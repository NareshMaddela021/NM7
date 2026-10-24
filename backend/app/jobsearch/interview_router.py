"""Interview prep pack + practice mode (Phase 3).

  POST /api/me/jobs/matches/{id}/interview            {useAi} → make (or remake) the pack for this job
  GET  /api/me/jobs/matches/{id}/interview            the pack (without the Interview pack: the first 3 questions)
  POST /api/me/jobs/matches/{id}/interview/practice   {qid, answer, useAi} → feedback; progress is saved

The Interview pack (Rs 99, included in Career Launch) unlocks all 10 questions, the 2-minute intro, the weak spots, the
questions to ask, the homework checklist and practice on every question. Free: the first 3 questions, with practice.
AI is counted before each call; with AI off or over a limit the rules pack / rules feedback is used.
"""

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core.db import DB, JOB_MATCHES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import access, interview
from app.jobsearch.parse import Parsed
from app.jobsearch.router import _ai_read, _match, _ms, _resume

router = APIRouter(prefix="/api/me/jobs", tags=["job search"])
log = logging.getLogger("nm7.jobs")
LOCKED = ApiError(402, "interview_locked", "This part is in the Interview pack. The first 3 questions are free.")


class MakeIn(CamelModel):
    use_ai: bool = True


class PracticeIn(CamelModel):
    qid: str = Field(..., max_length=8)
    answer: str = Field(..., min_length=1, max_length=4000)
    use_ai: bool = True


def _note(note: str) -> str:
    return note.replace("this is our quick reading of the post", "here are answers from our templates").replace(
        "this is our quick reading of it", "here are answers from our templates"
    )


def view(d: dict[str, Any], paid: bool) -> dict[str, Any]:
    pack = d.get("interview") or {}
    qs = pack.get("questions") or []
    practised = pack.get("practised") or {}
    free = access.FREE_QUESTIONS
    shown = qs if paid else qs[:free]
    out = {
        "unlocked": paid,
        "questions": [q | {"practised": practised.get(q["id"])} for q in shown],
        "locked": [] if paid else [{"id": q["id"], "group": q["group"]} for q in qs[free:]],
        "groups": interview.GROUPS,
        "progress": {
            "done": len(practised),
            "total": len(qs) if paid else min(free, len(qs)),
            "of": len(qs),
        },  # fmt: skip
        "intro": pack.get("intro") if paid else {"sec60": (pack.get("intro") or {}).get("sec60", "")},
        "weak": pack.get("weak") if paid else None,
        "ask": pack.get("ask") if paid else None,
        "homework": pack.get("homework") if paid else None,
        "source": pack.get("source", "rules"),
        "note": pack.get("note", ""),
        "resumeId": pack.get("resume_key"),
        "createdAt": _ms(pack.get("created_at")),
    }
    return out


@router.post("/matches/{match_id}/interview", status_code=201)
async def make(match_id: str, body: MakeIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    d = await _match(db, uid, match_id)
    resume = await _resume(db, uid, d.get("tailored_key") or d.get("resume_key"))
    paid = await access.has(db, uid, "interview")
    p = Parsed(**(d.get("parsed") or {}))
    data = resume.get("data") or {}
    answer, note = None, ""
    if body.use_ai:
        qs = interview.questions(p, data)
        answer, note = await _ai_read(db, auth, lambda stats: interview.call_model(p, data, qs, stats))
    pack = interview.build(p, data, answer)
    if answer and pack["source"] == "rules":
        note = "The AI answers didn't stick to your resume, so here are answers from our templates."
    rejected = pack.pop("rejected", 0)
    # practice already done on the same questions is kept
    old = (d.get("interview") or {}).get("practised") or {}
    ids = {q["id"] for q in pack["questions"]}
    pack |= {"note": _note(note), "resume_key": resume["key"], "created_at": now(),
             "practised": {k: v for k, v in old.items() if k in ids}}  # fmt: skip
    await db[JOB_MATCHES].update_one({"_id": match_id}, {"$set": {"interview": pack, "updated_at": now()}})
    log.info("job interview: source=%s rejected=%d paid=%s", pack["source"], rejected, paid)
    return view(d | {"interview": pack}, paid)


@router.get("/matches/{match_id}/interview")
async def get(match_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    d = await _match(db, auth.user.id, match_id)
    if not d.get("interview"):
        raise ApiError(404, "no_interview_pack", "Make the interview pack first.")
    return view(d, await access.has(db, auth.user.id, "interview"))


@router.post("/matches/{match_id}/interview/practice")
async def practice(match_id: str, body: PracticeIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    d = await _match(db, uid, match_id)
    pack = d.get("interview") or {}
    qs = pack.get("questions") or []
    idx = next((i for i, q in enumerate(qs) if q["id"] == body.qid), None)
    if idx is None:
        raise ApiError(404, "no_question", "That question isn't in this pack.")
    paid = await access.has(db, uid, "interview")
    if idx >= access.FREE_QUESTIONS and not paid:
        raise LOCKED
    q = qs[idx]
    resume = await _resume(db, uid, pack.get("resume_key") or d.get("resume_key"))
    data = resume.get("data") or {}
    p = Parsed(**(d.get("parsed") or {}))
    fb = interview.feedback(q, body.answer, data)
    note = ""
    if body.use_ai:
        ai, note = await _ai_read(db, auth, lambda stats: interview.call_feedback(q, body.answer, data, stats))
        fb = interview.merge_feedback(fb, ai, q, body.answer, data, p)
        if ai and fb["source"] == "rules":
            note = "The AI's better version added things you didn't say, so here is ours."
    fb["note"] = note.replace("this is our quick reading of the post", "here is our feedback").replace(
        "this is our quick reading of it", "here is our feedback"
    )
    entry = {"at": int(now().timestamp() * 1000), "answer": body.answer.strip()[:4000], "feedback": fb}
    await db[JOB_MATCHES].update_one(
        {"_id": match_id}, {"$set": {f"interview.practised.{q['id']}": entry, "updated_at": now()}}
    )
    practised = {**(pack.get("practised") or {}), q["id"]: entry}
    total = len(qs) if paid else min(access.FREE_QUESTIONS, len(qs))
    done = len([k for k in practised if paid or k in {x["id"] for x in qs[: access.FREE_QUESTIONS]}])
    return {"qid": q["id"], "feedback": fb, "progress": {"done": done, "total": total, "of": len(qs)}}
