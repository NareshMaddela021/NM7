"""H3 Skill checks (Phase 5): a 10-minute multiple-choice test per skill, from a question bank Admin edits.

Candidate (signed in):
  GET  /api/me/skill-checks                       the skills with a test, my last result for each, when I may try again
  POST /api/me/skill-checks/start {skill}         10 questions picked at random (options shuffled), a 10-minute timer
  POST /api/me/skill-checks/{id}/submit {answers, tabSwitches, spoken}   marked at once; optional spoken answers
  PUT  /api/me/skill-checks/{id}/share {share}    the candidate decides whether companies see the result
Admin (permission "jobs"):
  GET  /api/admin/skill-tests?skill=&role=&active=     the bank (also: the skills and how many active questions each)
  POST /api/admin/skill-tests {role, skill, question, options, answer, difficulty, active}
  PUT  /api/admin/skill-tests/{id} {…}                 edit, or turn a question off (nothing is deleted)

Rules: one attempt per skill every 30 days (a started test counts, so closing the tab doesn't give a new try). Answers
sent after the 10 minutes (plus 30 seconds for a slow network) are not counted. The page counts how often the tab was
left; the count is shown with the result, no camera, nothing else is watched. Up to 3 spoken answers are kept as TEXT
only (never audio), each with clarity feedback (the interview practice rules). Results are shared with companies only
when the candidate turns sharing on (default off); companies see them only with the skill checks feature
(Admin → Plans → Company hiring, open to every Verified company by default).
"""

import random
from datetime import datetime, timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Query
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.core.db import DB, RESUMES, SKILL_ATTEMPTS, SKILL_QUESTIONS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.hire.bank import SEED, SPOKEN
from app.jobsearch import interview
from app.me.service import ms

me = APIRouter(prefix="/api/me/skill-checks", tags=["hire in 30 minutes"])
admin = APIRouter(prefix="/api/admin/skill-tests", tags=["hire in 30 minutes"])

QUESTIONS = 10
MIN_QUESTIONS = 5  # a skill with fewer active questions has no test
MINUTES = 10
GRACE = timedelta(seconds=30)
EVERY = timedelta(days=30)
DIFFICULTY = ("easy", "medium", "hard")


async def ensure_bank(db) -> int:
    """The starting questions, once: only when the bank is empty (Admin's edits are never overwritten)."""
    if await db[SKILL_QUESTIONS].estimated_document_count():
        return 0
    t = now()
    docs = [
        {
            "skill": s,
            "role": r,
            "difficulty": d,
            "question": q,
            "options": o,
            "answer": a,
            "active": True,
            "seed": True,
            "created_at": t,
            "updated_at": t,
        }  # fmt: skip
        for s, r, d, q, o, a in SEED
    ]
    await db[SKILL_QUESTIONS].insert_many(docs)
    return len(docs)


def mark(questions: list[dict[str, Any]], order: dict[str, list[int]], answers: dict[str, int]) -> tuple[int, int]:
    """(right, total). `order`: per question, the bank's option index behind each shown option."""
    right = 0
    for q in questions:
        qid = str(q["_id"])
        shown = answers.get(qid)
        if shown is None or not 0 <= shown < len(order.get(qid, [])):
            continue
        if order[qid][shown] == q["answer"]:
            right += 1
    return right, len(questions)


