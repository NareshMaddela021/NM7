"""Tailor this resume (Phase 1, Tailor pack): a copy named "<Role> - <Company> - <date>" and suggestions to accept or
skip. The original resume is never changed; each accepted suggestion is written to the copy and the copy is scored
again.

  POST /api/me/jobs/matches/{id}/tailor                 make the copy and the suggestions (or return the existing)
  GET  /api/me/jobs/matches/{id}/tailor                 the copy, the suggestions and the scores
  POST /api/me/jobs/matches/{id}/suggestions/{sid}      {action: accept | skip}
"""

import logging
import secrets
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core.db import DB, JOB_MATCHES, RESUMES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import access, tailor
from app.jobsearch.parse import Parsed
from app.jobsearch.router import _ai_read, _match, _resume
from app.jobsearch.score import score

router = APIRouter(prefix="/api/me/jobs", tags=["job search"])
log = logging.getLogger("nm7.jobs")

MAX_RESUMES = 20
LOCKED = ApiError(402, "tailor_locked", "Tailoring is part of the Tailor pack.")


async def _out(db, d: dict[str, Any], copy: dict[str, Any] | None) -> dict[str, Any]:
    t = d.get("tailor") or {}
    parsed = Parsed(**(d.get("parsed") or {}))
    sugg = t.get("suggestions", [])
    out: dict[str, Any] = {
        "matchId": d["_id"],
        "copy": {"id": copy["key"], "name": copy["name"]} if copy else None,
        "original": {"id": d.get("resume_key"), "name": d.get("resume_name") or ""},
        "suggestions": sugg,
        "scoreBefore": (d.get("result") or {}).get("score"),
        "note": t.get("note", ""),
    }
    if copy:
        data = copy.get("data") or {}
        out["scoreNow"] = score(parsed, data)["score"]
        all_in = data
        for s in sugg:
            if s["status"] == "pending":
                all_in = tailor.apply(all_in, s)
        out["scoreIfAll"] = score(parsed, all_in)["score"]
    return out


async def _copy(db, uid: str, d: dict[str, Any]) -> dict[str, Any] | None:
    key = d.get("tailored_key")
    return await db[RESUMES].find_one({"user_id": uid, "key": key}) if key else None


class TailorIn(CamelModel):
    use_ai: bool = True


@router.post("/matches/{match_id}/tailor")
async def make(match_id: str, body: TailorIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    if not await access.has(db, uid, "tailor"):
        raise LOCKED
    d = await _match(db, uid, match_id)
    existing = await _copy(db, uid, d)
    if existing and d.get("tailor"):
        return await _out(db, d, existing)
    original = await _resume(db, uid, d.get("resume_key"))
    if await db[RESUMES].count_documents({"user_id": uid}) >= MAX_RESUMES:
        raise ApiError(400, "too_many", f"You can keep up to {MAX_RESUMES} resumes. Delete one in My resumes first.")
    parsed = Parsed(**(d.get("parsed") or {}))
    data = original.get("data") or {}
    answer, note = None, ""
    if body.use_ai:
        answer, note = await _ai_read(db, auth, lambda stats: tailor.call_model(parsed, data, stats))
        if note:
            note = note.replace("our quick reading of the post", "suggestions from our rules")
    suggestions, stats = tailor.build(parsed, data, answer)
    t = now()
    copy = {
        "key": f"t{secrets.token_hex(6)}",
        "user_id": uid,
        "name": tailor.copy_name(parsed),
        "data": data,  # starts as an exact copy; accepted suggestions change only this copy
        "jd": d.get("post", "")[:20_000],
        "active": False,
        "versions": [],
        "created_at": t,
        "updated_at": t,
        "tailored_from": original["key"],
        "match_id": match_id,
    }
    await db[RESUMES].insert_one(copy)
    await db[JOB_MATCHES].update_one(
        {"_id": match_id},
        {"$set": {"tailored_key": copy["key"], "updated_at": t,
                  "tailor": {"suggestions": suggestions, "note": note, "created_at": t, "stats": stats}}},
    )  # fmt: skip
    log.info("job tailor: suggestions=%d ai_used=%d ai_rejected=%d", len(suggestions), stats["ai_used"],
             stats["ai_rejected"])  # fmt: skip
    return await _out(db, await _match(db, uid, match_id), copy)


@router.get("/matches/{match_id}/tailor")
async def get(match_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    d = await _match(db, auth.user.id, match_id)
    return await _out(db, d, await _copy(db, auth.user.id, d))


class DecideIn(CamelModel):
    action: Literal["accept", "skip"]
    text: str | None = Field(None, max_length=2000)  # (not used yet: the person edits the copy in the builder)


@router.post("/matches/{match_id}/suggestions/{sid}")
async def decide(match_id: str, sid: str, body: DecideIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    if not await access.has(db, uid, "tailor"):
        raise LOCKED
    d = await _match(db, uid, match_id)
    copy = await _copy(db, uid, d)
    sugg = (d.get("tailor") or {}).get("suggestions", [])
    s = next((x for x in sugg if x["id"] == sid), None)
    if not copy or not s:
        raise ApiError(404, "not_found", "That suggestion isn't there any more.")
    if s["status"] != "pending":
        return await _out(db, d, copy)
    if body.action == "accept":
        data = tailor.apply(copy.get("data") or {}, s)
        await db[RESUMES].update_one({"_id": copy["_id"]}, {"$set": {"data": data, "updated_at": now()}})
    s["status"] = "accepted" if body.action == "accept" else "skipped"
    await db[JOB_MATCHES].update_one({"_id": match_id}, {"$set": {"tailor.suggestions": sugg, "updated_at": now()}})
    return await _out(db, await _match(db, uid, match_id), await _copy(db, uid, d))
