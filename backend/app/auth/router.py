"""Sign-up, email verification, login, logout and password reset for customers and experts."""

from fastapi import APIRouter, Request, Response
from pymongo.errors import DuplicateKeyError

from app.auth import emails
from app.auth.deps import CurrentAuth, MaybeAuth
from app.auth.models import User
from app.auth.schemas import ChangePasswordIn, EmailCodeIn, EmailIn, LoginIn, Ok, ResetIn, SignupIn, SignupOut, UserOut
from app.auth.service import (
    INVALID_CODE,
    LOGIN_FAIL_EMAIL,
    LOGIN_FAIL_IP,
    check_code,
    check_new_password,
    find_user,
    issue_code,
    login_keys,
    may_send_code,
    normalize_phone,
)
from app.auth.sessions import SESSION_COOKIE, clear_cookie, client_ip, revoke_all, start_session
from app.core import rate_limit
from app.core.db import DB, SESSIONS, USERS
from app.core.email import MailerDep, require_email, send_safely
from app.core.errors import ApiError
from app.core.security import hash_password, needs_rehash, verify_password
from app.core.time import now

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _already_registered(db, mailer, user: User) -> SignupOut:
    """Sign-up with an email that already has an account answers exactly like a fresh sign-up ("code sent"), so the
    page can't be used to find out who has an account. The account's owner gets a short reminder instead of a code
    (under the same per-email send limit)."""
    await may_send_code(db, user.email)
    sent = await send_safely(mailer, emails.account_exists(user.email, user.name))
    return SignupOut(email=user.email, code_sent=sent)


@router.post("/signup", status_code=201)
async def signup(body: SignupIn, request: Request, db: DB, mailer: MailerDep) -> SignupOut:
    require_email(mailer)  # 503 rather than claim a code was sent
    name = " ".join(body.name.split())
    if not name:
        raise ApiError(400, "name_required", "Enter your name.")
    check_new_password(body.password, body.password_confirm)
    if not body.terms_accepted:
        raise ApiError(400, "terms_required", "Please accept the Terms and Privacy Policy.")
    phone = normalize_phone(body.phone)

    user = await find_user(db, body.email)
    if user and (user.verified or user.role == "admin"):
        return await _already_registered(db, mailer, user)
    await may_send_code(db, body.email)

    fields = dict(
        role=body.role,
        name=name,
        phone=phone,
        password_hash=await hash_password(body.password),
        terms_accepted_at=now(),
        expert_status="draft" if body.role == "expert" else None,
    )
    if body.ref and body.role == "customer":
        friend = await db[USERS].find_one({"referral_code": body.ref.strip().upper()}, {"_id": 1})
        if friend and (not user or friend["_id"] != user.id):
            fields["referred_by"] = friend["_id"]
    if user:  # never verified (e.g. a typo in the first try) — the email owner still has to confirm the code
        await db[USERS].update_one({"_id": user.id}, {"$set": {**fields, "updated_at": now()}})
        user = user.model_copy(update=fields)
    else:
        user = User(email=body.email.strip(), **fields)
        try:
            await db[USERS].insert_one(user.to_mongo())
        except DuplicateKeyError:  # the same address signed up at the same moment
            existing = await find_user(db, body.email)
            if existing is None:
                raise ApiError(409, "exists", "Please try again.") from None
            return await _already_registered(db, mailer, existing)
    code = await issue_code(db, user, "verify_email", client_ip(request))
    sent = await send_safely(mailer, emails.verify_email(user.email, user.name, code))
    return SignupOut(email=user.email, code_sent=sent)


@router.post("/verify-email")
async def verify_email(body: EmailCodeIn, request: Request, response: Response, db: DB) -> UserOut:
    user = await find_user(db, body.email)
    if not user or user.verified or user.disabled_at or not await check_code(db, user, "verify_email", body.code):
        raise INVALID_CODE
    user.email_verified_at = now()
    await db[USERS].update_one({"_id": user.id}, {"$set": {"email_verified_at": user.email_verified_at}})
    await start_session(db, request, response, user)
    return UserOut.model_validate(user)


