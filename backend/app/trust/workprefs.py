# ruff: noqa: E501  (dense tables and consent text)
"""Vetting Trust T6: Work preferences, the location pin, distance to a job, and saved answers that are never asked twice.

Work preferences (Profile & settings → Work preferences; one row per person in `trust_work_prefs`, all self-declared):
  shifts (day / night / rotational), night shifts yes / no, weekends yes / no, vehicles owned (two-wheeler, car,
  bicycle, or none), languages spoken, notice period (days) and "available now", willing to relocate.
They answer the common knock-out questions (app/trust/knockout.TEMPLATES) for every job: saving them writes the same
answers into the saved-answer store Auto Apply already uses (`users.auto_apply.answers`, keyed by the question's
words), so the apply form, Auto Apply 2.0 and the calling agent (T5) all read one place, and an answer given in any of
them is saved there too (and a template answer updates the matching preference).

The location pin needs its own consent ("location"): the browser's position (or a city picked from the list) is
rounded to 2 decimals (about 1 km) before it is stored; the exact position never reaches the server. Companies never
see it: Hire now shows only the distance to the job, rounded ("~4 km"). Kept 365 days from when it was set (Admin can
change it, 30–730) and deleted at once when the consent is taken back or the person removes it.

  GET    /api/me/trust/work                   preferences, the pin's label, consent, saved answers, answers I gave
  PUT    /api/me/trust/work {…}               save the preferences (and their saved answers)
  PUT    /api/me/trust/work/location {lat, lng} | {city}   set the pin (needs the location consent)
  DELETE /api/me/trust/work/location          remove the pin
  DELETE /api/me/trust/work/saved/{key}       forget one saved answer (it is asked again next time)
"""

import math
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field, field_validator, model_validator

from app.auth.deps import CustomerAuth
from app.core.db import APPLICATIONS, DB, JOBS, TRUST_DOCUMENTS, TRUST_WORK_PREFS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.trust import access
from app.trust import consent as C
from app.trust import knockout as K
from app.trust import retention as R

me = APIRouter(prefix="/api/me/trust/work", tags=["trust"], dependencies=[access.ON])

PURPOSE = "location"
SHIFTS = ("day", "night", "rotational")
VEHICLES = ("two_wheeler", "car", "bicycle")
LANGUAGES = ("English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi",
             "Odia", "Urdu", "Assamese")  # fmt: skip
INDIA = (6.0, 37.6, 68.0, 97.5)  # lat min / max, lng min / max
DECIMALS = 2  # about 1.1 km

# City centres (rounded) for a city picked instead of a pin, and for a job without its own office pin.
CITY_COORDS: dict[str, tuple[float, float]] = {
    "Bengaluru": (12.97, 77.59), "Mumbai": (19.08, 72.88), "Navi Mumbai": (19.03, 73.03), "Thane": (19.22, 72.98),
    "Pune": (18.52, 73.86), "Hyderabad": (17.39, 78.49), "Secunderabad": (17.44, 78.5), "Chennai": (13.08, 80.27),
    "Kolkata": (22.57, 88.36), "Delhi": (28.65, 77.23), "New Delhi": (28.61, 77.21), "Noida": (28.54, 77.39),
    "Greater Noida": (28.47, 77.5), "Gurugram": (28.46, 77.03), "Faridabad": (28.41, 77.32), "Ghaziabad": (28.67, 77.45),
    "Ahmedabad": (23.02, 72.57), "Gandhinagar": (23.22, 72.65), "Surat": (21.17, 72.83), "Vadodara": (22.31, 73.18),
    "Rajkot": (22.3, 70.8), "Jaipur": (26.91, 75.79), "Lucknow": (26.85, 80.95), "Kanpur": (26.45, 80.33),
    "Indore": (22.72, 75.86), "Bhopal": (23.26, 77.41), "Nagpur": (21.15, 79.09), "Nashik": (20.0, 73.79),
    "Aurangabad": (19.88, 75.34), "Coimbatore": (11.02, 76.96), "Madurai": (9.93, 78.12), "Tiruchirappalli": (10.79, 78.7),
    "Salem": (11.66, 78.15), "Kochi": (9.93, 76.27), "Thiruvananthapuram": (8.52, 76.94), "Kozhikode": (11.26, 75.78),
    "Mysuru": (12.3, 76.64), "Mangaluru": (12.91, 74.86), "Visakhapatnam": (17.69, 83.22), "Vijayawada": (16.51, 80.65),
    "Guntur": (16.31, 80.44), "Warangal": (17.97, 79.6), "Tirupati": (13.63, 79.42), "Nellore": (14.44, 79.99),
    "Kakinada": (16.99, 82.25), "Rajahmundry": (17.0, 81.8), "Karimnagar": (18.44, 79.13), "Bhubaneswar": (20.3, 85.82),
    "Patna": (25.59, 85.14), "Ranchi": (23.34, 85.31), "Guwahati": (26.14, 91.74), "Chandigarh": (30.73, 76.78),
    "Mohali": (30.7, 76.72), "Ludhiana": (30.9, 75.86), "Amritsar": (31.63, 74.87), "Dehradun": (30.32, 78.03),
    "Raipur": (21.25, 81.63), "Goa": (15.5, 73.83), "Panaji": (15.49, 73.83), "Prayagraj": (25.44, 81.85),
    "Varanasi": (25.32, 82.97), "Agra": (27.18, 78.01), "Meerut": (28.98, 77.71), "Jodhpur": (26.24, 73.02),
    "Udaipur": (24.59, 73.71), "Hubballi": (15.36, 75.12), "Belagavi": (15.85, 74.5), "Jamshedpur": (22.8, 86.2),
}  # fmt: skip

