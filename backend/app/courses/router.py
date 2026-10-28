"""Free courses for the skills a job match found missing (Admin → Courses keeps the list).

  GET    /api/me/courses?skills=Python,SQL     up to 3 free, active courses per skill (+ free catalogues when none)
  GET    /api/admin/courses                    the whole list ("settings": Owner)
  POST   /api/admin/courses · PUT/DELETE /api/admin/courses/{id}

Only free courses are ever shown to a student (free: yes and active). No affiliate or sponsored links: a link with
tracking parameters (utm_, ref=, aff…) is refused when saved. Marking "I learned this" happens in the browser and never
adds a skill to the resume.
"""

import re
from typing import Any
from urllib.parse import parse_qsl, urlparse

from fastapi import APIRouter, Query, Request
from pydantic import Field, field_validator
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core.db import COURSES, DB, LOCKS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.courses.seed import CATALOGUES, SEED
from app.jobsearch import skills

me = APIRouter(prefix="/api/me/courses", tags=["courses"])
admin = APIRouter(prefix="/api/admin/courses", tags=["admin-courses"])

PER_SKILL = 3
TRACKING = re.compile(r"^(utm_|ref$|referral|aff|affiliate|partner|campaign|coupon|irclickid|clickid)", re.I)


def skill_name(s: str) -> str:
    return skills.canonical(s) or " ".join(s.split())


async def ensure_seed(db: AsyncDatabase) -> None:
    """The first list, once (an admin may delete every course afterwards: it is not seeded again)."""
    try:
        await db[LOCKS].insert_one({"_id": "courses-seeded", "at": now()})
    except DuplicateKeyError:
        return
    t = now()
    await db[COURSES].insert_many(
        [
            {
                "_id": new_id(),
                "skill": s,
                "title": ti,
                "provider": p,
                "url": u,
                "language": lang,
                "hours": h,
                "free": True,
                "active": True,
                "created_at": t,
                "updated_at": t,
            }
            for s, ti, p, u, lang, h in SEED
        ]
    )


def out(c: dict[str, Any]) -> dict[str, Any]:
    return {
        k2: c.get(k)
        for k, k2 in (
            ("_id", "id"),
            ("skill", "skill"),
            ("title", "title"),
            ("provider", "provider"),
            ("url", "url"),
            ("language", "language"),
            ("hours", "hours"),
            ("free", "free"),
            ("active", "active"),
        )
    }


@me.get("")
async def for_skills(
    auth: CustomerAuth,
    db: DB,
    skills_: str = Query("", alias="skills", max_length=600),
    language: str = Query("", max_length=30),
) -> dict[str, Any]:
    await ensure_seed(db)
    asked = [x.strip() for x in skills_.split(",") if x.strip()][:12]
    result = []
    for s in asked:
        name = skill_name(s)
        rows = (
            await db[COURSES]
            .find({"skill": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "free": True, "active": True})
            .to_list(50)
        )
        rows.sort(key=lambda c: (c.get("language", "").lower() != language.lower(), c.get("hours") or 99, c["title"]))
        result.append({"skill": name, "courses": [out(c) for c in rows[:PER_SKILL]]})
    catalogues = [{"title": t, "provider": p, "url": u} for t, p, u in CATALOGUES]
    return {"skills": result, "catalogues": catalogues}


class CourseIn(CamelModel):
    skill: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=2, max_length=160)
    provider: str = Field(min_length=2, max_length=80)
    url: str = Field(min_length=10, max_length=500)
    language: str = Field("English", max_length=30)
    hours: float | None = Field(None, ge=0, le=2000)
    free: bool = True
    active: bool = True

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        u = urlparse(v)
        if u.scheme != "https" or not u.netloc or "." not in u.netloc:
            raise ValueError("Use the full https:// link of the course.")
        if any(TRACKING.match(k) for k, _ in parse_qsl(u.query)):
            raise ValueError("Remove tracking or affiliate parts from the link (utm_, ref, aff…).")
        return v


def _doc(body: CourseIn) -> dict[str, Any]:
    return {**body.model_dump(), "skill": skill_name(body.skill)}


@admin.get("")
async def list_courses(db: DB, _: AdminAuth("settings")) -> list[dict[str, Any]]:
    await ensure_seed(db)
    return [out(c) for c in await db[COURSES].find().sort([("skill", 1), ("title", 1)]).to_list(2000)]


@admin.post("", status_code=201)
async def add_course(body: CourseIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    t = now()
    doc = {"_id": new_id(), **_doc(body), "created_at": t, "updated_at": t}
    await db[COURSES].insert_one(doc)
    await audit(
        db,
        auth.user.id,
        "course.created",
        target=doc["_id"],
        data={"skill": doc["skill"], "url": doc["url"]},
        ip=client_ip(request),
    )
    return out(doc)


@admin.put("/{course_id}")
async def edit_course(course_id: str, body: CourseIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict:
    doc = await db[COURSES].find_one_and_update(
        {"_id": course_id}, {"$set": {**_doc(body), "updated_at": now()}}, return_document=True
    )
    if not doc:
        raise ApiError(404, "not_found", "No such course.")
    await audit(
        db,
        auth.user.id,
        "course.edited",
        target=course_id,
        data={"skill": doc["skill"], "active": doc["active"]},
        ip=client_ip(request),
    )
    return out(doc)


@admin.delete("/{course_id}")
async def delete_course(course_id: str, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    r = await db[COURSES].delete_one({"_id": course_id})
    if not r.deleted_count:
        raise ApiError(404, "not_found", "No such course.")
    await audit(db, auth.user.id, "course.deleted", target=course_id, ip=client_ip(request))
    return {"deleted": course_id}
