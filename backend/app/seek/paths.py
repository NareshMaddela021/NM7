"""Phase 6 S2: learning paths with proof. Each role from the role finder has a path: its free courses in order (from
Admin → Courses), a small guided project (brief, steps, what to send: a link or a short text; never paid work), then
the role's skill check (H3).

  GET  /api/me/learn                     my paths (progress) and every path I could start
  GET  /api/me/learn/{role}              one path: courses (ticked or not), the project, the skill check, the badge
  POST /api/me/learn/{role}/start
  PUT  /api/me/learn/{role}/course {courseId, done}       "I finished this course": progress only, never a skill
  POST /api/me/learn/{role}/project {link | text}         the project, sent (changeable)
  POST /api/public/learn/stop-nudges {token}               the weekly nudge email's "Stop these emails" link
Admin ("settings"):
  GET  /api/admin/learn-paths · PUT /api/admin/learn-paths/{role} {skills, project, test, active}

"Skill verified: <skill>" needs BOTH: the role's skill check passed (the best finished official attempt at or above
Admin → Settings seek.pass_score, 60%) and the project sent. Practice tests never count. The badge is kept on the
user (verified_skills: skill, role, when) and shows on the public resume link and to companies in Hire now.
Weekly nudges: one email a week at most, only while a started path is unfinished and untouched for 7 days; it has a
"Stop these emails" link.
"""

import logging
import re
from datetime import timedelta
from html import escape
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from pydantic import Field, field_validator, model_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, LEARN_PATHS, LEARN_PROGRESS, SKILL_ATTEMPTS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import now
from app.courses.router import courses_for
from app.me.service import ms
from app.seek.catalogue import ROLES
from app.seek.projects import PROJECTS
from app.site import get_site

log = logging.getLogger("nm7.learn")
me = APIRouter(prefix="/api/me/learn", tags=["job seekers"])
admin = APIRouter(prefix="/api/admin/learn-paths", tags=["job seekers"])
public = APIRouter(prefix="/api/public/learn", tags=["job seekers"])

PER_SKILL = 2  # courses a skill brings into the path
NUDGE_EVERY = timedelta(days=7)
BY_ID = {r["id"]: r for r in ROLES}


async def ensure_paths(db) -> None:
    """One path per catalogue role, added once (Admin's edits are never overwritten)."""
    if await db[LEARN_PATHS].count_documents({}) >= len(ROLES):
        return
    t = now()
    for r in ROLES:
        doc = {"title": r["title"], "skills": list(r["skills"]), "project": PROJECTS.get(r["id"]) or {},
               "test": r["test"], "active": True, "created_at": t, "updated_at": t}  # fmt: skip
        await db[LEARN_PATHS].update_one({"_id": r["id"]}, {"$setOnInsert": doc}, upsert=True)


async def path_of(db, role: str) -> dict[str, Any]:
    await ensure_paths(db)
    p = await db[LEARN_PATHS].find_one({"_id": role})
    if not p or not p.get("active", True):
        raise ApiError(404, "not_found", "There is no learning path for that role yet.")
    return p


async def pass_score(db) -> int:
    return int((await get_site(db)).get("seek", {}).get("pass_score", 60))


async def best_check(db, uid: str, skill: str) -> dict[str, Any] | None:
    """The best finished OFFICIAL skill check for `skill` (practice is a different collection and never counts)."""
    if not skill:
        return None
    a = await db[SKILL_ATTEMPTS].find_one(
        {"user_id": uid, "skill": skill, "submitted_at": {"$ne": None}, "late": {"$ne": True}},
        sort=[("score", -1), ("submitted_at", -1)],
    )
    return {"score": a["score"], "at": a["submitted_at"]} if a else None


def progress_id(uid: str, role: str) -> str:
    return f"{uid}:{role}"


