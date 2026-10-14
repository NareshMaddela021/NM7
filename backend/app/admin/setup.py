"""One-time setup of the first owner admin from the website, for hosts without a shell (e.g. Render free plan).

Enabled only while ADMIN_SETUP_TOKEN is set (24+ characters) AND no admin account exists. Afterwards both
endpoints answer 404 for good, even if the token is still set.

1. POST /api/admin/setup {token, email, name, password, passwordConfirm}
   → checks the token, returns the authenticator link + 10 recovery codes (shown once). Nothing is saved yet:
     the pending account travels in an encrypted, signed, 15-minute cookie.
2. POST /api/admin/setup/verify {code}
   → the 6-digit code from the authenticator app proves it was set up; only then is the owner account created.
"""

import hmac
import logging
import uuid
from datetime import timedelta

import pyotp
from fastapi import APIRouter, Request, Response
from pydantic import EmailStr, Field
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.admin_service import ISSUER, check_totp, new_recovery_code, recovery_hash
from app.auth.models import RecoveryCode, User
from app.auth.service import check_new_password, find_user
from app.auth.sessions import clear_cookie, client_ip, set_cookie
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, LOCKS, RECOVERY_CODES, USERS, Session, transaction
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import encrypt, hash_password, seal, unseal
from app.core.time import now

router = APIRouter(prefix="/api/admin/setup", tags=["admin setup"])
log = logging.getLogger("nm7.admin_setup")

MIN_TOKEN_LENGTH = 24
TICKET_COOKIE = "nm7_admin_setup"
COOKIE_PATH = "/api/admin/setup"
TICKET_TTL = timedelta(minutes=15)
START_RULES = [(5, timedelta(minutes=15))]  # per IP
VERIFY_RULES = [(10, timedelta(minutes=15))]  # wrong codes per IP
GLOBAL_RULES = [(30, timedelta(hours=1))]  # all failures together, from anywhere

NOT_FOUND = ApiError(404, "not_found", "Not found.")


class SetupIn(CamelModel):
    token: str = Field(max_length=200)
    email: EmailStr
    name: str = Field(max_length=80)
    password: str = Field(max_length=200)
    password_confirm: str = Field(max_length=200)


class SetupOut(CamelModel):
    otpauth_uri: str
    secret: str
    recovery_codes: list[str]
    expires_in_minutes: int


class VerifyIn(CamelModel):
    code: str = Field(max_length=10)


class VerifyOut(CamelModel):
    ok: bool = True
    email: str


async def _admin_exists(db: AsyncDatabase, session: Session = None) -> bool:
    return await db[USERS].find_one({"role": "admin"}, projection={"_id": 1}, session=session) is not None


async def _setup_open(db: AsyncDatabase, session: Session = None) -> None:
    """404 unless setup is switched on and nobody is admin yet — no hint which one failed."""
    token = get_settings().admin_setup_token
    if not token:
        raise NOT_FOUND
    if len(token) < MIN_TOKEN_LENGTH:
        log.warning("ADMIN_SETUP_TOKEN is shorter than %d characters; admin setup stays off", MIN_TOKEN_LENGTH)
        raise NOT_FOUND
    if await _admin_exists(db, session):
        raise NOT_FOUND


async def _fail(db: AsyncDatabase, ip_key: str, action: str, ip: str | None, err: ApiError) -> None:
    await rate_limit.record(db, ip_key, "admin-setup:all")
    await audit(db, None, action, ip=ip)
    raise err


