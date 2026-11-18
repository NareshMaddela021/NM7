# ruff: noqa: E501  (dense response shapes)
"""Vetting Trust T6: self-serve knock-out questions (the company side) and the verified non-tech filters in Hire now.

  GET /api/company/{cid}/trust/knockouts     what the job form needs while the Trust switch lets this company in: up to
                                             8 questions, the templates, and the patterns of the questions it refuses
                                             (404 otherwise: the form stays as before, 5 questions)

Hire now (app/hire/shortlist.py calls `attach` and `apply_filters` only where the switch lets the company in): each
person gets `nonTech`, every item labelled with where it comes from:
  licence     DigiLocker (T2): "verified", with the classes of vehicle (two-wheeler, LMV, …); a test document only on
              a demo company or outside production, like the T2 badges
  vehicles    Work preferences: "self-declared"
  shifts      Work preferences (day / night / rotational, night shifts yes / no): "self-declared"
  distance    from the person's pin (location consent; rounded to ~1 km when stored) to the job's office pin or its
              city: only the rounded distance ("~4 km"), never a place or coordinates: "self-declared"
  languages   Work preferences: "self-declared" (T10 will add a verified spoken-English score)
  immediate   Work preferences (available now / no notice), else the Ready to join notice period: "self-declared"
Filters combine (AND); `counts` says how many people each filter would leave with the others as they are.
"""

from typing import Any

from fastapi import APIRouter, Header

from app.companies.signup import company_for
from app.core.config import get_settings
from app.core.db import DB, TRUST_DOCUMENTS, TRUST_WORK_PREFS
from app.core.errors import ApiError
from app.core.time import now
from app.trust import access
from app.trust import knockout as K
from app.trust import workprefs as W

company = APIRouter(prefix="/api/company", tags=["trust"])

VERIFIED = "verified"
SELF = "self-declared"
FILTER_KEYS = ("licence", "vehicle", "nightShift", "shift", "maxKm", "lang", "immediate")
PROBE = {
    "licence": "any",
    "vehicle": "two_wheeler",
    "nightShift": True,
    "shift": "night",
    "maxKm": 10,
    "immediate": True,
}
KM_STEPS = (2, 5, 10, 20, 50)


