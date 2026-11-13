# ruff: noqa: E501  (kind wording on one line each)
"""Phase 6 S6: interview feedback. When a company marks an applicant Not selected it can pick 1–3 short reasons
(optional, encouraged); the student sees them in kind words with practice tests and free courses to help. The
feedback never carries the interviewer's name or the account that wrote it. Students can also keep private
self-reviews of any interview (what was asked, how it went) and get tips. Recent reasons add "Work on interview
feedback" to the readiness score's things left.

  POST /api/company/{cid}/applicants/{app_id}/feedback {reasons, skill, note}   only for Not selected applicants
  GET  /api/me/feedback                          feedback I got (kind wording + help) and my self-reviews
  POST /api/me/feedback/self {company, role, date, asked, went, notes}            private; tips by rules
  DELETE /api/me/feedback/self/{id}
"""

import re
from datetime import timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.signup import company_for
from app.core.db import APPLICATIONS, DB, INTERVIEW_REVIEWS, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.courses.router import courses_for
from app.me.service import ms
from app.seek.practice_bank import SETS

company = APIRouter(prefix="/api/company", tags=["job seekers"])
me = APIRouter(prefix="/api/me/feedback", tags=["job seekers"])

POST = {"main", "full", "posting"}
Reason = Literal["skills", "communication", "experience", "fit", "filled", "other"]
REASONS = ("skills", "communication", "experience", "fit", "filled", "other")
# what the student reads: kind, plain, never blaming; no interviewer, no account
KIND = {
    "skills": "They were looking for more {skill}. That is something you can learn: here is a free way to start.",
    "skills_any": "They were looking for stronger skills for this role. You can build them: here is a free way to start.",
    "communication": "They felt your answers could be clearer. Practising a few common questions out loud helps a lot.",
    "experience": "They chose someone with more experience this time. A small project or an internship can close that gap.",
    "fit": "They felt the role wasn't the best match for you. That isn't about your worth: other roles may suit you better.",
    "filled": "The position was filled. This often has nothing to do with you; keep applying.",
    "other": "They shared a short note with you.",
}
RECENT = timedelta(days=90)
SKILL_SET = {"sql": "role-SQL", "excel": "role-Excel", "microsoft excel": "role-Excel", "python": "role-Python",
             "accounting": "role-Accounting", "tally": "role-Accounting", "electrical": "role-Electrical",
             "warehouse": "role-Warehouse", "sales": "role-Sales", "customer support": "role-Customer support",
             "customer service": "role-Customer support"}  # fmt: skip
TIPS = {
    "badly": "One hard interview doesn't decide anything. Write down the questions you found hard and practise just those.",
    "ok": "Good effort. Pick the one answer you'd most like to redo and practise it out loud twice.",
    "well": "Well done. Note what worked so you can do it again, and send a short thank-you email today.",
}
ASKED_TIPS = [
    (
        re.compile(r"tell me about yourself|introduce yourself", re.I),
        "For “Tell me about yourself”: 3 parts in under a minute — what you studied, one thing you built or did, why this role.",
    ),
    (
        re.compile(r"weakness|strength", re.I),
        "For strengths and weaknesses: give one real example each, and for a weakness say what you are doing about it.",
    ),
    (
        re.compile(r"salary|ctc|expect", re.I),
        "For salary questions: use the salary guide for your role and city, and give a range.",
    ),
    (
        re.compile(r"sql|excel|python|code|coding|query", re.I),
        "For technical questions: practise the matching practice test, and say your thinking out loud next time.",
    ),
    (
        re.compile(r"why (should we|do you want)|why this", re.I),
        "For “Why this job”: name one thing about the company and one skill of yours that fits.",
    ),
]


class FeedbackIn(CamelModel):
    reasons: list[Reason] = Field(min_length=1, max_length=3)
    skill: str = Field("", max_length=60)
    note: str = Field("", max_length=300)

    @field_validator("note", "skill")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return " ".join(v.split())


@company.post("/{cid}/applicants/{app_id}/feedback")
async def give(cid: str, app_id: str, body: FeedbackIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    try:
        oid = ObjectId(app_id)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "No such applicant.") from None
    a = await db[APPLICATIONS].find_one({"_id": oid, "company_id": cid})
    if not a:
        raise ApiError(404, "not_found", "No such applicant.")
    if a.get("status") != "rejected":
        raise ApiError(409, "not_rejected", "Feedback is for applicants marked Not selected.")
    fb = {"reasons": list(dict.fromkeys(body.reasons)), "skill": body.skill if "skills" in body.reasons else "",
          "note": body.note, "at": now()}  # never the interviewer's name or who wrote it  # fmt: skip
    await db[APPLICATIONS].update_one({"_id": a["_id"]}, {"$set": {"feedback": fb}})
    await audit(
        db,
        None,
        "company.applicant_feedback",
        target=cid,
        data={"by": acc["email_lc"], "app": app_id, "reasons": fb["reasons"]},
    )
    return {"ok": True, "reasons": fb["reasons"]}


