# ruff: noqa: E501  (the plain-language data-type line)
"""Sign in / sign up with Google, and connecting or removing Google in Settings (customers and experts).

  POST   /api/auth/google        {credential, role?, ref?, next?}  → UserOut + isNew (signed in)
  POST   /api/auth/google/link   {credential}   signed in: connect this Google account
  DELETE /api/auth/google                       signed in: remove it (only while a password is set)

It is the same account system as email sign-up (router.py): the same users, sessions, roles and onboarding. Google
only stands in for the emailed code (it has already proven the person owns the address) and, once connected, for
the password. Which account a Google sign-in opens:
1. the account already connected to this Google account (`google.sub`);
2. else the account with that email: Google is connected to it (no second account). If it was never confirmed, it
   counts as confirmed now (Google said email_verified) and any password typed at that unconfirmed sign-up is removed,
   because whoever typed it never proved the address was theirs;
3. else a new account, made by the same code as email sign-up (router.new_account_fields) with the role the page
   sent (customer when none). `isNew` in the answer sends the page to the same step an email sign-up lands on.
   The Trust consents and the under-18 parental check then happen exactly as for an email sign-up (the first time
   the person uses a Trust feature: consent.py / age.py).

Admins never sign in with Google: admin login is email + password + authenticator only (admin_router.py). Any
account with an authenticator set up is refused the same way, so Google can never skip a two-step login.

Stored on the user: google = {sub, email, name, picture, linked_at}. Never a Google token. Nothing about the token is
logged. Removing Google deletes that object; deleting the account deletes it too (app/me/erase.py).
"""

from typing import Any

from fastapi import APIRouter, Request, Response
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth import google
from app.auth.deps import CurrentAuth
from app.auth.models import User
from app.auth.router import new_account_fields
from app.auth.schemas import GoogleIn, GoogleLinkIn, GoogleSignInOut, UserOut
from app.auth.service import CODE_SEND_IP_RULES, LOGIN_FAIL_IP, find_user
from app.auth.sessions import client_ip, revoke_all, start_session
from app.core import rate_limit
from app.core.db import DB, USERS
from app.core.errors import ApiError
from app.core.time import now
from app.trust import retention as R

router = APIRouter(prefix="/api/auth", tags=["auth"])

ADMIN_REFUSED = ApiError(403, "use_admin_login", "Use your password to sign in to admin.")
TWO_STEP_REFUSED = ApiError(
    403, "use_password_login", "This account uses two-step login. Sign in with your email and password."
)
OTHER_GOOGLE = ApiError(
    409,
    "google_other_account",
    "This Nm7 account is connected to a different Google account. Sign in with that one, or with your password.",
)
DEMO_REFUSED = ApiError(403, "demo_account", "Made-up demo and test accounts can’t use Google sign-in.")
GOOGLE_TAKEN = ApiError(409, "google_taken", "This Google account is already connected to another Nm7 account.")
DISABLED_ACCOUNT = ApiError(403, "account_disabled", "This account is turned off. Write to info@nm7.si.")


async def _no_clean(db, cutoff, cap) -> int:
    return 0


async def _kept_with_account(db, uid: str) -> int:
    return 0  # deleted with the account (app/me/erase.py), or at once when the person removes Google


R.register(R.DataType("google_link", "Google sign-in link (Google account ID, email, name, picture link; no Google password or token)",
                      3650, 3650, 3650, clean=_no_clean, erase=_kept_with_account,
                      note="Kept while Google is connected; removed at once when you remove Google, and deleted with the account"))  # fmt: skip


def _link(g: google.GoogleId) -> dict[str, Any]:
    return {"sub": g.sub, "email": g.email, "name": g.name, "picture": g.picture, "linked_at": now()}


def _check_may_sign_in(user: User) -> None:
    if user.disabled_at:
        raise DISABLED_ACCOUNT
    if user.role == "admin" or user.admin_role:
        raise ADMIN_REFUSED
    if user.totp_secret_enc:
        raise TWO_STEP_REFUSED
    if user.demo or user.owner_admin_id:  # demo people, test users, an admin's personas: only Admin opens them
        raise DEMO_REFUSED


async def _connect(db, user: User, g: google.GoogleId, role: str | None) -> User:
    """Google connected to an existing account found by its email (the Google address, which Google verified)."""
    if user.google and user.google.get("sub") != g.sub:
        raise OTHER_GOOGLE
    sets: dict[str, Any] = {"google": _link(g), "updated_at": now()}
    unset: dict[str, str] = {}
    if not user.verified:  # Google proved the address; the unconfirmed sign-up's password did not
        sets |= {"email_verified_at": now(), "password_hash": ""}
        if g.name:
            sets["name"] = g.name
        if role and role != user.role:
            sets |= {"role": role, "expert_status": "draft" if role == "expert" else None}
        unset = {"unverified_expires_at": "", "signup_token_hash": ""}
    q = {"_id": user.id, "$or": [{"google": None}, {"google.sub": g.sub}]}
    try:
        r = await db[USERS].update_one(q, {"$set": sets, **({"$unset": unset} if unset else {})})
    except DuplicateKeyError:
        raise GOOGLE_TAKEN from None
    if r.matched_count != 1:
        raise OTHER_GOOGLE
    if not user.verified:
        await revoke_all(db, user.id)
    await audit(db, user.id, "auth.google_connected", target=user.id, data={"was_verified": user.verified})
    return User.load(await db[USERS].find_one({"_id": user.id}))