C.add_purpose(C.Purpose(PURPOSE, "Your location for distance to jobs",
    "If you share your location, we store it rounded to about 1 km (never your exact position) to work out how far each job is from you. "
    "Companies never see your location: in Hire now they see only the distance, rounded (for example “~4 km”). "
    "You can pick your city instead of sharing a pin. We keep it for {days} days from when you set it, then delete it. "
    "If you take this back, it is deleted now.", 1, "location"))  # fmt: skip


async def _clean_location(db, cutoff: datetime, cap: int) -> int:
    ids = [d["_id"] async for d in db[TRUST_WORK_PREFS].find({"location.at": {"$lt": cutoff}}, {"_id": 1}).limit(cap)]
    if not ids:
        return 0
    return (await db[TRUST_WORK_PREFS].update_many({"_id": {"$in": ids}}, {"$unset": {"location": ""}})).modified_count


async def _erase_location(db, uid: str) -> int:
    return (
        await db[TRUST_WORK_PREFS].update_one({"_id": uid, "location": {"$exists": True}}, {"$unset": {"location": ""}})
    ).modified_count


R.register(R.DataType("location", "Your location pin for distance to jobs (rounded to about 1 km)", 365, 30, 730,
                      clean=_clean_location, erase=_erase_location, purpose=PURPOSE,
                      note="Deleted by the daily job, or now when the Location consent is taken back"))  # fmt: skip
R.register(R.DataType("work_prefs", "Work preferences (shifts, vehicle, languages, notice period)", 730, 180, 1095,
                      TRUST_WORK_PREFS, field="updated_at", user_field="_id",
                      note="Deleted 2 years after the last change (daily job), or with the account"))  # fmt: skip


# --- location and distance ---------------------------------------------------------------------------------------------


def coarse(lat: float, lng: float) -> tuple[float, float]:
    """Rounded to about 1 km. Raises ValueError outside India."""
    lat, lng = float(lat), float(lng)
    if not (INDIA[0] <= lat <= INDIA[1] and INDIA[2] <= lng <= INDIA[3]):
        raise ValueError("outside India")
    return round(lat, DECIMALS), round(lng, DECIMALS)


def city_point(name: str) -> tuple[float, float] | None:
    from app.jobsearch.parse import canonical_city

    c = canonical_city(name or "")
    return CITY_COORDS.get(c) or next((v for k, v in CITY_COORDS.items() if k.lower() == c.lower()), None)


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance (km)."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def rounded_km(km: float) -> int:
    """What a company may see: 1 km steps up to 10, 5 km steps up to 50, then 10 km steps (never below 1)."""
    if km < 10:
        return max(1, round(km))
    if km < 50:
        return int(5 * round(km / 5))
    return int(10 * round(km / 10))


