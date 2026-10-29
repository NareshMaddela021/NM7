"""Resume health: the API (dashboard card, dismiss), the opt-out (Profile settings toggle or the signed unsubscribe
link) and the daily email batch (one email per person at most every 14 days, only with something to fix, never to
an address that bounced or opted out).

  GET  /api/me/health                 the visible alerts and whether emails are on
  POST /api/me/health/dismiss         {id}
  PUT  /api/me/health/emails          {on}
  POST /api/public/health/unsubscribe {token}   the link in every alert email (no sign-in)
"""

import logging
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase

from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, HEALTH, LOCKS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.health import alerts

router = APIRouter(prefix="/api/me/health", tags=["health"])
public = APIRouter(prefix="/api/public/health", tags=["health"])
log = logging.getLogger("nm7.health")

BATCH = 500  # people looked at per pass (the pass runs every few minutes, the email goes once a day per person)
UNSUB_RULES = [(30, timedelta(hours=1))]  # unsubscribe-link tries per address
STYLE = "font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5"


def emails_on(user: dict[str, Any]) -> bool:
    return ((user.get("notify") or {}).get("email") or {}).get("health", True) is not False


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('health-unsub', user_id)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").partition(".")
    return uid if uid and sig and same(sig, keyed_hash("health-unsub", uid)[:32]) else None


class DismissIn(CamelModel):
    id: str = Field(min_length=3, max_length=200)


class EmailsIn(CamelModel):
    on: bool


class UnsubIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@router.get("")
async def my_health(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": auth.user.id}, {"notify": 1})
    return {"alerts": await alerts.visible(db, auth.user.id), "emails": emails_on(u or {})}


@router.post("/dismiss")
async def dismiss(body: DismissIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await alerts.dismiss(db, auth.user.id, body.id)
    return {"alerts": await alerts.visible(db, auth.user.id)}


@router.put("/emails")
async def set_emails(body: EmailsIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"notify.email.health": body.on}})
    return {"emails": body.on}


@public.post("/unsubscribe")
async def unsubscribe(body: UnsubIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"health-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, UNSUB_RULES)
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn’t work. You can turn alert emails off in your settings.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"notify.email.health": False}})
    return {"ok": True}


# ---------- the email ----------


def health_email(to: str, name: str, user_id: str, items: list[dict[str, Any]]) -> Email:
    site = get_settings().site_url
    stop = f"{site}/stop-alerts#t={unsub_token(user_id)}"
    first = (name or "").split(" ")[0] or "there"
    shown = items[:4]
    more = len(items) - len(shown)
    text = "\n".join(
        [f"Hi {first},", "", "A few quick things would make your resume stronger:", ""]
        + [f"- {a['title']}: {a['text']}\n  {a['fix']['label']}: {site}{a['fix']['path']}" for a in shown]
        + ([f"\n…and {more} more on your dashboard: {site}/me"] if more else [])
        + ["", "You get this at most once every two weeks.", f"Stop these emails: {stop}", "", "Nm7 · nm7.si"]
    )
    rows = "".join(
        f'<li style="margin-bottom:10px"><b>{escape(a["title"])}</b><br>{escape(a["text"])}<br>'
        f'<a href="{escape(site + a["fix"]["path"])}">{escape(a["fix"]["label"])}</a></li>'
        for a in shown
    )
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>A few quick things would make your resume stronger:</p>'
        f'<ul style="padding-left:18px">{rows}</ul>'
        + (f'<p><a href="{escape(site)}/me">…and {more} more on your dashboard</a></p>' if more else "")
        + '<p style="color:#666;font-size:13px">You get this at most once every two weeks. '
        f'<a href="{escape(stop)}" style="color:#666">Stop these emails</a></p></div>'
    )
    return Email(to=to, to_name=name, subject="Your resume: a few quick fixes", text=text, html=html)


async def daily_batch(db: AsyncDatabase, mailer: Mailer, limit: int = BATCH) -> int:
    """Sends the alert email to people due one (opted in, confirmed, not bounced, nothing sent in 14 days, something
    to fix). Runs inside the automation pass; once per India day it walks everyone in pages of `limit`."""
    t = now()
    day = t.astimezone(IST).date().isoformat()
    lock = await db[LOCKS].find_one({"_id": "health-batch"}) or {}
    if lock.get("day") == day and lock.get("done"):
        return 0
    after = lock.get("after") if lock.get("day") == day else None
    q: dict[str, Any] = {
        "role": "customer",
        "email_verified_at": {"$ne": None},
        "email_bounced": {"$ne": True},
        "notify.email.health": {"$ne": False},
    }
    if after:
        q["_id"] = {"$gt": after}
    users = await db[USERS].find(q, {"email": 1, "name": 1}).sort("_id", 1).limit(limit).to_list(None)
    sent = 0
    for u in users:
        h = await db[HEALTH].find_one({"_id": u["_id"]}, {"last_email_at": 1}) or {}
        last = h.get("last_email_at")
        if last and last.tzinfo is None:
            last = last.replace(tzinfo=IST)
        if last and last > t - alerts.EMAIL_EVERY:
            continue
        items = await alerts.visible(db, u["_id"], t)
        if not items:
            continue
        ok = await send_safely(mailer, health_email(u["email"], u.get("name", ""), u["_id"], items))
        if ok:
            sent += 1
            await db[HEALTH].update_one({"_id": u["_id"]}, {"$set": {"last_email_at": t}}, upsert=True)
    done = len(users) < limit
    await db[LOCKS].update_one(
        {"_id": "health-batch"},
        {"$set": {"day": day, "done": done, "after": users[-1]["_id"] if users else after}},
        upsert=True,
    )
    if sent:
        log.info("health alerts: %d email(s) sent", sent)
    return sent
