"""Student testimonials and placement stories. A student submits a short story (and, if they like, a photo, the
company and role) with an explicit consent tick for public use. Nm7's admin approves it (fixing typos only),
or rejects it. Approved stories show on the home page and /for-orgs. The student can withdraw a story at any time and
it disappears at once (it is deleted). Nothing is ever made up: the public list holds only real, approved stories;
the demo college's stories are marked demo and never public.

Stories can't hold phone numbers, email addresses or ID numbers.

  GET    /api/me/stories                 mine
  POST   /api/me/stories                 {story, displayName, company?, role?, photo? (data URL), consent: true}
  DELETE /api/me/stories/{id}            withdraw (deleted)
  GET    /api/admin/stories?status=      pending / approved / rejected
  PUT    /api/admin/stories/{id}         {action: approve | reject, story?} (story: typo fixes only)
  GET    /api/public/stories             approved, not demo
"""

import base64
import binascii
import difflib
import re
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core.db import DB, STORIES
from app.core.errors import ApiError
from app.core.pii import PHONE, has_id_number
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms

me = APIRouter(prefix="/api/me/stories", tags=["stories"])
admin = APIRouter(prefix="/api/admin/stories", tags=["admin"])
public = APIRouter(prefix="/api/public/stories", tags=["public"])

MAX_PHOTO = 300_000
MAX_OPEN = 3  # pending or approved stories per student
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
NO_CONTACT = ApiError(
    400, "contact_details", "Please remove phone numbers, email addresses and ID numbers: the story is public."
)


class StoryIn(CamelModel):
    story: str = Field(min_length=40, max_length=700)
    display_name: str = Field(min_length=2, max_length=40)  # how the name shows, e.g. "Asha R."
    company: str = Field("", max_length=60)
    role: str = Field("", max_length=60)
    photo: str | None = Field(None, max_length=MAX_PHOTO * 2)
    consent: Literal[True]  # "Nm7 may show this story, my name and photo on its website"


class DecideIn(CamelModel):
    action: Literal["approve", "reject"]
    story: str | None = Field(None, min_length=40, max_length=700)


def _clean(*texts: str) -> None:
    for t in texts:
        if t and (EMAIL.search(t) or PHONE.search(t) or has_id_number(t)):
            raise NO_CONTACT


def check_photo(data_url: str) -> str:
    """A PNG or JPEG data URL up to 300 KB (else 400)."""
    bad = ApiError(400, "bad_photo", "Use a PNG or JPG photo up to 300 KB.")
    m = re.match(r"^data:(image/png|image/jpeg);base64,([A-Za-z0-9+/=]+)$", data_url or "")
    if not m:
        raise bad
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise bad from None
    png, jpg = raw.startswith(b"\x89PNG\r\n\x1a\n"), raw.startswith(b"\xff\xd8\xff")
    if len(raw) > MAX_PHOTO or not ((m.group(1) == "image/png" and png) or (m.group(1) == "image/jpeg" and jpg)):
        raise bad
    return data_url


def typo_only(before: str, after: str) -> bool:
    """An admin edit that only fixes typos: almost the same text, about the same length."""
    if abs(len(after) - len(before)) > max(10, len(before) // 10):
        return False
    return difflib.SequenceMatcher(None, before, after).ratio() >= 0.9


def out(s: dict[str, Any], *, admin_view: bool = False) -> dict[str, Any]:
    o = {
        "id": s["_id"],
        "story": s["story"],
        "displayName": s["display_name"],
        "company": s.get("company", ""),
        "role": s.get("role", ""),
        "photo": s.get("photo"),
        "status": s["status"],
        "createdAt": ms(s["created_at"]),
    }
    if admin_view:
        o.update(demo=bool(s.get("demo")), original=s.get("original") or s["story"], edited=bool(s.get("original")))
    return o


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> list[dict[str, Any]]:
    return [out(s) async for s in db[STORIES].find({"user_id": auth.user.id}).sort("created_at", -1)]


@me.post("", status_code=201)
async def submit(body: StoryIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    _clean(body.story, body.display_name, body.company, body.role)
    q = {"user_id": auth.user.id, "status": {"$in": ["pending", "approved"]}}
    if await db[STORIES].count_documents(q) >= MAX_OPEN:
        raise ApiError(409, "too_many", f"You can have {MAX_OPEN} stories at a time. Withdraw one to add another.")
    s = {
        "_id": new_id(),
        "user_id": auth.user.id,
        "story": " ".join(body.story.split()),
        "display_name": body.display_name.strip(),
        "company": body.company.strip(),
        "role": body.role.strip(),
        "photo": check_photo(body.photo) if body.photo else None,
        "consent_at": now(),
        "status": "pending",
        "created_at": now(),
    }
    await db[STORIES].insert_one(s)
    await audit(db, auth.user.id, "story.submitted", target=s["_id"], ip=client_ip(request))
    return out(s)


@me.delete("/{story_id}", status_code=204)
async def withdraw(story_id: str, request: Request, db: DB, auth: CustomerAuth) -> Response:
    r = await db[STORIES].delete_one({"_id": story_id, "user_id": auth.user.id})
    if not r.deleted_count:
        raise ApiError(404, "not_found", "No such story.")
    await audit(db, auth.user.id, "story.withdrawn", target=story_id, ip=client_ip(request))
    return Response(status_code=204)


@admin.get("")
async def list_stories(
    db: DB, _: AdminAuth("customers"), status: Literal["pending", "approved", "rejected"] | None = Query(None)
) -> list[dict[str, Any]]:
    q = {"status": status} if status else {}
    rows = await db[STORIES].find(q).sort("created_at", -1).limit(300).to_list(None)
    return [out(s, admin_view=True) for s in rows]


@admin.put("/{story_id}")
async def decide(story_id: str, body: DecideIn, request: Request, db: DB, auth: AdminAuth("customers")) -> dict:
    s = await db[STORIES].find_one({"_id": story_id})
    if not s:
        raise ApiError(404, "not_found", "This story was withdrawn.")
    sets: dict[str, Any] = {"status": "approved" if body.action == "approve" else "rejected", "decided_at": now()}
    if body.story is not None and body.story.strip() != s["story"]:
        new = " ".join(body.story.split())
        original = s.get("original") or s["story"]
        if not typo_only(original, new):
            raise ApiError(400, "not_a_typo", "Only fix typos. Larger changes need the student to send a new story.")
        _clean(new)
        sets.update(story=new, original=original)
    await db[STORIES].update_one({"_id": story_id}, {"$set": sets})
    await audit(db, auth.user.id, f"story.{sets['status']}", target=story_id, ip=client_ip(request))
    return out({**s, **sets}, admin_view=True)


@public.get("")
async def public_stories(response: Response, db: DB, limit: int = Query(6, ge=1, le=12)) -> list[dict[str, Any]]:
    response.headers["Cache-Control"] = "public, max-age=300"
    q = {"status": "approved", "demo": {"$ne": True}}
    rows = await db[STORIES].find(q).sort("decided_at", -1).limit(limit).to_list(None)
    return [{k: v for k, v in out(s).items() if k not in ("status", "createdAt")} for s in rows]