@router.post("/verify-email/resend")
async def resend_verification(body: EmailIn, request: Request, db: DB, mailer: MailerDep) -> Ok:
    require_email(mailer)  # 503 rather than claim a code was sent
    await may_send_code(db, body.email)
    user = await find_user(db, body.email)
    code = None
    if user and not user.verified and not user.disabled_at:
        code = await issue_code(db, user, "verify_email", client_ip(request))
    if user and code:
        await send_safely(mailer, emails.verify_email(user.email, user.name, code))
    return Ok()


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: DB, mailer: MailerDep) -> UserOut:
    keys = login_keys(body.email, client_ip(request))
    await rate_limit.check(db, keys[0], [LOGIN_FAIL_EMAIL])
    if len(keys) > 1:
        await rate_limit.check(db, keys[1], [LOGIN_FAIL_IP])

    user = await find_user(db, body.email)
    if not await verify_password(user.password_hash if user else None, body.password):
        await rate_limit.record(db, *keys)
        raise ApiError(401, "invalid_credentials", "Email or password is wrong.")
    assert user is not None
    if user.disabled_at:
        raise ApiError(403, "account_disabled", "This account is turned off. Write to info@nm7.si.")
    if user.role == "admin":
        raise ApiError(403, "use_admin_login", "Admins sign in at /admin/login (with two-step login).")
    if not user.verified:
        code = None
        if await may_send_code(db, user.email, raise_if_limited=False):
            code = await issue_code(db, user, "verify_email", client_ip(request))
        if code:
            await send_safely(mailer, emails.verify_email(user.email, user.name, code))
        raise ApiError(403, "email_not_verified", "Please confirm your email first — we’ve sent you a code.")

    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
        await db[USERS].update_one({"_id": user.id}, {"$set": {"password_hash": user.password_hash}})
    await rate_limit.clear(db, keys[0])
    await start_session(db, request, response, user)
    return UserOut.model_validate(user)


@router.post("/password/forgot")
async def forgot_password(body: EmailIn, request: Request, db: DB, mailer: MailerDep) -> Ok:
    """Always answers OK, so it can't be used to find out who has an account."""
    require_email(mailer)  # 503 rather than claim a code was sent
    await may_send_code(db, body.email)
    user = await find_user(db, body.email)
    code = None
    if user and user.role != "admin" and not user.disabled_at:  # admins reset from the command line
        code = await issue_code(db, user, "reset_password", client_ip(request))
    if user and code:
        await send_safely(mailer, emails.reset_password(user.email, user.name, code))
    return Ok()


@router.post("/password/reset")
async def reset_password(body: ResetIn, db: DB) -> Ok:
    check_new_password(body.password, body.password_confirm)
    user = await find_user(db, body.email)
    if not user or user.role == "admin" or user.disabled_at:
        raise INVALID_CODE
    if not await check_code(db, user, "reset_password", body.code):
        raise INVALID_CODE
    user.password_hash = await hash_password(body.password)
    user.email_verified_at = user.email_verified_at or now()  # the code proved they own the email
    await db[USERS].update_one(
        {"_id": user.id},
        {
            "$set": {
                "password_hash": user.password_hash,
                "email_verified_at": user.email_verified_at,
                "updated_at": now(),
            }
        },
    )
    await revoke_all(db, user.id)  # sign out everywhere
    return Ok()


@router.post("/password/change")
async def change_password(body: ChangePasswordIn, auth: CurrentAuth, request: Request, db: DB) -> Ok:
    """Signed in: current password + new one twice. Signs out every other browser (this one stays signed in)."""
    user = auth.user
    if user.role == "admin" and not auth.session.two_step:
        raise ApiError(403, "two_step_required", "Finish two-step login first.")
    key = f"pwchange:{user.id}"
    await rate_limit.check(db, key, [LOGIN_FAIL_EMAIL])
    if not await verify_password(user.password_hash, body.current_password):
        await rate_limit.record(db, key)
        raise ApiError(400, "wrong_password", "Your current password is wrong.")
    check_new_password(body.password, body.password_confirm)
    if body.password == body.current_password:
        raise ApiError(400, "same_password", "Choose a password different from your current one.")
    await rate_limit.clear(db, key)
    t = now()
    await db[USERS].update_one(
        {"_id": user.id},
        {"$set": {"password_hash": await hash_password(body.password), "password_changed_at": t, "updated_at": t}},
    )
    await db[SESSIONS].update_many(
        {"user_id": user.id, "_id": {"$ne": auth.session.id}, "revoked_at": None}, {"$set": {"revoked_at": t}}
    )
    return Ok()


@router.post("/logout")
async def logout(auth: MaybeAuth, response: Response, db: DB) -> Ok:
    if auth:
        await db[SESSIONS].update_one({"_id": auth.session.id}, {"$set": {"revoked_at": now()}})
    clear_cookie(response, SESSION_COOKIE)
    return Ok()


@router.get("/me")
async def me(auth: CurrentAuth) -> UserOut:
    return UserOut.model_validate(auth.user)
