"""Recruiter accounts (R1; the `recruiter_accounts` feature, Drive and Campus): one account per email address across
colleges, still with an emailed one-time code and no password. Every recruiter invite sent to that address belongs to
it (matched by email, so invites made before accounts existed link up by themselves).

  POST /api/recruiter-account/code {email}           email a sign-in code (only if a college invited that address;
                                                     the answer is the same either way)
  POST /api/recruiter-account/session {email, code}  → {session} (12 hours, sent as X-Recruiter-Account)
  POST /api/recruiter-account/sign-out
  GET  /api/recruiter-account/drives                 "My drives": every college and invite, with counts and notes

Access stays with each college. An account only opens an invite (`/recruiter/i.<invite id>`) while that invite is
active: revoked or expired invites answer 410 at once. Past drives show counts and the recruiter's own notes; student
names on them only when the college allows it (Org → Recruiters → "Show names on past drives"). Sign-ins and every
look at My drives are in each college's Activity log.
"""

import re
import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import AUDIT_LOG, DB, MEMBERSHIPS, OFFERS, ORGANIZATIONS, RECRUITER_INVITES, RECRUITERS, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, new_code, same
from app.core.time import now
from app.me.service import ms
from app.orgs.recruiter import NO_STORE
from app.orgs.scope import features_of

router = APIRouter(prefix="/api/recruiter-account", tags=["recruiter accounts"])

SESSION_HOURS = 12
CODE_MINUTES = 10
CODE_SEND_RULES = [(5, timedelta(days=1))]  # per address
CODE_IP_RULES = [(20, timedelta(hours=1))]
CODE_TRY_RULES = [(8, timedelta(minutes=15))]
STAGES = ("shortlisted", "interview", "selected", "rejected")
SENT = {"sent": True, "message": "If a college invited this address, a sign-in code is on its way."}


class EmailIn(CamelModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return v.strip().lower()


class SessionIn(EmailIn):
    code: str = Field(min_length=4, max_length=10)


def _hash(kind: str, *parts: str) -> str:
    return keyed_hash(f"recruiter-account-{kind}", *parts)


def allowed(o: dict[str, Any] | None) -> bool:
    """Accounts reach this college's invites: the college has recruiter links and recruiter accounts, and isn't
    archived."""
    if not o or o.get("status") == "archived":
        return False
    f = features_of(o)
    return f["recruiter_links"] and f["recruiter_accounts"]


async def _invites(db, email_lc: str) -> list[dict[str, Any]]:
    """This address's invites at colleges that allow accounts (any state), newest first."""
    invites = await db[RECRUITER_INVITES].find({"email_lc": email_lc}).sort("created_at", -1).to_list(500)
    orgs = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({i["org_id"] for i in invites})}})}
    out = []
    for i in invites:
        if allowed(orgs.get(i["org_id"])):
            i["_org"] = orgs[i["org_id"]]
            out.append(i)
    return out


async def issue_session(db, email_lc: str, name: str = "") -> str:
    """A new account session (the account is made on first use). Used after a code sign-in, here or on an invite
    link (the same address was proven either way)."""
    session = secrets.token_urlsafe(32)
    t = now()
    acc = await db[RECRUITERS].find_one({"email_lc": email_lc})
    if not acc:
        acc = {"_id": new_id(), "email_lc": email_lc, "name": name, "sessions": [], "created_at": t}
        try:
            await db[RECRUITERS].insert_one(acc)
        except Exception:  # made at the same moment by another request
            acc = await db[RECRUITERS].find_one({"email_lc": email_lc})
    sessions = [s for s in acc.get("sessions") or [] if s["exp"] > t][-4:]
    sessions.append({"hash": _hash("session", session), "exp": t + timedelta(hours=SESSION_HOURS)})
    sets: dict[str, Any] = {"sessions": sessions, "last_seen_at": t}
    if name and not acc.get("name"):
        sets["name"] = name
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": sets})
    return session


async def account_for(db, session: str | None) -> dict[str, Any] | None:
    """The account behind an X-Recruiter-Account session, or None."""
    if not session or len(session) > 100:
        return None
    h = _hash("session", session)
    acc = await db[RECRUITERS].find_one({"sessions": {"$elemMatch": {"hash": h, "exp": {"$gt": now()}}}})
    return acc


async def _signed_in(db, session: str | None) -> dict[str, Any]:
    acc = await account_for(db, session)
    if not acc:
        raise ApiError(401, "session_required", "Please sign in with the code we email you.")
    return acc


@router.post("/code")
async def send_code(body: EmailIn, request: Request, response: Response, db: DB, mailer: MailerDep) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    ip_key = f"raccount-ip:{keyed_hash('ip', client_ip(request) or '-')[:24]}"
    await rate_limit.check(db, ip_key, CODE_IP_RULES, "Too many codes. Please try again later.")
    await rate_limit.record(db, ip_key)
    invites = await _invites(db, body.email)
    if not invites:
        return SENT  # the same answer: nobody learns which addresses were invited
    key = f"raccount-code:{_hash('email', body.email)[:24]}"
    await rate_limit.check(db, key, CODE_SEND_RULES, "Too many codes today. Please try again tomorrow.")
    await rate_limit.record(db, key)
    code = new_code()
    name = invites[0]["recruiter_name"]
    await db[RECRUITERS].update_one(
        {"email_lc": body.email},
        {
            "$set": {"code_hash": _hash("code", body.email, code), "code_exp": now() + timedelta(minutes=CODE_MINUTES)},
            "$setOnInsert": {"_id": new_id(), "name": name, "sessions": [], "created_at": now()},
        },
        upsert=True,
    )
    text = (
        f"Your Nm7 recruiter sign-in code: {code}\n\nIt works for {CODE_MINUTES} minutes and opens My drives: every "
        "college that invited you. If you didn't ask for it, ignore this email.\n\nNm7 · nm7.si"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px"><p>Your Nm7 recruiter sign-in code:</p>'
        f'<p style="font-size:26px;font-weight:700;letter-spacing:4px">{code}</p><p>It works for {CODE_MINUTES} '
        "minutes and opens My drives: every college that invited you.</p></div>"
    )
    await send_safely(mailer, Email(body.email, name, f"Your sign-in code: {code}", text, html))
    return SENT