def distance_text(km: float) -> str:
    return f"~{rounded_km(km)} km"


def job_point(j: dict[str, Any]) -> tuple[float, float] | None:
    """The job's office pin (T6, rounded like a person's), else its first city's centre; None for a remote job."""
    if j.get("remote") or j.get("work_type") == "remote":
        return None
    g = j.get("geo") or {}
    if g.get("lat") is not None and g.get("lng") is not None:
        return float(g["lat"]), float(g["lng"])
    for c in j.get("locations") or []:
        if p := city_point(c.split(",")[0]):
            return p
    return None


def nearest_city(p: tuple[float, float]) -> str:
    return min(CITY_COORDS, key=lambda k: distance_km(p, CITY_COORDS[k]))


def point_of(prefs: dict[str, Any] | None) -> tuple[float, float] | None:
    loc = (prefs or {}).get("location") or {}
    return (loc["lat"], loc["lng"]) if loc.get("lat") is not None else None


# --- preferences and the answers they give -----------------------------------------------------------------------------


async def get(db, uid: str) -> dict[str, Any]:
    return await db[TRUST_WORK_PREFS].find_one({"_id": uid}) or {"_id": uid}


async def licence_verified(db, uid: str) -> bool:
    from app.trust.digilocker.service import badge_ok

    row = await db[TRUST_DOCUMENTS].find_one({"user_id": uid, "kind": "dl"})
    return bool(row and badge_ok(row))


def pref_answer(t: dict[str, Any], p: dict[str, Any], licence: bool = False) -> Any:
    """The answer Work preferences give to one template question, or None."""
    pref = t.get("pref")
    if pref in ("night_shift", "relocate", "weekends"):
        v = p.get(pref)
        return None if v is None else ("yes" if v else "no")
    if pref == "vehicle":
        v = p.get("vehicles")
        return None if v is None else ("yes" if "two_wheeler" in v else "no")
    if pref == "available_now":
        if p.get("available_now") or p.get("notice_days") == 0:
            return "yes"
        if p.get("available_now") is False or (p.get("notice_days") or 0) > 0:
            return "no"
        return None
    if pref == "licence":
        return "yes" if licence else None  # only a DigiLocker-verified licence answers it; else the person is asked
    if pref == "shift":
        s = p.get("shifts") or []
        return s[0].title() if len(s) == 1 else None
    if pref == "notice_days":
        return p.get("notice_days")
    return None


def _store_key(text: str) -> str:
    from app.autoapply.engine import norm

    return norm(text)


async def sync_store(db, uid: str, p: dict[str, Any]) -> None:
    """Work preferences → the saved answers of the template questions (Auto Apply, the apply form, the agent)."""
    lic = await licence_verified(db, uid)
    sets, unsets = {}, {}
    for t in K.TEMPLATES:
        if not t.get("pref"):
            continue
        a = pref_answer(t, p, lic)
        key = f"auto_apply.answers.{_store_key(t['text'])}"
        if a is None:
            if t["pref"] != "licence":
                unsets[key] = ""
        else:
            sets[key] = a
    upd: dict[str, Any] = {}
    if sets:
        upd["$set"] = sets
    if unsets:
        upd["$unset"] = unsets
    if upd:
        await db[USERS].update_one({"_id": uid}, upd)


REVERSE = {"night_shift": "night_shift", "relocate": "relocate", "weekends": "weekends"}


