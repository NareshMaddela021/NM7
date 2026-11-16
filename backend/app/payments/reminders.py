# ruff: noqa: E501
"""Unpaid orders: at most 2 "Finish your payment" emails.

A customer who opened Razorpay's checkout and closed it, or whose payment failed, gets
  1. one email after about 1 hour, and
  2. one more after about 20 hours (before the order expires at 24 hours, Admin → Settings → Automation),
each with a link back to My orders, where "Pay now" opens the same order again (POST /api/orders/{id}/pay).
Never more than 2 per order, never after it is paid, and never to a bounced address or someone who turned payment
reminders off (users.notify.email.payments = false). Not for organization orders (their owners get invoices and
payment links instead).
"""

from datetime import timedelta
from html import escape
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.billing.checkout import site_url
from app.core.db import ORDERS, PAYMENTS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.time import now
from app.orders.pricing import PLANS

STEPS = (timedelta(hours=1), timedelta(hours=20))  # the 1st and the 2nd reminder, after the order was created


def _inr(paise: int) -> str:
    return f"₹{paise / 100:,.2f}".replace(".00", "")


def reminder_email(to: str, name: str, order: dict[str, Any], failed: bool, n: int) -> Email:
    first = (name or "").split(" ")[0] or "there"
    plan = PLANS.get(order.get("plan"), ("your order",))[0]
    link = f"{site_url()}/me/orders?pay={order['_id']}"
    why = "Your payment didn’t go through" if failed else "Your payment isn’t finished yet"
    text = (
        f"Hi {first},\n\n{why} for {plan} (order {order['_id']}, {_inr(order['amount'])}). No money was taken.\n\n"
        f"Try again: {link}\n\nUPI, cards, netbanking and wallets all work. If money did leave your account, it is "
        f"confirmed automatically within a few minutes, or refunded.\n\n"
        + ("This is the last reminder for this order." if n >= len(STEPS) else "")
        + "\n\nNm7 · nm7.si · info@nm7.si"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(first)},</p><p>{escape(why)} for {escape(plan)} (order <b>{escape(order['_id'])}</b>, "
        f"{_inr(order['amount'])}). No money was taken.</p>"
        f'<p><a href="{escape(link)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;'
        f'border-radius:8px;text-decoration:none">Try the payment again</a></p>'
        '<p style="color:#666;font-size:13px">UPI, cards, netbanking and wallets all work. If money did leave your '
        "account, it is confirmed automatically within a few minutes, or refunded."
        + (" This is the last reminder for this order." if n >= len(STEPS) else "")
        + "</p></div>"
    )
    return Email(to, name, f"Finish your payment — order {order['_id']}", text, html)


def _wants(u: dict[str, Any]) -> bool:
    if not u or u.get("email_bounced") or not u.get("email"):
        return False
    return ((u.get("notify") or {}).get("email") or {}).get("payments", True) is not False


async def send_reminders(db: AsyncDatabase, mailer: Mailer, limit: int = 200) -> int:
    t = now()
    sent = 0
    for n, after in enumerate(STEPS, start=1):
        q = {"status": "pending_payment", "kind": {"$in": ["customer", "addon"]}, "reminders_sent": {"$in": [n - 1, None] if n == 1 else [n - 1]},
             "created_at": {"$lte": t - after, "$gt": t - timedelta(days=2)}}  # fmt: skip
        async for o in db[ORDERS].find(q).limit(limit):
            claimed = await db[ORDERS].update_one(
                {"_id": o["_id"], "status": "pending_payment", "reminders_sent": o.get("reminders_sent")},
                {"$set": {"reminders_sent": n, "reminded_at": t}},
            )
            if not claimed.modified_count:
                continue
            u = await db[USERS].find_one(
                {"_id": o["customer_id"]}, {"email": 1, "name": 1, "notify": 1, "email_bounced": 1}
            )
            if not _wants(u):
                continue
            failed = bool(await db[PAYMENTS].find_one({"order_id": o["_id"], "status": "failed"}, {"_id": 1}))
            if await send_safely(mailer, reminder_email(u["email"], u.get("name", ""), o, failed, n)):
                sent += 1
    return sent
