"""The match score on the job board (J4): how well a signed-in person's resume fits each job, by rules only.

    skills       60   the job's skills found anywhere on the resume (bullets, projects, skills list, certificates)
    experience   25   the job's level against the years on the resume; fresher and internship jobs suit 0-3 years
    place        15   remote, or the job is in the resume's city; no city on the resume = half

No AI call per card. The answer is a number and plain parts the page turns into words in the person's language:
"Matches 4 of 5 skills · Fresher OK · In Hyderabad", with the skills found and missing. Each score is cached per
person and job (job_fit), keyed by the resume's and the job's last change, so it is worked out again when either
changes. The resume used is the person's active one (else the latest).
"""

import re
from datetime import UTC, datetime
from typing import Any

from pymongo import UpdateOne

from app.core.db import JOB_FIT, RESUMES
from app.core.time import now
from app.jobsearch import skills as dictionary
from app.jobsearch.score import Resume

WEIGHTS = {"skills": 60, "experience": 25, "place": 15}
MAX_RANKED = 300  # "Best match" ranks the newest jobs that pass the filters, up to this many
CACHE_WRITES = 60  # scores saved per request at most (the rest are cheap to work out again)


class Person:
    """One person's resume, read once per request."""

    def __init__(self, resume: dict[str, Any]):
        self.resume_id = resume["_id"]
        changed = resume.get("updated_at") or resume.get("created_at") or datetime(2000, 1, 1, tzinfo=UTC)
        self.rev = f"{resume['_id']}:{changed.isoformat()}"
        data = resume.get("data") or {}
        self.r = Resume(data)
        self.has = set(self.r.proven) | set(self.r.listed) | set(self.r.cert_skills)
        self.text = f"{self.r.proof_text}\n{self.r.listed_text}"
        place = str((data.get("personal") or {}).get("location") or "")
        self.place = place.lower()

    def usable(self) -> bool:
        r = self.r
        return bool(r.skills_text.strip() or r.bullets or r.roles or r.edu or r.summary.strip())


async def person_for(db, user_id: str) -> Person | None:
    """The person's active resume (else the latest), or None when there is none with anything in it."""
    d = await db[RESUMES].find_one({"user_id": user_id, "active": True}) or await db[RESUMES].find_one(
        {"user_id": user_id}, sort=[("updated_at", -1)]
    )
    if not d:
        return None
    p = Person(d)
    return p if p.usable() else None


def _has_skill(p: Person, name: str) -> bool:
    if name in p.has:
        return True
    if dictionary.canonical(name) == name:  # a dictionary skill the resume doesn't show
        return False
    return re.search(rf"(?<![\w+#]){re.escape(name.lower())}(?![\w+#])", p.text) is not None  # kept as written


def job_skills(job: dict[str, Any]) -> list[str]:
    return list(job.get("skills") or []) or dictionary.find(job.get("title") or "")[:8]


def _experience(level: str, years: float) -> tuple[float, str]:
    """(share of the marks, ok / near / far)."""
    if level in ("internship", "fresher"):
        return (1.0, "ok") if years <= 3 else (0.5, "near")
    if level == "0_1":
        return (1.0, "ok") if years <= 2 else (0.6, "near")
    if level == "1_3":
        return (1.0, "ok") if years >= 1 else (0.5, "near") if years >= 0.5 else (0.2, "far")
    return (1.0, "ok") if years >= 3 else (0.5, "near") if years >= 2 else (0.1, "far")  # 3_plus


def _place(job: dict[str, Any], p: Person) -> tuple[float, str, str]:
    """(share, remote / city / other / unknown, the city that matched)."""
    if job.get("remote"):
        return 1.0, "remote", ""
    cities = job.get("locations") or []
    if not p.place:
        return 0.5, "unknown", ""
    for c in cities:
        lc = c.lower()
        if lc and (lc in p.place or p.place.split(",")[0].strip() in lc):
            return 1.0, "city", c
    return 0.0, "other", ""


def fit(job: dict[str, Any], p: Person) -> dict[str, Any]:
    wanted = job_skills(job)
    found = [s for s in wanted if _has_skill(p, s)]
    missing = [s for s in wanted if s not in found]
    skill_share = len(found) / len(wanted) if wanted else 0.5
    exp_share, exp = _experience(job["experience"], p.r.years)
    place_share, place, city = _place(job, p)
    total = skill_share * WEIGHTS["skills"] + exp_share * WEIGHTS["experience"] + place_share * WEIGHTS["place"]
    return {
        "score": round(total),
        "found": found,
        "missing": missing,
        "experience": exp,
        "level": job["experience"],
        "years": p.r.years,
        "place": place,
        "city": city,
    }


def _job_rev(job: dict[str, Any]) -> str:
    t = job.get("updated_at") or job.get("created_at")
    return t.isoformat() if t else ""


async def fits(db, user_id: str, p: Person, jobs: list[dict[str, Any]], save: bool = True) -> dict[str, dict]:
    """job id → fit, from the cache when the resume and the job haven't changed, else worked out (and saved)."""
    if not jobs:
        return {}
    cached = {c["job_id"]: c async for c in db[JOB_FIT].find({"_id": {"$in": [f"{user_id}:{j['_id']}" for j in jobs]}})}
    out: dict[str, dict] = {}
    writes = []
    t = now()
    for j in jobs:
        rev = f"{p.rev}|{_job_rev(j)}"
        c = cached.get(j["_id"])
        if c and c.get("rev") == rev:
            out[j["_id"]] = c["fit"]
            continue
        out[j["_id"]] = f = fit(j, p)
        if save and len(writes) < CACHE_WRITES:
            doc = {"user_id": user_id, "job_id": j["_id"], "rev": rev, "fit": f, "at": t}
            writes.append(UpdateOne({"_id": f"{user_id}:{j['_id']}"}, {"$set": doc}, upsert=True))
    if writes:
        await db[JOB_FIT].bulk_write(writes, ordered=False)
    return out
