"""Recruiter feedback to the college (R4; the `recruiter_feedback` feature, Drive and Campus). After a drive (in the
portal, or later from My drives) the recruiter fills a one-minute form: an overall rating 1–5, common gaps (skills
from the skills dictionary, "basics of <skill>", projects without results, communication, and free text), what went
well, and whether they would visit again. One answer per invite; it can be changed.

The college's coordinators see each drive's feedback and a combined "What recruiters said" (average rating, top gaps
across drives) with free courses for the skill gaps. Nothing in it is about one student, and students never see it.

  GET/PUT /api/recruiter/{token}/feedback                       (an active invite)
  GET/PUT /api/recruiter-account/drives/{invite_id}/feedback    (My drives: past drives too)
  GET     /api/org/{org_id}/recruiter-feedback                  coordinators (their groups' invites)
"""

from collections import Counter
from typing import Any, Literal

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.core.db import DB, ORGANIZATIONS, RECRUITER_FEEDBACK, RECRUITER_INVITES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.courses.router import courses_for
from app.courses.seed import SEED
from app.jobsearch import skills as dictionary
from app.me.service import ms
from app.orgs.recruiter import NO_STORE
from app.orgs.recruiter_account import _invites
from app.orgs.recruiter_account import _signed_in as account_signed_in
from app.orgs.recruiter_portal import _audit, _signed_in
from app.orgs.scope import NOT_FOUND, OrgScope, features_of, require_feature

portal = APIRouter(prefix="/api/recruiter/{token}/feedback", tags=["recruiter feedback"])
account = APIRouter(prefix="/api/recruiter-account/drives/{invite_id}/feedback", tags=["recruiter feedback"])
staff = APIRouter(prefix="/api/org/{org_id}/recruiter-feedback", tags=["recruiter feedback"])

EXTRA = ("C", "C++", "Data structures", "Linux")  # beyond the course list
TOP = 8


def skill_options() -> list[str]:
    """The tick list: skills Nm7 has free courses for, plus a few every recruiter asks about (dictionary names)."""
    names = {(s[0] if isinstance(s, tuple) else s["skill"]) for s in SEED}
    names |= {dictionary.canonical(x) or "" for x in EXTRA}
    return sorted({n for n in names if n and dictionary.canonical(n)}, key=str.lower)


class FeedbackIn(CamelModel):
    rating: int = Field(ge=1, le=5)
    skills: list[str] = Field(default_factory=list, max_length=20)  # missing skills
    basics: list[str] = Field(default_factory=list, max_length=10)  # "basics of <skill>"
    projects_no_results: bool = False
    communication: bool = False
    other: str = Field("", max_length=300)
    went_well: str = Field("", max_length=500)
    visit_again: Literal["yes", "maybe", "no"]

    @field_validator("skills", "basics")
    @classmethod
    def _skills(cls, v):
        out = []
        for s in v:
            c = dictionary.canonical(s.strip())
            if not c:
                raise ValueError(f"“{s}” isn’t in the skills list.")
            if c not in out:
                out.append(c)
        return out

    @field_validator("other", "went_well")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())


def gaps_of(f: dict[str, Any]) -> list[str]:
    return [
        *f.get("skills", []),
        *(f"Basics of {s}" for s in f.get("basics", [])),
        *(["Projects without results"] if f.get("projects_no_results") else []),
        *(["Communication"] if f.get("communication") else []),
    ]


def feedback_out(f: dict[str, Any] | None) -> dict[str, Any] | None:
    if not f:
        return None
    return {
        "rating": f["rating"],
        "skills": f.get("skills", []),
        "basics": f.get("basics", []),
        "projectsNoResults": f.get("projects_no_results", False),
        "communication": f.get("communication", False),
        "other": f.get("other", ""),
        "wentWell": f.get("went_well", ""),
        "visitAgain": f["visit_again"],
        "gaps": gaps_of(f),
        "updatedAt": ms(f.get("updated_at")),
    }


