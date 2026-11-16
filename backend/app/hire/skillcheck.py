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

import hashlib
from datetime import datetime, timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Query
from pydantic import Field, field_validator
from pymongo.errors import BulkWriteError

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core.db import DB, SKILL_ATTEMPTS, SKILL_QUESTIONS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.hire.bank import SEED
from app.hire.bank2 import SEED_2
from app.me.service import ms

me = APIRouter(prefix="/api/me/skill-checks", tags=["hire in 60 minutes"])
admin = APIRouter(prefix="/api/admin/skill-tests", tags=["hire in 60 minutes"])

QUESTIONS = 10
MIN_QUESTIONS = 5  # a skill with fewer active questions has no test
MINUTES = 10
GRACE = timedelta(seconds=30)
EVERY = timedelta(days=30)
DIFFICULTY = ("easy", "medium", "hard")


async def ensure_bank(db) -> int:
    """The starting questions, once: the first batch only when the bank is empty, then the second batch (more per
    test, and new tests) once, also into a bank that already has questions. Admin's edits are never overwritten: a
    second-batch question has a fixed id from its text, so it is never added twice, and one Admin turned off stays
    off."""
    t = now()
    added = 0
    if not await db[SKILL_QUESTIONS].estimated_document_count():
        docs = [{"skill": s, "role": r, "difficulty": d, "question": q, "options": o, "answer": a, "active": True,
                 "seed": True, "created_at": t, "updated_at": t} for s, r, d, q, o, a in SEED]  # fmt: skip
        await db[SKILL_QUESTIONS].insert_many(docs)
        added += len(docs)
    if await db[SKILL_QUESTIONS].find_one({"_id": seed_id(SEED_2[-1])}, {"_id": 1}):
        return added  # the second batch is in (questions are never deleted, only turned off)
    have = {
        d["_id"] async for d in db[SKILL_QUESTIONS].find({"_id": {"$in": [seed_id(x) for x in SEED_2]}}, {"_id": 1})
    }
    new = [{"_id": seed_id(x), "skill": x[0], "role": x[1], "difficulty": x[2], "question": x[3], "options": x[4],
            "answer": x[5], "active": True, "seed": True, "batch": 2, "created_at": t, "updated_at": t}
           for x in SEED_2 if seed_id(x) not in have]  # fmt: skip
    if new:
        try:
            await db[SKILL_QUESTIONS].insert_many(new, ordered=False)
            added += len(new)
        except BulkWriteError as e:  # another request added some at the same moment: theirs stand
            added += e.details.get("nInserted", 0)
        await _link_new_tests(db)
    return added


def seed_id(x: tuple) -> ObjectId:
    """A fixed id for a second-batch question, from its test and wording."""
    return ObjectId(hashlib.sha1(f"{x[0]}|{x[3]}".encode()).hexdigest()[:24])


async def _link_new_tests(db) -> None:
    """Learning paths still without a skill check (and never edited by Admin) get the new test for their role."""
    from app.core.db import LEARN_PATHS
    from app.seek.catalogue import ROLES

    for r in ROLES:
        if r.get("test"):
            await db[LEARN_PATHS].update_one(
                {"_id": r["id"], "test": "", "$expr": {"$eq": ["$created_at", "$updated_at"]}},
                {"$set": {"test": r["test"]}},
            )


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
    """{skill: {role, count}} for skills with enough active H3 questions (the V2 bank questions are not counted, so
    learning paths and job templates list the same tests as before)."""
    out: dict[str, dict[str, Any]] = {}
    async for g in await db[SKILL_QUESTIONS].aggregate(
        [
            {"$match": {"active": True, "bank_id": {"$exists": False}}},  # the H3 tests (V2 banks: vetting/router.py)
            {"$group": {"_id": "$skill", "n": {"$sum": 1}, "role": {"$first": "$role"}}},
        ]
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


# --- candidate ---------------------------------------------------------------------------------------------------
# The candidate endpoints moved to Vetting V2 (app/hire/vetting/router.py): same address, same collections, a richer
# paper (topics, experience bands, timers that survive a dropped connection), integrity signals and a practical task.


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That question isn’t here.") from None


# --- admin --------------------------------------------------------------------------------------------------------


class Tr(CamelModel):
    q: str = Field(min_length=3, max_length=600)
    options: list[str] = Field(min_length=2, max_length=6)


class QuestionIn(CamelModel):
    role: str = Field("", max_length=80)
    skill: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=5, max_length=500)
    options: list[str] = Field(min_length=2, max_length=6)
    answer: int = Field(ge=0, le=5)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    topic: str = Field("", max_length=80)
    kind: Literal["mcq", "scenario"] = "mcq"
    tr: dict[Literal["te", "hi"], Tr] = Field(default_factory=dict)
    needs_review: bool = False
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


