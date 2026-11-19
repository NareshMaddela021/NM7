"""Read-only mode for Admin → Customers → "View as this user (read-only)" (app/auth/views.py, mode "readonly").

Enforced on the server, before and around every route, so no page or forgotten endpoint can change anything:

- ReadOnlyGuard (ASGI middleware): while this browser's view is read-only, every method other than GET / HEAD /
  OPTIONS is refused with 403 read_only (only "Back to Admin" itself is let through). Files (PDFs, photos, documents,
  exports: anything that isn't JSON) are refused too, and JSON answers are masked (mask()).
- READ_ONLY (a context variable the guard sets for the request): get_database() then hands out a database whose
  collections skip every write (no "last seen", no "viewed" marks, no lazily made records while reading), and
  send_safely / send_batch send no email.
"""

import json
import logging
import re
from contextvars import ContextVar
from typing import Any

from app.core.errors import ApiError

log = logging.getLogger("nm7.readonly")

READ_ONLY: ContextVar[bool] = ContextVar("nm7_read_only", default=False)
SAFE = ("GET", "HEAD", "OPTIONS")
ALLOW = {("POST", "/api/admin/views/stop")}  # "Back to Admin"
MESSAGE = "This is a read-only view. Nothing can be changed or sent. Use Back to Admin to leave it."
REFUSED = ApiError(403, "read_only", MESSAGE)
FILES_MESSAGE = "Files and documents are hidden in the read-only view."

# ---------- masking ----------
HIDDEN = "Hidden in read-only view"
_PARTS = ("selfie", "face", "digilocker", "aadhaar", "aadhar", "integrity", "evidence", "document", "liveness",
          "passport", "idnumber", "id_number", "kyc", "voterid", "licence", "license_no", "bank", "ifsc",
          "payout", "account_number", "accountnumber")  # fmt: skip
_EXACT = {"pan", "pannumber", "pan_number", "dob", "birth", "birthdate", "dateofbirth", "date_of_birth", "idproof",
          "photoid", "address_line", "addressline", "upi", "upi_id", "upiid", "vpa"}  # fmt: skip
_EMAIL = re.compile(r"^([^@\s]{1,64})@([^@\s]+)$")


def mask_email(v: str) -> str:
    m = _EMAIL.match(v.strip())
    if not m:
        return HIDDEN
    name, domain = m.groups()
    return f"{name[0]}{'*' * max(2, len(name) - 1)}@{domain}"


def mask_phone(v: str) -> str:
    digits = re.sub(r"\D", "", v)
    if len(digits) < 4:
        return "••••" if v else v
    return f"•••••• {digits[-2:]}"


def _sensitive(key: str) -> bool:
    k = key.lower()
    return k in _EXACT or any(p in k for p in _PARTS)


def _blank(v: Any) -> Any:
    if isinstance(v, dict):
        return {}
    if isinstance(v, list):
        return []
    if isinstance(v, bool) or v is None:
        return v  # done / not done stays visible, what is in it doesn't
    if isinstance(v, (int, float)):
        return None
    return HIDDEN


def mask(v: Any, key: str = "") -> Any:
    """A copy of a JSON value with private fields hidden: documents, DigiLocker, selfie and face results, ID data,
    integrity evidence, bank details (emptied), emails and phone numbers (partly shown)."""
    if key and _sensitive(key):
        return _blank(v)
    k = key.lower()
    if isinstance(v, str):
        if k.endswith("email") or k in ("email_lc", "emaillc"):
            return mask_email(v) if v else v
        if ("phone" in k or "mobile" in k or "whatsapp" in k) and re.search(r"\d", v):
            return mask_phone(v)
        return v
    if isinstance(v, dict):
        return {kk: mask(vv, str(kk)) for kk, vv in v.items()}
    if isinstance(v, list):
        return [mask(x, key) for x in v]
    return v


# ---------- the database: reads only ----------
class _Result:
    """What a skipped write answers: as if it worked, so a page that makes something on first look (a referral
    code, a default setting) carries on with it in memory, and nothing is stored."""

    acknowledged = True
    upserted_id = None
    raw_result: dict = {}
    bulk_api_result: dict = {}

    def __init__(self, inserted_id=None, inserted_ids=None):
        self.inserted_id = inserted_id
        self.inserted_ids = inserted_ids or []
        self.matched_count = self.modified_count = self.deleted_count = self.inserted_count = 1
        self.upserted_count = 0


_WRITES = {"insert_one", "insert_many", "update_one", "update_many", "replace_one", "delete_one", "delete_many",
           "bulk_write", "create_index", "create_indexes", "drop", "drop_index", "drop_indexes", "rename"}  # fmt: skip
