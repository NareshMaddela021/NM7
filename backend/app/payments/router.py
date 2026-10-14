"""Confirming payments: the checkout handler (/verify) and Razorpay's server-to-server webhook."""

import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import User
from app.core.config import get_settings
from app.core.db import DB, PAYMENTS, USERS, WEBHOOK_EVENTS
from app.core.email import Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orders import emails
from app.orders.models import Order
from app.orders.schemas import OrderOut
from app.orders.service import get_order, mark_paid, order_view
from app.payments.models import Payment, WebhookEvent
from app.payments.razorpay import payment_signature_ok, webhook_signature_ok
from app.refunds.service import on_refund_webhook

router = APIRouter(prefix="/api/payments", tags=["payments"])
log = logging.getLogger("nm7.payments")


class VerifyIn(CamelModel):
    # Razorpay's checkout handler gives snake_case keys; camelCase works too.
    razorpay_order_id: str = Field(max_length=40)
    razorpay_payment_id: str = Field(max_length=40)
    razorpay_signature: str = Field(max_length=128)


def _secret(name: str) -> str:
    value = getattr(get_settings(), name)
    if not value:
        raise ApiError(503, "payments_unavailable", "Payments aren’t switched on yet.")
    return value


async def _payment_for_razorpay_order(db: AsyncDatabase, razorpay_order_id: str) -> tuple[Payment, Order] | None:
    payment = Payment.load(await db[PAYMENTS].find_one({"razorpay_order_id": razorpay_order_id}))
    if payment is None or payment.order_id is None:
        return None
    order = await get_order(db, payment.order_id)
    return (payment, order) if order else None


async def _send_receipt(db: AsyncDatabase, mailer: Mailer, order: Order) -> None:
    user = User.load(await db[USERS].find_one({"_id": order.customer_id}))
    if user:
        await send_safely(mailer, emails.payment_receipt(user.email, user.name, order))


@router.post("/verify")
async def verify_payment(body: VerifyIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> OrderOut:
    secret = _secret("razorpay_key_secret")
    found = await _payment_for_razorpay_order(db, body.razorpay_order_id)
    if found is None or found[1].customer_id != auth.user.id:
        raise ApiError(404, "not_found", "We couldn’t find that payment.")
    payment, order = found
    if not payment_signature_ok(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature, secret):
        log.warning("Bad payment signature for %s (order %s)", body.razorpay_payment_id, order.id)
        raise ApiError(
            400,
            "invalid_signature",
            "We couldn’t confirm this payment. If money left your account, "
            "it will be confirmed automatically or refunded.",
        )
    order, first = await mark_paid(db, payment.id, body.razorpay_payment_id)
    if first:
        await _send_receipt(db, mailer, order)
    return await order_view(db, await get_order(db, order.id))


# ---------- webhook ----------


def _entity(event: dict[str, Any], name: str) -> dict[str, Any]:
    return ((event.get("payload") or {}).get(name) or {}).get("entity") or {}


async def _on_payment_captured(db: AsyncDatabase, event: dict[str, Any]) -> Order | None:
    p = _entity(event, "payment")
    if not p.get("id"):
        return None
    found = await _payment_for_razorpay_order(db, p.get("order_id") or "")
    if found is None:
        # Money with no order of ours (e.g. paid through a link) — keep it so admins can match or refund it.
        orphan = Payment(
            order_id=None,
            razorpay_order_id=p.get("order_id"),
            razorpay_payment_id=p["id"],
            amount=int(p.get("amount") or 0),
            currency=p.get("currency") or "INR",
            status="captured",
            method=p.get("method"),
            captured_at=now(),
            raw={"payment": p},
            error="Paid, but no matching order",
        )
        try:
            await db[PAYMENTS].insert_one(orphan.to_mongo())
        except DuplicateKeyError:
            pass  # already recorded
        return None
    payment, order = found
    if int(p.get("amount") or 0) != payment.amount:
        await db[PAYMENTS].update_one(
            {"_id": payment.id},
            {"$set": {"error": f"Amount mismatch: Razorpay {p.get('amount')} vs order {payment.amount}"}},
        )
        await audit(db, None, "payment.amount_mismatch", target=order.id, data={"payment_id": p["id"]})
        return None
    order, first = await mark_paid(db, payment.id, p["id"], p.get("method"), raw=p)
    return order if first else None


async def _on_payment_failed(db: AsyncDatabase, event: dict[str, Any]) -> None:
    p = _entity(event, "payment")
    # Only while unpaid: the customer can try again on the same Razorpay order.
    await db[PAYMENTS].update_one(
        {"razorpay_order_id": p.get("order_id") or "-", "order_id": {"$ne": None}, "status": "created"},
        [
            {
                "$set": {
                    "status": "failed",
                    "method": {"$ifNull": [p.get("method"), "$method"]},
                    "error": (p.get("error_description") or "Payment failed")[:300],
                    "raw.failed": {"$literal": p},
                    "updated_at": now(),
                }
            }
        ],
    )


async def handle_event(db: AsyncDatabase, event: dict[str, Any]) -> Order | None:
    """Returns an order that just became paid (to email the receipt), if any."""
    kind = event.get("event")
    if kind in ("payment.captured", "order.paid"):
        return await _on_payment_captured(db, event)
    if kind == "payment.failed":
        await _on_payment_failed(db, event)
    elif kind in ("refund.processed", "refund.failed"):
        await on_refund_webhook(db, event)
    return None


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: DB, mailer: MailerDep) -> dict[str, bool]:
    secret = _secret("razorpay_webhook_secret")
    body = await request.body()
    if not webhook_signature_ok(body, request.headers.get("x-razorpay-signature", ""), secret):
        raise ApiError(400, "invalid_signature", "Bad signature.")
    event = json.loads(body)
    event_id = request.headers.get("x-razorpay-event-id") or "sha256:" + hashlib.sha256(body).hexdigest()

    try:
        await db[WEBHOOK_EVENTS].insert_one(
            WebhookEvent(_id=event_id, type=str(event.get("event"))[:60], payload=event).to_mongo()
        )
    except DuplicateKeyError:
        seen = await db[WEBHOOK_EVENTS].find_one({"_id": event_id}, projection={"processed_at": 1})
        if seen and seen.get("processed_at"):
            return {"ok": True, "duplicate": True}
        # Seen but not finished (an earlier try failed): handle it again; every step is safe to repeat.

    paid = await handle_event(db, event)
    await db[WEBHOOK_EVENTS].update_one({"_id": event_id}, {"$set": {"processed_at": now()}})
    if paid:
        await _send_receipt(db, mailer, paid)
    return {"ok": True}