def flags(q: dict[str, Any]) -> list[str]:
    """Bad-question hints from the answers so far (once it has been shown 30 times): nearly everyone right (too easy
    to tell people apart), nearly everyone wrong (unclear, or the marked answer is wrong), or top scorers failing it
    more than the rest (it misleads people who know the subject)."""
    s = q.get("stats") or {}
    shown, right = int(s.get("shown") or 0), int(s.get("right") or 0)
    out = []
    if shown >= 30:
        rate = right / shown
        if rate >= 0.95:
            out.append("too_easy")
        elif rate <= 0.15:
            out.append("too_hard")
        ts, tr = int(s.get("top_shown") or 0), int(s.get("top_right") or 0)
        if ts >= 10 and tr / ts < rate - 0.1:
            out.append("top_scorers_fail")
    return out


def q_out(q: dict[str, Any]) -> dict[str, Any]:
    s = q.get("stats") or {}
    shown, timed = int(s.get("shown") or 0), int(s.get("timed") or 0)
    return {"id": str(q["_id"]), "role": q.get("role", ""), "skill": q["skill"], "question": q["question"],
            "options": q["options"], "answer": q["answer"], "difficulty": q.get("difficulty", "medium"),
            "topic": q.get("topic", ""), "kind": q.get("kind", "mcq"), "bankId": q.get("bank_id", ""),
            "tr": q.get("tr") or {}, "needsReview": bool(q.get("needs_review")), "edited": bool(q.get("edited")),
            "active": bool(q.get("active")), "updatedAt": ms(q.get("updated_at")),
            "stats": {"shown": shown, "right": round(100 * int(s.get("right") or 0) / shown) if shown else None,
                      "avgSeconds": round(int(s.get("time_ms") or 0) / timed / 1000) if timed else None},
            "flags": flags(q)}  # fmt: skip


def _check(body: QuestionIn) -> dict[str, Any]:
    if body.answer >= len(body.options):
        raise ApiError(400, "answer", "The right answer must be one of the options.")
    for lang, tr in body.tr.items():
        if len(tr.options) != len(body.options):
            raise ApiError(400, "tr", f"The {lang} version needs the same number of options, in the same order.")
    d = body.model_dump()
    d["skill"] = " ".join(d["skill"].split())
    d["role"] = " ".join(d["role"].split())
    d["question"] = " ".join(d["question"].split())
    d["tr"] = {k: {"q": " ".join(v["q"].split()), "options": v["options"]} for k, v in d["tr"].items()}
    return d


@admin.get("")
async def bank(
    db: DB, _: AdminAuth("jobs"), skill: str = Query("", max_length=80), role: str = Query("", max_length=80),
    active: Literal["", "yes", "no"] = "", flagged: bool = False, review: bool = False,
) -> dict[str, Any]:  # fmt: skip
    from app.hire.vetting.store import ensure_banks

    await ensure_bank(db)
    await ensure_banks(db)
    q: dict[str, Any] = {}
    if skill:
        q["skill"] = skill
    if role:
        q["role"] = role
    if active:
        q["active"] = active == "yes"
    if review:
        q["needs_review"] = True
    rows = (
        await db[SKILL_QUESTIONS]
        .find(q)
        .sort([("skill", 1), ("topic", 1), ("difficulty", 1), ("_id", 1)])
        .to_list(3000)
    )
    items = [q_out(x) for x in rows]
    if flagged:
        items = [x for x in items if x["flags"]]
    counts: dict[str, dict[str, int]] = {}
    async for g in await db[SKILL_QUESTIONS].aggregate(
        [{"$group": {"_id": "$skill", "all": {"$sum": 1}, "on": {"$sum": {"$cond": ["$active", 1, 0]}},
                     "review": {"$sum": {"$cond": [{"$eq": ["$needs_review", True]}, 1, 0]}}}}]
    ):  # fmt: skip
        counts[g["_id"]] = {"all": g["all"], "active": g["on"], "review": g["review"]}
    return {
        "items": items,
        "skills": [{"skill": k, **v, "hasTest": v["active"] >= MIN_QUESTIONS} for k, v in sorted(counts.items())],
        "minQuestions": MIN_QUESTIONS,
    }


@admin.post("", status_code=201)
async def add(body: QuestionIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    t = now()
    d = {**_check(body), "created_at": t, "updated_at": t, "by": auth.user.id, "edited": True}
    res = await db[SKILL_QUESTIONS].insert_one(d)
    await audit(db, auth.user.id, "skill_test.add", target=str(res.inserted_id), data={"skill": d["skill"]})
    return q_out({**d, "_id": res.inserted_id})


@admin.put("/{qid}")
async def edit(qid: str, body: QuestionIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    old = await db[SKILL_QUESTIONS].find_one({"_id": _oid(qid)})
    if not old:
        raise ApiError(404, "not_found", "That question isn’t here.")
    d = {**_check(body), "updated_at": now(), "by": auth.user.id, "edited": True}  # a newer bank file won't undo it
    await db[SKILL_QUESTIONS].update_one({"_id": old["_id"]}, {"$set": d})
    await audit(db, auth.user.id, "skill_test.edit", target=qid, data={"skill": d["skill"], "active": d["active"]})
    return q_out({**old, **d})
