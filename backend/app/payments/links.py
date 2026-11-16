"""Razorpay Payment Links: a Razorpay-hosted page to pay one order, sent by email.

Used for
- pending orders from the old WhatsApp payments (Admin → Payments → "Send payment link", one or all at once), so
  nobody has to pay on WhatsApp any more;
- organization invoices (colleges and companies): the proforma's link is emailed to the organization
  (app/billing/invoice_router.py), replacing manual WhatsApp collection.

A paid link arrives as the webhook "payment_link.paid" (and "payment.captured" with the link's notes), which runs the
same checks and mark_paid() as a checkout payment (app/payments/router.py). Opening a new link cancels the order's
older open link, so one order never has two live links. Razorpay TEST keys only until Admin → Billing settings →
"Razorpay live" is on (the same guard as the organization checkout).
"""

import logging
from datetime import datetime, timedelta
from html import escape
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.billing.checkout import _check_mode, site_url
from app.billing.settings import get_billing
from app.core.db import ORDERS, PAYMENTS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.time import now
from app.orders.models import Order
from app.orders.pricing import PLANS
from app.orders.service import PAYABLE, get_order
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay

log = logging.getLogger("nm7.payments")
LINK_DAYS = 7


def _inr(paise: int) -> str:
    return f"₹{paise / 100:,.2f}".replace(".00", "")


def describe(order: Order) -> str:
    if order.kind == "org":
        plan = next((i.name for i in order.items if i.kind == "plan"), "Nm7 for Organizations")
        return f"{plan} · {order.id}"
    return f"{PLANS.get(order.plan, ('Nm7',))[0]} · {order.id}"


async def payer(db: AsyncDatabase, order: Order) -> dict[str, str]:
    """Who the link is for: the customer, or the organization's billing email (else the person who ordered)."""
    buyer = (order.billing or {}).get("buyer") or {}
    u = await db[USERS].find_one({"_id": order.customer_id}, {"name": 1, "email": 1, "phone": 1}) or {}
    email = buyer.get("email") if order.kind == "org" and buyer.get("email") else u.get("email", "")
    name = (buyer.get("legal_name") if order.kind == "org" else None) or u.get("name", "")
    return {k: v for k, v in {"name": name, "email": email}.items() if v}


async def cancel_open_links(db: AsyncDatabase, order_id: str, except_id: str | None = None) -> None:
    rzp = get_razorpay()
    async for p in db[PAYMENTS].find(
        {"order_id": order_id, "razorpay_link_id": {"$type": "string"}, "status": {"$in": ["created", "failed"]}}
    ):
        if p["razorpay_link_id"] == except_id:
            continue
        try:
            await rzp.cancel_payment_link(p["razorpay_link_id"])
        except RazorpayError as e:  # already paid or expired at Razorpay: the webhook / daily check sorts it out
            log.info("cancel link %s: %s", p["razorpay_link_id"], e)
        await db[PAYMENTS].update_one({"_id": p["_id"]}, {"$set": {"status": "cancelled", "updated_at": now()}})


async def create_link(db: AsyncDatabase, order: Order, actor_id: str | None, days: int = LINK_DAYS) -> dict[str, Any]:
    """A new payment link for an unpaid order (the amount is the order's, from the server). Returns
    {"url", "id", "expiresAt"}; the order keeps it under `payment_link`."""
    if order.status not in PAYABLE or order.amount <= 0:
        raise ApiError(409, "not_payable", "This order isn’t waiting for a payment.")
    b = await get_billing(db)
    rzp = get_razorpay()  # 503 until the keys are set
    _check_mode(rzp.key_id, bool(b["razorpay_live"]))  # test keys only until "Razorpay live" is on
    expires = now() + timedelta(days=days)
    try:
        r = await rzp.create_payment_link(
            order.amount,
            f"{order.id}-{int(now().timestamp())}",  # Razorpay wants a fresh reference for every link
            describe(order),
            await payer(db, order),
            {"order_id": order.id, "kind": order.kind or "customer"},
            int(expires.timestamp()),
        )
    except RazorpayError as e:
        log.warning("payment link for %s: %s", order.id, e)
        raise ApiError(502, "payment_provider_error", "Razorpay didn’t create the payment link. Try again.") from e
    payment = Payment(
        order_id=order.id, razorpay_link_id=r["id"], amount=order.amount, status="created", raw={"link": r}
    )
    await db[PAYMENTS].insert_one(payment.to_mongo())
    await cancel_open_links(db, order.id, except_id=r["id"])
    link = {"url": r.get("short_url", ""), "id": r["id"], "expires_at": expires, "sent_at": now()}
    # an old WhatsApp order now pays through Razorpay: it is no longer a "WhatsApp" order
    sets: dict[str, Any] = {"payment_link": link, "updated_at": now()}
    if order.method == "whatsapp":
        sets.update(method=None, moved_from="whatsapp")
    await db[ORDERS].update_one({"_id": order.id}, {"$set": sets})
    await audit(db, actor_id, "payment.link_created", target=order.id, data={"link": r["id"], "amount": order.amount})
    return {"url": link["url"], "id": r["id"], "expiresAt": expires}


