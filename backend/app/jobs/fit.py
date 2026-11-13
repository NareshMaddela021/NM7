"""The match score on the job board (J4): how well a signed-in person's resume fits each job, by rules only.

    skills       60   the job's skills found anywhere on the resume (bullets, projects, skills list, certificates)
    experience   25   the job's level against the years on the resume; fresher and internship jobs suit 0-3 years,
                      a 5–8 year job suits 5 to 12 (round J2: levels from internship to 15+ years)
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
from app.jobs.model import BAND_YEARS
from app.jobsearch import skills as dictionary
from app.jobsearch.score import Resume

WEIGHTS = {"skills": 60, "experience": 25, "place": 15}
# a job that names the lowest qualification it accepts (Phase 5 H8): education takes 10 of the 100 marks
WEIGHTS_EDU = {"skills": 55, "experience": 20, "place": 15, "education": 10}
EDU_RANK = {"10th": 1, "12th": 2, "iti": 3, "diploma": 4, "graduate": 5, "postgraduate": 6}
MAX_RANKED = 300  # "Best match" ranks the newest jobs that pass the filters, up to this many
# years past a level's top before a resume counts as clearly more experienced than the job is for
OVER = {"internship": 3, "fresher": 3, "0_1": 3, "1_3": 3, "3_5": 3, "5_8": 4, "8_12": 4, "12_15": 5}
CACHE_WRITES = 60  # scores saved per request at most (the rest are cheap to work out again)
VERSION = "j2"  # part of each cached score's key: a change to the rules works every score out again


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
    """The skills the job lists. Never words of its title ("QA" is not "Quality assurance", item 7)."""
    return list(job.get("skills") or [])


def _experience(level: str, years: float) -> tuple[float, str]:
    """(share of the marks, ok / near / far / over / unknown). far: the job asks for clearly more years than the
    resume shows; over: the resume shows clearly more years than the job is for (round J2)."""
    if level not in BAND_YEARS:
        return 0.5, "unknown"  # experience not stated
    lo, hi = BAND_YEARS[level]
    if years < lo:
        if lo <= 1:
            return (0.5, "near") if years >= 0.5 else (0.2, "far")
        return (0.5, "near") if lo - years <= 1 else (0.1, "far")
    if hi is not None and years > hi + OVER.get(level, 3):
        return 0.5, "over"
    if level == "0_1" and years > 2:
        return 0.6, "near"
    return 1.0, "ok"


def level_fits(fit_: dict[str, Any]) -> bool:
    """Whether Auto Apply may use this job for the person: never a job that asks for clearly more years than the
    resume shows (a fresher for a 10-year job), nor one clearly below them (round J2). A 1–3 year job stays open to
    a fresher (it is "far" only on the score)."""
    exp = fit_.get("experience")
    if exp == "over":
        return False
    return not (exp == "far" and BAND_YEARS.get(fit_.get("level") or "", (0, 0))[0] >= 3)


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


def _education(need: str, have: int) -> tuple[float, str]:
    """(share, ok / near / below / unknown). ITI and 12th are side by side: either suits a job asking for the other."""
    want = EDU_RANK.get(need, 0)
    if not want:
        return 1.0, ""
    if not have:
        return 0.5, "unknown"  # the resume doesn't say: never a zero for that
    if have >= want or {have, want} == {2, 3}:
        return 1.0, "ok"
    return (0.5, "near") if have == want - 1 else (0.0, "below")


def fit(job: dict[str, Any], p: Person) -> dict[str, Any]:
    wanted = job_skills(job)
    found = [s for s in wanted if _has_skill(p, s)]
    missing = [s for s in wanted if s not in found]
    skill_share = len(found) / len(wanted) if wanted else 0.5
    exp_share, exp = _experience(job["experience"], p.r.years)
    place_share, place, city = _place(job, p)
    need = job.get("education") or ""
    edu_share, edu = _education(need, p.r.edu_level())
    w = WEIGHTS_EDU if need else WEIGHTS
    total = skill_share * w["skills"] + exp_share * w["experience"] + place_share * w["place"]
    total += edu_share * w.get("education", 0)
    return {
        "score": round(total),
        "found": found,
        "missing": missing,
        "experience": exp,
        "level": job["experience"],
        "years": p.r.years,
        "place": place,
        "city": city,
        "education": edu,
        "educationNeed": need,
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
        rev = f"{p.rev}|{_job_rev(j)}|{VERSION}"
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
