# ruff: noqa: E501  (dense response shapes)
"""Vetting V1, the stored side of the ladder (rules in levels.py):

- refresh(db, uid, why): recomputes one person's level from their data, stores it on the user (`vetting`), and logs
  every change in vetting_level_log (from, to, why, when). Called when something that feeds it changes (a V2 badge, a
  saved resume, "Ready to join" saved or confirmed, email verified) and by the hourly pass for everyone else.
- demand watch (hourly): live jobs (collector + company posts) counted by role × city × experience band; the top
  ones are "hot roles" for Admin and the V2 invites.
- ready shortlists (hourly): per hot role × city, the top 20 visible candidates by level, readiness and reliability,
  cached so Hire now can start from them; a person's entry is refreshed when their level or availability changes.
- freshness (weekly): "Still looking? Tap to confirm" — no reply in 7 days loses ⚡, 21 days hides them from Hire now.

  GET /api/me/level                         my level, ⚡, what to do next
  GET /api/admin/vetting/overview           counts per level, hot roles, shortlist health, freshness, success measures
"""

import logging
import re
from collections import Counter
from datetime import timedelta
from typing import Any

from fastapi import APIRouter

from app.admin.deps import AdminAuth
from app.auth.deps import CustomerAuth
from app.core.db import (
    APPLICATIONS,
    DB,
    HIRE_EVENTS,
    HIRE_INVITES,
    HIRE_PROFILES,
    HIRE_SLOTS,
    JOBS,
    RESUMES,
    USERS,
    VETTING_DEMAND,
    VETTING_LEVEL_LOG,
    VETTING_SHORTLISTS,
    VETTING_VERIFIED,
)
from app.core.time import now
from app.hire.vetting import levels as L
from app.hire.vetting.roles import ROLES
from app.me.service import ms

log = logging.getLogger(__name__)
me = APIRouter(prefix="/api/me/level", tags=["vetting"])
admin = APIRouter(prefix="/api/admin/vetting", tags=["vetting"])
HOT = 15  # hot role × city pairs kept
TOP = 20  # cached per pair


async def resume_score(db, uid: str) -> dict[str, Any] | None:
    from app.orgs.ats import ats_score
    from app.orgs.service import completeness

    r = await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
        {"user_id": uid}, sort=[("updated_at", -1)]
    )
    if not r:
        return None
    d = r.get("data") or {}
    pct, _ = completeness(d)
    try:
        ats = ats_score(d)["score"]
    except Exception:  # a resume the scorer can't read counts as not scored, never as an error page
        ats = None
    return {"complete": pct == 100, "ats": ats}


async def facts(db, uid: str, t=None) -> dict[str, Any] | None:
    t = t or now()
    u = await db[USERS].find_one(
        {"_id": uid}, {"email_verified_at": 1, "vetting_l3_until": 1, "vetting_l4_until": 1, "vetting": 1}
    )
    if not u:
        return None
    p = await db[HIRE_PROFILES].find_one({"_id": uid})
    badges = await db[VETTING_VERIFIED].find({"user_id": uid}).to_list(60)
    return {"user": u, "profile": p, "f": L.inputs_from(u, p, await resume_score(db, uid), badges, t)}


async def refresh(db, uid: str, why: str) -> dict[str, Any] | None:
    """Recompute and store; log a change of level or ⚡. Returns the level dict."""
    t = now()
    x = await facts(db, uid, t)
    if not x:
        return None
    lv = L.level_of(x["f"])
    old = x["user"].get("vetting") or {}
    stored = {"level": lv["level"], "ready_now": lv["readyNow"], "visible": L.visible(x["f"]), "next": lv["next"],
              "skill_verified": x["f"]["skillVerified"], "at": t}  # fmt: skip
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting": stored}})
    if old.get("level") != lv["level"] or bool(old.get("ready_now")) != lv["readyNow"]:
        await db[VETTING_LEVEL_LOG].insert_one({"user_id": uid, "from": old.get("level"), "to": lv["level"],
                                                "ready_from": old.get("ready_now"), "ready_to": lv["readyNow"],
                                                "why": why, "at": t})  # fmt: skip
        await db[VETTING_SHORTLISTS].update_many({"users": uid}, {"$set": {"stale": True}})  # rebuild on next pass
    return lv


