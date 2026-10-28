"""Transfer an organization's ownership.

The Owner (Org > Team) or Nm7's admin (Admin > Organizations, on the Owner's request) starts a transfer to a
coordinator / viewer of the organization or to any email address. The new owner gets a 6-digit code by email and
confirms it signed in with that (verified) email address; then they become the Owner and the old Owner becomes a
coordinator or leaves the organization (chosen when starting). Billing belongs to the organization, so the plan,
invoices and payment reminders move with it (they go to whoever is Owner). One open transfer per organization; it
expires after 48 hours; 5 wrong codes stop it. Every step is in the organization's Activity log.

  Owner  GET/POST/DELETE /api/org/{org_id}/transfer              {toEmail, oldOwner: coordinator | leave}
                                                                  GET answers {transfer: the open one or null}
  Admin  GET/POST/DELETE /api/admin/orgs/{org_id}/transfer        {toEmail, oldOwner, fromStaffId?}
  New    GET  /api/me/org-transfers                              transfers waiting for my email
         POST /api/me/org-transfers/{id}/accept {code}
"""

import secrets
from datetime import timedelta
from html import escape
from typing import Any, Literal

from fastapi import APIRouter, Request, Response
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, ORG_STAFF, ORG_TRANSFERS, ORGANIZATIONS, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_token
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, AdminScope, OrgScope, Scope

portal = APIRouter(prefix="/api/org/{org_id}/transfer", tags=["organizations"])
admin = APIRouter(prefix="/api/admin/orgs/{org_id}/transfer", tags=["organizations"])
me = APIRouter(prefix="/api/me/org-transfers", tags=["organizations"])

TTL = timedelta(hours=48)
MAX_TRIES = 5
START_RULES = [(10, timedelta(hours=1))]