async def help_for(db, fb: dict[str, Any]) -> list[dict[str, Any]]:
    """For each reason: kind words, and practice / free courses where they help."""
    out = []
    for r in fb.get("reasons") or []:
        row: dict[str, Any] = {
            "reason": r,
            "text": KIND["skills_any"]
            if r == "skills" and not fb.get("skill")
            else KIND[r].format(skill=fb.get("skill") or ""),
        }
        if r == "skills" and fb.get("skill"):
            row["practice"] = SKILL_SET.get(fb["skill"].lower(), "")
            row["courses"] = (await courses_for(db, [fb["skill"]], per=2))[0]["courses"]
        elif r == "communication":
            row["practice"] = "english-email"
            row["courses"] = (await courses_for(db, ["Communication skills"], per=2))[0]["courses"]
            row["interview"] = True  # the voice interview practice too
        elif r == "experience":
            row["learn"] = True  # learning paths: a project
        elif r == "other" and fb.get("note"):
            row["note"] = fb["note"]
        if row.get("practice") and row["practice"] not in SETS:
            row["practice"] = ""
        out.append(row)
    if fb.get("note") and "other" not in (fb.get("reasons") or []):
        out.append({"reason": "note", "text": "They added a short note:", "note": fb["note"]})
    return out


async def recent_reasons(db, uid: str) -> list[str]:
    """Reasons from the last 90 days that the student can work on (for readiness "things left")."""
    got: list[str] = []
    async for a in db[APPLICATIONS].find(
        {"user_id": uid, "feedback.at": {"$gt": now() - RECENT}}, {"feedback.reasons": 1}
    ):
        got += [r for r in a["feedback"].get("reasons") or [] if r in ("skills", "communication", "experience")]
    return got


class SelfIn(CamelModel):
    company: str = Field("", max_length=120)
    role: str = Field("", max_length=120)
    date: str = Field("", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    asked: str = Field("", max_length=2000)
    went: Literal["well", "ok", "badly"]
    notes: str = Field("", max_length=2000)


def tips_for(went: str, asked: str) -> list[str]:
    tips = [TIPS[went]]
    tips += [t for rx, t in ASKED_TIPS if rx.search(asked or "")][:3]
    return tips


def self_out(d: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(d["_id"]), "company": d["company"], "role": d["role"], "date": d["date"], "asked": d["asked"],
            "went": d["went"], "notes": d["notes"], "tips": tips_for(d["went"], d["asked"]), "at": ms(d["at"])}  # fmt: skip


@me.get("")
async def mine(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    got = []
    async for a in (
        db[APPLICATIONS]
        .find({"user_id": auth.user.id, "feedback": {"$exists": True}})
        .sort("feedback.at", -1)
        .limit(30)
    ):
        j = await db[JOBS].find_one({"_id": a["job_id"]}, {"title": 1, "company.name": 1}) or {}
        got.append({"id": str(a["_id"]), "job": j.get("title", ""), "company": (j.get("company") or {}).get("name", ""),
                    "at": ms(a["feedback"]["at"]), "help": await help_for(db, a["feedback"])})  # fmt: skip
    reviews = [
        self_out(d) async for d in db[INTERVIEW_REVIEWS].find({"user_id": auth.user.id}).sort("at", -1).limit(50)
    ]
    return {"feedback": got, "reviews": reviews}


@me.post("/self", status_code=201)
async def add_self(body: SelfIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if await db[INTERVIEW_REVIEWS].count_documents({"user_id": auth.user.id}) >= 200:
        raise ApiError(409, "too_many", "You have 200 notes already. Delete some old ones first.")
    doc = {
        "user_id": auth.user.id,
        **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()},
        "at": now(),
    }
    doc["_id"] = (await db[INTERVIEW_REVIEWS].insert_one(doc)).inserted_id
    return self_out(doc)


@me.delete("/self/{rid}")
async def del_self(rid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    try:
        oid = ObjectId(rid)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That note isn't here.") from None
    if not (await db[INTERVIEW_REVIEWS].delete_one({"_id": oid, "user_id": auth.user.id})).deleted_count:
        raise ApiError(404, "not_found", "That note isn't here.")
    return {"deleted": rid}
