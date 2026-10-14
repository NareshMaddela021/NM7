"""Admin accounts: authenticator (TOTP) codes, recovery codes, trusted devices."""

import secrets
import time

import pyotp
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.auth.models import RecoveryCode, User
from app.auth.service import find_user
from app.auth.sessions import revoke_all
from app.core.db import RECOVERY_CODES, TRUSTED_DEVICES, USERS, Session, transaction
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


async def set_up_two_step(db: AsyncDatabase, user: User, session: Session = None) -> tuple[str, list[str]]:
    """New authenticator secret + recovery codes. Old ones, trusted devices and sessions stop working."""
    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt(secret)
    user.totp_last_step = None
    codes = [new_recovery_code() for _ in range(RECOVERY_COUNT)]
    await db[USERS].update_one(
        {"_id": user.id},
        {"$set": {"totp_secret_enc": user.totp_secret_enc, "totp_last_step": None, "updated_at": now()}},
        session=session,
    )
    await db[RECOVERY_CODES].update_many(
        {"user_id": user.id, "used_at": None}, {"$set": {"used_at": now()}}, session=session
    )
    await db[RECOVERY_CODES].insert_many(
        [RecoveryCode(user_id=user.id, code_hash=_recovery_hash(user, _norm(c))).to_mongo() for c in codes],
        session=session,
    )
    await db[TRUSTED_DEVICES].update_many(
        {"user_id": user.id, "revoked_at": None}, {"$set": {"revoked_at": now()}}, session=session
    )
    await revoke_all(db, user.id, session=session)
    return secret, codes


def provisioning_uri(user: User, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)


async def create_admin(db: AsyncDatabase, email: str, name: str, admin_role: str, password: str):
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

    async def save(session):
        await db[USERS].insert_one(user.to_mongo(), session=session)
        return await set_up_two_step(db, user, session=session)

    try:
        secret, codes = await transaction(save)
    except DuplicateKeyError:
        raise ValueError("an account with this email already exists") from None
    return user, secret, codes


def totp_step(user: User, code: str, at: float | None = None) -> int | None:
    """The 30-second step `code` belongs to (current, or one either side), if newer than the last one used."""
    if not user.totp_secret_enc or not (len(code) == 6 and code.isdigit()):
        return None
    totp = pyotp.TOTP(decrypt(user.totp_secret_enc))
    step = int((at if at is not None else time.time()) // totp.interval)
    last = user.totp_last_step if user.totp_last_step is not None else -1
    for s in (step - 1, step, step + 1):
        if s > last and same(totp.generate_otp(s), code):
            return s
    return None


def check_totp(user: User, code: str, at: float | None = None) -> bool:
    """In-memory check (records the step on `user`); use claim_totp to also store it."""
    s = totp_step(user, code, at)
    if s is None:
        return False
    user.totp_last_step = s
    return True


async def claim_totp(db: AsyncDatabase, user: User, code: str) -> bool:
    """Checks the code and stores its step in one atomic update, so the same code can never be used twice —
    not even by two requests at the same moment."""
    s = totp_step(user, code)
    if s is None:
        return False
    r = await db[USERS].update_one(
        {"_id": user.id, "$or": [{"totp_last_step": None}, {"totp_last_step": {"$lt": s}}]},
        {"$set": {"totp_last_step": s}},
    )
    if r.modified_count != 1:
        return False
    user.totp_last_step = s
    return True


async def use_recovery_code(db: AsyncDatabase, user: User, code: str) -> bool:
    h = _recovery_hash(user, _norm(code))
    used = await db[RECOVERY_CODES].find_one_and_update(
        {"user_id": user.id, "code_hash": h, "used_at": None}, {"$set": {"used_at": now()}}
    )
    return used is not None


def require_two_step_set_up(user: User) -> None:
    if not user.totp_secret_enc:
        raise ApiError(403, "two_step_not_set_up", "Two-step login isn’t set up for this admin. Ask the owner.")
