"""Password hashing, random tokens, one-time codes and keyed hashes."""

import hashlib
import hmac
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings

_ph = PasswordHasher()  # argon2id
_DUMMY_HASH = _ph.hash("not-a-real-password-1")


def _verify(hash_: str, password: str) -> bool:
    try:
        return _ph.verify(hash_, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# argon2 is deliberately slow; keep it off the event loop.
async def hash_password(password: str) -> str:
    return await run_in_threadpool(_ph.hash, password)


async def verify_password(hash_: str | None, password: str) -> bool:
    """Checks a password. With no hash (unknown account) it still spends the same time, then fails."""
    ok = await run_in_threadpool(_verify, hash_ or _DUMMY_HASH, password)
    return ok and hash_ is not None


def needs_rehash(hash_: str) -> bool:
    return _ph.check_needs_rehash(hash_)


def password_issue(password: str) -> str | None:
    """Same rule as passwordIssue() in the frontend's auth.js."""
    if len(password or "") < 8:
        return "At least 8 characters"
    if len(password) > 128:
        return "At most 128 characters"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Use letters and at least one number"
    return None


def keyed_hash(*parts: str) -> str:
    """HMAC-SHA256 with SECRET_KEY — for tokens and codes we must look up but never store in plain."""
    msg = "\x1f".join(parts).encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return keyed_hash("token", token)


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