@router.post("/session")
async def start_session(body: SessionIn, request: Request, response: Response, db: DB) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    key = f"raccount-try:{_hash('email', body.email)[:24]}"
    await rate_limit.check(db, key, CODE_TRY_RULES, "Too many wrong codes. Please wait 15 minutes.")
    acc = await db[RECRUITERS].find_one({"email_lc": body.email})
    ok = (
        acc
        and acc.get("code_hash")
        and acc.get("code_exp")
        and acc["code_exp"] > now()
        and same(_hash("code", body.email, body.code.strip()), acc["code_hash"])
    )
    if not ok:
        await rate_limit.record(db, key)
        raise ApiError(401, "wrong_code", "That code is wrong or has expired. Ask for a new one.")
    await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"code_hash": None, "code_exp": None}})
    session = await issue_session(db, body.email)
    orgs = sorted({i["org_id"] for i in await _invites(db, body.email)})
    await audit(db, None, "recruiter_account_login", target=acc["_id"], data={"orgs": orgs}, ip=None)
    return {"session": session, "expiresInHours": SESSION_HOURS}


@router.post("/sign-out")
async def sign_out(response: Response, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    acc = await account_for(db, x_recruiter_account)
    if acc:
        keep = [s for s in acc["sessions"] if not same(s["hash"], _hash("session", x_recruiter_account or ""))]
        await db[RECRUITERS].update_one({"_id": acc["_id"]}, {"$set": {"sessions": keep}})
    return {"ok": True}


def state(inv: dict[str, Any]) -> str:
    if inv.get("revoked_at"):
        return "revoked"
    return "expired" if inv["expires_at"] <= now() else "active"


async def _names(db, inv: dict[str, Any], mids: list[str], active: bool) -> dict[str, str]:
    """Student names for the recruiter's notes: while the invite is active, only students still shared with this
    recruiter; afterwards only when the college allows names on past drives."""
    if not mids:
        return {}
    if active:
        from app.orgs.recruiter_portal import visible  # the same check every portal request makes

        return {r["membership_id"]: r["name"] for r in await visible(db, inv) if r["membership_id"] in set(mids)}
    if not ((inv["_org"].get("recruiter_settings") or {}).get("names_after")):
        return {}
    members = {m["_id"]: m["user_id"] async for m in db[MEMBERSHIPS].find({"_id": {"$in": mids}}, {"user_id": 1})}
    users = {u["_id"]: u.get("name") or "" async for u in db[USERS].find({"_id": {"$in": list(members.values())}})}
    return {mid: users.get(uid, "") for mid, uid in members.items() if users.get(uid)}


async def drive_out(db, inv: dict[str, Any]) -> dict[str, Any]:
    st = state(inv)
    board = inv.get("board") or {}
    stages = [b.get("stage") for b in board.values()]
    viewed = await db[AUDIT_LOG].distinct("data.student", {"target": inv["_id"], "action": "recruiter_view"})
    offers = await db[OFFERS].count_documents(
        {
            "org_id": inv["org_id"],
            "membership_id": {"$in": list(board)},
            "company": {"$regex": f"^{re.escape(inv['company'])}$", "$options": "i"},
        }
    )
    names = await _names(db, inv, [m for m, b in board.items() if b.get("note")], st == "active")
    notes = [
        {"name": names.get(mid), "stage": b.get("stage"), "note": b["note"], "at": ms(b.get("at"))}
        for mid, b in sorted(board.items(), key=lambda kv: str(kv[1].get("at") or ""), reverse=True)
        if b.get("note")
    ]
    return {
        "id": inv["_id"],
        "orgName": inv["_org"]["name"],
        "company": inv["company"],
        "createdAt": ms(inv["created_at"]),
        "expiresAt": ms(inv["expires_at"]),
        "state": st,
        "path": f"/recruiter/i.{inv['_id']}" if st == "active" else None,
        "counts": {
            "viewed": len([v for v in viewed if v]),
            "shortlisted": sum(1 for s in stages if s in STAGES),
            "interviewed": sum(1 for s in stages if s in ("interview", "selected")),
            "selected": sum(1 for s in stages if s == "selected"),
            "offers": offers,
        },
        "notes": notes,
        "demo": bool(inv.get("demo")),
    }


@router.get("/drives")
async def my_drives(response: Response, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    response.headers.update(NO_STORE)
    acc = await _signed_in(db, x_recruiter_account)
    invites = await _invites(db, acc["email_lc"])
    drives = [await drive_out(db, i) for i in invites]
    if invites:
        await audit(
            db, None, "recruiter_drives", target=acc["_id"], data={"orgs": sorted({i["org_id"] for i in invites})}
        )
    user, _, domain = acc["email_lc"].partition("@")
    return {
        "name": acc.get("name") or (invites[0]["recruiter_name"] if invites else ""),
        "emailHint": f"{user[:2]}{'•' * max(1, len(user) - 2)}@{domain}",
        "drives": drives,
    }
