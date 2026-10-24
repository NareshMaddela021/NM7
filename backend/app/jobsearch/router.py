"""Job search, Phase 1: match a resume to a job post.

  GET    /api/me/jobs/access                 packs owned, payment mode, prices, free uses left today
  POST   /api/me/jobs/read-image             a screenshot of a job post → its text (AI; the photo is not kept)
  POST   /api/me/jobs/match                  {resumeId, text} → the reading, the score /100 and what to fix (saved)
  GET    /api/me/jobs/matches                saved matches, newest first
  GET    /api/me/jobs/matches/{id}           one match
  PATCH  /api/me/jobs/matches/{id}           title / company (fix a wrong reading)
  POST   /api/me/jobs/matches/{id}/rescore   score again (after editing or tailoring the resume)
  DELETE /api/me/jobs/matches/{id}           one match and everything made from it
  DELETE /api/me/jobs                        all job-search data (job posts, matches, letters, interview prep)

Job links can't be opened: the person pastes the post's text (or a screenshot / PDF of it). Everything is saved on
the person's account only and is never shared with an organization. AI (reading a messy post or a screenshot) is
counted before the call (core/ai_quota.py, feature "jobs"); when AI is off or over a limit, the rules' reading is
used and the page says so — never an error page.
"""

import base64
import binascii
import logging
import re
from typing import Any

import anthropic
from fastapi import APIRouter, Response
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import DB, JOB_MATCHES, RESUMES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import access, ai
from app.jobsearch.parse import Parsed, clean_text, parse
from app.jobsearch.score import score
from app.photos.router import _kind
from app.site import get_site
from app.wapay.settings import payment_mode

router = APIRouter(prefix="/api/me/jobs", tags=["job search"])
log = logging.getLogger("nm7.jobs")

MAX_MATCHES = 200  # per account; the oldest go first
MIN_TEXT = 60
LINK_ONLY = re.compile(r"^\s*(?:https?://|www\.)\S+\s*$", re.I)
MAX_IMAGE = 8 * 1024 * 1024
NOT_FOUND = ApiError(404, "not_found", "We couldn't find that job match.")


def _ms(dt) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


def match_out(d: dict[str, Any], full: bool = True) -> dict[str, Any]:
    r = d.get("result") or {}
    out = {
        "id": d["_id"],
        "title": d.get("title") or "",
        "company": d.get("company") or "",
        "location": d.get("location") or "",
        "resumeId": d.get("resume_key"),
        "resumeName": d.get("resume_name") or "",
        "score": r.get("score"),
        "verdict": r.get("verdict"),
        "verdictText": r.get("verdictText"),
        "tailoredResumeId": d.get("tailored_key"),
        "createdAt": _ms(d.get("created_at")),
        "updatedAt": _ms(d.get("updated_at")),
        "source": d.get("source", "rules"),
    }
    if full:
        p = d.get("parsed") or {}
        out |= {
            "post": d.get("post") or "",
            "parsed": {
                "title": p.get("title", ""),
                "company": p.get("company", ""),
                "location": p.get("location", ""),
                "expMin": p.get("exp_min"),
                "expMax": p.get("exp_max"),
                "fresher": p.get("fresher", False),
                "education": p.get("education", []),
                "must": p.get("must", []),
                "nice": p.get("nice", []),
                "tools": p.get("tools", []),
                "certs": p.get("certs", []),
                "soft": p.get("soft", []),
                "languages": p.get("languages", []),
                "duties": p.get("duties", []),
            },
            "breakdown": r.get("breakdown", []),
            "items": r.get("items", []),
            "soft": r.get("soft", []),
            "fixes": r.get("fixes", []),
            "note": d.get("note") or "",
        }
    return out


async def _resume(db, user_id: str, key: str | None) -> dict[str, Any]:
    q: dict[str, Any] = {"user_id": user_id}
    if key:
        q["key"] = key
    else:
        q["active"] = True
    d = await db[RESUMES].find_one(q) or (None if key else await db[RESUMES].find_one({"user_id": user_id}))
    if not d:
        raise ApiError(404, "resume_not_found", "Pick one of your resumes.")
    return d


async def _match(db, user_id: str, match_id: str) -> dict[str, Any]:
    d = await db[JOB_MATCHES].find_one({"_id": match_id, "user_id": user_id})
    if not d:
        raise NOT_FOUND
    return d


