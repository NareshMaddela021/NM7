"""Job readiness score (Phase 4, E5): 0-100 from the person's own things, with up to 3 "Things left", each one button
to the exact place. Never compared with other students and never shown to anyone else.

  GET /api/me/simple/readiness   {score, parts: [{key, weight, got, done}], left: [{key, path, points}]}

Parts (weights in Admin → Settings → Easy dashboard, adding up to 100):
  resume     the resume is complete: contact, education, skills, a project or job, a summary
  score      the resume score (the same checks as the Resume score page)
  linkedin   a LinkedIn link (on the resume or on the LinkedIn page)
  interview  interview practice done (3 answers practised = full points)
  skills     the resume has the skills that live jobs for the person's chosen roles ask for most (no roles chosen yet:
             "Choose the jobs you want")
  certs      at least one certificate (wallet or resume)

Recomputed when something it reads changes (a signature of those things), else the saved result is used.
"""

import hashlib
import json
import math
import re
from collections import Counter
from typing import Any

from fastapi import APIRouter

from app.auth.deps import CustomerAuth
from app.autoapply.settings import resume_for
from app.core.db import CERTIFICATES, DB, JOB_MATCHES, JOBS, LINKEDIN, USERS
from app.core.time import now
from app.jobs.public import live_filter
from app.orgs.ats import _list, all_skills, ats_score, printed
from app.simple.router import missing
from app.site import get_site

router = APIRouter(prefix="/api/me/simple/readiness", tags=["easy dashboard"])

WEIGHTS = {"resume": 20, "score": 25, "linkedin": 10, "interview": 15, "skills": 20, "certs": 10}
PATHS = {
    "resume": "/builder",
    "score": "/me/ats",
    "linkedin": "/linkedin",
    "interview": "/me/ats",
    "skills": "/builder",
    "roles": "/me/auto-apply",
    "certs": "/me/certificates",
}
TOP_SKILLS = 8
PRACTICE_FULL = 3


def resume_complete(d: dict[str, Any]) -> float:
    p = d.get("personal") if isinstance(d.get("personal"), dict) else {}
    checks = [
        bool(p.get("name") and (p.get("email") or p.get("phone"))),
        *[k not in missing(d) for k in ("education", "skills", "projects")],
        bool(str(d.get("summary") or "").strip()),
    ]
    return sum(checks) / len(checks)


def role_skills(jobs: list[dict[str, Any]], roles: list[str]) -> list[str]:
    """The skills live jobs for these roles ask for most (lower case)."""
    words = [w for r in roles for w in re.findall(r"[a-z0-9+#.]+", r.lower()) if len(w) > 2]
    c: Counter[str] = Counter()
    for j in jobs:
        title = str(j.get("title") or "").lower()
        if words and any(w in title for w in words):
            c.update({str(s).strip().lower() for s in j.get("skills") or [] if str(s).strip()})
    return [s for s, _ in c.most_common(TOP_SKILLS)]


def _round(x: float) -> int:
    return math.floor(x + 0.5)  # 78.5 → 79 (Python's round() would give 78)


def compute(inputs: dict[str, Any], weights: dict[str, int]) -> dict[str, Any]:
    """The score from what was read (pure, so the maths is easy to test)."""
    d = inputs["data"]
    have = {s.lower() for s in all_skills(d)}
    want = inputs["role_skills"]
    if not inputs["roles"]:
        skills, skills_key = 0.0, "roles"
    elif want:
        skills, skills_key = sum(1 for s in want if s in have) / len(want), "skills"
    else:  # no live jobs for these roles yet: enough skills on the resume counts
        skills, skills_key = min(1.0, len(have) / 5), "skills"
    got = {
        "resume": resume_complete(d) if inputs["has_resume"] else 0.0,
        "score": (inputs["ats"] / 100) if inputs["has_resume"] else 0.0,
        "linkedin": 1.0 if inputs["linkedin"] else 0.0,
        "interview": min(1.0, inputs["practised"] / PRACTICE_FULL),
        "skills": skills,
        "certs": 1.0 if inputs["certs"] else 0.0,
    }
    parts = [
        {"key": k, "weight": int(weights.get(k, 0)), "got": _round(weights.get(k, 0) * got[k]), "done": got[k] >= 1}
        for k in WEIGHTS
    ]
    score = max(0, min(100, _round(sum(weights.get(k, 0) * got[k] for k in WEIGHTS))))
    open_ = [p for p in parts if not p["done"] and p["weight"] > 0]
    open_.sort(key=lambda p: p["weight"] - p["got"], reverse=True)
    left = []
    for p in open_[:3]:
        key = skills_key if p["key"] == "skills" else p["key"]
        left.append({"key": key, "path": PATHS[key], "points": p["weight"] - p["got"]})
    return {"score": score, "parts": parts, "left": left}


async def read_inputs(db, uid: str) -> dict[str, Any]:
    r = await resume_for(db, uid)
    raw = (r or {}).get("data") or {}
    d = printed(raw)
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply.roles": 1, "simple.readiness": 1, "demo": 1}) or {}
    roles = ((u.get("auto_apply") or {}).get("roles")) or []
    li = await db[LINKEDIN].find_one({"_id": uid}, {"url": 1}) or {}
    links = d.get("links") if isinstance(d.get("links"), dict) else {}
    practised = 0
    async for m in db[JOB_MATCHES].find({"user_id": uid, "interview.practised": {"$exists": True}}, {"interview": 1}):
        practised += len((m.get("interview") or {}).get("practised") or {})
    certs = await db[CERTIFICATES].count_documents({"user_id": uid}) + len(
        [c for c in _list(d.get("certs")) if c.get("name")]
    )
    return {
        "user": u,
        "resume": r,
        "raw": raw,
        "data": d,
        "has_resume": bool(r),
        "roles": roles,
        "linkedin": bool(links.get("linkedin") or li.get("url")),
        "practised": practised,
        "certs": certs,
    }


def signature(inputs: dict[str, Any], weights: dict[str, int]) -> str:
    r = inputs["resume"] or {}
    key = [
        r.get("key"),
        str(r.get("updated_at")),
        inputs["roles"],
        inputs["linkedin"],
        inputs["practised"],
        inputs["certs"],
        weights,
        now().strftime("%Y-%m-%d"),  # the jobs on the board change: at least once a day
    ]
    return hashlib.sha1(json.dumps(key, default=str, sort_keys=True).encode()).hexdigest()


async def readiness(db, uid: str, site: dict[str, Any] | None = None) -> dict[str, Any]:
    site = site or await get_site(db)
    weights = {**WEIGHTS, **(site["simple"].get("weights") or {})}
    inputs = await read_inputs(db, uid)
    sig = signature(inputs, weights)
    saved = ((inputs["user"].get("simple") or {}).get("readiness")) or {}
    if saved.get("sig") == sig and saved.get("out"):
        return saved["out"]
    jobs = []
    if inputs["roles"]:  # demo students (never public) are compared with the demo company's jobs only
        base = {"status": "active", "demo": True} if inputs["user"].get("demo") else live_filter()
        jobs = await db[JOBS].find(base, {"title": 1, "skills": 1}).sort("posted_at", -1).to_list(500)
    inputs["role_skills"] = role_skills(jobs, inputs["roles"])
    inputs["ats"] = ats_score(inputs["raw"])["score"] if inputs["has_resume"] else 0
    out = compute(inputs, weights)
    await db[USERS].update_one({"_id": uid}, {"$set": {"simple.readiness": {"sig": sig, "out": out, "at": now()}}})
    return out


@router.get("")
async def get_readiness(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await readiness(db, auth.user.id)
