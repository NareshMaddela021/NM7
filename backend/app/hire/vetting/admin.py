# ruff: noqa: E501  (dense response shapes, one field group a line)
"""Vetting V2, Admin (permission "jobs"). The question bank itself stays at /api/admin/skill-tests (skillcheck.py).

  GET  /api/admin/vetting/rubrics                 every role's practical task and rubric (version, history)
  PUT  /api/admin/vetting/rubrics/{slug} {rubric}  a new rubric version (graded tasks keep the version they used)
  GET  /api/admin/vetting/queue?kind=review|integrity&status=open|done
  POST /api/admin/vetting/queue/{id}/grade {scores, note}      review: a person's task scores (0–5 per criterion)
  POST /api/admin/vetting/queue/{id}/decide {decision, note}   integrity: clear (badge can be issued) or hold
  GET  /api/admin/vetting/stats?days=14            attempts, pass rate and average score per role; flags and AI spend
                                                  per day
Nothing here bans anyone: a held attempt keeps the badge back and the candidate can try again after 30 days.
"""

from datetime import timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Query
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core.db import AI_USAGE, DB, SKILL_ATTEMPTS, USERS, VETTING_BANKS, VETTING_PHOTOS, VETTING_QUEUE
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.hire.vetting import engine as E
from app.hire.vetting.roles import BY_SLUG, BY_TEST, ROLES
from app.hire.vetting.store import ensure_banks
from app.me.service import ms

admin = APIRouter(prefix="/api/admin/vetting", tags=["vetting"])


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That item isn’t here.") from None


@admin.get("/rubrics")
async def rubrics(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    await ensure_banks(db)
    banks = {b["_id"]: b async for b in db[VETTING_BANKS].find({})}
    out = []
    for r in ROLES:
        b = banks.get(r["slug"])
        out.append({
            "slug": r["slug"], "test": r["test"], "role": r["role"], "group": r["group"], "taskType": r["task"],
            "loaded": bool(b), "bankVersion": (b or {}).get("version"), "topics": (b or {}).get("topics", []),
            "task": {k: (b or {}).get("task", {}).get(k) for k in ("title", "brief", "minutes", "material", "key_points")} if b else None,
            "rubric": (b or {}).get("rubric", []), "rubricVersion": (b or {}).get("rubric_version"),
            "history": [{"version": h["version"], "at": ms(h["at"]), "by": h.get("by", "")} for h in (b or {}).get("rubric_history", [])],
        })  # fmt: skip
    return {"roles": out}


class Criterion(CamelModel):
    key: str = Field(pattern=r"^[a-z_]{2,30}$")
    label: str = Field(min_length=2, max_length=60)
    guide: str = Field(min_length=20, max_length=500)


class RubricIn(CamelModel):
    rubric: list[Criterion] = Field(min_length=3, max_length=5)

    @field_validator("rubric")
    @classmethod
    def _unique(cls, v: list[Criterion]) -> list[Criterion]:
        if len({c.key for c in v}) != len(v):
            raise ValueError("Each criterion needs its own key.")
        return v


@admin.put("/rubrics/{slug}")
async def edit_rubric(slug: str, body: RubricIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    b = await db[VETTING_BANKS].find_one({"_id": slug})
    if not b or slug not in BY_SLUG:
        raise ApiError(404, "not_found", "That role has no bank yet.")
    rv = int(b.get("rubric_version") or 0) + 1
    rubric = [c.model_dump() for c in body.rubric]
    await db[VETTING_BANKS].update_one(
        {"_id": slug},
        {"$set": {"rubric": rubric, "rubric_version": rv, "rubric_edited": True},
         "$push": {"rubric_history": {"version": rv, "rubric": rubric, "at": now(), "by": auth.user.id}}},
    )  # fmt: skip
    await audit(db, auth.user.id, "vetting.rubric_edit", target=slug, data={"version": rv})
    return {"slug": slug, "rubricVersion": rv, "rubric": rubric}


def _item(x: dict[str, Any], a: dict[str, Any] | None, u: dict[str, Any] | None, rubric: list | None) -> dict[str, Any]:
    tk = (a or {}).get("task") or {}
    integ = (a or {}).get("integrity") or {}
    return {
        "id": str(x["_id"]), "kind": x["kind"], "status": x.get("status", "open"), "skill": x["skill"],
        "role": (BY_TEST.get(x["skill"]) or {}).get("role", ""), "createdAt": ms(x["created_at"]),
        "person": {"name": (u or {}).get("name", ""), "id": x["user_id"]}, "data": x.get("data") or {},
        "attempt": {"id": str((a or {}).get("_id", "")), "band": (a or {}).get("band"), "score": (a or {}).get("score"),
                    "topics": (a or {}).get("topics") or {}, "strict": bool((a or {}).get("strict")),
                    "integrity": {"level": integ.get("level"), "points": integ.get("points"),
                                  "reasons": [E.POINTS.get(r, r) for r in integ.get("reasons") or []]},
                    "signals": {k: v for k, v in ((a or {}).get("signals") or {}).items() if not isinstance(v, dict)}},
        "task": {"type": tk.get("type"), "status": tk.get("status"), "score": tk.get("score"), "answer": tk.get("answer", ""),
                 "feedback": tk.get("feedback") or [], "confidence": tk.get("confidence"), "speech": tk.get("speech"),
                 "photo": {k: v for k, v in (tk.get("photo") or {}).items() if k != "id"} or None,
                 "hasPhoto": bool((tk.get("photo") or {}).get("id"))},
        "rubric": rubric or [], "decision": x.get("decision"), "note": x.get("note", ""),
    }  # fmt: skip


@admin.get("/queue")
async def queue(
    db: DB, _: AdminAuth("jobs"), kind: Literal["review", "integrity"] = "review",
    status: Literal["open", "done"] = "open", limit: int = Query(100, ge=1, le=300),
) -> dict[str, Any]:  # fmt: skip
    rows = (
        await db[VETTING_QUEUE]
        .find({"kind": kind, "status": status})
        .sort("created_at", 1 if status == "open" else -1)
        .to_list(limit)
    )
    atts = {a["_id"]: a async for a in db[SKILL_ATTEMPTS].find({"_id": {"$in": [r["attempt_id"] for r in rows]}})}
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r["user_id"] for r in rows]}}, {"name": 1})}
    banks = {b["_id"]: b async for b in db[VETTING_BANKS].find({}, {"rubric": 1})}
    counts = {g["_id"]: g["n"] async for g in await db[VETTING_QUEUE].aggregate(
        [{"$match": {"status": "open"}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}])}  # fmt: skip
    return {
        "items": [_item(r, atts.get(r["attempt_id"]), users.get(r["user_id"]),
                        (banks.get((BY_TEST.get(r["skill"]) or {}).get("slug")) or {}).get("rubric")) for r in rows],
        "open": {"review": counts.get("review", 0), "integrity": counts.get("integrity", 0)},
    }  # fmt: skip