async def refresh_verified(db, uid: str, p: dict[str, Any], prog: dict[str, Any] | None) -> dict[str, Any] | None:
    """Record the badge when the check is passed AND the project is sent. Returns {skill, at} or None."""
    if not prog or not (prog.get("project") or {}).get("at") or not p.get("test"):
        return None
    check = await best_check(db, uid, p["test"])
    if not check or check["score"] < await pass_score(db):
        return None
    if prog.get("verified_at"):
        return {"skill": p["test"], "at": prog["verified_at"]}
    at = max(check["at"], prog["project"]["at"])
    await db[LEARN_PROGRESS].update_one({"_id": prog["_id"]}, {"$set": {"verified_at": at}})
    await db[USERS].update_one({"_id": uid}, {"$pull": {"verified_skills": {"skill": p["test"]}}})
    await db[USERS].update_one(
        {"_id": uid}, {"$push": {"verified_skills": {"skill": p["test"], "role": p["_id"], "at": at}}}
    )
    await audit(db, uid, "learn.skill_verified", data={"skill": p["test"], "role": p["_id"]})
    return {"skill": p["test"], "at": at}


async def on_skill_check(db, uid: str, skill: str) -> None:
    """After an official skill check is finished: any started path for that test may now be verified."""
    async for prog in db[LEARN_PROGRESS].find({"user_id": uid, "verified_at": None}):
        p = await db[LEARN_PATHS].find_one({"_id": prog["role"], "test": skill})
        if p:
            await refresh_verified(db, uid, p, prog)


async def detail(db, uid: str, p: dict[str, Any]) -> dict[str, Any]:
    prog = await db[LEARN_PROGRESS].find_one({"_id": progress_id(uid, p["_id"])})
    groups = await courses_for(db, p.get("skills") or [], per=PER_SKILL)
    done = set((prog or {}).get("courses") or [])
    courses = [{**c, "skill": g["skill"], "done": c["id"] in done} for g in groups for c in g["courses"]]
    check = await best_check(db, uid, p.get("test") or "")
    need = await pass_score(db)
    badge = await refresh_verified(db, uid, p, prog)
    project = p.get("project") or {}
    sent = (prog or {}).get("project") or {}
    steps = len(courses) + 1 + (1 if p.get("test") else 0)
    got = sum(c["done"] for c in courses) + bool(sent.get("at")) + bool(check and check["score"] >= need)
    return {
        "role": p["_id"], "title": p["title"], "started": bool(prog), "startedAt": ms((prog or {}).get("started_at")),
        "courses": courses, "missingCourses": [g["skill"] for g in groups if not g["courses"]],
        "project": {**{k: project.get(k) for k in ("title", "brief", "steps", "submit")},
                    "sent": {"link": sent.get("link", ""), "text": sent.get("text", ""), "at": ms(sent.get("at"))}},
        "test": {"skill": p.get("test") or "", "pass": need,
                 "best": {"score": check["score"], "at": ms(check["at"])} if check else None},
        "progress": round(100 * got / steps) if steps else 0,
        "verified": {"skill": badge["skill"], "at": ms(badge["at"])} if badge else None,
    }  # fmt: skip


