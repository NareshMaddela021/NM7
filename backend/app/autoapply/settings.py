"""Auto Apply settings (Phase 3, A1): what the student lets Nm7 apply to, and the gate before it can start.

  GET  /api/me/auto-apply                  the settings (or the defaults), the gate and the limits
  PUT  /api/me/auto-apply {roles, cities, remote, experience, minSalary, minScore, dailyLimit, avoid, jobTypes, consent}
                                           saves; the first save with the consent tick turns Auto Apply on
  POST /api/me/auto-apply/pause {paused}   the big Pause / Resume button
  GET  /api/me/auto-apply/suggest          role ideas: job titles on the board and the person's own skills

The gate: the resume Auto Apply uses (the active one, else the latest) must score at least 60 in the ATS check
(Admin → Auto Apply); below that the page lists what to fix. Consent: "Nm7 may apply for me and share my profile with
these companies" must be ticked. Once set up, Auto Apply is on until the person pauses it; Manual Apply always works.
Every change is in the activity log.
"""

import math
from collections import Counter
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.core.db import DB, JOBS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs.model import EXPERIENCE, JOB_TYPES
from app.jobs.public import live_filter
from app.jobsearch import skills as dictionary
from app.me.service import ms
from app.orgs.ats import ats_score
from app.site import get_site

router = APIRouter(prefix="/api/me/auto-apply", tags=["auto apply"])

FIX_PATH = "/builder"
# each resume-score check → the builder section that fixes it (/builder?start=section&sec=…), items 5 and 14
FIX_SECTIONS = {
    "contact": "personal",
    "linkedin": "links",
    "summary": "summary",
    "experience": "proj",
    "numbers": "exp",
    "verbs": "exp",
    "skills": "skills",
    "education": "edu",
}


def fix_path(key: str) -> str:
    sec = FIX_SECTIONS.get(key)
    return f"{FIX_PATH}?start=section&sec={sec}" if sec else FIX_PATH


def _words(v: list[str], n: int, size: int = 60) -> list[str]:
    out: list[str] = []
    for x in v:
        x = " ".join(str(x).split())[:size]
        if x and x.lower() not in (o.lower() for o in out):
            out.append(x)
    return out[:n]


class SettingsIn(CamelModel):
    roles: list[str] = Field(default_factory=list, max_length=20)
    cities: list[str] = Field(default_factory=list, max_length=20)
    remote: bool = True
    experience: list[Literal[tuple(EXPERIENCE)]] = Field(default_factory=list, max_length=5)  # type: ignore[valid-type]
    min_salary: int | None = Field(None, ge=0, le=10_000_000)  # rupees a year; None = any
    min_score: int = Field(70, ge=50, le=100)
    daily_limit: int = Field(5, ge=1, le=50)
    avoid: list[str] = Field(default_factory=list, max_length=30)  # company names
    job_types: list[Literal[tuple(JOB_TYPES)]] = Field(default_factory=list, max_length=4)  # type: ignore[valid-type]
    consent: bool = False

    @field_validator("roles")
    @classmethod
    def _roles(cls, v: list[str]) -> list[str]:
        return _words(v, 10)

    @field_validator("cities")
    @classmethod
    def _cities(cls, v: list[str]) -> list[str]:
        return _words(v, 10)

    @field_validator("avoid")
    @classmethod
    def _avoid(cls, v: list[str]) -> list[str]:
        return _words(v, 20, 120)


class PauseIn(CamelModel):
    paused: bool


async def resume_for(db, user_id: str) -> dict[str, Any] | None:
    """The resume Auto Apply uses: the active one, else the latest."""
    return await db[RESUMES].find_one({"user_id": user_id, "active": True, "tailored_from": None}) or await db[
        RESUMES
    ].find_one({"user_id": user_id, "tailored_from": None}, sort=[("updated_at", -1)])


async def gate(db, user_id: str, site: dict[str, Any] | None = None) -> dict[str, Any]:
    """{ok, score, need, resume, fixes: [{key, label, path}]}: can Auto Apply start with this person's resume?"""
    need = int((site or await get_site(db))["auto_apply"]["ats_min"])
    r = await resume_for(db, user_id)
    if not r:
        return {"ok": False, "score": None, "need": need, "resume": None,
                "fixes": [{"key": "resume", "label": "Make a resume", "path": FIX_PATH}]}  # fmt: skip
    a = ats_score(r.get("data") or {})
    fixes = [{"key": c["key"], "label": c["label"], "path": fix_path(c["key"])} for c in a["checks"] if not c["ok"]]
    return {"ok": a["score"] >= need, "score": a["score"], "need": need,
            "resume": {"id": r["key"], "name": r.get("name") or "Resume"}, "fixes": fixes}  # fmt: skip


