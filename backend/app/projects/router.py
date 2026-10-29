"""POST /api/me/projects/strengthen: "Make this project stronger" (signed in; kiosk sign-ins allowed).

{title, answers: {built, tools, part, team, does, result}} → {bullets, source: ai | rules, tip, aiLeft, note}.
AI writes while the person's 3 free uses today last (core/ai_quota.py "projects"), each bullet fact-checked against
the answers (projects/helper.py); otherwise, or when the AI answer fails the check or AI is off, the rules write the
bullets from the answers. Always 200 with bullets: never an error page. Nothing is stored or logged but counts.
"""

import logging
from typing import Any

import anthropic
from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import AI_USAGE, DB
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers, tidy
from app.core.schemas import CamelModel
from app.projects import helper
from app.summary.router import CONTACT, URL

router = APIRouter(prefix="/api/me/projects", tags=["projects"])
log = logging.getLogger("nm7.projects")


class Answers(CamelModel):
    built: str = Field("", max_length=600)
    tools: str = Field("", max_length=600)
    part: str = Field("", max_length=600)
    team: str = Field("", max_length=100)
    does: str = Field("", max_length=600)
    result: str = Field("", max_length=600)


class StrengthenIn(CamelModel):
    title: str = Field("", max_length=200)
    answers: Answers


def _scrub(v: str) -> str:
    """No phone numbers, emails, links or ID numbers reach the model or the bullets."""
    return tidy(CONTACT.sub("", URL.sub("", scrub_id_numbers(" ".join(v.split()))[0])))


async def ai_left(db, user_id: str) -> int:
    doc = await db[AI_USAGE].find_one({"_id": f"{ai_quota.today()}|person|projects|{user_id}"}, {"n": 1})
    return max(0, ai_quota.PER_PERSON["projects"] - int((doc or {}).get("n", 0)))


@router.post("/strengthen")
async def strengthen(body: StrengthenIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    answers = helper.clean({k: _scrub(v) for k, v in body.answers.model_dump().items()})
    title = _scrub(body.title)[:120]
    if not answers.get("built") and not title:
        raise ApiError(400, "need_answers", "Tell us what you built first.")
    tip = None if helper.has_number(answers) else helper.TIP
    rules = helper.rules_bullets(answers, title)
    uid = str(auth.user.id)

    def out(bullets: list[str], source: str, note: str = "") -> dict[str, Any]:
        return {"bullets": bullets, "source": source, "tip": tip, "note": note}

    note = ""
    if not get_settings().anthropic_api_key:
        return {**out(rules, "rules"), "aiLeft": 0}
    try:
        await ai_quota.take(db, "projects", uid, auth.session.kiosk_id)
    except ApiError as e:  # today's 3 free AI rewrites are used: the rules write them
        return {**out(rules, "rules", e.message), "aiLeft": 0}
    except ai_quota.CapReached:
        return {**out(rules, "rules", "AI is busy today. These bullets are made from your answers."), "aiLeft": 0}
    stats: dict[str, Any] = {}
    try:
        written = await helper.call_model(answers, title, stats)
    except (claude.Unusable, anthropic.APIError):
        await ai_quota.note(db, "projects", "failed")
        written = []
    except Exception:  # never an error page: count it and use the rules
        await ai_quota.note(db, "projects", "failed")
        log.exception("project helper failed")
        written = []
    kept = [b for b in written if helper.grounded(b, answers, title) and 4 <= len(b.split()) <= 40]
    if dropped := len(written) - len(kept):
        await ai_quota.note(db, "projects", "dropped", by=dropped)
    if stats.get("fallback"):
        await ai_quota.note(db, "projects", "fallback")
    left = await ai_left(db, uid)
    log.info("project helper: model=%s bullets=%d dropped=%d", stats.get("model", ""), len(kept), dropped)
    if len(kept) < 2:
        if written:
            note = "AI added details that aren't in your answers, so these bullets use only your words."
        return {**out(rules, "rules", note), "aiLeft": left}
    return {**out(kept, "ai"), "aiLeft": left}