@me.get("")
async def my_level(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    lv = await refresh(db, auth.user.id, "viewed")
    hist = [{"from": h.get("from"), "to": h["to"], "why": h["why"], "at": ms(h["at"])}
            async for h in db[VETTING_LEVEL_LOG].find({"user_id": auth.user.id}).sort("at", -1).limit(10)]  # fmt: skip
    return {**lv, "levels": L.LEVELS, "readyDays": L.READY_DAYS, "hideDays": L.HIDE_DAYS, "history": hist}


async def refresh_all(db, limit: int = 3000) -> int:
    """The hourly pass: people whose level may have changed with time (⚡ lapsing, badges expiring) or whose data
    changed since their level was last worked out."""
    t = now()
    n = 0
    q = {"$or": [{"vetting": {"$exists": False}}, {"vetting.at": {"$lt": t - timedelta(hours=1)}}],
         "deleted_at": None, "email_verified_at": {"$ne": None}}  # fmt: skip
    async for u in db[USERS].find(q, {"_id": 1}).limit(limit):
        await refresh(db, u["_id"], "hourly")
        n += 1
    return n


# --- demand watch and ready shortlists ------------------------------------------------------------------------


def role_of_title(title: str) -> str | None:
    """The V2 test a job title belongs to (first role whose main word is in the title)."""
    low = title.lower()
    for r in ROLES:
        words = [
            w
            for w in re.findall(r"[a-z]{3,}", r["role"].lower())
            if w not in {"and", "executive", "staff", "junior", "developer"}
        ]
        if words and words[0] in low:
            return r["test"]
    return None


def band_of_job(j: dict[str, Any]) -> str:
    """A job's experience field (jobs.model.EXPERIENCE) as a V2 band."""
    e = str(j.get("experience") or "fresher")
    return {
        "internship": "fresher",
        "fresher": "fresher",
        "0_1": "fresher",
        "1_3": "1-3",
        "3_5": "3-5",
        "3_plus": "3-5",
        "5_8": "5-8",
        "8_12": "8+",
        "12_15": "8+",
        "15_plus": "8+",
    }.get(e, "fresher")


async def demand_watch(db) -> list[dict[str, Any]]:
    t = now()
    c: Counter[tuple[str, str, str]] = Counter()
    async for j in (
        db[JOBS]
        .find({"status": "active", "demo": {"$ne": True}}, {"title": 1, "locations": 1, "experience": 1})
        .limit(20000)
    ):
        role = role_of_title(j.get("title", ""))
        if not role:
            continue
        for city in (j.get("locations") or ["Anywhere"])[:3]:
            c[(role, str(city).split(",")[0].strip() or "Anywhere", band_of_job(j))] += 1
    rows = [{"role": r, "city": city, "band": b, "jobs": n} for (r, city, b), n in c.most_common(200)]
    await db[VETTING_DEMAND].update_one({"_id": "latest"}, {"$set": {"rows": rows, "at": t}}, upsert=True)
    return rows


async def hot_pairs(db) -> list[dict[str, Any]]:
    d = await db[VETTING_DEMAND].find_one({"_id": "latest"}) or {}
    pairs: Counter[tuple[str, str]] = Counter()
    for r in d.get("rows") or []:
        pairs[(r["role"], r["city"])] += r["jobs"]
    return [{"role": r, "city": c, "jobs": n} for (r, c), n in pairs.most_common(HOT)]


async def build_shortlists(db) -> int:
    """Top 20 visible candidates per hot role × city: a current badge for the role first, then level, ⚡, reliability."""
    from app.hire.reliability import reliability_for

    t = now()
    built = 0
    for pair in await hot_pairs(db):
        role, city = pair["role"], pair["city"]
        q = {"on": True, "consent_at": {"$ne": None}, "paused_at": None,
             "confirmed_at": {"$gt": t - timedelta(days=L.HIDE_DAYS)}}  # fmt: skip
        if city != "Anywhere":
            q["$or"] = [{"cities": {"$regex": f"^{re.escape(city)}", "$options": "i"}}, {"remote": True}]
        profiles = await db[HIRE_PROFILES].find(q, {"_id": 1, "confirmed_at": 1}).limit(2000).to_list(2000)
        uids = [p["_id"] for p in profiles]
        users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}, "deleted_at": None}, {"vetting": 1})}
        badges = {
            v["user_id"]
            async for v in db[VETTING_VERIFIED].find(
                {"user_id": {"$in": uids}, "test": role, "expires_at": {"$gt": t}}, {"user_id": 1}
            )
        }
        rel = await reliability_for(db, uids, t)
        ranked = sorted(
            (u for u in uids if u in users),
            key=lambda u: (u not in badges, -int((users[u].get("vetting") or {}).get("level") or 0),
                           not (users[u].get("vetting") or {}).get("ready_now"), -(rel[u].get("score") or 70)),
        )[:TOP]  # fmt: skip
        await db[VETTING_SHORTLISTS].update_one(
            {"_id": f"{role}|{city}"},
            {
                "$set": {
                    "role": role,
                    "city": city,
                    "jobs": pair["jobs"],
                    "users": ranked,
                    "ready": len(ranked),
                    "at": t,
                    "stale": False,
                }
            },
            upsert=True,
        )
        built += 1
    return built


