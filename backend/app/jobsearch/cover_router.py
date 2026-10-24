"""Cover letter + cold message from the match screen (Phase 2).

  POST   /api/me/jobs/matches/{id}/cover           {length, tone, manager, useAi} → the letter (saved with the job)
  DELETE /api/me/jobs/matches/{id}/cover/{cid}     one saved letter

Free: 1 a day; unlimited with the Tailor pack (or the Rs 99 plan). AI is counted before the call; with AI off or
over a limit (or when its letter fails the fact check) the rules letter is used.
"""

import logging
import secrets
from typing import Any, Literal

from fastapi import APIRouter, Response
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core.db import DB, JOB_MATCHES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import access, cover
from app.jobsearch.parse import Parsed
from app.jobsearch.router import _ai_read, _match, _resume

router = APIRouter(prefix="/api/me/jobs", tags=["job search"])
log = logging.getLogger("nm7.jobs")
MAX_LETTERS = 20


class CoverIn(CamelModel):
    length: Literal["short", "standard", "formal"] = "standard"
    tone: Literal["fresher", "experienced", "switch", "returning"] = "fresher"
    manager: str = Field("", max_length=80)
    use_ai: bool = True


@router.post("/matches/{match_id}/cover", status_code=201)
async def write(match_id: str, body: CoverIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    d = await _match(db, uid, match_id)
    resume = await _resume(db, uid, d.get("tailored_key") or d.get("resume_key"))
    if d.get("tailored_key") and not resume:
        resume = await _resume(db, uid, d.get("resume_key"))
    paid = await access.has(db, uid, "tailor")
    if not paid and not await access.take_free(db, uid, "cover"):
        raise ApiError(
            402,
            "free_limit",
            "You've used today's free cover letter. Come back tomorrow, or get the Tailor pack for unlimited letters.",
        )
    p = Parsed(**(d.get("parsed") or {}))
    data = resume.get("data") or {}
    manager = " ".join(body.manager.split())
    answer, note = None, ""
    try:
        if body.use_ai:
            answer, note = await _ai_read(
                db, auth, lambda stats: cover.call_model(p, data, body.length, body.tone, manager, stats)
            )
        letter = cover.write(p, data, body.length, body.tone, manager, answer)
    except Exception:
        if not paid:
            await access.give_back(db, uid, "cover")
        raise
    if note:
        note = note.replace("this is our quick reading of the post", "here is a letter from our templates")
    elif letter["source"] == "rules" and answer:
        note = "The AI letter didn't stick to your resume, so here is a letter from our templates."
    letter |= {"id": f"c{secrets.token_hex(5)}", "resumeId": resume["key"], "createdAt": int(now().timestamp() * 1000),
               "note": note}  # fmt: skip
    letter.pop("rejected", None)
    covers = [letter, *(d.get("covers") or [])][:MAX_LETTERS]
    await db[JOB_MATCHES].update_one({"_id": match_id}, {"$set": {"covers": covers, "updated_at": now()}})
    log.info("job cover: source=%s length=%s words=%d", letter["source"], body.length, letter["words"])
    return letter


@router.delete("/matches/{match_id}/cover/{cid}", status_code=204)
async def delete(match_id: str, cid: str, auth: CustomerAuth, db: DB) -> Response:
    d = await _match(db, auth.user.id, match_id)
    covers = [c for c in d.get("covers") or [] if c.get("id") != cid]
    await db[JOB_MATCHES].update_one({"_id": match_id}, {"$set": {"covers": covers}})
    return Response(status_code=204)
