"""Auto Apply 2.0 candidate rules: what Nm7 may apply to for this person. Stored additively on the same settings doc as
today's Auto Apply (users.auto_apply), so the old fields keep their meaning:

    roles             job titles or skills (the old `roles`)
    cities, remote    where (the old `cities` / `remote`)
    experience        experience bands (the old `experience`, app/jobs/model.py EXPERIENCE)
    min_salary        rupees a year (the old `min_salary`)
    notice_period     NEW: immediate / 15 / 30 / 60 / 90 days (used for ready answers, never invented)
    job_types         full-time, internship, ... (the old `job_types`)
    avoid             blocked companies (the old `avoid`: names; a part of the name is enough)
    daily_limit       default 10, at most 25 in 2.0 (Admin → Auto Apply 2.0)
    mode              NEW: full_auto · approve (DEFAULT, a morning list with "Approve all") · digest (weekly list)

`check(job, rules)` is the one rules filter (the morning run passes every job through it after the database query).
"""

import re
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import CamelModel
from app.jobs.model import EXPERIENCE, JOB_TYPES, with_older

MODES = ("full_auto", "approve", "digest")
DEFAULT_MODE = "approve"
NOTICE = {
    "immediate": "I can join immediately",
    "15_days": "My notice period is 15 days",
    "30_days": "My notice period is 30 days",
    "60_days": "My notice period is 60 days",
    "90_days": "My notice period is 90 days",
}


def _words(v: list[str], n: int, size: int = 60) -> list[str]:
    out: list[str] = []
    for x in v:
        x = " ".join(str(x).split())[:size]
        if x and x.lower() not in (o.lower() for o in out):
            out.append(x)
    return out[:n]


class RulesIn(CamelModel):
    roles: list[str] = Field(default_factory=list, max_length=20)
    cities: list[str] = Field(default_factory=list, max_length=20)
    remote: bool = True
    experience: list[Literal[tuple(EXPERIENCE)]] = Field(default_factory=list, max_length=11)  # type: ignore[valid-type]
    min_salary: int | None = Field(None, ge=0, le=10_000_000)
    notice_period: Literal[tuple(NOTICE)] | None = None  # type: ignore[valid-type]
    job_types: list[Literal[tuple(JOB_TYPES)]] = Field(default_factory=list, max_length=4)  # type: ignore[valid-type]
    avoid: list[str] = Field(default_factory=list, max_length=30)
    daily_limit: int = Field(10, ge=1, le=25)
    mode: Literal[MODES] = DEFAULT_MODE  # type: ignore[valid-type]

    @field_validator("roles", "cities")
    @classmethod
    def _short(cls, v: list[str]) -> list[str]:
        return _words(v, 10)

    @field_validator("avoid")
    @classmethod
    def _avoid(cls, v: list[str]) -> list[str]:
        return _words(v, 20, 120)


def limit_of(a: dict[str, Any], site: dict[str, Any]) -> int:
    v2 = site["auto_apply_v2"]
    return max(1, min(int(a.get("daily_limit") or v2["daily_limit"]), int(v2["max_daily_limit"])))


def mode_of(a: dict[str, Any]) -> str:
    return a.get("mode") if a.get("mode") in MODES else DEFAULT_MODE


def rules_of(a: dict[str, Any], site: dict[str, Any]) -> dict[str, Any]:
    return {
        "roles": a.get("roles") or [],
        "cities": a.get("cities") or [],
        "remote": a.get("remote", True),
        "experience": a.get("experience") or [],
        "minSalary": a.get("min_salary"),
        "noticePeriod": a.get("notice_period"),
        "jobTypes": a.get("job_types") or [],
        "avoid": a.get("avoid") or [],
        "dailyLimit": limit_of(a, site),
        "mode": mode_of(a),
    }


def yearly(sal: dict[str, Any] | None) -> int | None:
    if not sal:
        return None
    best = sal.get("max") or sal.get("min")
    if not best:
        return None
    return int(best) * (12 if sal.get("period") == "monthly" else 1)


def check(j: dict[str, Any], a: dict[str, Any]) -> str | None:
    """Why the candidate's own rules leave this job out (None = it passes): role, place, experience, job type,
    salary, blocked company."""
    roles = [r.lower() for r in a.get("roles") or []]
    hay = " ".join([j.get("title") or "", *(j.get("skills") or [])]).lower()
    if not roles or not any(re.search(re.escape(r), hay) for r in roles):
        return "role"
    cities = [c.lower() for c in a.get("cities") or []]
    remote_ok = a.get("remote", True)
    if j.get("remote"):
        in_city = any(loc.lower().startswith(c) for loc in j.get("locations") or [] for c in cities)
        if not remote_ok and not in_city:
            return "place"
    elif cities and not any(loc.lower().startswith(c) for loc in j.get("locations") or [] for c in cities):
        return "place"
    if a.get("experience") and j.get("experience") not in with_older(a["experience"]):
        return "experience"
    if a.get("job_types") and j.get("job_type") not in a["job_types"]:
        return "job_type"
    if a.get("min_salary"):
        y = yearly(j.get("salary"))
        if y is not None and y < a["min_salary"]:
            return "salary"
    name = ((j.get("company") or {}).get("name") or "").lower()
    if any(x.lower() in name for x in a.get("avoid") or [] if x.strip()):
        return "blocked_company"
    return None
