"""Faculty review mode (feature `faculty_review`: Drive and Campus plans).

Coordinators add faculty mentors as Reviewers (an org staff role) and assign students to them. A reviewer opens an
assigned student's shared resume (in the college format), leaves comments on a section (optionally quoting a line),
and sets a status — needs changes or approved — which feeds the existing review status the placement office already
uses (needs changes / ready). Students see the comments in the builder, next to the section, and mark them resolved.

Reviewers see only their assigned students, and nothing else of the organization: every other /api/org/{org_id}/…
endpoint answers 404 for them (app.orgs.scope.org_scope).

Staff (/api/org/{org_id}/reviewers; coordinators and Owners):
  GET  ""                          reviewers and how many students each has
  POST ""                          {email}: invite a reviewer (they accept with their own Nm7 account)
  GET  /{staff_id}/students        who can be assigned, and who is
  PUT  /{staff_id}/students        {membershipIds}
Reviewer (/api/review/{org_id}):
  GET  /students                   my assigned students
  GET  /students/{membership_id}   the shared resume (college format) and the comments
  POST /students/{membership_id}/comments   {section, line?, text}
  PUT  /students/{membership_id}/status     {status: needs_changes | approved, note?}
Student (/api/me/review-comments):
  GET  ""                          comments on my shared resumes
  POST /{id}/resolve               {resolved}
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Request
from pydantic import Field

from app.audit import audit
from app.auth.deps import Auth, CustomerAuth, get_auth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.college.common import log, members_of, org_with, public, scoped_groups
from app.core.db import DB, MEMBERSHIPS, ORG_STAFF, ORGANIZATIONS, REVIEW_COMMENTS, USERS
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.orgs.branding import brands_for
from app.orgs.scope import NOT_FOUND, OrgScope, Scope, features_of
from app.orgs.service import printable, shared_rows

staff = APIRouter(prefix="/api/org/{org_id}/reviewers", tags=["reviews"])
reviewer = APIRouter(prefix="/api/review/{org_id}", tags=["reviews"])
me = APIRouter(prefix="/api/me/review-comments", tags=["reviews"])

SECTIONS = {
    "general": "Overall", "personal": "Personal details", "summary": "Summary", "exp": "Experience",
    "edu": "Education", "proj": "Projects", "skills": "Skills", "certs": "Certifications", "ach": "Achievements",
    "langs": "Languages", "links": "Links", "hobbies": "Hobbies", "strengths": "Strengths",
}  # fmt: skip


class InviteIn(CamelModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


class AssignIn(CamelModel):
    membership_ids: list[str] = Field(max_length=500)


class CommentIn(CamelModel):
    section: str = Field(max_length=20)
    line: str = Field("", max_length=200)
    text: str = Field(min_length=2, max_length=1000)


class StatusIn(CamelModel):
    status: Literal["needs_changes", "approved"]
    note: str = Field("", max_length=500)


class ResolveIn(CamelModel):
    resolved: bool = True


# ---------- coordinators ----------
@staff.get("")
async def list_reviewers(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    await org_with(db, scope, "faculty_review")
    rows = (
        await db[ORG_STAFF]
        .find({"org_id": scope.org_id, "role": "reviewer", "status": {"$in": ["invited", "active"]}})
        .to_list(None)
    )
    names = {
        u["_id"]: u.get("name", "")
        async for u in db[USERS].find({"_id": {"$in": [s.get("user_id") for s in rows]}}, {"name": 1})
    }
    return [
        {
            "id": s["_id"],
            "email": s["email"],
            "name": names.get(s.get("user_id"), ""),
            "status": s["status"],
            "students": len(s.get("member_ids") or []),
            "inviteUrl": None,
        }
        for s in rows
    ]


@staff.post("", status_code=201)
async def invite_reviewer(
    body: InviteIn, request: Request, db: DB, scope: OrgScope, mailer: MailerDep
) -> dict[str, Any]:
    from app.orgs.staff import StaffIn, _invite_staff

    o = await org_with(db, scope, "faculty_review")
    scope.require("manage")
    s = await _invite_staff(
        db, mailer, o, StaffIn(email=body.email.strip(), role="reviewer", group_ids=None), scope, request
    )
    return s


async def _reviewer_row(db, scope, staff_id: str) -> dict[str, Any]:
    s = await db[ORG_STAFF].find_one({"_id": staff_id, "org_id": scope.org_id, "role": "reviewer"})
    if not s:
        raise NOT_FOUND
    return s


@staff.get("/{staff_id}/students")
async def assignable(staff_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "faculty_review")
    s = await _reviewer_row(db, scope, staff_id)
    people = await members_of(db, await scoped_groups(db, scope))
    return {
        "people": [public(p) for p in people],
        "chosen": [i for i in s.get("member_ids") or [] if i in {p["id"] for p in people}],
    }


@staff.put("/{staff_id}/students")
async def assign(staff_id: str, body: AssignIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "faculty_review")
    scope.require("manage")
    s = await _reviewer_row(db, scope, staff_id)
    ok = {p["id"] for p in await members_of(db, await scoped_groups(db, scope))}
    ids = [i for i in dict.fromkeys(body.membership_ids) if i in ok]
    # a coordinator limited to some groups keeps the reviewer's other assignments as they were
    keep = [i for i in s.get("member_ids") or [] if i not in ok]
    await db[ORG_STAFF].update_one({"_id": staff_id}, {"$set": {"member_ids": keep + ids}})
    await log(db, scope, request, "reviewer_assign", staff_id, count=len(ids))
    return await assignable(staff_id, db, scope)


# ---------- reviewers ----------
async def review_scope(
    db: DB, auth: Annotated[Auth, Depends(get_auth)], org_id: str = Path(max_length=64)
) -> tuple[Scope, dict[str, Any], dict[str, Any]]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    st = await db[ORG_STAFF].find_one(
        {"org_id": org_id, "user_id": auth.user.id, "status": "active", "role": "reviewer"}
    )
    if not o or not st or o.get("status") == "archived" or not features_of(o)["faculty_review"]:
        raise NOT_FOUND
    return Scope(actor_id=auth.user.id, role="coordinator", org_id=org_id, staff_id=st["_id"]), st, o


ReviewScope = Annotated[tuple, Depends(review_scope)]


async def _assigned(
    db, st: dict[str, Any], org_id: str, mid: str | None = None, *, with_data: bool = False
) -> list[dict[str, Any]]:
    ids = st.get("member_ids") or []
    if mid is not None:
        if mid not in ids:
            raise NOT_FOUND
        ids = [mid]
    return await shared_rows(db, {"org_id": org_id, "_id": {"$in": ids}}, with_data=with_data)


def comment_out(c: dict[str, Any], who: str = "") -> dict[str, Any]:
    return {
        "id": c["_id"],
        "section": c["section"],
        "sectionName": SECTIONS.get(c["section"], c["section"]),
        "line": c.get("line", ""),
        "text": c["text"],
        "by": who,
        "resolved": bool(c.get("resolved_at")),
        "at": ms(c["created_at"]),
    }


@reviewer.get("/students")
async def my_students(db: DB, rs: ReviewScope) -> dict[str, Any]:
    _, st, o = rs
    rows = await _assigned(db, st, o["_id"])
    open_ = {}
    async for c in db[REVIEW_COMMENTS].find(
        {"org_id": o["_id"], "membership_id": {"$in": [r["membership_id"] for r in rows]}, "resolved_at": None},
        {"membership_id": 1},
    ):
        open_[c["membership_id"]] = open_.get(c["membership_id"], 0) + 1
    return {
        "org": o["name"],
        "students": [
            {
                "id": r["membership_id"],
                "name": r["name"],
                "group": r["group_name"],
                "reviewStatus": r.get("review_status", "none"),
                "openComments": open_.get(r["membership_id"], 0),
            }
            for r in rows
        ],
    }


@reviewer.get("/students/{membership_id}")
async def student(membership_id: str, db: DB, rs: ReviewScope) -> dict[str, Any]:
    _, st, o = rs
    rows = await _assigned(db, st, o["_id"], membership_id, with_data=True)
    if not rows:
        raise NOT_FOUND
    r = rows[0]
    brand = (await brands_for(db, [r["group_id"]])).get(r["group_id"])
    cs = (
        await db[REVIEW_COMMENTS]
        .find({"org_id": o["_id"], "membership_id": membership_id})
        .sort("created_at", 1)
        .to_list(200)
    )
    return {
        "id": membership_id,
        "name": r["name"],
        "group": r["group_name"],
        "reviewStatus": r.get("review_status", "none"),
        "data": printable(r),
        "brand": brand,
        "comments": [comment_out(c) for c in cs],
        "sections": SECTIONS,
    }


@reviewer.post("/students/{membership_id}/comments", status_code=201)
async def add_comment(membership_id: str, body: CommentIn, request: Request, db: DB, rs: ReviewScope) -> dict[str, Any]:
    scope, st, o = rs
    rows = await _assigned(db, st, o["_id"], membership_id)
    if not rows:
        raise NOT_FOUND
    if body.section not in SECTIONS:
        raise ApiError(400, "bad_section", "Choose a section of the resume.")
    c = {
        "_id": new_id(),
        "org_id": o["_id"],
        "membership_id": membership_id,
        "user_id": rows[0]["user_id"],
        "reviewer_id": scope.actor_id,
        "section": body.section,
        "line": " ".join(body.line.split()),
        "text": body.text.strip(),
        "resolved_at": None,
        "created_at": now(),
    }
    await db[REVIEW_COMMENTS].insert_one(c)
    await audit(
        db,
        scope.actor_id,
        "review_comment",
        target=membership_id,
        data={"orgs": [o["_id"]], "by": "staff", "role": "reviewer", "section": body.section},
        ip=client_ip(request),
    )
    return comment_out(c)


@reviewer.put("/students/{membership_id}/status")
async def set_status(membership_id: str, body: StatusIn, request: Request, db: DB, rs: ReviewScope) -> dict[str, Any]:
    """Feeds the review status the placement office uses: needs changes, or approved (shown as "Ready")."""
    scope, st, o = rs
    if not await _assigned(db, st, o["_id"], membership_id):
        raise NOT_FOUND
    status = "needs_changes" if body.status == "needs_changes" else "ready"
    note = " ".join(body.note.split())
    await db[MEMBERSHIPS].update_one(
        {"_id": membership_id},
        {"$set": {"review_status": status, "review_note": note, "reviewed_at": now(), "reviewed_by": scope.actor_id}},
    )
    await audit(
        db,
        scope.actor_id,
        "review",
        target=membership_id,
        data={"orgs": [o["_id"]], "by": "staff", "role": "reviewer", "status": status},
        ip=client_ip(request),
    )
    return {"reviewStatus": status}


# ---------- students ----------
@me.get("")
async def my_comments(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    mids = {m["_id"]: m async for m in db[MEMBERSHIPS].find({"user_id": auth.user.id, "left_at": None})}
    rows = (
        await db[REVIEW_COMMENTS]
        .find({"membership_id": {"$in": list(mids)}, "user_id": auth.user.id})
        .sort("created_at", -1)
        .to_list(300)
    )
    orgs = {
        o["_id"]: o["name"]
        async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({c["org_id"] for c in rows})}}, {"name": 1})
    }
    return [
        {**comment_out(c, orgs.get(c["org_id"], "")), "resumeId": mids[c["membership_id"]].get("resume_id")}
        for c in rows
    ]


@me.post("/{comment_id}/resolve")
async def resolve(comment_id: str, body: ResolveIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    c = await db[REVIEW_COMMENTS].find_one({"_id": comment_id, "user_id": auth.user.id})
    if not c:
        raise NOT_FOUND
    await db[REVIEW_COMMENTS].update_one(
        {"_id": comment_id}, {"$set": {"resolved_at": now() if body.resolved else None}}
    )
    c["resolved_at"] = now() if body.resolved else None
    return comment_out(c)