def settings_of(u: dict[str, Any] | None, site: dict[str, Any]) -> dict[str, Any]:
    a = (u or {}).get("auto_apply") or {}
    d = site["auto_apply"]
    return {
        "setUp": bool(a.get("consent_at")),
        "on": bool(a.get("on")),
        "roles": a.get("roles") or [],
        "cities": a.get("cities") or [],
        "remote": a.get("remote", True),
        "experience": a.get("experience") or [],
        "minSalary": a.get("min_salary"),
        "minScore": a.get("min_score", d["min_score"]),
        "dailyLimit": min(a.get("daily_limit", d["daily_limit"]), d["max_daily_limit"]),
        "avoid": a.get("avoid") or [],
        "jobTypes": a.get("job_types") or [],
        "consentAt": ms(a.get("consent_at")),
        "startedAt": ms(a.get("started_at")),
        "pausedAt": ms(a.get("paused_at")),
    }


def preview_left(a: dict[str, Any], site: dict[str, Any], t=None) -> int:
    """Days left in which each auto application waits for the person's Approve (0 = fully automatic)."""
    started = a.get("started_at")
    if not started:
        return int(site["auto_apply"]["preview_days"])
    end = started + timedelta(days=int(site["auto_apply"]["preview_days"]))
    left = (end - (t or now())).total_seconds() / 86400
    return math.ceil(left) if left > 0 else 0


async def _out(db, uid: str) -> dict[str, Any]:
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1})
    d = site["auto_apply"]
    return {
        "settings": settings_of(u, site),
        "gate": await gate(db, uid, site),
        "siteOn": bool(d["on"]),
        "limits": {"maxDailyLimit": d["max_daily_limit"], "minScore": d["min_score"], "dailyLimit": d["daily_limit"],
                   "companyCap": d["company_cap"], "trustMin": d["trust_min"], "previewDays": d["preview_days"]},
        "previewLeft": preview_left((u or {}).get("auto_apply") or {}, site),
    }  # fmt: skip


@router.get("")
async def get_settings_(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await _out(db, auth.user.id)


@router.put("")
async def put_settings(body: SettingsIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await get_site(db)
    d = site["auto_apply"]
    if not body.roles:
        raise ApiError(400, "roles", "Add at least one role, like “Data analyst” or “Java developer”.")
    if body.daily_limit > d["max_daily_limit"]:
        raise ApiError(400, "daily_limit", f"The daily limit can be at most {d['max_daily_limit']}.")
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1}) or {}
    old = u.get("auto_apply") or {}
    first = not old.get("consent_at")
    if first and not body.consent:
        raise ApiError(400, "consent", "Tick the box so Nm7 may apply for you and share your profile.")
    g = await gate(db, uid, site)
    if first and not g["ok"]:
        raise ApiError(409, "gate", f"Your resume scores {g['score'] or 0} in the ATS check; Auto Apply needs "
                       f"{g['need']}. Fix the items listed first.", extra={"gate": g})  # fmt: skip
    t = now()
    sets = {f"auto_apply.{k}": v for k, v in body.model_dump(exclude={"consent"}).items()}
    sets["auto_apply.updated_at"] = t
    if first:
        sets |= {"auto_apply.consent_at": t, "auto_apply.on": True, "auto_apply.started_at": t,
                 "auto_apply.paused_at": None}  # fmt: skip
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    await audit(db, uid, "auto_apply.setup" if first else "auto_apply.settings",
                data={"roles": body.roles, "min_score": body.min_score, "daily_limit": body.daily_limit})  # fmt: skip
    return await _out(db, uid)


@router.post("/pause")
async def pause(body: PauseIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1}) or {}
    a = u.get("auto_apply") or {}
    if not a.get("consent_at"):
        raise ApiError(409, "not_set_up", "Set up Auto Apply first.")
    if not body.paused:
        g = await gate(db, uid)
        if not g["ok"]:
            raise ApiError(409, "gate", f"Your resume scores {g['score'] or 0}; Auto Apply needs {g['need']}.",
                           extra={"gate": g})  # fmt: skip
    t = now()
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"auto_apply.on": not body.paused, "auto_apply.paused_at": t if body.paused else None}}
    )
    await audit(db, uid, "auto_apply.pause" if body.paused else "auto_apply.resume")
    return await _out(db, uid)


@router.get("/suggest")
async def suggest(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    titles = Counter()
    async for j in db[JOBS].find(live_filter(), {"title": 1}).sort("posted_at", -1).limit(500):
        titles[" ".join(j["title"].split())[:60]] += 1
    r = await resume_for(db, auth.user.id)
    mine = []
    if r:
        from app.jobsearch.facts import resume_text

        mine = [s for s in dictionary.find(resume_text(r.get("data") or {}))][:15]
    from app.seek.roles import suggested_roles  # Phase 6 S1: the role finder's three roles come first

    found = await suggested_roles(db, auth.user.id)
    rest = [t for t, _ in titles.most_common(30) if t.lower() not in {f.lower() for f in found}]
    return {"roles": [*found, *rest], "fromRoleFinder": found, "skills": mine}