class TransferIn(CamelModel):
    to_email: str = Field(min_length=5, max_length=200, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
    old_owner: Literal["coordinator", "leave"] = "coordinator"


class AdminTransferIn(TransferIn):
    from_staff_id: str | None = Field(None, max_length=64)  # which Owner hands over (default: the first one)


class AcceptIn(CamelModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


def _hash(tid: str, code: str) -> str:
    return hash_token(f"org-transfer:{tid}:{code}")


def out(t: dict[str, Any] | None) -> dict[str, Any] | None:
    if not t:
        return None
    return {
        "id": t["_id"],
        "toEmail": t["to_email"],
        "oldOwner": t["old_owner"],
        "fromName": t.get("from_name", ""),
        "by": t["by"],
        "status": t["status"],
        "createdAt": ms(t["created_at"]),
        "expiresAt": ms(t["expires_at"]),
    }


async def _open(db, org_id: str) -> dict[str, Any] | None:
    return await db[ORG_TRANSFERS].find_one({"org_id": org_id, "status": "pending", "expires_at": {"$gt": now()}})


def _email(to: str, org: str, from_name: str, code: str) -> Email:
    url = f"{get_settings().site_url}/org/transfer"
    text = (
        f"Hello,\n\n{from_name} wants to make you the Owner of {org} on Nm7. As Owner you choose and pay for the "
        f"plan, invite coordinators and run the organization's placement drives.\n\n"
        f"Your code: {code}\n\nTo accept, sign in (or create a free account) with this email address, {to}, and enter "
        f"the code at {url}\n\nThe code works for 48 hours. If you weren't expecting this, ignore this email: nothing "
        "changes.\n\nNm7 · nm7.si"
    )
    html = (
        f"<p>Hello,</p><p>{escape(from_name)} wants to make you the Owner of <b>{escape(org)}</b> on Nm7.</p>"
        f'<p style="font-size:24px;letter-spacing:4px"><b>{code}</b></p>'
        f'<p>Sign in with this email address and enter the code at <a href="{url}">{url}</a>. It works for 48 '
        "hours. If you weren’t expecting this, ignore this email: nothing changes.</p>"
    )
    return Email(to, to, f"{code} is your code to become Owner of {org} on Nm7", text, html)


async def _start(db, mailer, request: Request, scope: Scope, org_id: str, body: TransferIn, from_staff: dict) -> dict:
    key = f"org-transfer:{scope.actor_id}"
    await rate_limit.check(db, key, START_RULES)
    await rate_limit.record(db, key)
    org = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not org:
        raise NOT_FOUND
    to_lc = body.to_email.strip().lower()
    if to_lc == from_staff["email_lc"]:
        raise ApiError(400, "same_owner", "That’s the current Owner’s own email address.")
    target = await db[ORG_STAFF].find_one({"org_id": org_id, "email_lc": to_lc, "status": "active"})
    if target and target["role"] == "owner":
        raise ApiError(409, "already_owner", f"{body.to_email} is already an Owner of this organization.")
    if await _open(db, org_id):
        raise ApiError(409, "transfer_open", "A transfer is already waiting. Cancel it first to start a new one.")
    from_user = await db[USERS].find_one({"_id": from_staff.get("user_id")}, {"name": 1}) or {}
    code = f"{secrets.randbelow(10**6):06d}"
    tid = new_id()
    t = {
        "_id": tid,
        "org_id": org_id,
        "from_staff_id": from_staff["_id"],
        "from_user_id": from_staff.get("user_id"),
        "from_name": from_user.get("name", ""),
        "to_email": body.to_email.strip(),
        "to_email_lc": to_lc,
        "old_owner": body.old_owner,
        "code_hash": _hash(tid, code),
        "tries": 0,
        "by": "admin" if scope.role == "admin" else "owner",
        "started_by": scope.actor_id,
        "status": "pending",
        "created_at": now(),
        "expires_at": now() + TTL,
    }
    await db[ORG_TRANSFERS].insert_one(t)
    who = from_user.get("name") or "The Owner"
    sent = await send_safely(mailer, _email(t["to_email"], org["name"], who, code))
    data = scope.audit_data([org_id], to=t["to_email"], oldOwner=body.old_owner)
    await audit(db, scope.actor_id, "owner_transfer_start", target=tid, data=data, ip=client_ip(request))
    return {**out(t), "emailSent": sent}


async def _cancel(db, request: Request, scope: Scope, org_id: str) -> Response:
    t = await _open(db, org_id)
    if not t:
        raise NOT_FOUND
    await db[ORG_TRANSFERS].update_one({"_id": t["_id"]}, {"$set": {"status": "cancelled", "ended_at": now()}})
    await audit(
        db, scope.actor_id, "owner_transfer_cancel", target=t["_id"], data=scope.audit_data([org_id]),
        ip=client_ip(request),
    )  # fmt: skip
    return Response(status_code=204)


async def _my_owner_row(db, scope: Scope) -> dict[str, Any]:
    if scope.role != "owner":
        raise ApiError(403, "owner_only", "Only the organization’s Owner can transfer ownership.")
    s = await db[ORG_STAFF].find_one({"_id": scope.staff_id, "status": "active", "role": "owner"})
    if not s:
        raise NOT_FOUND
    return s


# ---------- the Owner ----------
@portal.get("")
async def owner_view(db: DB, scope: OrgScope) -> dict[str, Any]:
    await _my_owner_row(db, scope)
    return {"transfer": out(await _open(db, scope.org_id))}


@portal.post("", status_code=201)
async def owner_start(body: TransferIn, request: Request, db: DB, mailer: MailerDep, scope: OrgScope) -> dict:
    s = await _my_owner_row(db, scope)
    return await _start(db, mailer, request, scope, scope.org_id, body, s)


@portal.delete("", status_code=204)
async def owner_cancel(request: Request, db: DB, scope: OrgScope) -> Response:
    await _my_owner_row(db, scope)
    return await _cancel(db, request, scope, scope.org_id)


# ---------- Nm7's admin, on request ----------
@admin.get("")
async def admin_view(org_id: str, db: DB, _: AdminScope) -> dict[str, Any]:
    return {"transfer": out(await _open(db, org_id))}


@admin.post("", status_code=201)
async def admin_start(
    org_id: str, body: AdminTransferIn, request: Request, db: DB, mailer: MailerDep, scope: AdminScope
) -> dict[str, Any]:
    q: dict[str, Any] = {"org_id": org_id, "role": "owner", "status": "active"}
    if body.from_staff_id:
        q["_id"] = body.from_staff_id
    s = await db[ORG_STAFF].find_one(q, sort=[("created_at", 1)])
    if not s:
        raise ApiError(404, "no_owner", "This organization has no active Owner. Invite one from Team instead.")
    return await _start(db, mailer, request, scope, org_id, body, s)


@admin.delete("", status_code=204)
async def admin_cancel(org_id: str, request: Request, db: DB, scope: AdminScope) -> Response:
    return await _cancel(db, request, scope, org_id)


# ---------- the new owner ----------
@me.get("")
async def waiting(db: DB, auth: CustomerAuth) -> list[dict[str, Any]]:
    q = {"to_email_lc": auth.user.email.strip().lower(), "status": "pending", "expires_at": {"$gt": now()}}
    rows = await db[ORG_TRANSFERS].find(q).to_list(20)
    names = {o["_id"]: o["name"] async for o in db[ORGANIZATIONS].find({"_id": {"$in": [t["org_id"] for t in rows]}})}
    return [{**out(t), "orgId": t["org_id"], "orgName": names.get(t["org_id"], "")} for t in rows]


@me.post("/{transfer_id}/accept")
async def accept(transfer_id: str, body: AcceptIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    u = auth.user
    if not u.email_verified_at:
        raise ApiError(403, "email_unverified", "Please confirm your email address first.")
    lc = u.email.strip().lower()
    t = await db[ORG_TRANSFERS].find_one(
        {"_id": transfer_id, "to_email_lc": lc, "status": "pending", "expires_at": {"$gt": now()}}
    )
    if not t:
        raise ApiError(404, "not_found", "This transfer has ended or isn’t for your email address.")
    if t["tries"] >= MAX_TRIES:
        raise ApiError(429, "too_many_tries", "Too many wrong codes. Ask the Owner to start the transfer again.")
    if not secrets.compare_digest(_hash(t["_id"], body.code), t["code_hash"]):
        await db[ORG_TRANSFERS].update_one({"_id": t["_id"]}, {"$inc": {"tries": 1}})
        raise ApiError(400, "wrong_code", "That code isn’t right. Check the email and try again.")
    # the code works once: the transfer is closed in the same write that checks it's still open
    r = await db[ORG_TRANSFERS].update_one(
        {"_id": t["_id"], "status": "pending"}, {"$set": {"status": "done", "ended_at": now(), "to_user_id": u.id}}
    )
    if not r.modified_count:
        raise ApiError(404, "not_found", "This transfer has ended.")
    org_id = t["org_id"]
    tnow = now()
    new_owner = {"role": "owner", "status": "active", "user_id": u.id, "group_ids": None, "invite_token_hash": None}
    row = await db[ORG_STAFF].find_one({"org_id": org_id, "email_lc": lc})
    if row:
        await db[ORG_STAFF].update_one({"_id": row["_id"]}, {"$set": {**new_owner, "accepted_at": tnow}})
    else:
        await db[ORG_STAFF].insert_one(
            {"_id": new_id(), "org_id": org_id, "email": u.email, "email_lc": lc, **new_owner,
             "invited_by": t["started_by"], "created_at": tnow, "accepted_at": tnow}
        )  # fmt: skip
    if t["old_owner"] == "leave":
        old = {"status": "removed", "removed_at": tnow, "invite_token_hash": None}
    else:
        old = {"role": "coordinator", "group_ids": None}
    await db[ORG_STAFF].update_one({"_id": t["from_staff_id"], "role": "owner"}, {"$set": old})
    data = {"orgs": [org_id], "by": "staff", "role": "owner", "from": t.get("from_name", "")}
    data["oldOwner"] = t["old_owner"]
    await audit(db, u.id, "owner_transfer_done", target=t["_id"], data=data, ip=client_ip(request))
    return {"orgId": org_id, "role": "owner"}
