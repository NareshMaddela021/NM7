"""Refund rules (same as the frontend's askRefund): late delivery or cancelling before an expert accepts is
refunded at once; anything else waits for an admin."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import audit
from app.core.errors import ApiError
from app.core.time import now
from app.orders.models import Order
from app.payments.models import Payment
from app.payments.razorpay import Razorpay, RazorpayError
from app.refunds.models import OPEN, REFUND_NO, Refund

REFUNDABLE = ("offer", "in_progress", "waiting", "revision", "delivered", "done")


def is_late(order: Order) -> bool:
    return order.deadline_at is not None and order.delivered_at is None and now() > order.deadline_at


async def refunds_by_order(db: AsyncSession, order_ids: list[str]) -> dict[str, list[Refund]]:
    out: dict[str, list[Refund]] = {i: [] for i in order_ids}
    if order_ids:
        rows = await db.execute(select(Refund).where(Refund.order_id.in_(order_ids)).order_by(Refund.created_at))
        for r in rows.scalars():
            out[r.order_id].append(r)
    return out


async def captured_payment(db: AsyncSession, order: Order) -> Payment:
    p = (
        await db.execute(
            select(Payment).where(Payment.order_id == order.id, Payment.status == "captured").with_for_update()
        )
    ).scalar_one_or_none()
    if p is None or not p.razorpay_payment_id:
        raise ApiError(409, "not_refundable", "This order has no completed payment to refund.")
    return p


async def has_open_refund(db: AsyncSession, order_id: str) -> bool:
    q = select(Refund.id).where(Refund.order_id == order_id, Refund.status.in_(OPEN))
    return (await db.execute(q)).first() is not None


async def new_refund(db: AsyncSession, order: Order, payment: Payment, **fields) -> Refund:
    n = (await db.execute(select(REFUND_NO.next_value()))).scalar_one()
    refund = Refund(id=f"RF-{n}", order_id=order.id, payment_id=payment.id, **fields)
    db.add(refund)
    await db.flush()
    return refund


async def send_to_razorpay(
    db: AsyncSession, rzp: Razorpay, refund: Refund, order: Order, payment: Payment, actor_id: uuid.UUID | None
) -> None:
    """Asks Razorpay to return the money and updates the refund, order and audit log (caller commits)."""
    try:
        r = await rzp.refund(
            payment.razorpay_payment_id,
            refund.amount,
            receipt=refund.id,
            notes={"order_id": order.id, "refund_id": refund.id},
        )
    except RazorpayError as e:
        await db.rollback()
        raise ApiError(502, "payment_provider_error", "Razorpay didn’t accept the refund. Please try again.") from e
    refund.razorpay_refund_id = r["id"]
    refund.status = "processed" if r.get("status") == "processed" else "approved"
    refund.decided_at = refund.decided_at or now()
    full = refund.amount >= order.amount
    if refund.status == "processed":
        refund.processed_at = now()
        if full:
            payment.status = "refunded"
    if full:
        order.status = "cancelled" if refund.reason == "cancel" else "refunded"
    audit(
        db,
        actor_id,
        "refund.sent",
        target=refund.id,
        data={"order_id": order.id, "amount": refund.amount, "razorpay_refund_id": r["id"], "auto": refund.auto},
    )


async def on_refund_webhook(db: AsyncSession, event: dict) -> None:
    entity = ((event.get("payload") or {}).get("refund") or {}).get("entity") or {}
    refund = (
        await db.execute(select(Refund).where(Refund.razorpay_refund_id == entity.get("id")).with_for_update())
    ).scalar_one_or_none()
    if refund is None:
        return
    if event.get("event") == "refund.processed" and refund.status != "processed":
        refund.status = "processed"
        refund.processed_at = now()
        payment = await db.get(Payment, refund.payment_id, with_for_update=True)
        order = await db.get(Order, refund.order_id)
        if payment and order and refund.amount >= order.amount:
            payment.status = "refunded"
    elif event.get("event") == "refund.failed" and refund.status != "failed":
        refund.status = "failed"
        refund.error = "Razorpay could not complete the refund"
        audit(db, None, "refund.failed", target=refund.id, data={"order_id": refund.order_id})