@admin.get("/queue/{iid}/photo")
async def photo(iid: str, db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    x = await db[VETTING_QUEUE].find_one({"_id": _oid(iid)})
    a = await db[SKILL_ATTEMPTS].find_one({"_id": x["attempt_id"]}) if x else None
    pid = (((a or {}).get("task") or {}).get("photo") or {}).get("id")
    p = await db[VETTING_PHOTOS].find_one({"_id": pid}) if pid else None
    if not p:
        raise ApiError(404, "not_found", "No photo (photos are deleted after 30 days).")
    return {"type": p["type"], "data": p["data"]}


class Score(CamelModel):
    key: str
    score: int = Field(ge=0, le=5)
    reason: str = Field("", max_length=300)


class GradeIn(CamelModel):
    scores: list[Score] = Field(min_length=1, max_length=5)
    note: str = Field("", max_length=500)


@admin.post("/queue/{iid}/grade")
async def grade(iid: str, body: GradeIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    x = await db[VETTING_QUEUE].find_one({"_id": _oid(iid), "kind": "review"})
    if not x or x.get("status") != "open":
        raise ApiError(404, "not_found", "That review isn’t open.")
    a = await db[SKILL_ATTEMPTS].find_one({"_id": x["attempt_id"]})
    b = await db[VETTING_BANKS].find_one({"_id": (BY_TEST.get(x["skill"]) or {}).get("slug")}) or {}
    rubric = b.get("rubric") or []
    keys = [c["key"] for c in rubric]
    got = {s.key: s for s in body.scores}
    if set(got) != set(keys):
        raise ApiError(400, "scores", "Give a score for every rubric line.")
    labels = {c["key"]: c["label"] for c in rubric}
    scores = [
        {"key": k, "label": labels[k], "score": got[k].score, "reason": got[k].reason or "Graded by our team."}
        for k in keys
    ]
    score = E.task_score(scores)
    tk = {**(a.get("task") or {}), "score": score, "feedback": scores, "status": "graded", "graded_by": auth.user.id,
          "rubric_version": b.get("rubric_version", 1)}  # fmt: skip
    await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"task": tk}})
    await db[VETTING_QUEUE].update_one({"_id": x["_id"]}, {"$set": {"status": "done", "decision": "graded", "note": body.note,
                                                                    "by": auth.user.id, "done_at": now()}})  # fmt: skip
    from app.hire.vetting.router import award

    v = await award(db, {**a, "task": tk})
    await audit(db, auth.user.id, "vetting.review_grade", target=str(a["_id"]), data={"score": score})
    return {"score": score, "verified": bool(v and v.get("attempt_id") == a["_id"])}


