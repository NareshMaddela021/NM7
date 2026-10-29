"""Admin sign-in: password, then a 6-digit authenticator code (or a recovery code); optional 30-day trust."""

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import EmailStr, Field

from app.audit import audit
from app.auth.admin_service import claim_totp, require_two_step_set_up, use_recovery_code
from app.auth.models import AdminChallenge, TrustedDevice, User
from app.auth.schemas import Ok, UserOut
from app.auth.service import LOGIN_FAIL_EMAIL, LOGIN_FAIL_IP, find_user, login_keys
from app.auth.sessions import clear_cookie, client_ip, set_cookie, start_session
from app.core import rate_limit
from app.core.db import ADMIN_CHALLENGES, DB, TRUSTED_DEVICES, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token, new_token, verify_password
from app.core.time import now

router = APIRouter(prefix="/api/auth/admin", tags=["admin auth"])

COOKIE_PATH = "/api/auth/admin"
CHALLENGE_COOKIE = "nm7_2fa"
TRUST_COOKIE = "nm7_trust"
CHALLENGE_TTL = timedelta(minutes=5)
TRUST_TTL = timedelta(days=30)
CHALLENGE_MAX_ATTEMPTS = 5

BAD_LOGIN = ApiError(401, "invalid_credentials", "Email or password is wrong.")
BAD_CODE = ApiError(400, "invalid_code", "That code is wrong. Use the 6-digit code from your authenticator app.")
NO_CHALLENGE = ApiError(400, "no_challenge", "Your sign-in timed out. Enter your email and password again.")


class AdminLoginIn(CamelModel):
    email: EmailStr
    password: str = Field(max_length=200)


class AdminVerifyIn(CamelModel):
    code: str = Field(max_length=20)
    trust: bool = False


class AdminLoginOut(CamelModel):
    status: Literal["code_required", "signed_in"]
    user: UserOut | None = None


async def _trusted(db: DB, request: Request, user: User) -> bool:
    token = request.cookies.get(TRUST_COOKIE)
    if not token:
        return False
    found = await db[TRUSTED_DEVICES].find_one(
        {"token_hash": hash_token(token), "user_id": user.id, "revoked_at": None, "expires_at": {"$gt": now()}},
        projection={"_id": 1},
    )
    return found is not None


@router.post("/login")
async def admin_login(body: AdminLoginIn, request: Request, response: Response, db: DB) -> AdminLoginOut:
    ip = client_ip(request)
    keys = [f"admin-{k}" for k in login_keys(body.email, ip)]
    await rate_limit.check(db, keys[0], [LOGIN_FAIL_EMAIL])
    if len(keys) > 1:
        await rate_limit.check(db, keys[1], [LOGIN_FAIL_IP])

    user = await find_user(db, body.email)
    ok = await verify_password(user.password_hash if user else None, body.password)
    if not ok or not user or user.role != "admin" or user.disabled_at:
        await rate_limit.record(db, *keys)
        if user and user.role == "admin":
            await audit(db, user.id, "admin.login_failed", data={"step": "password"}, ip=ip)
        raise BAD_LOGIN
    require_two_step_set_up(user)
    await rate_limit.clear(db, keys[0])

    if await _trusted(db, request, user):
        await audit(db, user.id, "admin.login", data={"via": "trusted_device"}, ip=ip)
        await start_session(db, request, response, user, two_step=True)
        return AdminLoginOut(status="signed_in", user=UserOut.model_validate(user))

    token = new_token()
    challenge = AdminChallenge(user_id=user.id, token_hash=hash_token(token), expires_at=now() + CHALLENGE_TTL)
    await db[ADMIN_CHALLENGES].insert_one(challenge.to_mongo())
    set_cookie(response, CHALLENGE_COOKIE, token, CHALLENGE_TTL, path=COOKIE_PATH)
    return AdminLoginOut(status="code_required")


@router.post("/verify")
async def admin_verify(body: AdminVerifyIn, request: Request, response: Response, db: DB) -> AdminLoginOut:
    token = request.cookies.get(CHALLENGE_COOKIE)
    if not token:
        raise NO_CHALLENGE
    live = {
        "token_hash": hash_token(token),
        "used_at": None,
        "expires_at": {"$gt": now()},
        "attempts": {"$lt": CHALLENGE_MAX_ATTEMPTS},
    }
    challenge = AdminChallenge.load(await db[ADMIN_CHALLENGES].find_one(live))
    if challenge is None:
        raise NO_CHALLENGE
    user = User.load(await db[USERS].find_one({"_id": challenge.user_id, "disabled_at": None}))
    if user is None:
        raise NO_CHALLENGE

    ip = client_ip(request)
    code = body.code.strip().replace(" ", "")
    via = (
        "totp"
        if await claim_totp(db, user, code)
        else "recovery_code"
        if await use_recovery_code(db, user, code)
        else None
    )
    if via is None:
        await db[ADMIN_CHALLENGES].update_one({"_id": challenge.id}, {"$inc": {"attempts": 1}})
        await audit(db, user.id, "admin.login_failed", data={"step": "code"}, ip=ip)
        raise BAD_CODE

    # Use the challenge up atomically (a second request with the same cookie gets nothing).
    if await db[ADMIN_CHALLENGES].find_one_and_update(live, {"$set": {"used_at": now()}}) is None:
        raise NO_CHALLENGE
    await audit(db, user.id, "admin.login", data={"via": via, "trust": body.trust}, ip=ip)
    if body.trust:
        device_token = new_token()
        device = TrustedDevice(
            user_id=user.id,
            token_hash=hash_token(device_token),
            expires_at=now() + TRUST_TTL,
            ip=ip,
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        )
        await db[TRUSTED_DEVICES].insert_one(device.to_mongo())
        set_cookie(response, TRUST_COOKIE, device_token, TRUST_TTL, path=COOKIE_PATH)
    await start_session(db, request, response, user, two_step=True)
    clear_cookie(response, CHALLENGE_COOKIE, path=COOKIE_PATH)
    return AdminLoginOut(status="signed_in", user=UserOut.model_validate(user))


@router.post("/forget-device")
async def forget_device(request: Request, response: Response, db: DB) -> Ok:
    """Stop trusting this browser (the next admin sign-in asks for the code again)."""
    token = request.cookies.get(TRUST_COOKIE)
    if token:
        device = await db[TRUSTED_DEVICES].find_one_and_update(
            {"token_hash": hash_token(token), "revoked_at": None}, {"$set": {"revoked_at": now()}}
        )
        if device:
            await audit(db, device["user_id"], "admin.device_forgotten", ip=client_ip(request))
    clear_cookie(response, TRUST_COOKIE, path=COOKIE_PATH)
    return Ok()