async def _get(db, inv: dict[str, Any]) -> dict[str, Any]:
    f = await db[RECRUITER_FEEDBACK].find_one({"_id": inv["_id"]})
    return {"company": inv["company"], "orgName": inv["_org"]["name"], "feedback": feedback_out(f),
            "options": skill_options()}  # fmt: skip


async def _put(db, inv: dict[str, Any], body: FeedbackIn) -> dict[str, Any]:
    t = now()
    doc = {**body.model_dump(), "org_id": inv["org_id"], "company": inv["company"], "group_ids": inv["group_ids"],
           "demo": bool(inv.get("demo")), "updated_at": t}  # fmt: skip
    await db[RECRUITER_FEEDBACK].update_one(
        {"_id": inv["_id"]}, {"$set": doc, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    await audit(db, None, "recruiter_feedback", target=inv["_id"], data=_audit(inv, rating=body.rating))
    return await _get(db, inv)


def _require(inv: dict[str, Any]) -> None:
    if not features_of(inv["_org"])["recruiter_feedback"]:
        raise ApiError(402, "plan_feature", "Recruiter feedback isn’t on for this college’s plan.")


@portal.get("")
async def portal_get(
    token: str, request: Request, response: Response, db: DB, x_recruiter_session: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    _require(inv)
    return await _get(db, inv)


@portal.put("")
async def portal_put(
    token: str,
    body: FeedbackIn,
    request: Request,
    response: Response,
    db: DB,
    x_recruiter_session: str | None = Header(None),
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    inv = await _signed_in(db, token, request, x_recruiter_session)
    _require(inv)
    return await _put(db, inv, body)


async def _account_invite(db, invite_id: str, session: str | None) -> dict[str, Any]:
    acc = await account_signed_in(db, session)
    inv = next((i for i in await _invites(db, acc["email_lc"]) if i["_id"] == invite_id), None)
    if not inv:
        raise NOT_FOUND
    _require(inv)
    return inv


@account.get("")
async def account_get(
    invite_id: str, response: Response, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    return await _get(db, await _account_invite(db, invite_id, x_recruiter_account))


@account.put("")
async def account_put(
    invite_id: str, body: FeedbackIn, response: Response, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    return await _put(db, await _account_invite(db, invite_id, x_recruiter_account), body)


@staff.get("")
async def college_feedback(db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, "recruiter_feedback")
    rows = await db[RECRUITER_FEEDBACK].find({"org_id": scope.org_id}).sort("updated_at", -1).to_list(500)
    if scope.group_ids is not None:  # a coordinator of some groups: feedback on invites to those groups only
        rows = [f for f in rows if set(f.get("group_ids") or []) <= set(scope.group_ids)]
    invites = {
        i["_id"]: i
        async for i in db[RECRUITER_INVITES].find(
            {"_id": {"$in": [f["_id"] for f in rows]}}, {"created_at": 1, "expires_at": 1}
        )
    }
    drives = [
        {"id": f["_id"], "company": f["company"], "invitedAt": ms((invites.get(f["_id"]) or {}).get("created_at")),
         **feedback_out(f)}
        for f in rows
    ]  # fmt: skip
    counts = Counter(g for f in rows for g in gaps_of(f))
    top = counts.most_common(TOP)
    fixed = ("Projects without results", "Communication")
    skill_gaps = [g.removeprefix("Basics of ") for g, _ in top if g not in fixed]
    courses = {c["skill"].lower(): c["courses"][:2] for c in await courses_for(db, list(dict.fromkeys(skill_gaps)))}
    summary = {
        "count": len(rows),
        "rating": round(sum(f["rating"] for f in rows) / len(rows), 1) if rows else None,
        "visitAgain": {k: sum(1 for f in rows if f["visit_again"] == k) for k in ("yes", "maybe", "no")},
        "topGaps": [
            {"gap": g, "count": n, "courses": courses.get(g.removeprefix("Basics of ").lower(), [])} for g, n in top
        ],
    }
    return {"summary": summary, "drives": drives}
