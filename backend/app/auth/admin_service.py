"""Admin accounts: authenticator (TOTP) codes, recovery codes, trusted devices."""

import secrets
import time

import pyotp
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RecoveryCode, TrustedDevice, User
from app.auth.service import find_user
from app.auth.sessions import revoke_all
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt, hash_password, keyed_hash, password_issue, same
from app.core.time import now

ISSUER = "Nm7"
RECOVERY_COUNT = 10
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def recovery_hash(user: User, code: str) -> str:
    return _recovery_hash(user, _norm(code))


def _recovery_hash(user: User, code: str) -> str:
    return keyed_hash("recovery", str(user.id), code)


def _norm(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def new_recovery_code() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


async def set_up_two_step(db: AsyncSession, user: User) -> tuple[str, list[str]]:
    """New authenticator secret + recovery codes. Old ones, trusted devices and sessions stop working."""
    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt(secret)
    user.totp_last_step = None
    codes = [new_recovery_code() for _ in range(RECOVERY_COUNT)]
    await db.execute(update(RecoveryCode).where(RecoveryCode.user_id == user.id).values(used_at=now()))
    db.add_all(RecoveryCode(user_id=user.id, code_hash=_recovery_hash(user, _norm(c))) for c in codes)
    await db.execute(update(TrustedDevice).where(TrustedDevice.user_id == user.id).values(revoked_at=now()))
    await revoke_all(db, user.id)
    return secret, codes


def provisioning_uri(user: User, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)


async def create_admin(db: AsyncSession, email: str, name: str, admin_role: str, password: str):
    from app.admin.roles import ROLES

    if admin_role not in ROLES:
        raise ValueError(f"admin role must be one of {', '.join(ROLES)}")
    if issue := password_issue(password):
        raise ValueError(f"password: {issue}")
    if await find_user(db, email):
        raise ValueError("an account with this email already exists")
    user = User(
        email=email.strip(),
        name=name.strip(),
        role="admin",
        admin_role=admin_role,
        password_hash=await hash_password(password),
        email_verified_at=now(),
    )
    db.add(user)
    await db.flush()
    secret, codes = await set_up_two_step(db, user)
    return user, secret, codes


def check_totp(user: User, code: str, at: float | None = None) -> bool:
    """Accepts the current 30-second code or one step either side, never a step already used."""
    if not user.totp_secret_enc or not (len(code) == 6 and code.isdigit()):
        return False
    totp = pyotp.TOTP(decrypt(user.totp_secret_enc))
    step = int((at if at is not None else time.time()) // totp.interval)
    for s in (step - 1, step, step + 1):
        if s > (user.totp_last_step if user.totp_last_step is not None else -1) and same(totp.generate_otp(s), code):
            user.totp_last_step = s
            return True
    return False


async def use_recovery_code(db: AsyncSession, user: User, code: str) -> bool:
    h = _recovery_hash(user, _norm(code))
    row = (
        await db.execute(
            select(RecoveryCode)
            .where(RecoveryCode.user_id == user.id, RecoveryCode.code_hash == h, RecoveryCode.used_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    row.used_at = now()
    return True


def require_two_step_set_up(user: User) -> None:
    if not user.totp_secret_enc:
        raise ApiError(403, "two_step_not_set_up", "Two-step login isn’t set up for this admin. Ask the owner.")
