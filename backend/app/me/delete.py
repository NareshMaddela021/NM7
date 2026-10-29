"""Delete my account (self-serve). Profile & settings > Delete account explains what is removed, sends a code to the
account's email and, once the code is entered, schedules the erase for 7 days later. Until then the person can
sign in and undo it; the public resume link is turned off at once. After 7 days the automation pass erases the
account (app/me/erase.py: everything personal; paid orders and invoices kept for GST, anonymised).

Organization Owners transfer ownership first (Org > Team). Expert accounts are deleted by support.
Admin > Customers > Deletion requests lists them (name and email only while the request is open).

  GET    /api/me/account/deletion            {requested, eraseAt, ownerOf: [org names]}
  POST   /api/me/account/deletion/code       emails a code
  POST   /api/me/account/deletion   {code}   schedules the erase (7 days)
  DELETE /api/me/account/deletion            undo
  GET    /api/admin/deletion-requests
"""

import logging
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.service import check_code, issue_code
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, DELETION_REQUESTS, ORG_STAFF, ORGANIZATIONS, SHARES, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.erase import erase_account
from app.me.service import ms

log = logging.getLogger("nm7.delete")
me = APIRouter(prefix="/api/me/account/deletion", tags=["me"])
admin = APIRouter(prefix="/api/admin/deletion-requests", tags=["admin"])

UNDO = timedelta(days=7)
PURPOSE = "delete_account"
CODE_RULES = [(5, timedelta(hours=1))]