async def cached_ids(db, role: str | None, city: str | None) -> list[str] | None:
    """The cached top people for this role × city, when fresh (an hour) and not marked stale."""
    if not role:
        return None
    doc = await db[VETTING_SHORTLISTS].find_one({"_id": f"{role}|{city or 'Anywhere'}"})
    if not doc or doc.get("stale") or doc["at"] < now() - timedelta(hours=1):
        return None
    return doc["users"]


# --- Admin → Vetting overview ---------------------------------------------------------------------------------


@admin.get("/overview")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    t = now()
    per = Counter()
    ready = 0
    visible = 0
    async for u in db[USERS].find(
        {"vetting": {"$exists": True}, "deleted_at": None, "demo": {"$ne": True}}, {"vetting": 1}
    ):
        v = u["vetting"]
        per[int(v.get("level") or 0)] += 1
        ready += bool(v.get("ready_now"))
        visible += bool(v.get("visible"))
    seen_l2 = 0
    async for u in db[USERS].find({"vetting.visible": True, "demo": {"$ne": True}}, {"vetting.level": 1}):
        seen_l2 += int((u.get("vetting") or {}).get("level") or 0) >= 2
    lists = [{"role": d["role"], "city": d["city"], "jobs": d.get("jobs", 0), "ready": d.get("ready", 0), "low": d.get("ready", 0) < 5,
              "at": ms(d["at"])} async for d in db[VETTING_SHORTLISTS].find({}).sort("jobs", -1).limit(50)]  # fmt: skip
    # freshness: of the reminders sent in the last 30 days, how many confirmed within 7 days
    asked = await db[HIRE_PROFILES].count_documents({"reminded_at": {"$gt": t - timedelta(days=30)}})
    replied = await db[HIRE_PROFILES].count_documents(
        {"reminded_at": {"$gt": t - timedelta(days=30)}, "$expr": {"$gt": ["$confirmed_at", "$reminded_at"]}}
    )
    # success measures (real events only; "no data yet" when there is none)
    since = t - timedelta(days=30)
    times = []
    async for j in (
        db[JOBS]
        .find(
            {"created_at": {"$gt": since}, "hire_speed.first_booked_at": {"$exists": True}},
            {"created_at": 1, "hire_speed": 1},
        )
        .limit(2000)
    ):
        times.append((j["hire_speed"]["first_booked_at"] - j["created_at"]).total_seconds() / 60)
    shows = await db[HIRE_EVENTS].count_documents({"kind": "attended", "at": {"$gt": since}})
    noshow = await db[HIRE_EVENTS].count_documents({"kind": "no_show", "at": {"$gt": since}})
    return {
        "levels": [{"level": k, "label": L.LEVELS[k], "people": per.get(k, 0)} for k in range(5)],
        "readyNow": ready, "visible": visible, "hot": await hot_pairs(db), "shortlists": lists,
        "freshness": {"asked": asked, "replied": replied, "rate": round(100 * replied / asked) if asked else None},
        "measures": {
            "firstInterviewMinutes": round(sorted(times)[len(times) // 2]) if times else None,
            "shareL2Plus": round(100 * seen_l2 / visible) if visible else None,
            "pairs5Plus": round(100 * sum(not x["low"] for x in lists) / len(lists)) if lists else None,
            "showUp": round(100 * shows / (shows + noshow)) if shows + noshow else None,
            "shortlistRating": None, "appealsUpheld": None, "aiPerVetted": None,
        },
        "targets": {"firstInterviewMinutes": 60, "shareL2Plus": 70, "pairs5Plus": 80, "showUp": 75, "shortlistRating": 4,
                    "appealsUpheld": 5, "aiPerVetted": 10},
        "at": ms(t),
    }  # fmt: skip


async def hourly(db) -> dict[str, int]:
    return {
        "levels": await refresh_all(db),
        "demand": len(await demand_watch(db)),
        "shortlists": await build_shortlists(db),
    }


__all__ = ["APPLICATIONS", "HIRE_INVITES", "HIRE_SLOTS"]  # kept for the overview's later measures (V3–V5)


async def hourly_if_due(db) -> dict[str, int]:
    """The automation pass runs often; the V1 hourly work runs once an hour (the demand snapshot's time says when)."""
    d = await db[VETTING_DEMAND].find_one({"_id": "latest"}, {"at": 1})
    if d and d.get("at") and d["at"] > now() - timedelta(minutes=55):
        return {}
    return await hourly(db)
