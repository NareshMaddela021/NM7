"""LinkedIn services, Phase 1 (free): /api/me/linkedin.

- GET / PUT / DELETE /api/me/linkedin: the person's LinkedIn record on their own account only (never shared with an
  organization): the profile link they pasted (stored and shown, never fetched: we never open linkedin.com, never log
  in and never ask for a LinkedIn password), the text of their LinkedIn PDF or the sections they pasted, the target
  role, and the latest check (score, fixes, keywords, headline before / after) or the headlines made for a new
  profile. An organization the person joined sees only one yes / no from it on its placement dashboard
  ("LinkedIn-ready": a link added, or a check score of 70+), never the record itself (app/orgs/placement.py). ID numbers are removed before anything is saved. DELETE removes all of it.
- POST /api/me/linkedin/headlines: headlines written by Claude from the facts the browser sends (counted against the
  daily AI limits before the call). Every headline is checked: at most 220 characters, no phone / email / link / ID
  number, and every number must be in the facts, the note or the current headline. The browser keeps its own
  rules-based headlines for anything dropped, and when AI is off, busy or over the limit.
"""

import json
import logging
import re
import time
from typing import Any, Literal

import anthropic
from fastapi import APIRouter, Response
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import DB, LINKEDIN
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers, tidy
from app.core.schemas import CamelModel
from app.core.time import now
from app.linkedin import writer
from app.photos.scrub import looks_like_id

router = APIRouter(prefix="/api/me/linkedin", tags=["linkedin"])
log = logging.getLogger("nm7.linkedin")

PROFILE_URL = re.compile(
    r"^(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9\-_%.]{3,100})/?(?:\?.*)?$", re.I
)
CONTACT = re.compile(
    r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|[\w.+-]+@[\w-]+\.[\w.]+|\bwww\.|https?://|linkedin\.com", re.I
)
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿]")
MAX_STORED = 60_000  # characters of JSON for sections / details / result together
NOTE_MAX = 1000


def normalize_url(v: str) -> str:
    """'linkedin.com/in/ravi-kumar' → 'https://www.linkedin.com/in/ravi-kumar'; anything else is refused."""
    v = (v or "").strip()
    if not v:
        return ""
    m = PROFILE_URL.match(v)
    if not m:
        raise ValueError("Paste your profile link, like linkedin.com/in/your-name.")
    return f"https://www.linkedin.com/in/{m.group(1).rstrip('/')}"


class LinkedInIn(CamelModel):
    url: str = Field("", max_length=300)
    path: Literal["fix", "create", ""] = ""
    target_role: str = Field("", max_length=100)
    source: Literal["pdf", "paste", "resume", "details", "both", ""] = ""
    sections: dict[str, Any] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return normalize_url(v)


def out(doc: dict[str, Any] | None) -> dict[str, Any]:
    if not doc:
        return {
            "url": "",
            "path": "",
            "targetRole": "",
            "source": "",
            "sections": {},
            "details": {},
            "result": {},
            "updatedAt": None,
        }
    return {
        "url": doc.get("url", ""),
        "path": doc.get("path", ""),
        "targetRole": doc.get("target_role", ""),
        "source": doc.get("source", ""),
        "sections": doc.get("sections") or {},
        "details": doc.get("details") or {},
        "result": doc.get("result") or {},
        "updatedAt": int(doc["updated_at"].timestamp() * 1000) if doc.get("updated_at") else None,
    }


