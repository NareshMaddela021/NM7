"""Easy dashboard practice interview (re-test 12 Nov, N1): feedback after each answer to the 5 common questions.

  POST /api/me/simple/practice {q: q1..q5, answer, spokenSeconds?} → the same "clarity" feedback as the full practice
       mode (length, filler words, structure, a missing result or number) and a better version that uses only the
       answer and the student's own resume. Each question answered counts for the readiness item "Practise an
       interview" (users.simple.practised), like a practised question in a job's interview pack.

Rules only (no AI): instant, free, and nothing is sent anywhere.
"""

import re
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.autoapply.settings import resume_for
from app.core.db import DB, USERS
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import interview
from app.orgs.ats import _list, all_skills, printed

router = APIRouter(prefix="/api/me/simple/practice", tags=["easy dashboard"])

QUESTIONS = ("q1", "q2", "q3", "q4", "q5")
# how each common question is read by the rules: q1 is the introduction, q3 a STAR (situation) question
KIND = {"q1": {"id": "q1", "group": "intro"}, "q2": {"id": "q2", "group": "motivation"},
        "q3": {"id": "q3", "group": "hr"}, "q4": {"id": "q4", "group": "strengths"},
        "q5": {"id": "q5", "group": "ask"}}  # fmt: skip


class PracticeIn(CamelModel):
    q: Literal[QUESTIONS]  # type: ignore[valid-type]
    answer: str = Field(min_length=1, max_length=4000)
    spoken_seconds: float | None = Field(None, ge=1, le=900)


def _has(text: str, phrase: str) -> bool:
    words = [w for w in re.findall(r"[a-z0-9+#]+", (phrase or "").lower()) if len(w) > 2]
    return bool(words) and all(w in text for w in words[:2])


def _result_line(d: dict[str, Any]) -> str:
    """The first line of a project or job on the resume that has a number in it: their own result."""
    for x in _list(d.get("proj")) + _list(d.get("exp")):
        for line in str(x.get("description") or "").splitlines():
            line = line.strip(" -•\t")
            if re.search(r"\d", line):
                return line[:1].upper() + line[1:].rstrip(".") + "."
    return ""


def _intro_from_resume(text: str, d: dict[str, Any]) -> list[str]:
    """The parts of a good "Tell me about yourself" the answer left out, in the student's own resume words."""
    low = text.lower()
    out = []
    name = str((d.get("personal") or {}).get("name") or "").strip()
    if name and not _has(low, name):
        out.append(f"My name is {name}.")
    edu = next(iter(_list(d.get("edu"))), {})
    course = " ".join(x for x in (str(edu.get("degree") or "").strip(), str(edu.get("field") or "").strip()) if x)
    if course and not _has(low, course):
        place = str(edu.get("institution") or "").strip()
        out.append(f"I studied {course}" + (f" at {place}." if place else "."))
    skills = [s for s in all_skills(d) if s and s.lower() not in low][:2]
    if skills and not any(s.lower() in low for s in all_skills(d)):
        out.append(f"I am good at {' and '.join(skills)}.")
    proj = next(iter(_list(d.get("proj"))), {})
    title = str(proj.get("title") or "").strip()
    if title and not _has(low, title):
        out.append(f"One project I did is {title}.")
    return out


def coach(q: str, answer: str, data: dict[str, Any], spoken_seconds: float | None = None) -> dict[str, Any]:
    d = printed(data or {})
    kind = {**KIND[q]}
    if q == "q3":
        kind["star"] = {"result": _result_line(d) or interview.RESULT_GAP}
    fb = interview.feedback(kind, answer, d, spoken_seconds)
    if q == "q1":
        extra = _intro_from_resume(" ".join(answer.split()), d)
        if extra:  # their answer, then what their resume says that they left out
            fb["better"] = " ".join([fb["better"].replace(" [Add what came out of it.]", ""), *extra]).strip()
            fb["structure"] = "Say who you are, what you studied, one skill and one project. Some of that is missing."
        else:
            fb["structure"] = "Clear: your name, what you studied, a skill and a project."
    if q == "q5":  # a question for them: no result or number is needed
        asks = "?" in answer or re.search(r"\b(what|how|which|when|who|will|can|is there)\b", answer.lower())
        ask_one = "Ask them one real question, for example what you will learn in the first month."
        fb["structure"] = "Good: you asked them a real question." if asks else ask_one
        fb["result"] = ""
        fb["better"] = fb["better"].replace(" [Add what came out of it.]", "")
    return fb


@router.post("")
async def practise(body: PracticeIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    r = await resume_for(db, auth.user.id)
    fb = coach(body.q, body.answer, (r or {}).get("data") or {}, body.spoken_seconds)
    await db[USERS].update_one(
        {"_id": auth.user.id},
        {"$set": {f"simple.practised.{body.q}": {"at": now(), "words": fb["words"]}}},
    )
    u = await db[USERS].find_one({"_id": auth.user.id}, {"simple.practised": 1}) or {}
    done = len(((u.get("simple") or {}).get("practised")) or {})
    return {"q": body.q, "feedback": fb, "done": done, "total": len(QUESTIONS)}