async def verified_of(db, uids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """{user: [{skill, at}]} for showing the badge (Hire now, the public resume link)."""
    out: dict[str, list[dict[str, Any]]] = {}
    async for u in db[USERS].find({"_id": {"$in": uids}}, {"verified_skills": 1}):
        out[u["_id"]] = [{"skill": v["skill"], "at": ms(v["at"])} for v in u.get("verified_skills") or []]
    return out


# --- the student ----------------------------------------------------------------------------------------------------


@me.get("")
async def mine(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await ensure_paths(db)
    uid = auth.user.id
    started = []
    async for prog in db[LEARN_PROGRESS].find({"user_id": uid}).sort("updated_at", -1).limit(20):
        p = await db[LEARN_PATHS].find_one({"_id": prog["role"]})
        if p:
            d = await detail(db, uid, p)
            started.append({k: d[k] for k in ("role", "title", "progress", "verified")})
    u = await db[USERS].find_one({"_id": uid}, {"role_finder.picks": 1}) or {}
    picks = (u.get("role_finder") or {}).get("picks") or []
    paths = [{"role": p["_id"], "title": p["title"], "test": p.get("test") or "", "suggested": p["_id"] in picks}
             async for p in db[LEARN_PATHS].find({"active": {"$ne": False}}).sort("title", 1)]  # fmt: skip
    paths.sort(key=lambda x: (not x["suggested"], x["title"]))
    return {"started": started, "paths": paths}


@me.get("/{role}")
async def one(role: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await detail(db, auth.user.id, await path_of(db, role))


@me.post("/{role}/start")
async def start(role: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    p = await path_of(db, role)
    t = now()
    uid = auth.user.id
    await db[LEARN_PROGRESS].update_one(
        {"_id": progress_id(uid, role)},
        {
            "$setOnInsert": {
                "user_id": uid,
                "role": role,
                "courses": [],
                "project": {},
                "started_at": t,
                "verified_at": None,
                "nudged_at": None,
            },
            "$set": {"updated_at": t},
        },  # fmt: skip
        upsert=True,
    )
    return await detail(db, uid, p)


async def _progress(db, uid: str, role: str) -> dict[str, Any]:
    prog = await db[LEARN_PROGRESS].find_one({"_id": progress_id(uid, role)})
    if not prog:
        raise ApiError(409, "not_started", "Start this learning path first.")
    return prog


class CourseIn(CamelModel):
    course_id: str = Field(min_length=1, max_length=64)
    done: bool


@me.put("/{role}/course")
async def course(role: str, body: CourseIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    p = await path_of(db, role)
    uid = auth.user.id
    await _progress(db, uid, role)
    groups = await courses_for(db, p.get("skills") or [], per=PER_SKILL)
    if body.course_id not in {c["id"] for g in groups for c in g["courses"]}:
        raise ApiError(404, "not_found", "That course isn't in this path.")
    op = "$addToSet" if body.done else "$pull"
    await db[LEARN_PROGRESS].update_one(
        {"_id": progress_id(uid, role)}, {op: {"courses": body.course_id}, "$set": {"updated_at": now()}}
    )
    return await detail(db, uid, p)  # "I learned this" is progress only: no skill is ever added here


class ProjectIn(CamelModel):
    link: str = Field("", max_length=500)
    text: str = Field("", max_length=4000)

    @field_validator("link")
    @classmethod
    def _link(cls, v: str) -> str:
        v = v.strip()
        if v:
            u = urlparse(v)
            if u.scheme not in ("http", "https") or "." not in u.netloc:
                raise ValueError("Paste the full link, starting with https://")
        return v

    @model_validator(mode="after")
    def _some(self):
        if not self.link and len(self.text.strip()) < 40:
            raise ValueError("Paste a link to your work, or write at least a few lines about it.")
        return self


@me.post("/{role}/project")
async def project(role: str, body: ProjectIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    p = await path_of(db, role)
    uid = auth.user.id
    await _progress(db, uid, role)
    t = now()
    sent = {"link": body.link, "text": " ".join(body.text.split()) if not body.link else body.text.strip(), "at": t}
    await db[LEARN_PROGRESS].update_one({"_id": progress_id(uid, role)}, {"$set": {"project": sent, "updated_at": t}})
    await audit(db, uid, "learn.project_sent", data={"role": role, "link": bool(body.link)})
    return await detail(db, uid, p)


# --- weekly nudges ----------------------------------------------------------------------------------------------------


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('learn-unsub', user_id)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("learn-unsub", uid)[:32]) else None


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/stop-nudges")
async def stop_nudges(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"learn-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(20, timedelta(hours=1))])
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn't work.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"learn_nudges_off": True}})
    return {"ok": True}


def nudge_email(u: dict[str, Any], d: dict[str, Any]) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/learn?role={d['role']}"
    stop = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=learn"
    nxt = next((f"the course “{c['title']}”" for c in d["courses"] if not c["done"]), None)
    if not nxt:
        nxt = "your project" if not d["project"]["sent"]["at"] else f"the {d['test']['skill']} skill check"
    lines = [f"Hi {first},", "", f"Your {d['title']} learning path is {d['progress']}% done. Next: {nxt}.",
             "A little each week adds up. Everything on the path is free.", "", f"Continue: {link}", "",
             "You get this at most once a week while a path is unfinished.", f"Stop these emails: {stop}"]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            f"<p>Your {escape(d['title'])} learning path is {d['progress']}% done. Next: {escape(nxt)}.</p>"
            "<p>A little each week adds up. Everything on the path is free.</p>"
            f'<p><a href="{escape(link)}">Continue</a></p>'
            f'<p style="color:#666;font-size:13px">You get this at most once a week while a path is unfinished. '
            f'<a href="{escape(stop)}" style="color:#666">Stop these emails</a></p></div>')  # fmt: skip
    return Email(to=u["email"], to_name=u.get("name", ""), subject=f"Your {d['title']} path: {d['progress']}% done",
                 text="\n".join(lines), html=html)  # fmt: skip


async def send_nudges(db, mailer: Mailer, limit: int = 200) -> int:
    """One email a week at most per person, for a started, unfinished path untouched for 7 days."""
    t = now()
    sent = 0
    q = {"verified_at": None, "updated_at": {"$lt": t - NUDGE_EVERY},
         "$or": [{"nudged_at": None}, {"nudged_at": {"$lt": t - NUDGE_EVERY}}]}  # fmt: skip
    seen: set[str] = set()
    async for prog in db[LEARN_PROGRESS].find(q).sort("updated_at", -1).limit(limit):
        uid = prog["user_id"]
        if uid in seen:
            continue
        seen.add(uid)
        u = await db[USERS].find_one(
            {"_id": uid, "email_verified_at": {"$ne": None}, "email_bounced": {"$ne": True},
             "learn_nudges_off": {"$ne": True}, "deleted_at": None, "demo": {"$ne": True},
             "$or": [{"learn_nudged_at": None}, {"learn_nudged_at": {"$lt": t - NUDGE_EVERY}}]},
            {"email": 1, "name": 1},
        )  # fmt: skip
        p = await db[LEARN_PATHS].find_one({"_id": prog["role"]})
        if not u or not p:
            continue
        await db[LEARN_PROGRESS].update_one({"_id": prog["_id"]}, {"$set": {"nudged_at": t}})
        await db[USERS].update_one({"_id": uid}, {"$set": {"learn_nudged_at": t}})
        if await send_safely(mailer, nudge_email(u, await detail(db, uid, p))):
            sent += 1
    if sent:
        log.info("learning nudges: %d email(s) sent", sent)
    return sent


# --- admin ------------------------------------------------------------------------------------------------------------


class ProjectSpec(CamelModel):
    title: str = Field(min_length=3, max_length=120)
    brief: str = Field(min_length=10, max_length=600)
    steps: list[str] = Field(min_length=1, max_length=8)
    submit: Literal["link", "text"] = "link"

    @field_validator("steps")
    @classmethod
    def _steps(cls, v: list[str]) -> list[str]:
        out = [" ".join(s.split())[:200] for s in v if s.strip()]
        if not out:
            raise ValueError("Add at least one step.")
        return out


PAID = re.compile(r"\b(pay|fee|deposit|buy|purchase|subscription|₹|rs\.?|inr)\b", re.I)


class PathIn(CamelModel):
    skills: list[str] = Field(max_length=8)
    project: ProjectSpec
    test: str = Field("", max_length=60)
    active: bool = True

    @model_validator(mode="after")
    def _free(self):
        words = " ".join([self.project.brief, *self.project.steps])
        if PAID.search(words):
            raise ValueError("A project must be free to do: no fee, deposit or purchase.")
        return self


def admin_out(p: dict[str, Any]) -> dict[str, Any]:
    return {"role": p["_id"], "title": p["title"], "skills": p.get("skills") or [], "project": p.get("project") or {},
            "test": p.get("test") or "", "active": p.get("active", True),
            "updatedAt": ms(p.get("updated_at"))}  # fmt: skip


@admin.get("")
async def list_paths(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    from app.hire.skillcheck import ensure_bank, skills

    await ensure_paths(db)
    await ensure_bank(db)
    rows = [admin_out(p) async for p in db[LEARN_PATHS].find().sort("title", 1)]
    return {"items": rows, "tests": sorted(await skills(db)), "passScore": await pass_score(db)}


@admin.put("/{role}")
async def edit_path(role: str, body: PathIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict:
    from app.courses.router import skill_name
    from app.hire.skillcheck import skills

    await ensure_paths(db)
    if body.test and body.test not in await skills(db):
        raise ApiError(422, "no_test", "That skill check has no questions yet (Admin → Skill tests).")
    sets = {"skills": [skill_name(s) for s in body.skills if s.strip()], "project": body.project.model_dump(),
            "test": body.test, "active": body.active, "updated_at": now()}  # fmt: skip
    p = await db[LEARN_PATHS].find_one_and_update({"_id": role}, {"$set": sets}, return_document=True)
    if not p:
        raise ApiError(404, "not_found", "No such learning path.")
    await audit(db, auth.user.id, "learn.path_edited", target=role, data={"test": body.test, "active": body.active},
                ip=client_ip(request))  # fmt: skip
    return admin_out(p)
