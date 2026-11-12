"""H9 Hiring speed (Phase 5): how fast each role went from posted to a checked, available candidate, from real events.

  GET /api/company/{cid}/hire/speed     per role: minutes from posting to the first candidate shown, the first invite
                                        accepted, the first interview booked and the first offer sent; the share of
                                        roles that reached an interview or offer within 30 minutes; the funnel
  GET /api/admin/hire/supply            Admin: available candidates by city and by domain, next to live jobs

"Hired in 30 minutes" = an interview booked or an offer sent within 30 minutes of the job being posted. The badge on
the company's public page shows only when at least one real (not demo) role did that; nothing is estimated.
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Header

from app.admin.deps import AdminAuth
from app.companies.signup import company_for
from app.core.db import COMPANIES, DB, HIRE_INVITES, HIRE_OFFERS, HIRE_PROFILES, HIRE_SLOTS, JOBS, RESUMES, USERS
from app.core.time import now
from app.hire.available import available
from app.hire.templates import TEMPLATES
from app.jobs.public import live_filter
from app.jobsearch import skills as dictionary
from app.site import get_site

company = APIRouter(prefix="/api/company", tags=["hire in 30 minutes"])
admin = APIRouter(prefix="/api/admin/hire", tags=["hire in 30 minutes"])

GOAL = timedelta(minutes=30)
STEPS = ("shown", "accepted", "interview", "offer")


def minutes(a: datetime | None, b: datetime | None) -> int | None:
    if not a or not b:
        return None
    return max(0, round((b - a).total_seconds() / 60))


async def role_times(db, j: dict[str, Any]) -> dict[str, Any]:
    """{posted, shown, accepted, interview, offer} times for one job (None where it hasn't happened)."""
    jid = j["_id"]

    async def first(coll: str, q: dict[str, Any], field: str) -> datetime | None:
        d = await db[coll].find_one({"job_id": jid, **q, field: {"$ne": None}}, {field: 1}, sort=[(field, 1)])
        return (d or {}).get(field)

    return {
        "posted": j.get("posted_at") or j.get("created_at"),
        "shown": (j.get("hire_speed") or {}).get("first_shown_at"),
        "accepted": await first(HIRE_INVITES, {"status": "accepted"}, "answered_at"),
        "interview": await first(HIRE_SLOTS, {}, "booked_at"),
        "offer": await first(HIRE_OFFERS, {}, "created_at"),
    }


def in_goal(t: dict[str, Any]) -> bool:
    ends = [x for x in (t["interview"], t["offer"]) if x]
    return bool(t["posted"] and ends and min(ends) - t["posted"] <= GOAL)


def summary(roles: list[dict[str, Any]]) -> dict[str, Any]:
    active = [r for r in roles if r["minutes"]["shown"] is not None]
    hit = [r for r in active if r["in30"]]

    def avg(k: str) -> int | None:
        xs = [r["minutes"][k] for r in active if r["minutes"][k] is not None]
        return round(sum(xs) / len(xs)) if xs else None

    return {
        "roles": len(active),
        "in30": len(hit),
        "in30Pct": round(100 * len(hit) / len(active)) if active else 0,
        "avgMinutes": {k: avg(k) for k in STEPS},
    }


@company.get("/{cid}/hire/speed")
async def speed(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await company_for(db, cid, x_recruiter_account)
    roles = []
    async for j in db[JOBS].find({"company_id": cid}, {"description": 0}).sort("created_at", -1).limit(200):
        t = await role_times(db, j)
        roles.append({"id": j["_id"], "title": j["title"], "status": j["status"],
                      "minutes": {k: minutes(t["posted"], t[k]) for k in STEPS}, "in30": in_goal(t)})  # fmt: skip
    q = {"company_id": cid}
    funnel = {
        "invited": await db[HIRE_INVITES].count_documents(q),
        "accepted": await db[HIRE_INVITES].count_documents({**q, "status": "accepted"}),
        "interviews": await db[HIRE_SLOTS].count_documents({**q, "booked_at": {"$ne": None}}),
        "attended": await db[HIRE_SLOTS].count_documents({**q, "mark": "attended"}),
        "offers": await db[HIRE_OFFERS].count_documents({**q, "status": {"$ne": "withdrawn"}}),
        "offersAccepted": await db[HIRE_OFFERS].count_documents({**q, "status": {"$in": ["accepted", "joined"]}}),
        "joined": await db[HIRE_OFFERS].count_documents({**q, "status": "joined"}),
    }
    c = await db[COMPANIES].find_one({"_id": cid}, {"demo": 1})
    out = summary(roles)
    return {**out, "funnel": funnel, "items": roles, "badge": out["in30"] > 0 and not (c or {}).get("demo")}


async def hired_in_30(db, cid: str) -> bool:
    """The public badge: at least one real role reached an interview or offer within 30 minutes of posting."""
    c = await db[COMPANIES].find_one({"_id": cid}, {"demo": 1})
    if not c or c.get("demo"):
        return False
    async for j in db[JOBS].find({"company_id": cid, "demo": {"$ne": True}, "hire_speed.first_shown_at": {"$ne": None}},
                                 {"posted_at": 1, "created_at": 1, "hire_speed": 1}):  # fmt: skip
        if in_goal(await role_times(db, j)):
            return True
    return False


# --- the admin supply map -----------------------------------------------------------------------------------------

DOMAIN_OF: dict[str, str] = {}
for _t in TEMPLATES:
    for _s in _t["skills"]:
        DOMAIN_OF.setdefault(_s, _t["domain"])


def domain_for(skills_found: list[str]) -> str:
    """The template domain most of the person's skills belong to ("Other" when none)."""
    count: dict[str, int] = {}
    for s in skills_found:
        d = DOMAIN_OF.get(s)
        if d:
            count[d] = count.get(d, 0) + 1
    return max(sorted(count), key=lambda d: count[d]) if count else "Other"


@admin.get("/supply")
async def supply(db: DB, _: AdminAuth("companies")) -> dict[str, Any]:
    site = await get_site(db)
    t = now()
    days = int(site["hire"]["confirm_days"])
    q = {"on": True, "consent_at": {"$ne": None}, "paused_at": None, "confirmed_at": {"$gt": t - timedelta(days=days)}}
    profiles = [p async for p in db[HIRE_PROFILES].find(q) if available(p, site, t)]
    uq = {"_id": {"$in": [p["_id"] for p in profiles]}, "demo": {"$ne": True}}
    real = {u["_id"] async for u in db[USERS].find(uq, {"_id": 1})}
    cities: dict[str, int] = {}
    domains: dict[str, int] = {}
    remote = 0
    for p in profiles:
        if p["_id"] not in real:
            continue
        for c in p.get("cities") or []:
            cities[c.title()] = cities.get(c.title(), 0) + 1
        remote += bool(p.get("remote"))
        r = await db[RESUMES].find_one({"user_id": p["_id"], "active": True}, {"data": 1}) or {}
        text = (
            str((r.get("data") or {}).get("skillGroups") or "") + " " + str((r.get("data") or {}).get("summary") or "")
        )
        d = domain_for(dictionary.find(text))
        domains[d] = domains.get(d, 0) + 1
    demand: dict[str, int] = {}
    async for j in db[JOBS].find({"$and": [live_filter(), {"demo": {"$ne": True}}]}, {"locations": 1}):
        for c in j.get("locations") or []:
            demand[c.title()] = demand.get(c.title(), 0) + 1
    rows = sorted(set(cities) | set(demand), key=lambda c: (-cities.get(c, 0), c))
    return {
        "available": len(real),
        "remote": remote,
        "byCity": [{"city": c, "available": cities.get(c, 0), "liveJobs": demand.get(c, 0)} for c in rows[:50]],
        "byDomain": [{"domain": d, "available": n} for d, n in sorted(domains.items(), key=lambda x: (-x[1], x[0]))],
    }