def result_out(a: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    t = t or now()
    done = bool(a.get("submitted_at"))
    return {
        "id": str(a["_id"]),
        "skill": a["skill"],
        "startedAt": ms(a["started_at"]),
        "endsAt": ms(a["ends_at"]),
        "done": done,
        "score": a.get("score") if done else None,
        "right": a.get("right") if done else None,
        "total": a.get("total"),
        "late": bool(a.get("late")),
        "tabSwitches": int(a.get("tab_switches") or 0),
        "share": bool(a.get("share")),
        "spoken": [{"q": x["q"], "text": x["text"], "feedback": x["feedback"]} for x in a.get("spoken") or []],
        "againAt": ms(a["started_at"] + EVERY),
        "canRetry": a["started_at"] + EVERY <= t,
    }


async def skills(db) -> dict[str, dict[str, Any]]:
    """{skill: {role, count}} for skills with enough active questions."""
    out: dict[str, dict[str, Any]] = {}
    async for g in await db[SKILL_QUESTIONS].aggregate(
        [{"$match": {"active": True}}, {"$group": {"_id": "$skill", "n": {"$sum": 1}, "role": {"$first": "$role"}}}]
    ):
        if g["n"] >= MIN_QUESTIONS:
            out[g["_id"]] = {"role": g["role"], "count": g["n"]}
    return out


async def shared_results(db, user_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """For companies: each person's latest finished, shared result per skill (best kept per skill)."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    q = {"user_id": {"$in": user_ids}, "share": True, "submitted_at": {"$ne": None}}
    async for a in db[SKILL_ATTEMPTS].find(q).sort("submitted_at", -1):
        per = out.setdefault(a["user_id"], {})
        if a["skill"] not in per:
            per[a["skill"]] = {"skill": a["skill"], "score": a["score"], "at": ms(a["submitted_at"]),
                               "tabSwitches": int(a.get("tab_switches") or 0), "late": bool(a.get("late"))}  # fmt: skip
    return {k: list(v.values()) for k, v in out.items()}


def best_for(
    results: list[dict[str, Any]], wanted: list[str], covers: dict[str, set[str]] | None = None
) -> dict | None:
    """The best result for one of the job's skills, else None. `covers`: test → the job skills it also speaks for
    (from the job templates: the "Customer support" test covers Customer service and Telesales)."""
    low = {w.lower() for w in wanted}

    def fits(skill: str) -> bool:
        return skill.lower() in low or bool({x.lower() for x in (covers or {}).get(skill, ())} & low)

    mine = [r for r in results if fits(r["skill"])]
    return max(mine, key=lambda r: r["score"]) if mine else None


# --- candidate ----------------------------------------------------------------------------------------------------


@me.get("")
async def catalog(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await ensure_bank(db)
    t = now()
    have = await skills(db)
    mine: dict[str, dict[str, Any]] = {}
    async for a in db[SKILL_ATTEMPTS].find({"user_id": auth.user.id}).sort("started_at", -1):
        mine.setdefault(a["skill"], result_out(a, t))
    return {
        "minutes": MINUTES,
        "questions": QUESTIONS,
        "everyDays": EVERY.days,
        "skills": [{"skill": s, "role": v["role"], "last": mine.get(s)} for s, v in sorted(have.items())],
    }


class StartIn(CamelModel):
    skill: str = Field(min_length=1, max_length=60)


@me.post("/start")
async def start(body: StartIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await ensure_bank(db)
    uid = auth.user.id
    t = now()
    last = await db[SKILL_ATTEMPTS].find_one({"user_id": uid, "skill": body.skill}, sort=[("started_at", -1)])
    if last and last["started_at"] + EVERY > t:
        if not last.get("submitted_at") and last["ends_at"] + GRACE > t:
            return await _resume_attempt(db, last)  # the same test, still running (a reload)
        raise ApiError(
            409, "too_soon", f"You can take the {body.skill} check again from {(last['started_at'] + EVERY):%d %b}.",
            extra={"againAt": ms(last["started_at"] + EVERY)},
        )  # fmt: skip
    pool = await db[SKILL_QUESTIONS].find({"skill": body.skill, "active": True}).to_list(500)
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
        "_id": ObjectId(), "user_id": uid, "skill": body.skill, "question_ids": [q["_id"] for q in picked],
        "order": order, "started_at": t, "ends_at": t + timedelta(minutes=MINUTES), "total": len(picked),
        "share": False, "submitted_at": None,
    }  # fmt: skip
    await db[SKILL_ATTEMPTS].insert_one(a)
    await audit(db, uid, "hire.skill_check_start", data={"skill": body.skill})
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


@me.post("/{aid}/submit")
async def submit(aid: str, body: SubmitIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": uid})
    if not a:
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
    return result_out({**a, **sets}, t)


class ShareIn(CamelModel):
    share: bool


@me.put("/{aid}/share")
async def share(aid: str, body: ShareIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[SKILL_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": auth.user.id})
    if not a or not a.get("submitted_at"):
        raise ApiError(404, "not_found", "Finish the test first.")
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"share": body.share}})
    return result_out({**a, "share": body.share})


# --- admin --------------------------------------------------------------------------------------------------------


class QuestionIn(CamelModel):
    role: str = Field("", max_length=80)
    skill: str = Field(min_length=1, max_length=60)
    question: str = Field(min_length=5, max_length=500)
    options: list[str] = Field(min_length=2, max_length=6)
    answer: int = Field(ge=0, le=5)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    active: bool = True

    @field_validator("options")
    @classmethod
    def _opts(cls, v: list[str]) -> list[str]:
        v = [" ".join(x.split()) for x in v]
        if any(not x or len(x) > 200 for x in v):
            raise ValueError("Each option needs 1–200 characters.")
        if len({x.lower() for x in v}) != len(v):
            raise ValueError("Two options are the same.")
        return v


def q_out(q: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(q["_id"]), "role": q.get("role", ""), "skill": q["skill"], "question": q["question"],
            "options": q["options"], "answer": q["answer"], "difficulty": q.get("difficulty", "medium"),
            "active": bool(q.get("active")), "updatedAt": ms(q.get("updated_at"))}  # fmt: skip


def _check(body: QuestionIn) -> dict[str, Any]:
    if body.answer >= len(body.options):
        raise ApiError(400, "answer", "The right answer must be one of the options.")
    d = body.model_dump()
    d["skill"] = " ".join(d["skill"].split())
    d["role"] = " ".join(d["role"].split())
    d["question"] = " ".join(d["question"].split())
    return d


@admin.get("")
async def bank(
    db: DB, _: AdminAuth("jobs"), skill: str = Query("", max_length=60), role: str = Query("", max_length=80),
    active: Literal["", "yes", "no"] = "",
) -> dict[str, Any]:  # fmt: skip
    await ensure_bank(db)
    q: dict[str, Any] = {}
    if skill:
        q["skill"] = skill
    if role:
        q["role"] = role
    if active:
        q["active"] = active == "yes"
    rows = await db[SKILL_QUESTIONS].find(q).sort([("skill", 1), ("difficulty", 1), ("_id", 1)]).to_list(2000)
    counts: dict[str, dict[str, int]] = {}
    async for g in await db[SKILL_QUESTIONS].aggregate(
        [{"$group": {"_id": "$skill", "all": {"$sum": 1}, "on": {"$sum": {"$cond": ["$active", 1, 0]}}}}]
    ):
        counts[g["_id"]] = {"all": g["all"], "active": g["on"]}
    return {
        "items": [q_out(x) for x in rows],
        "skills": [{"skill": k, **v, "hasTest": v["active"] >= MIN_QUESTIONS} for k, v in sorted(counts.items())],
        "minQuestions": MIN_QUESTIONS,
    }


@admin.post("", status_code=201)
async def add(body: QuestionIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    t = now()
    d = {**_check(body), "created_at": t, "updated_at": t, "by": auth.user.id}
    res = await db[SKILL_QUESTIONS].insert_one(d)
    await audit(db, auth.user.id, "skill_test.add", target=str(res.inserted_id), data={"skill": d["skill"]})
    return q_out({**d, "_id": res.inserted_id})


@admin.put("/{qid}")
async def edit(qid: str, body: QuestionIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    old = await db[SKILL_QUESTIONS].find_one({"_id": _oid(qid)})
    if not old:
        raise ApiError(404, "not_found", "That question isn’t here.")
    d = {**_check(body), "updated_at": now(), "by": auth.user.id}
    await db[SKILL_QUESTIONS].update_one({"_id": old["_id"]}, {"$set": d})
    await audit(db, auth.user.id, "skill_test.edit", target=qid, data={"skill": d["skill"], "active": d["active"]})
    return q_out({**old, **d})
