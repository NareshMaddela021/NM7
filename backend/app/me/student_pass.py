"""The annual student pass (P1): one payment (Rs 199, Admin → Settings & prices) unlocks for 12 months unlimited PDF /
Word downloads, the Tailor pack, the Interview pack (with voice practice) and the LinkedIn pack. The single
purchases stay on sale.

A pass is a paid order of the plan `annual_pass` (WhatsApp, Razorpay later, or a free code), or an admin grant. It
runs 12 months from the payment; a second pass bought before the first ends starts when the first ends. A refund or
cancel takes it away at once (checked against the orders themselves). When it ends, things bought separately stay
unlocked and only pass access stops; resumes and data are never locked or deleted.

  GET  /api/me/pass       {active, until, source, price, onSale, mode}
The automation pass emails a reminder 7 days before a pass ends (once per pass end date).
"""

from datetime import datetime, timedelta
from html import escape
from typing import Any

from fastapi import APIRouter
from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.auth.deps import CustomerAuth
from app.core.config import get_settings
from app.core.db import DB, FEATURE_GRANTS, ORDERS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.time import IST, now
from app.me.service import ms

router = APIRouter(prefix="/api/me/pass", tags=["student pass"])

PLAN = "annual_pass"
DAYS = 365
REMIND_DAYS = 7
LOST = ("refunded", "cancelled")
WHAT = (
    "unlimited PDF and Word downloads, the Tailor pack, the Interview pack (with voice practice) and the LinkedIn pack"
)


async def periods(db: AsyncDatabase, user_id: str) -> list[dict[str, Any]]:
    """Every pass this account has, oldest first: {order_id, start, until, source}. Paid passes chain (a second
    one starts when the first ends); an admin grant is its own period."""
    out: list[dict[str, Any]] = []
    end: datetime | None = None
    cur = db[ORDERS].find(
        {"customer_id": user_id, "plan": PLAN, "kind": {"$ne": "org"}, "paid_at": {"$ne": None},
         "status": {"$nin": list(LOST)}},
        {"paid_at": 1},
    ).sort("paid_at", ASCENDING)  # fmt: skip
    async for o in cur:
        start = max(o["paid_at"], end) if end else o["paid_at"]
        end = start + timedelta(days=DAYS)
        out.append({"order_id": o["_id"], "start": start, "until": end, "source": "order"})
    g = await db[FEATURE_GRANTS].find_one({"_id": f"pass:{user_id}"})
    if g:
        out.append({"order_id": None, "start": g["at"], "until": g["until"], "source": "grant"})
    return out


async def active(db: AsyncDatabase, user_id: str, at: datetime | None = None) -> dict[str, Any] | None:
    """The pass in force now (the one ending last), or None."""
    t = at or now()
    live = [p for p in await periods(db, user_id) if p["start"] <= t < p["until"]]
    if not live:
        return None
    last = max(p["until"] for p in await periods(db, user_id) if p["until"] > t)
    best = max(live, key=lambda p: p["until"])
    return {**best, "until": last}  # a pass already bought for later extends this one


async def grant(db: AsyncDatabase, user_id: str, admin_id: str, note: str = "") -> datetime:
    until = now() + timedelta(days=DAYS)
    await db[FEATURE_GRANTS].update_one(
        {"_id": f"pass:{user_id}"},
        {"$set": {"user_id": user_id, "feature": "pass", "granted_by": admin_id, "note": note, "at": now(),
                  "until": until}},
        upsert=True,
    )  # fmt: skip
    return until


async def revoke(db: AsyncDatabase, user_id: str) -> None:
    await db[FEATURE_GRANTS].delete_one({"_id": f"pass:{user_id}"})


def day(t: datetime) -> str:
    return t.astimezone(IST).strftime("%-d %b %Y")


@router.get("")
async def my_pass(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.site import get_site
    from app.wapay.settings import payment_mode

    p = await active(db, auth.user.id)
    mode = await payment_mode(db)
    plan = (await get_site(db))["plans"][PLAN]
    return {
        "active": p is not None,
        "until": ms(p["until"]) if p else None,
        "untilText": day(p["until"]) if p else "",
        "source": p["source"] if p else "",
        "price": plan["amount"] / 100,
        "onSale": mode != "off" and plan["active"],
        "mode": mode,
    }


def reminder_email(to: str, name: str, until: datetime) -> Email:
    site = get_settings().site_url
    first = (name or "").split(" ")[0] or "there"
    text = (
        f"Hi {first},\n\nYour Nm7 annual pass ends on {day(until)}. After that, {WHAT} lock again unless you bought "
        f"them separately. Your resumes and everything you made stay in your account.\n\nRenew for another year: "
        f"{site}/me\n\nNm7 · nm7.si"
    )
    html = (
        f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
        f"<p>Your Nm7 annual pass ends on <b>{escape(day(until))}</b>. After that, {escape(WHAT)} lock again unless "
        "you bought them separately. Your resumes and everything you made stay in your account.</p>"
        f'<p><a href="{escape(site)}/me">Renew for another year</a></p></div>'
    )
    return Email(to=to, to_name=name, subject=f"Your Nm7 annual pass ends on {day(until)}", text=text, html=html)


async def send_reminders(db: AsyncDatabase, mailer: Mailer) -> int:
    """Runs in the automation pass: passes ending within 7 days get one reminder per end date."""
    t = now()
    soon = t + timedelta(days=REMIND_DAYS)
    users = set(
        await db[ORDERS].distinct(
            "customer_id",
            {"plan": PLAN, "paid_at": {"$ne": None}, "status": {"$nin": list(LOST)}, "kind": {"$ne": "org"}},
        )
    )
    users |= set(await db[FEATURE_GRANTS].distinct("user_id", {"feature": "pass", "until": {"$gt": t, "$lte": soon}}))
    sent = 0
    for uid in users:
        p = await active(db, uid, t)
        if not p or p["until"] > soon:
            continue
        key = p["until"].isoformat()
        u = await db[USERS].find_one({"_id": uid}, {"email": 1, "name": 1, "email_bounced": 1, "pass_reminded": 1})
        if not u or u.get("email_bounced") or u.get("pass_reminded") == key:
            continue
        if await send_safely(mailer, reminder_email(u["email"], u.get("name", ""), p["until"])):
            sent += 1
        await db[USERS].update_one({"_id": uid}, {"$set": {"pass_reminded": key}})
    return sent