@router.post("")
async def start_setup(body: SetupIn, request: Request, response: Response, db: DB) -> SetupOut:
    await _setup_open(db)
    ip = client_ip(request)
    ip_key = f"admin-setup:{ip}"
    await rate_limit.check(db, ip_key, START_RULES)
    await rate_limit.check(db, "admin-setup:all", GLOBAL_RULES)

    if not hmac.compare_digest(body.token.strip().encode(), get_settings().admin_setup_token.encode()):
        await _fail(
            db, ip_key, "admin.setup_bad_token", ip, ApiError(403, "invalid_token", "That setup token is wrong.")
        )

    name = " ".join(body.name.split())
    if not name:
        raise ApiError(400, "name_required", "Enter your name.")
    check_new_password(body.password, body.password_confirm)
    if await find_user(db, body.email):
        raise ApiError(409, "email_taken", "This email already has an account. Use another email for the admin.")

    user_id = str(uuid.uuid4())
    secret = pyotp.random_base32()
    codes = [new_recovery_code() for _ in range(10)]
    # Not saved: recovery-code hashes are tied to the future account id.
    holder = User(_id=user_id, email=body.email, name=name, role="customer", password_hash="")
    ticket = {
        "uid": user_id,
        "email": body.email.strip(),
        "name": name,
        "ph": await hash_password(body.password),
        "ts": secret,
        "rc": [recovery_hash(holder, c) for c in codes],
    }
    await audit(db, None, "admin.setup_started", data={"email": ticket["email"]}, ip=ip)
    set_cookie(response, TICKET_COOKIE, seal(ticket), TICKET_TTL, path=COOKIE_PATH)
    uri = pyotp.TOTP(secret).provisioning_uri(name=ticket["email"], issuer_name=ISSUER)
    return SetupOut(
        otpauth_uri=uri, secret=secret, recovery_codes=codes, expires_in_minutes=int(TICKET_TTL.total_seconds() // 60)
    )


@router.post("/verify")
async def verify_setup(body: VerifyIn, request: Request, response: Response, db: DB) -> VerifyOut:
    await _setup_open(db)
    ip = client_ip(request)
    ip_key = f"admin-setup-verify:{ip}"
    await rate_limit.check(db, ip_key, VERIFY_RULES)
    await rate_limit.check(db, "admin-setup:all", GLOBAL_RULES)

    sealed = request.cookies.get(TICKET_COOKIE)
    ticket = unseal(sealed, int(TICKET_TTL.total_seconds())) if sealed else None
    if ticket is None:
        raise ApiError(400, "setup_expired", "This setup has expired. Start again with the setup token.")

    user = User(
        _id=ticket["uid"],
        email=ticket["email"],
        name=ticket["name"],
        role="admin",
        admin_role="owner",
        password_hash=ticket["ph"],
        totp_secret_enc=encrypt(ticket["ts"]),
        email_verified_at=now(),
    )
    if not check_totp(user, body.code.strip()):  # also records the step, so this code can't be reused to log in
        await _fail(
            db,
            ip_key,
            "admin.setup_bad_code",
            ip,
            ApiError(400, "invalid_code", "That code is wrong. Use the 6-digit code from your authenticator app."),
        )

    async def create_owner(session):
        # Every setup writes this lock document first, so two setups at the same moment conflict and only one
        # commits; the loser is retried, sees the new admin and gets 404.
        await db[LOCKS].update_one({"_id": "admin_setup"}, {"$inc": {"n": 1}}, upsert=True, session=session)
        await _setup_open(db, session)
        await db[USERS].insert_one(user.to_mongo(), session=session)
        await db[RECOVERY_CODES].insert_many(
            [RecoveryCode(user_id=user.id, code_hash=h).to_mongo() for h in ticket["rc"]], session=session
        )
        await audit(
            db,
            user.id,
            "admin.setup_completed",
            target=user.id,
            data={"email": user.email, "role": "owner"},
            ip=ip,
            session=session,
        )

    try:
        await transaction(create_owner)
    except DuplicateKeyError:
        raise ApiError(
            409, "email_taken", "This email already has an account. Start again with another email."
        ) from None
    clear_cookie(response, TICKET_COOKIE, path=COOKIE_PATH)
    log.warning("First owner admin %s created through /api/admin/setup — remove ADMIN_SETUP_TOKEN now", user.email)
    return VerifyOut(email=user.email)
