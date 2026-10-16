"""Kiosk mode (Nm7 for Organizations, Phase 3A): a tablet or laptop at a job fair where candidates sign in with an
emailed code, consent, answer the group's questions, build a resume step by step and print it.

Staff:   /api/org/{org_id}/kiosks (list, create), …/kiosks/{id}/revoke — coordinators (and the super-admin through
         the portal); viewers only see the list. Needs the organization's `kiosk` feature (else 404).
Kiosk:   /api/kiosk/{token} (what the screen shows; also the heartbeat), …/code (email a 6-digit code), …/verify
         (sign in, creating the account if needed), …/join (consent + answers), …/print (log a print),
         …/send-link (email a one-time "continue on your phone" link), …/exit (check the exit PIN).
Phone:   POST /api/public/continue — the emailed link signs the candidate in on their own device, once.

Kiosk links and exit PINs are stored as keyed hashes only. A link expires (end of today by default, at most 3 days)
or is revoked; either ends it at once, including any candidate still signed in on it (see auth/sessions.py).
Candidates at a kiosk get a short sign-in (45 minutes, never extended) tied to that kiosk.
"""

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import EmailCode, User, new_id
from app.auth.service import CODE_MAX_ATTEMPTS, CODE_TTL, find_user, may_send_code
from app.auth.sessions import client_ip, revoke_all, start_session
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, DB, EMAIL_CODES, KIOSKS, MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, USERS
from app.core.email import MailerDep, require_email, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_password, keyed_hash, new_code, new_token, same
from app.core.time import IST, now
from app.me.service import ms
from app.orgs import emails
from app.orgs.branding import brands_for
from app.orgs.router import JoinIn, _join
from app.orgs.scope import NOT_FOUND, OrgScope, require_feature
from app.orgs.service import ORG_TYPE_NAMES, consent_text, group_problem

staff = APIRouter(prefix="/api/org/{org_id}/kiosks", tags=["kiosk"])
kiosk = APIRouter(prefix="/api/kiosk/{token}", tags=["kiosk"])
cont = APIRouter(prefix="/api/public/continue", tags=["kiosk"])

MAX_DAYS = 3
ACTIVE_FOR = timedelta(minutes=3)  # the kiosk screen checks in every minute
CONTINUE_TTL = timedelta(hours=24)
KIOSK_RULES = [(600, timedelta(hours=1))]  # every call to one kiosk link (a busy stall, with the heartbeat)
KIOSK_CODE_RULES = [(120, timedelta(hours=1))]  # codes emailed from one kiosk
KIOSK_VERIFY_RULES = [(200, timedelta(hours=1))]
EXIT_RULES = [(5, timedelta(minutes=15))]  # wrong exit PINs per kiosk
CREATE_RULES = [(30, timedelta(hours=1))]
SEND_LINK_RULES = [(3, timedelta(hours=1))]  # "continue on my phone" emails per account
GONE = ApiError(410, "kiosk_ended", "This kiosk link has ended. Ask the organizer for a new one.")
CODE_WRONG = ApiError(400, "invalid_code", "That code is wrong or expired.")


# ---------- models ----------
class KioskIn(CamelModel):
    group_id: str = Field(max_length=64)
    label: str = Field(min_length=1, max_length=40)
    expires_on: date | None = None  # the link works until the end of this day (India time); default today
    pin: str = Field(pattern=r"^\d{4,6}$")

    @field_validator("label")
    @classmethod
    def _label(cls, v):
        v = " ".join(v.split())
        if not v:
            raise ValueError("label required")
        return v