_FIND_AND = {"find_one_and_update", "find_one_and_replace", "find_one_and_delete"}


class ReadOnlyCollection:
    """A collection whose writes do nothing (and say so in the log): find_one_and_* only find."""

    def __init__(self, coll):
        self._coll = coll

    def __getattr__(self, name: str):
        if name in _WRITES:

            async def skipped(*a, **_k):
                log.info("read-only view: skipped %s on %s", name, self._coll.name)
                doc = a[0] if a else None
                if name == "insert_one" and isinstance(doc, dict):
                    return _Result(inserted_id=doc.get("_id"))
                if name == "insert_many" and isinstance(doc, list):
                    return _Result(inserted_ids=[d.get("_id") for d in doc if isinstance(d, dict)])
                return _Result()

            return skipped
        if name in _FIND_AND:

            async def find_only(filter, *a, projection=None, session=None, **_k):  # noqa: A002
                if projection is None and name != "find_one_and_delete" and len(a) > 1:
                    projection = a[1]
                return await self._coll.find_one(filter, projection, session=session)

            return find_only
        if name == "with_options":
            return lambda *a, **k: ReadOnlyCollection(self._coll.with_options(*a, **k))
        return getattr(self._coll, name)

    def __getitem__(self, sub: str):
        return ReadOnlyCollection(self._coll[sub])


class ReadOnlyDatabase:
    def __init__(self, db):
        self._db = db

    def __getitem__(self, name: str):
        return ReadOnlyCollection(self._db[name])

    def get_collection(self, name: str, *a, **k):
        return ReadOnlyCollection(self._db.get_collection(name, *a, **k))

    def __getattr__(self, name: str):
        return getattr(self._db, name)


def wrap(db):
    return ReadOnlyDatabase(db) if READ_ONLY.get() and not isinstance(db, ReadOnlyDatabase) else db


# ---------- the middleware ----------
def _json(status: int, code: str, message: str) -> tuple[dict, bytes]:
    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    start = {
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"cache-control", b"private, no-store"),
        ],  # fmt: skip
    }
    return start, body


class ReadOnlyGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or b"nm7_view=" not in dict(scope.get("headers") or []).get(b"cookie", b""):
            return await self.app(scope, receive, send)
        from starlette.requests import Request

        from app.auth.views import find_view
        from app.core.db import get_database

        try:
            v = await find_view(get_database(), Request(scope))
        except Exception:  # the database is down: let the route answer (it fails the same way)
            log.exception("read-only check failed")
            v = None
        if not v or v.get("mode") != "readonly":
            return await self.app(scope, receive, send)
        method, path = scope["method"], scope["path"]
        if method not in SAFE and (method, path) not in ALLOW:
            start, body = _json(403, "read_only", MESSAGE)
            await send(start)
            await send({"type": "http.response.body", "body": body})
            return None
        token = READ_ONLY.set((method, path) not in ALLOW)
        try:
            await self.app(scope, receive, _Masker(send) if (method, path) not in ALLOW else send)
        finally:
            READ_ONLY.reset(token)
        return None


class _Masker:
    """Holds the answer back, masks JSON, refuses anything else that has a body (files)."""

    def __init__(self, send):
        self.send = send
        self.start: dict | None = None
        self.kind = "pass"
        self.chunks: list[bytes] = []

    async def __call__(self, message):
        if message["type"] == "http.response.start":
            headers = {k.lower(): v for k, v in message.get("headers") or []}
            ctype = headers.get(b"content-type", b"").decode("latin-1").lower()
            status = message["status"]
            if status in (204, 304) or 300 <= status < 400:
                self.kind = "pass"
                return await self.send(message)
            self.kind = "json" if "json" in ctype else "file"
            self.start = message
            return None
        if message["type"] != "http.response.body" or self.kind == "pass":
            return await self.send(message)
        self.chunks.append(message.get("body", b""))
        if message.get("more_body"):
            return None
        raw = b"".join(self.chunks)
        if self.kind == "file":
            if not raw:
                await self.send(self.start)
                return await self.send({"type": "http.response.body", "body": b""})
            start, body = _json(403, "read_only_file", FILES_MESSAGE)
        else:
            try:
                body = json.dumps(mask(json.loads(raw or b"null")), ensure_ascii=False).encode()
            except ValueError:
                start, body = _json(403, "read_only_file", FILES_MESSAGE)
            else:
                start = dict(self.start)
                start["headers"] = [(k, v) for k, v in self.start.get("headers") or []
                                    if k.lower() not in (b"content-length", b"etag")]  # fmt: skip
                start["headers"].append((b"content-length", str(len(body)).encode()))
        await self.send(start)
        return await self.send({"type": "http.response.body", "body": body})
