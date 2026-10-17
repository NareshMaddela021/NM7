"""POST /api/me/photo-import: "Snap photos" — read resume details from up to 6 photos.

Privacy: the photos are checked and passed to the reader in memory only (never written to the database, disk or
logs); the reply is scrubbed of every ID / bank number; nothing is saved here — the customer reviews the result and
the browser saves only what they keep.
"""

import base64
import binascii
from typing import Any

import anthropic
from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core import ai_quota
from app.core.config import get_settings
from app.core.db import DB
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.photos import reader
from app.photos.scrub import scrub

router = APIRouter(prefix="/api/me/photo-import", tags=["photo import"])

MAX_PHOTOS = 6
MAX_BYTES = 10 * 1024 * 1024


class Photo(CamelModel):
    name: str = Field("", max_length=200)
    data: str  # base64, no data: prefix
    is_id: bool = False  # the customer marked it as an ID card


class ImportIn(CamelModel):
    photos: list[Photo]
    id_consent: bool = False


def _kind(raw: bytes) -> str | None:
    """The real image type from the file's first bytes (the declared type isn't trusted)."""
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[4:8] == b"ftyp" and raw[8:12] in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
        return "image/heic"
    return None


def _check(photos: list[Photo]) -> list[tuple[str, str]]:
    if not photos:
        raise ApiError(400, "no_photos", "Add at least one photo.")
    if len(photos) > MAX_PHOTOS:
        raise ApiError(400, "too_many_photos", f"You can send up to {MAX_PHOTOS} photos at a time.")
    out = []
    for i, p in enumerate(photos, 1):
        if len(p.data) > MAX_BYTES * 4 // 3 + 8:
            raise ApiError(
                413, "photo_too_large", f"Photo {i} is over 10 MB. Please take it again or choose a smaller one."
            )
        try:
            raw = base64.b64decode(p.data, validate=True)
        except (binascii.Error, ValueError) as e:
            raise ApiError(400, "bad_photo", f"Photo {i} couldn't be opened. Please choose it again.") from e
        if len(raw) > MAX_BYTES:
            raise ApiError(
                413, "photo_too_large", f"Photo {i} is over 10 MB. Please take it again or choose a smaller one."
            )
        kind = _kind(raw)
        if kind == "image/heic":  # the browser converts HEIC to JPG first; one that arrives as HEIC can't be read
            raise ApiError(415, "photo_type", f"Photo {i} is a HEIC photo. Please send it as JPG, PNG or WebP.")
        if kind is None:
            raise ApiError(415, "photo_type", f"Photo {i} isn't a JPG, PNG or WebP picture.")
        out.append((kind, p.data))
    return out


@router.post("")
async def photo_import(body: ImportIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if not get_settings().anthropic_api_key:
        raise ApiError(503, "feature_off", "Photo reading is being switched on - try again soon.")
    images = _check(body.photos)
    marked = [i for i, p in enumerate(body.photos) if p.is_id]
    if marked and not body.id_consent:
        raise ApiError(
            400,
            "consent_required",
            "Please tick the box to let Nm7 read your name, address and date of birth from the ID card.",
        )
    # counted before the call, failed attempts included (core/ai_quota.py): 5 a day per person, per kiosk link,
    # and the site-wide AI cap
    try:
        await ai_quota.take(db, "photos", str(auth.user.id), auth.session.kiosk_id)
    except ai_quota.CapReached as e:
        raise ApiError(
            503,
            "ai_busy",
            "Photo reading is busy today. Please try again tomorrow, or type your details in the builder.",
        ) from e
    stats: dict[str, Any] = {}
    try:
        raw = await reader.call_model(images, stats)
    except reader.ReadFailed as e:
        await ai_quota.note(db, "photos", "failed")
        raise ApiError(422, "unreadable", "We couldn't read these photos - try again in better light.") from e
    except anthropic.APIError as e:
        await ai_quota.note(db, "photos", "failed")
        raise ApiError(
            502, "reader_unavailable", "We couldn't read the photos right now. Please try again in a minute."
        ) from e
    if stats.get("fallback"):
        await ai_quota.note(db, "photos", "fallback")

    out = scrub(raw if isinstance(raw, dict) else {})
    photos = [p for p in out.get("photos", []) if isinstance(p, dict)]
    detected = sorted({int(p.get("index", -1)) for p in photos if p.get("kind") == "id_card"} | set(marked))
    if detected and not body.id_consent:
        # an ID card we weren't told about: nothing from these photos is returned until the customer agrees
        raise ApiError(
            409,
            "id_consent_required",
            "One of these photos looks like an ID card. Please tick the box to let Nm7 read it.",
            extra={"photos": detected},
        )
    return {
        "photos": [
            {"index": int(p.get("index", i)), "kind": p.get("kind", "other"), "readable": bool(p.get("readable", True))}
            for i, p in enumerate(photos)
        ],
        "personal": out.get("personal", {}),
        "headline": out.get("headline", ""),
        "experience": out.get("experience", []),
        "skills": out.get("skills", []),
        "certifications": out.get("certifications", []),
        "education": out.get("education", []),
        "languages": out.get("languages", []),
    }
