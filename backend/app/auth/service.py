"""Account rules shared by the auth routes."""

import re
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import EmailCode, User
from app.core import rate_limit
from app.core.errors import ApiError
from app.core.security import keyed_hash, new_code, password_issue, same
from app.core.time import now

CODE_TTL = timedelta(minutes=10)
CODE_MAX_ATTEMPTS = 5
CODE_SEND_RULES = [(1, timedelta(minutes=1)), (5, timedelta(hours=1))]  # per email address
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


async def find_user(db: AsyncSession, email: str) -> User | None:
    return (await db.execute(select(User).where(User.email == email.strip()))).scalar_one_or_none()


def _code_hash(user: User, purpose: str, code: str) -> str:
    return keyed_hash("code", purpose, str(user.id), code)


async def issue_code(db: AsyncSession, user: User, purpose: str, ip: str | None) -> str:
    """New code for (user, purpose); any earlier unused code for the same purpose stops working."""
    await db.execute(
        update(EmailCode)
        .where(EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None))
        .values(used_at=now())
    )
    code = new_code()
    db.add(
        EmailCode(
            user_id=user.id,
            purpose=purpose,
            code_hash=_code_hash(user, purpose, code),
            expires_at=now() + CODE_TTL,
            ip=ip,
        )
    )
    return code


async def check_code(db: AsyncSession, user: User, purpose: str, code: str) -> bool:
    """True and uses up the code if it matches. A wrong guess counts and is saved straight away."""
    row = (
        await db.execute(
            select(EmailCode)
            .where(
                EmailCode.user_id == user.id,
                EmailCode.purpose == purpose,
                EmailCode.used_at.is_(None),
                EmailCode.expires_at > now(),
            )
            .order_by(EmailCode.created_at.desc())
            .limit(1)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.attempts >= CODE_MAX_ATTEMPTS:
        return False
    if not same(row.code_hash, _code_hash(user, purpose, code.strip())):
        row.attempts += 1
        await db.commit()
        return False
    row.used_at = now()
    return True


async def may_send_code(db: AsyncSession, email: str, *, raise_if_limited: bool = True) -> bool:
    """Applies the per-email send limit (whether or not the account exists) and records the send."""
    try:
        await rate_limit.check(
            db, code_key(email), CODE_SEND_RULES, "Please wait a minute before asking for another code."
        )
    except ApiError:
        if raise_if_limited:
            raise
        return False
    await rate_limit.record(db, code_key(email))
    return True
