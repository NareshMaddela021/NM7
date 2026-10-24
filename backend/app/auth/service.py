"""Account rules shared by the auth routes."""

import re
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from app.auth.models import EmailCode, User
from app.core import rate_limit
from app.core.db import EMAIL_CODES, USERS, Session
from app.core.errors import ApiError
from app.core.security import keyed_hash, new_code, password_issue
from app.core.time import now

CODE_TTL = timedelta(minutes=10)
CODE_MAX_ATTEMPTS = 5
CODE_SEND_RULES = [(1, timedelta(minutes=1)), (5, timedelta(hours=1))]  # per email address
# One client must not make the site email unlimited addresses (Resend quota, reputation, junk accounts). The per-IP
# numbers leave room for a whole college on one Wi-Fi address; the global ones are an abuse brake, not a budget.
CODE_SEND_IP_RULES = [(30, timedelta(minutes=10)), (120, timedelta(hours=1)), (400, timedelta(days=1))]
CODE_SEND_ALL_RULES = [(300, timedelta(hours=1)), (2000, timedelta(days=1))]
UNVERIFIED_TTL = timedelta(days=7)  # a sign-up never confirmed is dropped after this
LOGIN_FAIL_EMAIL = (10, timedelta(minutes=15))
LOGIN_FAIL_IP = (30, timedelta(minutes=15))

INVALID_CODE = ApiError(400, "invalid_code", "That code is wrong or expired.")


def code_key(email: str) -> str:
    return f"code:{email.strip().lower()}"


def login_keys(email: str, ip: str | None) -> list[str]:
    return [f"login:{email.strip().lower()}"] + ([f"login-ip:{ip}"] if ip else [])


def normalize_phone(phone: str | None) -> str | None:
    """Indian mobile → '+91 98765 43210' (same as normPhone in the frontend)."""
    if not phone or not phone.strip():
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ApiError(400, "invalid_phone", "Enter a 10-digit Indian mobile number.")
    return f"+91 {digits[:5]} {digits[5:]}"


def check_new_password(password: str, confirm: str) -> None:
    issue = password_issue(password)
    if issue:
        raise ApiError(400, "weak_password", issue)
    if password != confirm:
        raise ApiError(400, "password_mismatch", "The two passwords don’t match.")


async def find_user(db: AsyncDatabase, email: str, session: Session = None) -> User | None:
    return User.load(await db[USERS].find_one({"email_lc": email.strip().lower()}, session=session))


def _code_hash(user: User, purpose: str, code: str) -> str:
    return keyed_hash("code", purpose, str(user.id), code)


async def issue_code(db: AsyncDatabase, user: User, purpose: str, ip: str | None) -> str:
    """New code for (user, purpose); any earlier unused code for the same purpose stops working."""
    await db[EMAIL_CODES].update_many(
        {"user_id": user.id, "purpose": purpose, "used_at": None}, {"$set": {"used_at": now()}}
    )
    code = new_code()
    doc = EmailCode(
        user_id=user.id, purpose=purpose, code_hash=_code_hash(user, purpose, code), expires_at=now() + CODE_TTL, ip=ip
    )
    await db[EMAIL_CODES].insert_one(doc.to_mongo())
    return code


async def check_code(db: AsyncDatabase, user: User, purpose: str, code: str) -> bool:
    """True and uses up the code if it matches. A wrong guess counts. Both are single atomic updates, so two
    requests can never use the same code twice or get extra guesses."""
    live = {
        "user_id": user.id,
        "purpose": purpose,
        "used_at": None,
        "expires_at": {"$gt": now()},
        "attempts": {"$lt": CODE_MAX_ATTEMPTS},
    }
    used = await db[EMAIL_CODES].find_one_and_update(
        {**live, "code_hash": _code_hash(user, purpose, code.strip())}, {"$set": {"used_at": now()}}
    )
    if used is not None:
        return True
    await db[EMAIL_CODES].update_one(live, {"$inc": {"attempts": 1}})
    return False


async def may_send_code(db: AsyncDatabase, email: str, ip: str | None = None, *, raise_if_limited: bool = True) -> bool:
    """Applies the send limits (per email address whether or not the account exists, per caller address, and for
    the site as a whole) and records the send."""
    keys = [code_key(email), "code:all"] + ([f"code-ip:{ip}"] if ip else [])
    try:
        await rate_limit.check(
            db, code_key(email), CODE_SEND_RULES, "Please wait a minute before asking for another code."
        )
        if ip:
            await rate_limit.check(db, f"code-ip:{ip}", CODE_SEND_IP_RULES)
        await rate_limit.check(db, "code:all", CODE_SEND_ALL_RULES)
    except ApiError:
        if raise_if_limited:
            raise
        return False
    await rate_limit.record(db, *keys)
    return True