async def remember(db, uid: str, qs: list[dict[str, Any]], given: dict[str, Any]) -> None:
    """Answers given on the apply form / the agent: saved for later jobs, and a template answer updates the matching
    preference (so Work preferences always says what the person last said)."""
    texts = {q["id"]: q for q in qs}
    sets = {f"auto_apply.answers.{_store_key(texts[k]['text'])}": v for k, v in given.items() if k in texts}
    if not sets:
        return
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    p = await get(db, uid)
    ch: dict[str, Any] = {}
    for k, v in given.items():
        t = K.template_for(texts.get(k) or {})
        if not t or not t.get("pref"):
            continue
        pref = t["pref"]
        if pref in REVERSE and v in ("yes", "no"):
            ch[pref] = v == "yes"
        elif pref == "vehicle" and v in ("yes", "no"):
            have = set(p.get("vehicles") or [])
            have = have | {"two_wheeler"} if v == "yes" else have - {"two_wheeler"}
            ch["vehicles"] = sorted(have)
        elif pref == "available_now" and v in ("yes", "no"):
            ch["available_now"] = v == "yes"
            if v == "yes":
                ch["notice_days"] = 0
        elif pref == "notice_days" and isinstance(v, int):
            ch["notice_days"] = v
        elif pref == "shift" and isinstance(v, str) and v.lower() in SHIFTS:
            ch["shifts"] = [v.lower()]
    if ch:
        t = now()
        await db[TRUST_WORK_PREFS].update_one(
            {"_id": uid}, {"$set": {**ch, "updated_at": t}, "$setOnInsert": {"created_at": t}}, upsert=True
        )


async def known_answers(db, uid: str, j: dict[str, Any]) -> dict[str, Any]:
    """The answers this person already gave to this job's questions (Work preferences first, then saved answers),
    checked like answers on the form. The questions left are the only ones asked."""
    from app.companies import questions as qmod

    qs = j.get("questions") or []
    if not qs:
        return {}
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply.answers": 1}) or {}
    saved = (u.get("auto_apply") or {}).get("answers") or {}
    p = await get(db, uid)
    lic = None
    given: dict[str, Any] = {}
    for q in qs:
        t = K.template_for(q)
        a = None
        if t and t.get("pref") and t["kind"] == q["kind"]:
            if t["pref"] == "licence" and lic is None:
                lic = await licence_verified(db, uid)
            a = pref_answer(t, p, bool(lic))
        if a is None:
            a = saved.get(_store_key(q["text"]))
        if a is not None:
            given[q["id"]] = a
    ok, _ = qmod.answers_for([q for q in qs if q["id"] in given], given)
    return ok


# --- the candidate's endpoints -----------------------------------------------------------------------------------------


class PrefsIn(CamelModel):
    shifts: list[Literal["day", "night", "rotational"]] = Field(default_factory=list, max_length=3)
    night_shift: bool | None = None
    weekends: bool | None = None
    vehicles: list[Literal["two_wheeler", "car", "bicycle"]] | None = Field(None, max_length=3)  # [] = none
    languages: list[str] = Field(default_factory=list, max_length=8)
    notice_days: int | None = Field(None, ge=0, le=180)
    available_now: bool | None = None
    relocate: bool | None = None

    @field_validator("languages")
    @classmethod
    def _langs(cls, v: list[str]) -> list[str]:
        out = []
        for x in v:
            m = next((lang for lang in LANGUAGES if lang.lower() == str(x).strip().lower()), None)
            if m and m not in out:
                out.append(m)
        return out

    @model_validator(mode="after")
    def _shape(self) -> "PrefsIn":
        self.shifts = sorted(set(self.shifts), key=SHIFTS.index)
        if self.vehicles is not None:
            self.vehicles = sorted(set(self.vehicles))
        if self.night_shift is None and self.shifts:
            self.night_shift = "night" in self.shifts or "rotational" in self.shifts
        if self.available_now:
            self.notice_days = 0
        return self


class LocationIn(CamelModel):
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    city: str = Field("", max_length=60)


def prefs_out(p: dict[str, Any]) -> dict[str, Any]:
    loc = p.get("location") or {}
    return {
        "shifts": p.get("shifts") or [], "nightShift": p.get("night_shift"), "weekends": p.get("weekends"),
        "vehicles": p.get("vehicles"), "languages": p.get("languages") or [], "noticeDays": p.get("notice_days"),
        "availableNow": p.get("available_now"), "relocate": p.get("relocate"), "updatedAt": ms(p.get("updated_at")),
        "location": {"label": loc.get("label", ""), "source": loc.get("source", ""), "at": ms(loc.get("at"))} if loc else None,
    }  # fmt: skip


