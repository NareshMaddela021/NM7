"""The skill checks as they were before Vetting V2 (H3: 10 questions in 10 minutes, a spoken answer, share with
companies). While the vetting engine is hidden (Admin → Skill checks → Launch, app/hire/vetting/access.py) everyone
except admins, demo accounts and testers gets exactly this, at the same address. Only the original questions are used:
the V2 bank questions (they carry a `bank_id`) are left out, so the old tests look and score as before."""

import random
from datetime import timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import Field, field_validator

from app.audit import audit
from app.core.db import RESUMES, SKILL_ATTEMPTS, SKILL_QUESTIONS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.hire.bank import SPOKEN
from app.hire.skillcheck import EVERY, GRACE, MIN_QUESTIONS, MINUTES, QUESTIONS, ensure_bank, mark, result_out, skills
from app.jobsearch import interview
from app.me.service import ms

CLASSIC = {"bank_id": {"$exists": False}}  # the H3 questions only


async def catalog(db, uid: str) -> dict[str, Any]:
    await ensure_bank(db)
    t = now()
    have = await skills(db)
    mine: dict[str, dict[str, Any]] = {}
    async for a in db[SKILL_ATTEMPTS].find({"user_id": uid}).sort("started_at", -1):
        mine.setdefault(a["skill"], result_out(a, t))
    return {
        "minutes": MINUTES,
        "questions": QUESTIONS,
        "everyDays": EVERY.days,
        "skills": [{"skill": s, "role": v["role"], "last": mine.get(s)} for s, v in sorted(have.items())],
    }


async def start(db, uid: str, skill: str) -> dict[str, Any]:
    await ensure_bank(db)
    t = now()
    last = await db[SKILL_ATTEMPTS].find_one({"user_id": uid, "skill": skill}, sort=[("started_at", -1)])
    if last and last["started_at"] + EVERY > t:
        if not last.get("submitted_at") and last.get("ends_at") and last["ends_at"] + GRACE > t:
            return await _resume_attempt(db, last)  # the same test, still running (a reload)
        raise ApiError(
            409, "too_soon", f"You can take the {skill} check again from {(last['started_at'] + EVERY):%d %b}.",
            extra={"againAt": ms(last["started_at"] + EVERY)},
        )  # fmt: skip
    pool = await db[SKILL_QUESTIONS].find({"skill": skill, "active": True, **CLASSIC}).to_list(500)
    if len(pool) < MIN_QUESTIONS:
        raise ApiError(404, "no_test", "There is no test for this skill yet.")
    rng = random.SystemRandom()
    picked = rng.sample(pool, min(QUESTIONS, len(pool)))
    order = {}
    for q in picked:
        idx = list(range(len(q["options"])))
        rng.shuffle(idx)
        order[str(q["_id"])] = idx
    a = {
        "_id": ObjectId(), "user_id": uid, "skill": skill, "question_ids": [q["_id"] for q in picked],
        "order": order, "started_at": t, "ends_at": t + timedelta(minutes=MINUTES), "total": len(picked),
        "share": False, "submitted_at": None,
    }  # fmt: skip
    await db[SKILL_ATTEMPTS].insert_one(a)
    await audit(db, uid, "hire.skill_check_start", data={"skill": skill})
    return _paper(a, picked)


def _paper(a: dict[str, Any], picked: list[dict[str, Any]]) -> dict[str, Any]:
    by = {q["_id"]: q for q in picked}
    qs = []
    for qid in a["question_ids"]:
        q = by.get(qid)
        if q:
            qs.append(
                {"id": str(qid), "question": q["question"], "options": [q["options"][i] for i in a["order"][str(qid)]]}
            )
    spoken = [x.format(skill=a["skill"]) for x in SPOKEN.get(a["skill"], SPOKEN["default"])]
    return {"id": str(a["_id"]), "skill": a["skill"], "endsAt": ms(a["ends_at"]), "startedAt": ms(a["started_at"]),
            "questions": qs, "spoken": spoken}  # fmt: skip


async def _resume_attempt(db, a: dict[str, Any]) -> dict[str, Any]:
    picked = await db[SKILL_QUESTIONS].find({"_id": {"$in": a["question_ids"]}}).to_list(100)
    return _paper(a, picked)


class SpokenIn(CamelModel):
    q: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=1, max_length=1500)  # the transcript only: audio is never sent or kept
    seconds: float | None = Field(None, ge=0, le=600)


class SubmitIn(CamelModel):
    answers: dict[str, int] = Field(default_factory=dict)
    tab_switches: int = Field(0, ge=0, le=1000)
    spoken: list[SpokenIn] = Field(default_factory=list, max_length=3)

    @field_validator("answers")
    @classmethod
    def _few(cls, v: dict[str, int]) -> dict[str, int]:
        if len(v) > QUESTIONS:
            raise ValueError("Too many answers.")
        return v


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That test isn’t here.") from None


async def submit(db, uid: str, aid: str, body: SubmitIn) -> dict[str, Any]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": uid})
    if not a or not a.get("ends_at"):
        raise ApiError(404, "not_found", "That test isn’t here.")
    if a.get("submitted_at"):
        raise ApiError(409, "done", "This test is finished already.")
    t = now()
    late = t > a["ends_at"] + GRACE
    picked = await db[SKILL_QUESTIONS].find({"_id": {"$in": a["question_ids"]}}).to_list(100)
    right, total = mark(picked, a["order"], {} if late else body.answers)
    total = a.get("total") or total
    r = await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
        {"user_id": uid}, sort=[("updated_at", -1)]
    )
    data = (r or {}).get("data") or {}
    allowed = {x.format(skill=a["skill"]) for x in SPOKEN.get(a["skill"], SPOKEN["default"])}
    spoken = []
    for s in body.spoken:
        if s.q not in allowed:
            continue
        fb = interview.feedback({"id": "skill", "group": "tech", "q": s.q}, s.text, data, s.seconds)
        spoken.append(
            {
                "q": s.q,
                "text": " ".join(s.text.split()),
                "feedback": {k: fb[k] for k in ("length", "structure", "result", "filler") if fb.get(k)},
            }
        )
    sets = {
        "submitted_at": t, "late": late, "right": right, "total": total,
        "score": round(100 * right / total) if total else 0, "tab_switches": body.tab_switches, "spoken": spoken,
    }  # fmt: skip
    done = await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"], "submitted_at": None}, {"$set": sets})
    if not done.modified_count:
        raise ApiError(409, "done", "This test is finished already.")
    await audit(db, uid, "hire.skill_check_done", data={"skill": a["skill"], "score": sets["score"], "late": late})
    from app.seek.paths import on_skill_check  # Phase 6 S2: a passed check + a sent project = "Skill verified"

    await on_skill_check(db, uid, a["skill"])
    return result_out({**a, **sets}, t)


async def share(db, uid: str, aid: str, on: bool) -> dict[str, Any]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": uid})
    if not a or not a.get("submitted_at"):
        raise ApiError(404, "not_found", "Finish the test first.")
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"share": on}})
    return result_out({**a, "share": on})