class DecideIn(CamelModel):
    decision: Literal["clear", "hold"]
    note: str = Field("", max_length=500)


@admin.post("/queue/{iid}/decide")
async def decide(iid: str, body: DecideIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    x = await db[VETTING_QUEUE].find_one({"_id": _oid(iid), "kind": "integrity"})
    if not x or x.get("status") != "open":
        raise ApiError(404, "not_found", "That item isn’t open.")
    a = await db[SKILL_ATTEMPTS].find_one({"_id": x["attempt_id"]})
    v = None
    if body.decision == "clear":  # a person looked and found nothing wrong: integrity is clean again
        integ = {**(a.get("integrity") or {}), "level": "clean", "cleared_by": auth.user.id}
        await db[SKILL_ATTEMPTS].update_one({"_id": a["_id"]}, {"$set": {"integrity": integ, "retest_offered": False}})
        from app.hire.vetting.router import award

        v = await award(db, {**a, "integrity": integ})
    await db[VETTING_QUEUE].update_one({"_id": x["_id"]}, {"$set": {"status": "done", "decision": body.decision,
                                                                    "note": body.note, "by": auth.user.id, "done_at": now()}})  # fmt: skip
    await audit(db, auth.user.id, "vetting.integrity_decide", target=str(a["_id"]), data={"decision": body.decision})
    return {"decision": body.decision, "verified": bool(v and v.get("attempt_id") == a["_id"])}


@admin.get("/stats")
async def stats(db: DB, _: AdminAuth("jobs"), days: int = Query(14, ge=1, le=90)) -> dict[str, Any]:
    t = now()
    since = t - timedelta(days=days)
    per: dict[str, dict[str, Any]] = {}
    daily: dict[str, dict[str, int]] = {}
    async for a in db[SKILL_ATTEMPTS].find({"v": 2, "submitted_at": {"$gte": since}},
                                           {"skill": 1, "score": 1, "submitted_at": 1, "integrity": 1, "task": 1}):  # fmt: skip
        p = per.setdefault(a["skill"], {"attempts": 0, "passed": 0, "sum": 0, "verified": 0})
        p["attempts"] += 1
        p["sum"] += a.get("score") or 0
        p["passed"] += (a.get("score") or 0) >= E.PASS_MCQ
        tk = a.get("task") or {}
        p["verified"] += (
            E.verified(a.get("score"), tk.get("score"), (a.get("integrity") or {}).get("level", "clean"))
            and tk.get("status") == "graded"
        )
        d = a["submitted_at"].astimezone(IST).date().isoformat()
        day = daily.setdefault(d, {"attempts": 0, "watch": 0, "retest": 0})
        day["attempts"] += 1
        lvl = (a.get("integrity") or {}).get("level")
        if lvl in ("watch", "retest"):
            day[lvl] += 1
    ai = {}
    async for u in db[AI_USAGE].find({"_id": {"$regex": r"\|stat\|vetting\|calls$"}}):
        ai[u["day"]] = int(u["n"])
    return {
        "days": days,
        "roles": [{"skill": k, "role": (BY_TEST.get(k) or {}).get("role", ""), "attempts": v["attempts"],
                   "passRate": round(100 * v["passed"] / v["attempts"]), "avgScore": round(v["sum"] / v["attempts"]),
                   "verified": v["verified"]} for k, v in sorted(per.items(), key=lambda kv: -kv[1]["attempts"])],
        "daily": [{"day": d, **v, "aiCalls": ai.get(d, 0), "aiRupees": round(ai.get(d, 0) * RUPEES_PER_CALL, 2)}
                  for d, v in sorted(daily.items())],
        "rupeesPerCall": RUPEES_PER_CALL,
    }  # fmt: skip


RUPEES_PER_CALL = 0.05  # about: one claude-haiku-5-5 grading call (≈3k input + 400 output tokens at $0.10 / $0.50 per million, ₹85 a dollar)
