"""Salary ranges from Nm7's own job data (Phase 6: S1 uses it for a role's typical starting salary; S4 adds the guide).

A range is shown only when at least `salary_min_jobs` jobs (Admin → Settings, 10) with a salary match, from the last
90 days, never from demo jobs. Each job counts once, at the middle of its own range, in rupees a month; the range
shown is the middle half of those (25th to 75th percentile), rounded to ₹500. Fewer jobs: None, and the page says
"Not enough data yet". Nothing is ever estimated or filled in.
"""

import math
import re
from datetime import timedelta
from typing import Any

from app.core.db import JOBS
from app.core.time import now
from app.site import get_site

DAYS = 90
START = ("internship", "fresher", "0_1")  # "starting" salaries


def monthly_mid(s: dict[str, Any] | None) -> float | None:
    if not s or not (s.get("min") or s.get("max")):
        return None
    lo, hi = s.get("min") or s.get("max"), s.get("max") or s.get("min")
    mid = (lo + hi) / 2
    return mid / 12 if s.get("period", "yearly") == "yearly" else mid


def percentile(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def summarise(mids: list[float], need: int) -> dict[str, Any] | None:
    if len(mids) < need:
        return None
    r = lambda x: int(math.floor(x / 500.0 + 0.5) * 500)  # noqa: E731  (half up, the same way at both ends)
    return {"min": r(percentile(mids, 0.25)), "max": r(percentile(mids, 0.75)), "jobs": len(mids), "days": DAYS}


async def min_jobs(db) -> int:
    return int((await get_site(db)).get("seek", {}).get("salary_min_jobs", 10))


async def mids_for(db, words: list[str], city: str = "", levels: tuple[str, ...] | None = START) -> list[float]:
    since = now() - timedelta(days=DAYS)
    q: dict[str, Any] = {"salary": {"$ne": None}, "demo": {"$ne": True},
                         "status": {"$in": ["active", "closed", "paused"]}, "created_at": {"$gte": since},
                         "title": {"$regex": "|".join(re.escape(w) for w in words), "$options": "i"}}  # fmt: skip
    if levels:
        q["experience"] = {"$in": list(levels)}
    if city:
        q["locations"] = {"$regex": f"^{re.escape(city)}$", "$options": "i"}
    out = []
    async for j in db[JOBS].find(q, {"salary": 1}).limit(5000):
        m = monthly_mid(j.get("salary"))
        if m:
            out.append(m)
    return out


async def starting_range(db, role: dict[str, Any], city: str = "") -> dict[str, Any] | None:
    """The role's typical starting salary: in the city when it has enough jobs, else across India, else None."""
    need = await min_jobs(db)
    if city:
        got = summarise(await mids_for(db, role["words"], city), need)
        if got:
            return {**got, "city": city.title()}
    got = summarise(await mids_for(db, role["words"]), need)
    return {**got, "city": ""} if got else None


# --- S4: the salary guide ---------------------------------------------------------------------------------------------
#   GET /api/public/salaries?city=                  per role: starting, 1–3 years, 3+ years (each only with N jobs)
#   GET /api/public/salaries/lookup?title=&city=&experience=   the range for one job title (job pages)
#   GET /api/me/salary-hint?city=                   for Ready to join: the person's role (target role / role finder)

from fastapi import APIRouter, Query  # noqa: E402

from app.auth.deps import CustomerAuth  # noqa: E402
from app.core.db import DB, USERS  # noqa: E402
from app.seek.catalogue import ROLES  # noqa: E402

public = APIRouter(prefix="/api/public/salaries", tags=["job seekers"])
me = APIRouter(prefix="/api/me/salary-hint", tags=["job seekers"])

LEVELS = {"start": START, "1_3": ("1_3",), "3_plus": ("3_plus",)}
LEVEL_OF = {"internship": "start", "fresher": "start", "0_1": "start", "1_3": "1_3", "3_plus": "3_plus"}
_cache: dict[str, tuple[float, dict]] = {}
CACHE_S = 600


def role_for_title(title: str) -> dict[str, Any] | None:
    """The catalogue role whose words fit the title best (the longest matching word), else None."""
    t = (title or "").lower()
    best, size = None, 0
    for r in ROLES:
        for w in r["words"]:
            if re.search(rf"\b{re.escape(w)}\b", t) and len(w) > size:
                best, size = r, len(w)
    return best


async def range_for(db, role: dict[str, Any], city: str, level: str) -> dict[str, Any] | None:
    need = await min_jobs(db)
    got = summarise(await mids_for(db, role["words"], city, LEVELS[level]), need)
    return {**got, "city": city.title()} if got else None


@public.get("")
async def guide(db: DB, city: str = Query("", max_length=60)) -> dict[str, Any]:
    import time

    key = city.strip().lower()
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    rows = []
    for r in ROLES:
        levels = {lv: await range_for(db, r, key, lv) for lv in LEVELS}
        rows.append({"id": r["id"], "title": r["title"], "domain": r["domain"], "levels": levels})
    out = {"minJobs": await min_jobs(db), "days": DAYS, "city": key.title(), "roles": rows}
    _cache[key] = (time.monotonic(), out)
    return out


@public.get("/lookup")
async def lookup(
    db: DB,
    title: str = Query(..., min_length=2, max_length=160),
    city: str = Query("", max_length=60),
    experience: str = Query("fresher", max_length=20),
) -> dict[str, Any]:
    role = role_for_title(title)
    level = LEVEL_OF.get(experience, "start")
    if not role:
        return {"role": None, "level": level, "range": None}
    got = await range_for(db, role, city.strip(), level) if city.strip() else None
    got = got or await range_for(db, role, "", level)
    return {"role": {"id": role["id"], "title": role["title"]}, "level": level, "range": got}


@me.get("")
async def hint(auth: CustomerAuth, db: DB, city: str = Query("", max_length=60)) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": auth.user.id}, {"target_role": 1, "role_finder.picks": 1}) or {}
    by = {r["id"]: r for r in ROLES}
    picks = (u.get("role_finder") or {}).get("picks") or []
    role = role_for_title(u.get("target_role") or "") or (by.get(picks[0]) if picks else None)
    if not role:
        return {"role": None, "range": None}
    got = await range_for(db, role, city.strip(), "start") if city.strip() else None
    got = got or await range_for(db, role, "", "start")
    return {"role": {"id": role["id"], "title": role["title"]}, "range": got}