class ConfirmIn(CamelModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


async def owner_of(db: AsyncDatabase, user_id: str) -> list[str]:
    """Organizations this person is the Owner of (they transfer them first)."""
    rows = await db[ORG_STAFF].find({"user_id": user_id, "role": "owner", "status": "active"}).to_list(None)
    if not rows:
        return []
    q = {"_id": {"$in": [r["org_id"] for r in rows]}, "status": {"$ne": "archived"}}
    return [o["name"] async for o in db[ORGANIZATIONS].find(q, {"name": 1})]


def _state(u: dict[str, Any], owner: list[str]) -> dict[str, Any]:
    d = u.get("deletion") or {}
    return {"requested": bool(d), "eraseAt": ms(d.get("erase_at")), "ownerOf": owner}


def _code_email(to: str, name: str, code: str) -> Email:
    text = (
        f"Hi {name},\n\nYour code to delete your Nm7 account: {code}\n\nEnter it in Profile & settings > Delete "
        "account. Your account and resumes are erased 7 days later; until then you can sign in and undo it.\n\n"
        "If you didn't ask for this, ignore this email and change your password.\n\nNm7 · nm7.si"
    )
    html = (
        f"<p>Hi {escape(name)},</p><p>Your code to delete your Nm7 account:</p>"
        f'<p style="font-size:24px;letter-spacing:4px"><b>{code}</b></p>'
        "<p>Your account and resumes are erased 7 days later; until then you can sign in and undo it. If you didn’t "
        "ask for this, ignore this email and change your password.</p>"
    )
    return Email(to, name, f"{code} is your code to delete your Nm7 account", text, html)


def _scheduled_email(to: str, name: str, when: str) -> Email:
    text = (
        f"Hi {name},\n\nYour Nm7 account will be deleted on {when}. Changed your mind? Sign in before then and "
        "choose Undo in Profile & settings.\n\nNm7 · nm7.si"
    )
    html = (
        f"<p>Hi {escape(name)},</p><p>Your Nm7 account will be deleted on <b>{when}</b>. Changed your mind? "
        "Sign in before then and choose <b>Undo</b> in Profile &amp; settings.</p>"
    )
    return Email(to, name, "Your Nm7 account will be deleted in 7 days", text, html)


@me.get("")
async def status(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": auth.user.id}, {"deletion": 1}) or {}
    return _state(u, await owner_of(db, auth.user.id))


@me.post("/code")
async def send_code(request: Request, db: DB, mailer: MailerDep, auth: CustomerAuth) -> dict[str, bool]:
    u = auth.user
    if await owner_of(db, u.id):
        raise ApiError(409, "owner_first", "You own an organization. Transfer it first (Org > Team).")
    key = f"delete-code:{u.id}"
    await rate_limit.check(db, key, CODE_RULES, "You asked for several codes already. Try again in an hour.")
    await rate_limit.record(db, key)
    code = await issue_code(db, u, PURPOSE, client_ip(request))
    return {"sent": await send_safely(mailer, _code_email(u.email, u.name, code))}


@me.post("")
async def schedule(body: ConfirmIn, request: Request, db: DB, mailer: MailerDep, auth: CustomerAuth) -> dict:
    u = auth.user
    if await owner_of(db, u.id):
        raise ApiError(409, "owner_first", "You own an organization. Transfer it first (Org > Team).")
    if not await check_code(db, u, PURPOSE, body.code):
        raise ApiError(400, "wrong_code", "That code isn’t right, or it has expired. Ask for a new one.")
    t = now()
    erase_at = t + UNDO
    await db[USERS].update_one({"_id": u.id}, {"$set": {"deletion": {"requested_at": t, "erase_at": erase_at}}})
    await db[SHARES].update_one({"_id": u.id}, {"$set": {"on": False}})  # the public link stops at once
    await db[DELETION_REQUESTS].update_one(
        {"_id": u.id},
        {"$set": {"name": u.name, "email": u.email, "requested_at": t, "erase_at": erase_at, "status": "pending"}},
        upsert=True,
    )
    await audit(db, u.id, "account.delete_requested", target=u.id, ip=client_ip(request))
    when = f"{erase_at.astimezone(IST):%d %b %Y}"
    await send_safely(mailer, _scheduled_email(u.email, u.name, when))
    return _state({"deletion": {"erase_at": erase_at}}, [])


@me.delete("", status_code=204)
async def undo(request: Request, db: DB, auth: CustomerAuth) -> Response:
    r = await db[USERS].update_one({"_id": auth.user.id, "deletion": {"$exists": True}}, {"$unset": {"deletion": ""}})
    if not r.modified_count:
        raise ApiError(404, "not_found", "Your account isn’t set to be deleted.")
    await db[DELETION_REQUESTS].update_one(
        {"_id": auth.user.id}, {"$set": {"status": "undone", "undone_at": now(), "name": "", "email": ""}}
    )
    await audit(db, auth.user.id, "account.delete_undone", target=auth.user.id, ip=client_ip(request))
    return Response(status_code=204)


async def erase_due(db: AsyncDatabase) -> int:
    """Run by the automation pass: erase accounts whose 7 days are over (Owners are skipped until they transfer)."""
    n = 0
    async for u in db[USERS].find({"deletion.erase_at": {"$lte": now()}, "deleted_at": None}, {"_id": 1}):
        if await owner_of(db, u["_id"]):
            continue
        counts = await erase_account(db, u["_id"])
        await db[DELETION_REQUESTS].update_one(
            {"_id": u["_id"]},
            {"$set": {"status": "erased", "erased_at": now(), "name": "", "email": "", "counts": counts}},
            upsert=True,
        )
        await audit(db, None, "account.erased", target=u["_id"], data={"items": sum(counts.values())})
        log.info("account erased: %s items", sum(counts.values()))
        n += 1
    return n


@admin.get("")
async def deletion_requests(db: DB, _: AdminAuth("customers")) -> list[dict[str, Any]]:
    rows = await db[DELETION_REQUESTS].find({}).sort("requested_at", -1).limit(500).to_list(None)
    return [
        {
            "userId": r["_id"],
            "name": r.get("name", ""),
            "email": r.get("email", ""),
            "status": r["status"],
            "requestedAt": ms(r.get("requested_at")),
            "eraseAt": ms(r.get("erase_at")),
            "erasedAt": ms(r.get("erased_at")),
            "items": sum((r.get("counts") or {}).values()),
        }
        for r in rows
    ]
