"""Sign-up, email verification, login, logout and password reset for customers and experts."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.exc import IntegrityError

from app.auth import emails
from app.auth.deps import CurrentAuth, MaybeAuth
from app.auth.models import User
from app.auth.schemas import EmailCodeIn, EmailIn, LoginIn, Ok, ResetIn, SignupIn, SignupOut, UserOut
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
from app.core.db import DB
from app.core.email import Mailer, get_mailer, send_safely
from app.core.errors import ApiError
from app.core.security import hash_password, needs_rehash, verify_password
from app.core.time import now

router = APIRouter(prefix="/api/auth", tags=["auth"])
MailerDep = Annotated[Mailer, Depends(get_mailer)]

EMAIL_TAKEN = ApiError(409, "email_taken", "An account with this email already exists — sign in instead.")


@router.post("/signup", status_code=201)
async def signup(body: SignupIn, request: Request, db: DB, mailer: MailerDep) -> SignupOut:
    name = " ".join(body.name.split())
    if not name:
        raise ApiError(400, "name_required", "Enter your name.")
    check_new_password(body.password, body.password_confirm)
    if not body.terms_accepted:
        raise ApiError(400, "terms_required", "Please accept the Terms and Privacy Policy.")
    phone = normalize_phone(body.phone)

    user = await find_user(db, body.email)
    if user and (user.verified or user.role == "admin"):
        raise EMAIL_TAKEN
    await may_send_code(db, body.email)

    fields = dict(
        role=body.role,
        name=name,
        phone=phone,
        password_hash=await hash_password(body.password),
        terms_accepted_at=now(),
        expert_status="draft" if body.role == "expert" else None,
    )
    if user:  # never verified (e.g. a typo in the first try) — the email owner still has to confirm the code
        for k, v in fields.items():
            setattr(user, k, v)
    else:
        user = User(email=body.email.strip(), **fields)
        db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        raise EMAIL_TAKEN from None
    code = await issue_code(db, user, "verify_email", client_ip(request))
    await db.commit()
    sent = await send_safely(mailer, emails.verify_email(user.email, user.name, code))
    return SignupOut(email=user.email, code_sent=sent)


@router.post("/verify-email")
async def verify_email(body: EmailCodeIn, request: Request, response: Response, db: DB) -> UserOut:
    user = await find_user(db, body.email)
    if not user or user.verified or user.disabled_at or not await check_code(db, user, "verify_email", body.code):
        raise INVALID_CODE
    user.email_verified_at = now()
    await start_session(db, request, response, user)
    return UserOut.model_validate(user)


@router.post("/verify-email/resend")
async def resend_verification(body: EmailIn, request: Request, db: DB, mailer: MailerDep) -> Ok:
    await may_send_code(db, body.email)
    user = await find_user(db, body.email)
    code = None
    if user and not user.verified and not user.disabled_at:
        code = await issue_code(db, user, "verify_email", client_ip(request))
    await db.commit()
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
        await db.commit()
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
        await db.commit()
        if code:
            await send_safely(mailer, emails.verify_email(user.email, user.name, code))
        raise ApiError(403, "email_not_verified", "Please confirm your email first — we’ve sent you a code.")

    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    await rate_limit.clear(db, keys[0])
    await start_session(db, request, response, user)
    return UserOut.model_validate(user)


@router.post("/password/forgot")
async def forgot_password(body: EmailIn, request: Request, db: DB, mailer: MailerDep) -> Ok:
    """Always answers OK, so it can't be used to find out who has an account."""
    await may_send_code(db, body.email)
    user = await find_user(db, body.email)
    code = None
    if user and user.role != "admin" and not user.disabled_at:  # admins reset from the command line
        code = await issue_code(db, user, "reset_password", client_ip(request))
    await db.commit()
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
    await revoke_all(db, user.id)  # sign out everywhere
    await db.commit()
    return Ok()


@router.post("/logout")
async def logout(auth: MaybeAuth, response: Response, db: DB) -> Ok:
    if auth:
        auth.session.revoked_at = now()
        await db.commit()
    clear_cookie(response, SESSION_COOKIE)
    return Ok()


@router.get("/me")
async def me(auth: CurrentAuth) -> UserOut:
    return UserOut.model_validate(auth.user)