def link_email(to: str, name: str, order: Order, url: str, expires: datetime, *, old_whatsapp: bool) -> Email:
    first = (name or "").split(" ")[0] or "there"
    why = (
        "We no longer take payments on WhatsApp. Please pay for your order securely with Razorpay instead "
        "(UPI, cards, netbanking or wallets)."
        if old_whatsapp
        else "Pay securely with Razorpay (UPI, cards, netbanking or wallets)."
    )
    day = expires.strftime("%d %b %Y")
    text = (
        f"Hi {first},\n\n{why}\n\nOrder {order.id} — {describe(order)}\nAmount: {_inr(order.amount)}\n\n"
        f"Pay here: {url}\n\nThe link works until {day}. Your invoice is emailed as soon as the payment is "
        f"confirmed.\n\nQuestions? Reply to this email or write to info@nm7.si.\n\nNm7 · nm7.si"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">'
        f"<p>Hi {escape(first)},</p><p>{escape(why)}</p>"
        f"<p>Order <b>{escape(order.id)}</b> — {escape(describe(order))}<br>Amount: <b>{_inr(order.amount)}</b></p>"
        f'<p><a href="{escape(url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;'
        f'border-radius:8px;text-decoration:none">Pay {_inr(order.amount)}</a></p>'
        f'<p style="color:#666;font-size:13px">The link works until {day}. Your invoice is emailed as soon as the '
        "payment is confirmed. Questions? Reply to this email or write to info@nm7.si.</p></div>"
    )
    return Email(to, name, f"Pay for order {order.id} — {_inr(order.amount)}", text, html)


async def send_link(db: AsyncDatabase, mailer: Mailer, order_id: str, actor_id: str | None) -> dict[str, Any]:
    """Create a link for this unpaid order and email it to the payer."""
    order = await get_order(db, order_id)
    if order is None:
        raise ApiError(404, "not_found", "Order not found.")
    old = order.method == "whatsapp"
    out = await create_link(db, order, actor_id)
    who = await payer(db, order)
    sent = False
    if who.get("email"):
        sent = await send_safely(
            mailer, link_email(who["email"], who.get("name", ""), order, out["url"], out["expiresAt"], old_whatsapp=old)
        )
    return {**out, "emailed": bool(sent), "to": who.get("email", "")}


async def send_links_to_pending_whatsapp(db: AsyncDatabase, mailer: Mailer, actor_id: str | None) -> dict[str, int]:
    """Every old WhatsApp order still waiting for money gets a Razorpay payment link by email (once)."""
    sent = failed = 0
    async for o in (
        db[ORDERS]
        .find({"status": "awaiting_payment", "method": "whatsapp", "payment_link": None}, {"_id": 1})
        .limit(200)
    ):
        try:
            await send_link(db, mailer, o["_id"], actor_id)
            sent += 1
        except ApiError as e:
            log.warning("payment link for %s: %s", o["_id"], e.message)
            failed += 1
    return {"sent": sent, "failed": failed}


__all__ = ["create_link", "send_link", "send_links_to_pending_whatsapp", "site_url"]