@company.get("/{cid}/trust/knockouts")
async def knockout_info(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return {
        "max": K.MAX_SELF_SERVE,
        "templates": [{k: t.get(k) for k in ("key", "text", "kind", "options", "want", "min", "accept") if t.get(k) is not None}
                      for t in K.TEMPLATES],
        "patterns": K.patterns(),
        "labels": {k: v["label"] for k, v in K.BLOCKED_TOPICS.items()},
        "kmSteps": list(KM_STEPS),
        "languages": list(W.LANGUAGES),
    }  # fmt: skip


def vehicle_kinds(classes: list[str]) -> dict[str, bool]:
    """Classes of vehicle on an Indian licence → two-wheeler (MCWG, MCWOG, MC 50CC, M/CYCL.WG) / LMV (cars) / heavy."""
    cs = [str(c).upper().replace("-", "") for c in classes or []]
    return {
        "twoWheeler": any(c.startswith(("MC", "MCYCL", "SCOOTER", "MOPED")) for c in cs),
        "lmv": any(c.startswith(("LMV", "LMVNT", "MOTORCAR")) for c in cs),
        "heavy": any(c.startswith(("HMV", "HGMV", "HPMV", "HTV", "TRANS", "MGV", "HGV")) for c in cs),
    }


def _labels(kinds: dict[str, bool]) -> list[str]:
    return [w for k, w in (("twoWheeler", "two-wheeler"), ("lmv", "LMV (car)"), ("heavy", "heavy vehicle")) if kinds[k]]


async def attach(db, rows: list[dict[str, Any]], job: dict[str, Any], c: dict[str, Any]) -> None:
    """Puts `nonTech` on each Hire now row (key = the person's id)."""
    from app.trust.digilocker.service import badge_ok

    uids = [r["key"] for r in rows]
    if not uids:
        return
    prefs = {p["_id"]: p async for p in db[TRUST_WORK_PREFS].find({"_id": {"$in": uids}})}
    show_test = bool(c.get("demo")) or not get_settings().is_prod
    dq: dict[str, Any] = {"user_id": {"$in": uids}, "kind": "dl"}
    if not show_test:
        dq["test"] = {"$ne": True}
    t = now()
    dls = {}
    async for d in db[TRUST_DOCUMENTS].find(dq, {"user_id": 1, "fields": 1, "review": 1, "verify_until": 1, "test": 1}):
        if badge_ok(d, t):
            dls[d["user_id"]] = d
    jp = W.job_point(job)
    for r in rows:
        p = prefs.get(r["key"]) or {}
        dl = dls.get(r["key"])
        lic = None
        if dl:
            classes = (dl.get("fields") or {}).get("classes") or []
            kinds = vehicle_kinds(classes)
            lic = {"classes": classes, **kinds, "kinds": _labels(kinds), "source": VERIFIED, "via": "DigiLocker",
                   "test": bool(dl.get("test"))}  # fmt: skip
        pp = W.point_of(p)
        dist = None
        if pp and jp:
            km = W.distance_km(pp, jp)
            dist = {"text": W.distance_text(km), "km": W.rounded_km(km), "source": SELF}
        av = r.get("availability") or {}
        if p.get("available_now") or p.get("notice_days") == 0:
            imm = True
        elif p.get("available_now") is False or (p.get("notice_days") or 0) > 0:
            imm = False
        else:
            imm = not int(av.get("noticeDays") or 0) and not av.get("joinDate")
        r["nonTech"] = {
            "licence": lic,
            "vehicles": {"value": p["vehicles"], "source": SELF} if p.get("vehicles") is not None else None,
            "shifts": {"value": p.get("shifts") or [], "nightShift": p.get("night_shift"), "source": SELF}
            if (p.get("shifts") or p.get("night_shift") is not None) else None,
            "distance": dist,
            "languages": [{"name": x, "source": SELF} for x in p.get("languages") or []],
            "immediate": {"value": imm, "source": SELF},
        }  # fmt: skip


def keep(nt: dict[str, Any], f: dict[str, Any], skip: str = "") -> bool:
    """Does one person pass the active filters (all but `skip`)?"""
    for k in FILTER_KEYS:
        v = f.get(k)
        if k == skip or v in (None, "", False, 0):
            continue
        if k == "licence":
            lic = nt.get("licence")
            if not lic or (v == "two_wheeler" and not lic["twoWheeler"]) or (v == "lmv" and not lic["lmv"]):
                return False
        elif k == "vehicle":
            have = (nt.get("vehicles") or {}).get("value") or []
            if not have or (v != "any" and v not in have):
                return False
        elif k == "nightShift":
            if not (nt.get("shifts") or {}).get("nightShift"):
                return False
        elif k == "shift":
            if v not in ((nt.get("shifts") or {}).get("value") or []):
                return False
        elif k == "maxKm":
            d = nt.get("distance")
            if not d or d["km"] > int(v):
                return False
        elif k == "lang":
            if str(v).lower() not in {x["name"].lower() for x in nt.get("languages") or []}:
                return False
        elif k == "immediate":
            if not (nt.get("immediate") or {}).get("value"):
                return False
    return True


def apply_filters(rows: list[dict[str, Any]], f: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int | None]]:
    """(the rows that pass every filter, how many each filter would leave: the others as they are, this one on)."""
    counts: dict[str, int | None] = {}
    for k in FILTER_KEYS:
        probe = f.get(k) or PROBE.get(k)
        if probe in (None, ""):
            counts[k] = None
            continue
        f2 = {**f, k: probe}
        counts[k] = sum(1 for r in rows if keep(r.get("nonTech") or {}, f2))
    return [r for r in rows if keep(r.get("nonTech") or {}, f)], counts