class EmailIn(CamelModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return v.strip()


class VerifyIn(EmailIn):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")
    name: str = Field("", max_length=80)
    terms: bool = False


class KioskJoinIn(CamelModel):
    consent: bool = False
    fields: dict[str, Any] = Field(default_factory=dict)
    resume_id: str = Field(max_length=64)


class PinIn(CamelModel):
    pin: str = Field(max_length=6)


class TokenIn(CamelModel):
    token: str = Field(max_length=200)


# ---------- helpers ----------
def _token_hash(token: str) -> str:
    return keyed_hash("kiosk", token)


def _pin_hash(kiosk_id: str, pin: str) -> str:
    return keyed_hash("kiosk-pin", kiosk_id, pin)


def _today_start() -> datetime:
    return datetime.combine(now().astimezone(IST).date(), time.min, IST)


def _expiry(on: date | None) -> datetime:
    """The end of `on` (India time). Today by default; at most 3 days (today and the next two)."""
    today = now().astimezone(IST).date()
    on = on or today
    if on < today:
        raise ApiError(400, "bad_expiry", "The kiosk can’t end before today.")
    if on > today + timedelta(days=MAX_DAYS - 1):
        raise ApiError(400, "bad_expiry", f"A kiosk link works for at most {MAX_DAYS} days.")
    return datetime.combine(on, time(23, 59, 59), IST)


def _state(k: dict[str, Any]) -> str:
    if k.get("revoked_at"):
        return "revoked"
    if k["expires_at"] <= now():
        return "expired"
    seen = k.get("last_seen_at")
    return "active" if seen and now() - seen < ACTIVE_FOR else "idle"


async def _stats(db, ids: list[str]) -> dict[str, dict[str, int]]:
    """Sign-ins and prints today (India time), per kiosk, from the audit log."""
    out: dict[str, dict[str, int]] = {i: {"sessions": 0, "prints": 0} for i in ids}
    pipeline = [
        {"$match": {"target": {"$in": ids}, "action": {"$in": ["kiosk_session", "kiosk_print"]}}},
        {"$match": {"at": {"$gte": _today_start()}}},
        {"$group": {"_id": {"t": "$target", "a": "$action"}, "n": {"$sum": 1}}},
    ]
    async for c in await db[AUDIT_LOG].aggregate(pipeline):
        out[c["_id"]["t"]]["sessions" if c["_id"]["a"] == "kiosk_session" else "prints"] = c["n"]
    return out


def kiosk_out(k: dict[str, Any], group_name: str = "", stats: dict[str, int] | None = None) -> dict[str, Any]:
    return {
        "id": k["_id"],
        "groupId": k["group_id"],
        "groupName": group_name,
        "label": k["label"],
        "expiresAt": ms(k["expires_at"]),
        "createdAt": ms(k["created_at"]),
        "lastSeenAt": ms(k.get("last_seen_at")),
        "state": _state(k),
        "sessionsToday": (stats or {}).get("sessions", 0),
        "printsToday": (stats or {}).get("prints", 0),
    }


async def _org_with_kiosk(db, org_id: str) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    require_feature(o, "kiosk")
    return o


# ---------- staff: create, list, revoke ----------
@staff.get("")
async def list_kiosks(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    await _org_with_kiosk(db, scope.org_id)
    match: dict[str, Any] = {"org_id": scope.org_id}
    if scope.group_ids is not None:
        match["group_id"] = {"$in": scope.group_ids}
    rows = await db[KIOSKS].find(match).sort("created_at", -1).limit(200).to_list(None)
    names = {
        g["_id"]: g["name"]
        async for g in db[ORG_GROUPS].find({"_id": {"$in": list({k["group_id"] for k in rows})}}, {"name": 1})
    }
    stats = await _stats(db, [k["_id"] for k in rows])
    return [kiosk_out(k, names.get(k["group_id"], ""), stats.get(k["_id"])) for k in rows]


@staff.post("", status_code=201)
async def create_kiosk(body: KioskIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    """A new kiosk link for one group. The link (with its secret token) is shown once, here."""
    await _org_with_kiosk(db, scope.org_id)
    g = await scope.group(db, body.group_id)
    scope.require("manage")
    key = f"kiosk-create:{scope.actor_id}"
    await rate_limit.check(db, key, CREATE_RULES)
    await rate_limit.record(db, key)
    token = new_token()
    kid = new_id()
    k = {
        "_id": kid,
        "org_id": scope.org_id,
        "group_id": g["_id"],
        "label": body.label,
        "token_hash": _token_hash(token),
        "pin_hash": _pin_hash(kid, body.pin),
        "expires_at": _expiry(body.expires_on),
        "revoked_at": None,
        "last_seen_at": None,
        "created_by": scope.actor_id,
        "created_at": now(),
    }
    await db[KIOSKS].insert_one(k)
    until = k["expires_at"].astimezone(IST).date().isoformat()
    data = scope.audit_data(group=g["_id"], label=body.label, expires=until)
    await audit(db, scope.actor_id, "kiosk_create", target=kid, data=data, ip=client_ip(request))
    return {**kiosk_out(k, g["name"]), "url": f"{get_settings().site_url}/kiosk/{token}"}


@staff.post("/{kiosk_id}/revoke")
async def revoke_kiosk(kiosk_id: str, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    """Ends the link at once: the screen shows "ended" on its next check and anyone signed in there is signed out."""
    await _org_with_kiosk(db, scope.org_id)
    k = await db[KIOSKS].find_one({"_id": kiosk_id, "org_id": scope.org_id})
    g = k and await db[ORG_GROUPS].find_one({"_id": k["group_id"]})
    if not k or not scope.allows_group(g):
        raise NOT_FOUND
    scope.require("manage")
    if not k.get("revoked_at"):
        k["revoked_at"] = now()
        await db[KIOSKS].update_one({"_id": kiosk_id}, {"$set": {"revoked_at": k["revoked_at"]}})
        await audit(db, scope.actor_id, "kiosk_revoke", target=kiosk_id, data=scope.audit_data(), ip=client_ip(request))
    return kiosk_out(k, g["name"])


# ---------- the kiosk screen ----------
async def _kiosk(db, token: str, request: Request, *, seen: bool = False) -> tuple[dict, dict, dict]:
    """The live kiosk behind a link, its group and organization. Unknown or switched off: 404; ended: 410."""
    if len(token) > 100:
        raise NOT_FOUND
    th = _token_hash(token)
    key = f"kiosk:{th[:24]}"
    await rate_limit.check(db, key, KIOSK_RULES)
    await rate_limit.record(db, key)
    k = await db[KIOSKS].find_one({"token_hash": th})
    if not k:
        raise NOT_FOUND
    o = await db[ORGANIZATIONS].find_one({"_id": k["org_id"]})
    require_feature(o, "kiosk")
    if k.get("revoked_at") or k["expires_at"] <= now() or o.get("status") == "archived":
        raise GONE
    g = await db[ORG_GROUPS].find_one({"_id": k["group_id"]})
    if not g:
        raise GONE
    if seen:
        await db[KIOSKS].update_one({"_id": k["_id"]}, {"$set": {"last_seen_at": now()}})
    return k, g, o


def _signed_in_here(auth: CustomerAuth, k: dict[str, Any]) -> None:
    if auth.session.kiosk_id != k["_id"]:
        raise ApiError(401, "not_signed_in", "Please sign in at this kiosk first.")


@kiosk.get("")
async def kiosk_info(token: str, request: Request, db: DB) -> dict[str, Any]:
    """What the welcome screen shows. Called again every minute (the coordinator sees the kiosk as active)."""
    k, g, o = await _kiosk(db, token, request, seen=True)
    count = await db[MEMBERSHIPS].count_documents({"group_id": g["_id"], "left_at": None})
    problem = group_problem(g, o, count)
    brand = (await brands_for(db, [g["_id"]])).get(g["_id"])
    return {
        "kioskId": k["_id"],
        "label": k["label"],
        "expiresAt": ms(k["expires_at"]),
        "org": {"name": o["name"], "typeName": ORG_TYPE_NAMES.get(o["type"], ""), "logoUrl": o.get("logo_url", "")},
        "group": {
            "name": g["name"],
            "customFields": g.get("custom_fields", []),
            "requireApproval": g.get("settings", {}).get("require_approval", False),
        },
        "consentText": consent_text(o["name"]),
        "closed": problem[1] if problem else None,  # joining is closed: candidates can still build and print
        "brand": brand,  # Print now uses the organization's template when the group prints branded
    }


def _code_owner(email: str) -> str:
    return f"kiosk:{email.strip().lower()}"  # codes are tied to the address: the account may not exist yet


def _code_hash(email: str, code: str) -> str:
    return keyed_hash("kiosk-code", email.strip().lower(), code.strip())


@kiosk.post("/code")
async def send_code(token: str, body: EmailIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    """Emails a 6-digit code (10 minutes, 5 tries). Any earlier code for the address stops working."""
    require_email(mailer)
    k, g, o = await _kiosk(db, token, request)
    key = f"kiosk-code:{k['_id']}"
    await rate_limit.check(db, key, KIOSK_CODE_RULES)
    user = await find_user(db, body.email)
    if user and user.role != "customer":
        raise ApiError(403, "not_customer", "This email belongs to an Nm7 staff or expert account. Use your own email.")
    if user and user.disabled_at:
        raise ApiError(403, "account_disabled", "This account is turned off. Write to info@nm7.si.")
    await may_send_code(db, body.email)  # 1 a minute, 5 an hour per address
    await rate_limit.record(db, key)
    owner = _code_owner(body.email)
    old = {"user_id": owner, "purpose": "kiosk", "used_at": None}
    await db[EMAIL_CODES].update_many(old, {"$set": {"used_at": now()}})
    code = new_code()
    doc = EmailCode(
        user_id=owner,
        purpose="kiosk",
        code_hash=_code_hash(body.email, code),
        expires_at=now() + CODE_TTL,
        ip=client_ip(request),
    )
    await db[EMAIL_CODES].insert_one(doc.to_mongo())
    sent = await send_safely(mailer, emails.kiosk_code(body.email, code, o["name"], g["name"]))
    return {"sent": sent, "newAccount": user is None}


async def _use_code(db, email: str, code: str) -> bool:
    """Same rules as sign-up codes: one use, 10 minutes, 5 wrong tries (each update is atomic)."""
    live = {
        "user_id": _code_owner(email),
        "purpose": "kiosk",
        "used_at": None,
        "expires_at": {"$gt": now()},
        "attempts": {"$lt": CODE_MAX_ATTEMPTS},
    }
    if await db[EMAIL_CODES].find_one_and_update(
        {**live, "code_hash": _code_hash(email, code)}, {"$set": {"used_at": now()}}
    ):
        return True
    await db[EMAIL_CODES].update_one(live, {"$inc": {"attempts": 1}})
    return False


@kiosk.post("/verify")
async def verify(token: str, body: VerifyIn, request: Request, response: Response, db: DB) -> dict[str, Any]:
    """The code is right: sign in (the code proves the email), creating a free account when there's none yet."""
    k, g, o = await _kiosk(db, token, request)
    key = f"kiosk-verify:{k['_id']}"
    await rate_limit.check(db, key, KIOSK_VERIFY_RULES)
    await rate_limit.record(db, key)
    user = await find_user(db, body.email)
    name = " ".join(body.name.split())
    if user is None:  # checked before the code is used, so a missing name doesn't cost a new code
        if not name:
            raise ApiError(400, "name_required", "Enter your name.")
        if not body.terms:
            raise ApiError(400, "terms_required", "Please accept the Terms and Privacy Policy.")
    if not await _use_code(db, body.email, body.code):
        raise CODE_WRONG
    created = False
    if user is None:
        t = now()
        # no password at a kiosk: an unguessable one; "Forgot password" (or the emailed link) gets them back in
        user = User(
            email=body.email,
            name=name,
            role="customer",
            password_hash=await hash_password(new_token()),
            email_verified_at=t,
            terms_accepted_at=t,
        )
        try:
            await db[USERS].insert_one(user.to_mongo())
            created = True
        except DuplicateKeyError:
            user = await find_user(db, body.email)
    if not user or user.role != "customer" or user.disabled_at:
        raise CODE_WRONG
    if not user.email_verified_at:  # signed up earlier but never confirmed: whoever chose that password didn't
        user.email_verified_at = now()  # prove the address, so it stops working (no account pre-hijacking)
        sets = {"email_verified_at": user.email_verified_at, "password_hash": await hash_password(new_token())}
        await db[USERS].update_one({"_id": user.id}, {"$set": sets})
        await revoke_all(db, user.id)
    await start_session(db, request, response, user, kiosk_id=k["_id"])
    data = {"orgs": [o["_id"]], "group": g["_id"], "newAccount": created}
    await audit(db, user.id, "kiosk_session", target=k["_id"], data=data, ip=client_ip(request))
    m = await db[MEMBERSHIPS].find_one({"user_id": user.id, "group_id": g["_id"], "left_at": None})
    return {
        "name": user.name,
        "email": user.email,
        "newAccount": created,
        "membership": {"resumeId": m.get("resume_id"), "approval": m.get("approval") or "approved"} if m else None,
    }


@kiosk.post("/join", status_code=201)
async def kiosk_join(token: str, body: KioskJoinIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    """Consent and answers: the same join as the group's link (approval groups: Pending), logged as a kiosk join."""
    k, g, _ = await _kiosk(db, token, request)
    _signed_in_here(auth, k)
    jb = JoinIn(code=g["code"], consent=body.consent, fields=body.fields, resume_id=body.resume_id)
    return await _join(jb, request, auth, db, via={"kiosk": k["_id"]})


@kiosk.post("/print")
async def kiosk_print(token: str, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    """The candidate printed their own copy (always allowed, even while Pending). Logged only."""
    k, g, o = await _kiosk(db, token, request)
    _signed_in_here(auth, k)
    data = {"orgs": [o["_id"]], "group": g["_id"]}
    await audit(db, auth.user.id, "kiosk_print", target=k["_id"], data=data, ip=client_ip(request))
    return {"ok": True}


@kiosk.post("/send-link")
async def send_link(token: str, request: Request, db: DB, mailer: MailerDep, auth: CustomerAuth) -> dict[str, Any]:
    """Emails a one-time link (24 hours) that signs the candidate in on their own phone to keep going."""
    require_email(mailer)
    k, g, o = await _kiosk(db, token, request)
    _signed_in_here(auth, k)
    key = f"kiosk-link:{auth.user.id}"
    await rate_limit.check(db, key, SEND_LINK_RULES, "We’ve already emailed you a link. Please check your inbox.")
    await rate_limit.record(db, key)
    link = new_token()
    doc = EmailCode(
        user_id=auth.user.id,
        purpose="continue",
        code_hash=keyed_hash("continue", link),
        expires_at=now() + CONTINUE_TTL,
        ip=client_ip(request),
    )
    await db[EMAIL_CODES].insert_one(doc.to_mongo())
    url = f"{get_settings().site_url}/continue?t={link}"
    sent = await send_safely(mailer, emails.kiosk_continue(auth.user.email, auth.user.name, url, o["name"]))
    return {"sent": sent}


@kiosk.post("/exit")
async def exit_kiosk(token: str, body: PinIn, request: Request, db: DB) -> dict[str, Any]:
    """Checks the exit PIN (5 wrong tries per 15 minutes per kiosk)."""
    k, _, _ = await _kiosk(db, token, request)
    key = f"kiosk-exit:{k['_id']}"
    await rate_limit.check(db, key, EXIT_RULES, "Too many wrong PINs. Please wait 15 minutes.")
    if not same(_pin_hash(k["_id"], body.pin.strip()), k["pin_hash"]):
        await rate_limit.record(db, key)
        raise ApiError(400, "wrong_pin", "That PIN is wrong.")
    await rate_limit.clear(db, key)
    return {"ok": True}


# ---------- continue on the phone ----------
@cont.post("")
async def continue_here(body: TokenIn, request: Request, response: Response, db: DB) -> dict[str, Any]:
    key = f"continue:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(30, timedelta(hours=1))])
    await rate_limit.record(db, key)
    used = await db[EMAIL_CODES].find_one_and_update(
        {
            "purpose": "continue",
            "code_hash": keyed_hash("continue", body.token.strip()),
            "used_at": None,
            "expires_at": {"$gt": now()},
        },
        {"$set": {"used_at": now()}},
    )
    u = used and User.load(await db[USERS].find_one({"_id": used["user_id"], "disabled_at": None}))
    if not u or u.role != "customer":
        raise ApiError(404, "link_invalid", "This link was already used or has expired. Sign in instead.")
    await start_session(db, request, response, u)
    return {"ok": True}
