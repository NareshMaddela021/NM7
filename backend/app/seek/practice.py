"""Phase 6 S3: practice tests. Unlimited, free, and separate from the official skill checks (H3).

  GET  /api/me/practice                        the sets, my topic scores (last 90 days), weak topics with free courses
  POST /api/me/practice/start {set}            up to 10 questions in a random order, without their answers
  POST /api/me/practice/{id}/answer {q, choice}   right or not, the right option and why (shown after each question)
  POST /api/me/practice/{id}/finish            the score by topic, weak topics linked to free courses

Practice is stored in its own collection (practice_attempts) and NEVER counts as a verified score: the "Skill
verified" badge (S2) and what companies see (H3) read only official skill checks. The questions are Nm7's own
(app.seek.practice_bank), never the official bank, so practising can't show an official answer.
"""

import random
from datetime import timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core import rate_limit
from app.core.db import DB, PRACTICE_ATTEMPTS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.courses.router import courses_for
from app.me.service import ms
from app.seek.practice_bank import SETS

me = APIRouter(prefix="/api/me/practice", tags=["job seekers"])

PER_TEST = 10
WEAK_BELOW = 60  # % right in a topic
WEAK_MIN = 3  # answers needed before a topic can be called weak
HISTORY = timedelta(days=90)
STARTS = [(120, timedelta(hours=1))]  # unlimited in practice; this only stops runaway scripts


def question(qid: str) -> tuple[str, dict[str, Any], tuple] | None:
    sid, _, n = qid.rpartition(":")
    s = SETS.get(sid)
    if not s or not n.isdigit() or int(n) >= len(s["questions"]):
        return None
    return sid, s, s["questions"][int(n)]


def q_out(qid: str) -> dict[str, Any]:
    _, _, (topic, text, options, _, _) = question(qid)
    return {"id": qid, "topic": topic, "question": text, "options": options, "code": "\n" in text}


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That practice test isn't here.") from None


async def topic_scores(db, uid: str) -> dict[str, dict[str, Any]]:
    """{topic: {right, answered, course}} over the last 90 days of practice."""
    out: dict[str, dict[str, Any]] = {}
    async for a in db[PRACTICE_ATTEMPTS].find({"user_id": uid, "started_at": {"$gt": now() - HISTORY}}):
        for qid, r in (a.get("results") or {}).items():
            got = question(qid)
            if not got:
                continue
            _, s, (topic, *_rest) = got
            t = out.setdefault(topic, {"right": 0, "answered": 0, "course": s["course"]})
            t["answered"] += 1
            t["right"] += bool(r["right"])
    return out


async def weak_topics(db, scores: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    weak = [
        (k, v) for k, v in scores.items() if v["answered"] >= WEAK_MIN and 100 * v["right"] / v["answered"] < WEAK_BELOW
    ]
    weak.sort(key=lambda kv: kv[1]["right"] / kv[1]["answered"])
    skills = list(dict.fromkeys(v["course"] for _, v in weak))
    courses = {g["skill"]: g["courses"] for g in await courses_for(db, skills, per=2)} if skills else {}
    return [{"topic": k, "pct": round(100 * v["right"] / v["answered"]), "answered": v["answered"],
             "courses": courses.get(v["course"], [])} for k, v in weak[:6]]  # fmt: skip


@me.get("")
async def overview(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    scores = await topic_scores(db, auth.user.id)
    sets = [{"id": k, "title": s["title"], "area": s["area"], "count": len(s["questions"])} for k, s in SETS.items()]
    topics = [{"topic": k, "pct": round(100 * v["right"] / v["answered"]), "answered": v["answered"]}
              for k, v in sorted(scores.items())]  # fmt: skip
    done = await db[PRACTICE_ATTEMPTS].count_documents({"user_id": auth.user.id, "finished_at": {"$ne": None}})
    return {"sets": sets, "topics": topics, "weak": await weak_topics(db, scores), "tests": done,
            "note": "Practice never counts as a verified score. Only the official skill check does."}  # fmt: skip


class StartIn(CamelModel):
    set: str = Field(min_length=1, max_length=60)


@me.post("/start", status_code=201)
async def start(body: StartIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    s = SETS.get(body.set)
    if not s:
        raise ApiError(404, "not_found", "There is no such practice test.")
    key = f"practice:{auth.user.id}"
    await rate_limit.check(db, key, STARTS)
    await rate_limit.record(db, key)
    ids = [f"{body.set}:{i}" for i in range(len(s["questions"]))]
    random.shuffle(ids)
    ids = ids[:PER_TEST]
    doc = {"user_id": auth.user.id, "set": body.set, "questions": ids, "results": {}, "started_at": now(),
           "finished_at": None}  # fmt: skip
    r = await db[PRACTICE_ATTEMPTS].insert_one(doc)
    return {"id": str(r.inserted_id), "set": body.set, "title": s["title"], "questions": [q_out(q) for q in ids]}


class AnswerIn(CamelModel):
    q: str = Field(min_length=3, max_length=80)
    choice: int = Field(ge=0, le=9)


@me.post("/{aid}/answer")
async def answer(aid: str, body: AnswerIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[PRACTICE_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": auth.user.id})
    if not a or body.q not in a["questions"]:
        raise ApiError(404, "not_found", "That question isn't in this practice test.")
    _, _, (topic, _, options, right, why) = question(body.q)
    if body.choice >= len(options):
        raise ApiError(422, "invalid_input", "Pick one of the options.")
    first = a["results"].get(body.q)
    if not first:  # the first answer counts for the topic score; trying again still shows the explanation
        await db[PRACTICE_ATTEMPTS].update_one(
            {"_id": a["_id"]}, {"$set": {f"results.{body.q}": {"choice": body.choice, "right": body.choice == right}}}
        )
    return {"q": body.q, "topic": topic, "right": body.choice == right, "answer": right, "why": why,
            "counted": not first}  # fmt: skip


@me.post("/{aid}/finish")
async def finish(aid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[PRACTICE_ATTEMPTS].find_one({"_id": _oid(aid), "user_id": auth.user.id})
    if not a:
        raise ApiError(404, "not_found", "That practice test isn't here.")
    t = a.get("finished_at") or now()
    await db[PRACTICE_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"finished_at": t}})
    by: dict[str, dict[str, int]] = {}
    for qid in a["questions"]:
        topic = question(qid)[2][0]
        row = by.setdefault(topic, {"right": 0, "total": 0})
        row["total"] += 1
        row["right"] += bool((a["results"].get(qid) or {}).get("right"))
    right = sum(r["right"] for r in by.values())
    return {
        "id": aid, "set": a["set"], "right": right, "total": len(a["questions"]), "finishedAt": ms(t),
        "topics": [{"topic": k, **v} for k, v in by.items()],
        "weak": await weak_topics(db, await topic_scores(db, auth.user.id)),
        "verified": False,  # practice never counts as a verified score
    }  # fmt: skip