async def _ai_read(db, auth, run) -> tuple[dict[str, Any] | None, str]:
    """Runs one AI read (counted first). Returns (answer or None, note for the page)."""
    if not get_settings().anthropic_api_key:
        return None, "AI reading is off right now; this is our quick reading of the post."
    try:
        await ai_quota.take(db, "jobs", str(auth.user.id), auth.session.kiosk_id)
    except ai_quota.CapReached:
        return None, "AI is busy today; this is our quick reading of the post."
    except ApiError as e:  # this person (or kiosk) is at today's AI limit
        if e.status == 429:
            return None, "You've used today's AI reads; this is our quick reading of the post."
        raise
    stats: dict[str, Any] = {}
    try:
        answer = await run(stats)
    except (claude.Unusable, anthropic.APIError):
        await ai_quota.note(db, "jobs", "failed")
        return None, "AI couldn't read this post; this is our quick reading of it."
    except Exception:
        await ai_quota.note(db, "jobs", "failed")
        raise
    if stats.get("fallback"):
        await ai_quota.note(db, "jobs", "fallback")
    return answer, ""


# ---------- access ----------


@router.get("/access")
async def get_access(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await get_site(db)
    tailor = await access.status(db, uid, "tailor")
    interview = await access.status(db, uid, "interview")
    mode = await payment_mode(db)
    plans = site["plans"]
    return {
        "tailor": bool(tailor),
        "tailorSource": tailor["source"] if tailor else "",
        "interview": bool(interview),
        "interviewSource": interview["source"] if interview else "",
        "mode": mode,
        "onSale": {
            "tailor": mode != "off" and plans["tailor_pack"]["active"],
            "interview": mode != "off" and plans["interview_pack"]["active"],
        },
        "prices": {k: plans[k]["amount"] / 100 for k in ("tailor_pack", "interview_pack", "diy")},
        "free": {
            "matchesLeft": None if tailor else max(0, access.FREE["match"] - await access.used_today(db, uid, "match")),
            "coversLeft": None if tailor else max(0, access.FREE["cover"] - await access.used_today(db, uid, "cover")),
            "matchesPerDay": access.FREE["match"],
            "coversPerDay": access.FREE["cover"],
            "questions": access.FREE_QUESTIONS,
        },
        "ai": bool(get_settings().anthropic_api_key),
    }


# ---------- reading a screenshot ----------


class Image(CamelModel):
    data: str  # base64, no data: prefix


class ReadImageIn(CamelModel):
    images: list[Image] = Field(min_length=1, max_length=3)


@router.post("/read-image")
async def read_image(body: ReadImageIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    images = []
    for i, im in enumerate(body.images, 1):
        try:
            raw = base64.b64decode(im.data, validate=True)
        except (binascii.Error, ValueError) as e:
            raise ApiError(400, "bad_image", f"Picture {i} couldn't be opened. Please choose it again.") from e
        if len(raw) > MAX_IMAGE:
            raise ApiError(413, "image_too_large", f"Picture {i} is over 8 MB. Please choose a smaller one.")
        kind = _kind(raw)
        if kind not in ("image/jpeg", "image/png", "image/webp"):
            raise ApiError(415, "image_type", f"Picture {i} isn't a JPG, PNG or WebP picture.")
        images.append((kind, im.data))
    answer, note = await _ai_read(db, auth, lambda stats: ai.read_images(images, stats))
    if not answer or not answer.get("text", "").strip():
        raise ApiError(
            422,
            "unreadable",
            note or "We couldn't read the picture. Please copy the job post's text and paste it instead.",
        )
    return {"text": answer["text"]}


# ---------- matching ----------


class MatchIn(CamelModel):
    resume_id: str | None = Field(None, max_length=40)
    text: str = Field(min_length=1, max_length=40_000)
    title: str = Field("", max_length=120)
    company: str = Field("", max_length=120)


async def _read(db, auth, text: str) -> tuple[Parsed, str]:
    """The rules' reading; for a messy post, Claude's (checked against the post). Never fails."""
    p = parse(text)
    if p.confidence == "high":
        return p, ""
    answer, note = await _ai_read(db, auth, lambda stats: ai.read_text(text, stats))
    if answer:
        return ai.grounded(p, answer, clean_text(text)), ""
    return p, note


@router.post("/match", status_code=201)
async def match(body: MatchIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    text = clean_text(body.text)
    if LINK_ONLY.match(body.text):
        raise ApiError(400, "link_only", "We can't open job links. Please copy the job post's text and paste it here.")
    if len(text) < MIN_TEXT:
        raise ApiError(400, "too_short", "Please paste the whole job post - the duties and the skills they ask for.")
    resume = await _resume(db, uid, body.resume_id)
    paid = await access.has(db, uid, "tailor")
    if not paid and not await access.take_free(db, uid, "match"):
        raise ApiError(
            402,
            "free_limit",
            f"You've used today's {access.FREE['match']} free job matches. Come back tomorrow, or get the Tailor "
            "pack for unlimited matches.",
        )
    try:
        p, note = await _read(db, auth, text)
        if body.title.strip():
            p.title = body.title.strip()
        if body.company.strip():
            p.company = body.company.strip()
        result = score(p, resume.get("data") or {})
    except Exception:
        if not paid:
            await access.give_back(db, uid, "match")
        raise
    t = now()
    doc = {
        "_id": new_id(),
        "user_id": uid,
        "resume_key": resume["key"],
        "resume_name": resume.get("name") or "",
        "title": p.title,
        "company": p.company,
        "location": p.location,
        "post": text,
        "parsed": p.to_dict(),
        "result": result,
        "source": p.source,
        "note": note,
        "tailored_key": None,
        "created_at": t,
        "updated_at": t,
    }
    await db[JOB_MATCHES].insert_one(doc)
    # keep the newest MAX_MATCHES
    old = [
        d["_id"]
        async for d in db[JOB_MATCHES].find({"user_id": uid}, {"_id": 1}).sort("created_at", -1).skip(MAX_MATCHES)
    ]
    if old:
        await db[JOB_MATCHES].delete_many({"_id": {"$in": old}})
    log.info("job match: source=%s score=%s paid=%s", p.source, result["score"], str(paid).lower())
    return match_out(doc)


@router.get("/matches")
async def list_matches(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    cur = db[JOB_MATCHES].find({"user_id": auth.user.id}, {"post": 0, "parsed": 0}).sort("created_at", -1).limit(100)
    return [match_out(d, full=False) async for d in cur]


@router.get("/matches/{match_id}")
async def get_match(match_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return match_out(await _match(db, auth.user.id, match_id))


class MatchPatch(CamelModel):
    title: str | None = Field(None, max_length=120)
    company: str | None = Field(None, max_length=120)


@router.patch("/matches/{match_id}")
async def patch_match(match_id: str, body: MatchPatch, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    d = await _match(db, auth.user.id, match_id)
    changes: dict[str, Any] = {}
    for k in ("title", "company"):
        v = getattr(body, k)
        if v is not None:
            changes[k] = " ".join(v.split())
            changes[f"parsed.{k}"] = changes[k]
    if changes:
        d = {**d, **{k: v for k, v in changes.items() if "." not in k}}
        parsed = Parsed(**{**(d.get("parsed") or {}), **{k: v for k, v in changes.items() if "." not in k}})
        resume = await _resume(db, auth.user.id, d.get("resume_key"))
        changes["result"] = score(parsed, resume.get("data") or {})
        changes["updated_at"] = now()
        await db[JOB_MATCHES].update_one({"_id": match_id}, {"$set": changes})
    return match_out(await _match(db, auth.user.id, match_id))


class RescoreIn(CamelModel):
    resume_id: str | None = Field(None, max_length=40)


@router.post("/matches/{match_id}/rescore")
async def rescore(match_id: str, body: RescoreIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    d = await _match(db, auth.user.id, match_id)
    resume = await _resume(db, auth.user.id, body.resume_id or d.get("resume_key"))
    parsed = Parsed(**(d.get("parsed") or {}))
    result = score(parsed, resume.get("data") or {})
    await db[JOB_MATCHES].update_one(
        {"_id": match_id},
        {"$set": {"result": result, "resume_key": resume["key"], "resume_name": resume.get("name") or "",
                  "updated_at": now()}},
    )  # fmt: skip
    return match_out(await _match(db, auth.user.id, match_id))


@router.delete("/matches/{match_id}", status_code=204)
async def delete_match(match_id: str, auth: CustomerAuth, db: DB) -> Response:
    res = await db[JOB_MATCHES].delete_one({"_id": match_id, "user_id": auth.user.id})
    if not res.deleted_count:
        raise NOT_FOUND
    return Response(status_code=204)


@router.delete("", status_code=204)
async def delete_all(auth: CustomerAuth, db: DB) -> Response:
    """Every job post, match, tailored suggestion, cover letter and interview pack on this account (the tailored
    resume copies are ordinary resumes: they stay in My resumes until deleted there)."""
    await db[JOB_MATCHES].delete_many({"user_id": auth.user.id})
    return Response(status_code=204)