async def _create(db, request: Request, body: GoogleIn, g: google.GoogleId) -> User:
    """A new account through the same fields as email sign-up (router.new_account_fields). The role is the one the
    page asked for (customer when none: the sign-up page's default); the Google button carries the same terms line as
    the sign-up form. The email is already confirmed (Google verified it), so there is no code step."""
    ip = client_ip(request)
    if ip:  # the same brake as emailed sign-up codes: one address can't make unlimited accounts
        await rate_limit.check(db, f"google-new-ip:{ip}", CODE_SEND_IP_RULES)
        await rate_limit.record(db, f"google-new-ip:{ip}")
    fields = await new_account_fields(
        db,
        request,
        role=body.role or "customer",
        name=g.name or g.email.split("@")[0][:80],
        email=g.email,
        password_hash="",
        ref=body.ref,
        email_verified_at=now(),
        google=_link(g),
    )
    user = User(email=g.email, **fields)
    try:
        await db[USERS].insert_one(user.to_mongo())
    except DuplicateKeyError:  # the same address or Google account at the same moment
        raise ApiError(409, "exists", "Please try again.") from None
    await audit(db, user.id, "auth.google_signup", target=user.id, data={"role": user.role})
    return user


async def _verified(db, request: Request, credential: str) -> google.GoogleId:
    if not google.enabled():
        raise google.DISABLED
    ip = client_ip(request)
    key = f"google-ip:{ip}" if ip else None
    if key:
        await rate_limit.check(db, key, [LOGIN_FAIL_IP])
    try:
        return await google.verify(credential)
    except ApiError as e:
        if key and e.status == 400:
            await rate_limit.record(db, key)
        raise


@router.post("/google")
async def google_sign_in(body: GoogleIn, request: Request, response: Response, db: DB) -> GoogleSignInOut:
    g = await _verified(db, request, body.credential)
    is_new = False
    user = User.load(await db[USERS].find_one({"google.sub": g.sub}))
    if user is None:
        user = await find_user(db, g.email)
        if user is not None:
            _check_may_sign_in(user)
            is_new = not user.verified  # an unconfirmed sign-up: this is where it really starts
            user = await _connect(db, user, g, body.role)
        else:
            user = await _create(db, request, body, g)
            is_new = True
    _check_may_sign_in(user)
    await start_session(db, request, response, user)
    return GoogleSignInOut.model_validate({**UserOut.model_validate(user).model_dump(), "is_new": is_new})


@router.post("/google/link")
async def google_link(body: GoogleLinkIn, auth: CurrentAuth, request: Request, db: DB) -> UserOut:
    user = auth.user
    if auth.session.view_id:  # inside an admin's view: never give the viewed account a way in of its own
        raise DEMO_REFUSED
    _check_may_sign_in(user)
    g = await _verified(db, request, body.credential)
    if user.google and user.google.get("sub") != g.sub:
        raise ApiError(409, "google_connected", "Remove the connected Google account first.")
    other = await db[USERS].find_one({"google.sub": g.sub, "_id": {"$ne": user.id}}, {"_id": 1})
    if other:
        raise GOOGLE_TAKEN
    sets: dict[str, Any] = {"google": _link(g), "updated_at": now()}
    try:
        r = await db[USERS].update_one(
            {"_id": user.id, "$or": [{"google": None}, {"google.sub": g.sub}]}, {"$set": sets}
        )
    except DuplicateKeyError:
        raise GOOGLE_TAKEN from None
    if r.matched_count != 1:
        raise ApiError(409, "google_connected", "Remove the connected Google account first.")
    await audit(db, user.id, "auth.google_connected", target=user.id, data={"from": "settings"})
    return UserOut.model_validate(User.load(await db[USERS].find_one({"_id": user.id})))


@router.delete("/google")
async def google_unlink(auth: CurrentAuth, db: DB) -> UserOut:
    user = auth.user
    if not user.google:
        raise ApiError(404, "not_connected", "Google isn’t connected to this account.")
    # never remove the last way in: a Google-only account sets a password first (Forgot password sends the code)
    r = await db[USERS].update_one(
        {"_id": user.id, "password_hash": {"$nin": ["", None]}},
        {"$unset": {"google": ""}, "$set": {"updated_at": now()}},
    )
    if r.matched_count != 1:
        raise ApiError(
            400, "set_password_first", "Set a password first, so you can still sign in after removing Google."
        )
    await audit(db, user.id, "auth.google_removed", target=user.id)
    return UserOut.model_validate(User.load(await db[USERS].find_one({"_id": user.id})))
