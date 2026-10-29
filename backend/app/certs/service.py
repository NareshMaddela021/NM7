"""Certificate wallet: a student's certificate files (PDF / JPG / PNG, at most 10, 2 MB each after the browser has
compressed images) with title, issuer, date and an optional credential link.

Storage: the same place the app already keeps uploaded files (MongoDB: organization logos, invoice PDFs) — one
document per certificate in `certificates`, the file as BSON binary next to its details. A site-wide cap
(TOTAL_CAP_MB) keeps the database inside the hosting plan; uploads pause with a clear message when it is reached.

Who sees a file: its owner; and, only when the student switched on "Share certificates" AND ticked that certificate,
the organization staff who can see their shared resume and the recruiters invited to see it. Deleted with the
account (me/erase.py).
"""

import base64
import re
from typing import Any

from bson import Binary
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import CERTIFICATES, USERS
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers

MAX_FILES = 10
MAX_BYTES = 2 * 1024 * 1024
TOTAL_CAP_MB = 300  # all students' files together (MongoDB Atlas free tier: 512 MB for everything)
MIMES = {"application/pdf": b"%PDF", "image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
ID_WORDS = re.compile(
    r"\b(aadhaa?r|aadhar|pan card|permanent account number|passport|voter id|voter card|epic card|driving licen[cs]e|"
    r"ration card)\b",
    re.I,
)
ID_REFUSED = ApiError(400, "id_document", "Don’t upload Aadhaar, PAN or other ID documents. Certificates only.")
FULL = ApiError(507, "storage_full", "Certificate uploads are paused for now. Please try again later.")
LIST_FIELDS = {"file": 0}


def clean_text(v: str, limit: int) -> str:
    v = scrub_id_numbers(" ".join(str(v or "").split()))[0][:limit]
    if ID_WORDS.search(v):
        raise ID_REFUSED
    return v


def decode_file(data: str, mime: str) -> bytes:
    if mime not in MIMES:
        raise ApiError(400, "bad_file", "Use a PDF, JPG or PNG file.")
    try:
        raw = base64.b64decode(data.split(",", 1)[-1], validate=True)
    except ValueError:
        raise ApiError(400, "bad_file", "That file couldn’t be read. Try again.") from None
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "too_large", "That file is over 2 MB. Use a smaller scan or a photo.")
    if not raw.startswith(MIMES[mime]):
        raise ApiError(400, "bad_file", "That file isn’t a real PDF, JPG or PNG.")
    return raw


async def total_mb(db: AsyncDatabase) -> float:
    cur = await db[CERTIFICATES].aggregate([{"$group": {"_id": None, "b": {"$sum": "$size"}}}])
    rows = await cur.to_list(1)
    return (rows[0]["b"] if rows else 0) / (1024 * 1024)


def out(c: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": c["_id"],
        "title": c["title"],
        "issuer": c.get("issuer", ""),
        "date": c.get("date", ""),
        "link": c.get("link", ""),
        "mime": c["mime"],
        "size": c["size"],
        "name": c.get("name", ""),
        "share": bool(c.get("share")),
        "at": int(c["created_at"].timestamp() * 1000),
    }


async def sharing_on(db: AsyncDatabase, user_id: str) -> bool:
    u = await db[USERS].find_one({"_id": user_id}, {"cert_share": 1})
    return bool((u or {}).get("cert_share"))


async def shared_with_others(db: AsyncDatabase, user_id: str) -> list[dict[str, Any]]:
    """The certificates others may see: only with "Share certificates" on, and only the ticked ones."""
    if not user_id or not await sharing_on(db, user_id):
        return []
    cur = db[CERTIFICATES].find({"user_id": user_id, "share": True}, LIST_FIELDS).sort("created_at", 1)
    return [out(c) for c in await cur.to_list(MAX_FILES)]


async def shared_file(db: AsyncDatabase, user_id: str, cert_id: str) -> dict[str, Any] | None:
    if not user_id or not await sharing_on(db, user_id):
        return None
    return await db[CERTIFICATES].find_one({"_id": cert_id, "user_id": user_id, "share": True})


def file_response_headers(c: dict[str, Any]) -> dict[str, str]:
    """Shown in the browser, never run: no sniffing, a sandboxing CSP, no caching by shared caches."""
    ext = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[c["mime"]]
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", c.get("title") or "certificate").strip("_")[:60] or "certificate"
    return {
        "Content-Disposition": f'inline; filename="{safe}.{ext}"',
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "Cache-Control": "private, no-store",
    }


async def shared_file_response(db: AsyncDatabase, user_id: str, cert_id: str):
    """A shared certificate's file for someone who may see the student's resume (or 404)."""
    from fastapi import Response  # noqa: PLC0415 — keeps this module free of web imports at load time

    c = await shared_file(db, user_id, cert_id)
    if not c:
        raise ApiError(404, "not_found", "Certificate not found.")
    return Response(bytes(c["file"]), media_type=c["mime"], headers=file_response_headers(c))


def as_binary(raw: bytes) -> Binary:
    return Binary(raw)
