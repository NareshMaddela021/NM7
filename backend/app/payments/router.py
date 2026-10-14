"""Confirming payments: the checkout handler (/verify) and Razorpay's server-to-server webhook."""

import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import User
from app.core.config import get_settings
from app.core.db import DB
from app.core.email import Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orders import emails
from app.orders.models import Order
from app.orders.router import refunds_for
from app.orders.schemas import OrderOut
from app.orders.service import lock_order, mark_paid
from app.payments.models import Payment, WebhookEvent
from app.payments.razorpay import payment_signature_ok, webhook_signature_ok

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


async def _payment_for_razorpay_order(db: AsyncSession, razorpay_order_id: str) -> tuple[Payment, Order] | None:
    """Locks the order first, then its payment row (same order everywhere, so no deadlocks)."""
    order_id = (
        await db.execute(select(Payment.order_id).where(Payment.razorpay_order_id == razorpay_order_id))
    ).scalar_one_or_none()
    if order_id is None:
        return None
    order = await lock_order(db, order_id)
    payment = (
        await db.execute(
            select(Payment)
            .where(Payment.razorpay_order_id == razorpay_order_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return payment, order


async def _send_receipt(db: AsyncSession, mailer: Mailer, order: Order) -> None:
    user = await db.get(User, order.customer_id)
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
    first = await mark_paid(db, order, payment, body.razorpay_payment_id)
    await db.commit()
    if first:
        await _send_receipt(db, mailer, order)
    return OrderOut.of(order, await refunds_for(db, order.id))


# ---------- webhook ----------


def _entity(event: dict[str, Any], name: str) -> dict[str, Any]:
    return ((event.get("payload") or {}).get(name) or {}).get("entity") or {}


async def _on_payment_captured(db: AsyncSession, event: dict[str, Any]) -> Order | None:
    p = _entity(event, "payment")
    if not p.get("id"):
        return None
    found = await _payment_for_razorpay_order(db, p.get("order_id") or "")
    if found is None:
        # Money with no order of ours (e.g. paid through a link) — keep it so admins can match or refund it.
        exists = (await db.execute(select(Payment.id).where(Payment.razorpay_payment_id == p["id"]))).first()
        if not exists:
            db.add(
                Payment(
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
            )
        return None
    payment, order = found
    if int(p.get("amount") or 0) != payment.amount:
        payment.error = f"Amount mismatch: Razorpay {p.get('amount')} vs order {payment.amount}"
        audit(db, None, "payment.amount_mismatch", target=order.id, data={"payment_id": p["id"]})
        return None
    payment.raw = {**payment.raw, "payment": p}
    return order if await mark_paid(db, order, payment, p["id"], p.get("method")) else None


async def _on_payment_failed(db: AsyncSession, event: dict[str, Any]) -> None:
    p = _entity(event, "payment")
    found = await _payment_for_razorpay_order(db, p.get("order_id") or "")
    if found is None:
        return
    payment, _ = found
    if payment.status == "created":  # the customer can try again on the same Razorpay order
        payment.status = "failed"
        payment.method = p.get("method") or payment.method
        payment.error = (p.get("error_description") or "Payment failed")[:300]
        payment.raw = {**payment.raw, "failed": p}


async def handle_event(db: AsyncSession, event: dict[str, Any]) -> Order | None:
    """Returns an order that just became paid (to email the receipt), if any."""
    kind = event.get("event")
    if kind in ("payment.captured", "order.paid"):
        return await _on_payment_captured(db, event)
    if kind == "payment.failed":
        await _on_payment_failed(db, event)
    return None


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: DB, mailer: MailerDep) -> dict[str, bool]:
    secret = _secret("razorpay_webhook_secret")
    body = await request.body()
    if not webhook_signature_ok(body, request.headers.get("x-razorpay-signature", ""), secret):
        raise ApiError(400, "invalid_signature", "Bad signature.")
    event = json.loads(body)
    event_id = request.headers.get("x-razorpay-event-id") or "sha256:" + hashlib.sha256(body).hexdigest()

    inserted = await db.execute(
        insert(WebhookEvent)
        .values(id=event_id, type=str(event.get("event"))[:60], payload=event)
        .on_conflict_do_nothing()
        .returning(WebhookEvent.id)
    )
    if inserted.first() is None:
        row = await db.get(WebhookEvent, event_id, with_for_update=True)
        if row and row.processed_at:
            return {"ok": True, "duplicate": True}

    paid = await handle_event(db, event)
    row = await db.get(WebhookEvent, event_id)
    row.processed_at = now()
    await db.commit()
    if paid:
        await _send_receipt(db, mailer, paid)
    return {"ok": True}