@router.get("")
async def get_linkedin(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return out(await db[LINKEDIN].find_one({"_id": auth.user.id}))


@router.put("")
async def put_linkedin(body: LinkedInIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    fields = {k: getattr(body, k) for k in ("sections", "details", "result")}
    if len(json.dumps(fields, default=str)) > MAX_STORED:
        raise ApiError(413, "too_large", "That is more text than a LinkedIn profile holds. Please shorten it.")
    clean, removed = scrub_id_numbers(fields)  # never an Aadhaar / PAN / account number on file
    if removed:
        log.warning("linkedin save: removed %d ID-like number(s) from the text", removed)
    doc = {
        "url": body.url,
        "path": body.path,
        "target_role": " ".join(body.target_role.split()),
        "source": body.source,
        **clean,
        "updated_at": now(),
    }
    await db[LINKEDIN].update_one({"_id": auth.user.id}, {"$set": doc}, upsert=True)
    return out({**doc, "_id": auth.user.id})


@router.delete("", status_code=204)
async def delete_linkedin(auth: CustomerAuth, db: DB) -> Response:
    await db[LINKEDIN].delete_one({"_id": auth.user.id})
    return Response(status_code=204)


class HeadlinesIn(CamelModel):
    facts: dict[str, Any] = Field(default_factory=dict)
    note: str = Field("", max_length=NOTE_MAX)
    count: int = Field(5, ge=1, le=5)
    current: str = Field("", max_length=600)


def clean_facts(facts: dict[str, Any]) -> dict[str, Any]:
    """Only known keys, short strings or lists of strings, without contact details or ID-like values."""
    res: dict[str, Any] = {}
    for k in writer.FACT_KEYS:
        v = facts.get(k)
        if isinstance(v, list):
            vals = [str(x).strip()[:80] for x in v[:12] if isinstance(x, str | int | float) and str(x).strip()]
            vals = [x for x in vals if not looks_like_id(x) and not CONTACT.search(x)]
            if vals:
                res[k] = vals
        elif isinstance(v, str | int | float) and str(v).strip():
            s = str(v).strip()[:200]
            if not looks_like_id(s) and not CONTACT.search(s):
                res[k] = s
    return res


def clean_text(text: str) -> str:
    text = scrub_id_numbers(" ".join(text.split()))[0]
    return tidy(CONTACT.sub("", text))


def allowed(h: str, source: str) -> bool:
    """At most 220 characters, no contact details / links / ID numbers / emoji, no number that isn't in the source."""
    if not 10 <= len(h) <= writer.HEADLINE_MAX:
        return False
    if CONTACT.search(h) or looks_like_id(h) or EMOJI.search(h):
        return False
    return all(n in source for n in NUMBER.findall(h))


@router.post("/headlines")
async def headlines(body: HeadlinesIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if not get_settings().anthropic_api_key:
        raise ApiError(503, "feature_off", "AI writing is being switched on - here are quick suggestions instead.")
    facts = clean_facts(body.facts)
    note = clean_text(body.note)
    current = clean_text(body.current)
    try:
        await ai_quota.take(db, "linkedin", str(auth.user.id), auth.session.kiosk_id)
    except ai_quota.CapReached as e:
        raise ApiError(503, "ai_busy", "AI is busy today - here are quick suggestions instead.") from e
    stats: dict[str, Any] = {}
    t0 = time.monotonic()
    try:
        raw = await writer.call_model(facts, note, body.count, current, stats)
    except claude.Unusable as e:
        await ai_quota.note(db, "linkedin", "failed")
        raise ApiError(422, "unusable", "AI couldn't write these - here are quick suggestions instead.") from e
    except anthropic.APIError as e:
        await ai_quota.note(db, "linkedin", "failed")
        raise ApiError(502, "writer_unavailable", "AI is busy right now - here are quick suggestions instead.") from e
    except Exception:
        await ai_quota.note(db, "linkedin", "failed")
        raise
    if stats.get("fallback"):
        await ai_quota.note(db, "linkedin", "fallback")
    source = " ".join([*(json.dumps(v) for v in facts.values()), note, current])
    seen: set[str] = set()
    kept = []
    for h in raw:
        if allowed(h, source) and h.lower() not in seen:
            seen.add(h.lower())
            kept.append(h)
    kept = kept[: body.count]
    if len(raw) - len(kept):
        await ai_quota.note(db, "linkedin", "dropped", by=len(raw) - len(kept))
    log.info(
        "linkedin ai: ok model=%s ms=%d headlines=%d dropped=%d",
        stats.get("model", ""),
        int((time.monotonic() - t0) * 1000),
        len(kept),
        len(raw) - len(kept),
    )
    return {"headlines": kept, "model": stats.get("model", ""), "fallback": bool(stats.get("fallback"))}