async def my_answers(db, uid: str) -> list[dict[str, Any]]:
    """The answers I gave to companies' questions, per application (the questions, never the companies' rules)."""
    rows = await db[APPLICATIONS].find(
        {"user_id": uid, "company_id": {"$exists": True}, "answers": {"$ne": {}}},
        {"job_id": 1, "role": 1, "company": 1, "answers": 1, "created_at": 1, "origin": 1},
    ).sort("created_at", -1).limit(30).to_list(30)  # fmt: skip
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": [r["job_id"] for r in rows]}}, {"questions": 1})}
    out = []
    for r in rows:
        texts = {q["id"]: q["text"] for q in (jobs.get(r["job_id"]) or {}).get("questions") or []}
        items = [{"q": texts.get(k, k), "a": v} for k, v in (r.get("answers") or {}).items() if k in texts]
        if items:
            out.append({"role": r.get("role", ""), "company": r.get("company", ""), "at": ms(r.get("created_at")),
                        "via": r.get("origin") or "you", "items": items})  # fmt: skip
    return out


async def _state(db, uid: str) -> dict[str, Any]:
    p = await get(db, uid)
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply.answers": 1}) or {}
    saved = (u.get("auto_apply") or {}).get("answers") or {}
    return {
        "prefs": prefs_out(p),
        "locationConsent": await C.has(db, uid, PURPOSE),
        "consentText": C.text_of(C.PURPOSES[PURPOSE], await _site(db)),
        "languages": list(LANGUAGES),
        "cities": sorted(CITY_COORDS),
        "saved": [{"key": k, "question": k[:1].upper() + k[1:] + "?", "answer": v} for k, v in sorted(saved.items())][
            :60
        ],
        "answers": await my_answers(db, uid),
        "verified": await verified_languages(db, uid),  # T10: English "verified (B2)" where measured
    }


async def verified_languages(db, uid: str) -> dict[str, dict[str, Any]]:
    """{"English": {band, label, source}} when the T10 spoken-English score measured it."""
    from app.trust.spoken.service import SOURCE, latest

    row = await latest(db, uid)
    return {"English": {"band": row["band"], "label": f"verified ({row['band']})", "source": SOURCE}} if row else {}


async def _site(db) -> dict[str, Any]:
    from app.site import get_site

    return await get_site(db)


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _state(db, auth.user.id)


@me.put("")
async def save(body: PrefsIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    t = now()
    sets = {**body.model_dump(), "updated_at": t}
    await db[TRUST_WORK_PREFS].update_one({"_id": uid}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True)
    await sync_store(db, uid, await get(db, uid))
    return await _state(db, uid)


@me.put("/location")
async def set_location(body: LocationIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    await C.require(db, uid, PURPOSE)
    if body.lat is not None and body.lng is not None:
        try:
            lat, lng = coarse(body.lat, body.lng)
        except ValueError:
            raise ApiError(400, "outside", "That place is outside India. Pick your city instead.") from None
        loc = {
            "lat": lat,
            "lng": lng,
            "source": "pin",
            "label": f"Near {nearest_city((lat, lng))} (rounded to about 1 km)",
        }
    elif body.city:
        p = city_point(body.city)
        if not p:
            raise ApiError(400, "unknown_city", "Pick a city from the list.")
        loc = {"lat": p[0], "lng": p[1], "source": "city", "label": nearest_city(p)}
    else:
        raise ApiError(400, "nothing", "Share your location or pick your city.")
    t = now()
    await db[TRUST_WORK_PREFS].update_one({"_id": uid}, {"$set": {"location": {**loc, "at": t}, "updated_at": t},
                                                         "$setOnInsert": {"created_at": t}}, upsert=True)  # fmt: skip
    return await _state(db, uid)


@me.delete("/location")
async def remove_location(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    await _erase_location(db, auth.user.id)
    return await _state(db, auth.user.id)


@me.delete("/saved/{key}")
async def forget(key: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    if not key or "." in key or "$" in key or len(key) > 200:
        raise ApiError(404, "not_found", "There is no such saved answer.")
    await db[USERS].update_one({"_id": auth.user.id}, {"$unset": {f"auto_apply.answers.{key}": ""}})
    return await _state(db, auth.user.id)
