"""POST /api/me/summary/generate: "Write with AI" for the resume summary (signed in; kiosk sign-ins allowed).

The browser sends the facts it extracted (lib/summary/facts.js) and the note; the server drops anything personal,
counts the attempt (core/ai_quota.py: 10 a day per person, per kiosk link, the site-wide cap), asks Claude, then
checks every option: length, no contact details or ID numbers, and every number must appear in the facts or the note.
An option that fails is dropped; the browser fills that slot with its own templates (Layer A). Nothing here is
stored or logged.
"""

import re
from typing import Any

import anthropic
from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import DB
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.photos.scrub import looks_like_id
from app.summary import writer

router = APIRouter(prefix="/api/me/summary", tags=["summary"])

NOTE_MAX = 1000
MAX_CHARS = 400
MIN_CHARS = 40  # shorter than this is not a summary (the 150-character target is advice, not a rule)
CONTACT = re.compile(
    r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|[\w.+-]+@[\w-]+\.[\w.]+|\bwww\.|https?://", re.IGNORECASE
)
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
PERSONAL = re.compile(
    r"name|phone|mobile|email|address|dob|birth|aadhaar|aadhar|pan|passport|licen[cs]e|account|ifsc|id$", re.I
)


class GenerateIn(CamelModel):
    facts: dict[str, Any] = Field(default_factory=dict)
    note: str = Field("", max_length=NOTE_MAX)
    mode: str = Field("generate", pattern="^(generate|shorter|professional|simpler|retry)$")
    current: str = Field("", max_length=1200)


def clean_facts(facts: dict[str, Any]) -> dict[str, Any]:
    """Only the keys the writer knows, as short strings or lists of strings; anything personal is dropped."""
    out: dict[str, Any] = {}
    for k in writer.FACT_KEYS:
        v = facts.get(k)
        if PERSONAL.search(k):
            continue
        if isinstance(v, list):
            vals = [str(x).strip()[:80] for x in v[:8] if isinstance(x, str | int | float) and str(x).strip()]
            vals = [x for x in vals if not looks_like_id(x) and not CONTACT.search(x)]
            if vals:
                out[k] = vals
        elif isinstance(v, str | int | float) and str(v).strip():
            s = str(v).strip()[:200]
            if not looks_like_id(s) and not CONTACT.search(s):
                out[k] = s
    return out


def allowed(text: str, facts: dict[str, Any], note: str) -> bool:
    """Length, no contact details or ID-like numbers, and no number that isn't in the facts or the note."""
    if not MIN_CHARS <= len(text) <= MAX_CHARS * 2:  # a long one is trimmed to whole sentences; a runaway is dropped
        return False
    if CONTACT.search(text) or looks_like_id(text):
        return False
    source = " ".join([*(str(v) for v in facts.values()), note])
    return all(n in source for n in NUMBER.findall(text))


def trim(text: str) -> str:
    """Whole sentences within 400 characters."""
    if len(text) <= MAX_CHARS:
        return text
    out = ""
    for s in re.findall(r"[^.!?]+[.!?]+", text):
        if len(f"{out} {s}".strip()) > MAX_CHARS:
            break
        out = f"{out} {s}".strip()
    return out or text[: MAX_CHARS - 1].rsplit(" ", 1)[0] + "."


@router.post("/generate")
async def generate(body: GenerateIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if not get_settings().anthropic_api_key:
        raise ApiError(503, "feature_off", "AI writing is being switched on - here are quick suggestions instead.")
    facts = clean_facts(body.facts)
    note = " ".join(body.note.split())
    try:
        await ai_quota.take(db, "summary", str(auth.user.id), auth.session.kiosk_id)
    except ai_quota.CapReached as e:
        raise ApiError(503, "ai_busy", "AI is busy today - here are quick suggestions instead.") from e
    stats: dict[str, Any] = {}
    try:
        options = await writer.call_model(facts, note, body.mode, " ".join(body.current.split()), stats)
    except claude.Unusable as e:
        await ai_quota.note(db, "summary", "failed")
        raise ApiError(422, "unusable", "AI couldn't write this one - here are quick suggestions instead.") from e
    except anthropic.APIError as e:
        await ai_quota.note(db, "summary", "failed")
        raise ApiError(502, "writer_unavailable", "AI is busy right now - here are quick suggestions instead.") from e
    if stats.get("fallback"):
        await ai_quota.note(db, "summary", "fallback")
    kept = [{"style": o["style"], "text": trim(o["text"])} for o in options if allowed(o["text"], facts, note)]
    dropped = len(options) - len(kept)
    return {
        "options": kept,
        "dropped": dropped,
        "model": stats.get("model", ""),
        "fallback": bool(stats.get("fallback")),
    }
