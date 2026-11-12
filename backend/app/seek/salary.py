"""Salary ranges from Nm7's own job data (Phase 6: S1 uses it for a role's typical starting salary; S4 adds the guide).

A range is shown only when at least `salary_min_jobs` jobs (Admin → Settings, 10) with a salary match, from the last
90 days, never from demo jobs. Each job counts once, at the middle of its own range, in rupees a month; the range
shown is the middle half of those (25th to 75th percentile), rounded to ₹500. Fewer jobs: None, and the page says
"Not enough data yet". Nothing is ever estimated or filled in.
"""

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
    r = lambda x: int(round(x / 500.0) * 500)  # noqa: E731
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
