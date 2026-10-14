"""Refund rules (same as the frontend's askRefund): late delivery or cancelling before an expert accepts is
refunded at once; anything else waits for an admin.

Razorpay is never called inside a database transaction (a retried transaction could refund twice). Instead:
the refund document is saved first (a unique index allows one open refund per order), then Razorpay is asked,
then one transaction records the result. If Razorpay says no, the refund is removed (customer request) or put
back in review (admin approval)."""

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.core.db import ORDERS, PAYMENTS, REFUNDS, next_number, transaction
from app.core.errors import ApiError
from app.core.time import now
from app.orders.models import Order
from app.payments.models import Payment
from app.payments.razorpay import Razorpay, RazorpayError
from app.refunds.models import OPEN, REFUND_NO_START, Refund

REFUNDABLE = ("offer", "in_progress", "waiting", "revision", "delivered", "done")
REFUND_EXISTS = ApiError(409, "refund_exists", "You’ve already asked for a refund on this order.")


def is_late(order: Order) -> bool:
    return order.deadline_at is not None and order.delivered_at is None and now() > order.deadline_at


async def captured_payment(db: AsyncDatabase, order: Order) -> Payment:
    p = Payment.load(await db[PAYMENTS].find_one({"order_id": order.id, "status": "captured"}))
    if p is None or not p.razorpay_payment_id:
        raise ApiError(409, "not_refundable", "This order has no completed payment to refund.")
    return p


async def has_open_refund(db: AsyncDatabase, order_id: str) -> bool:
    return await db[REFUNDS].find_one({"order_id": order_id, "open": True}, projection={"_id": 1}) is not None


async def new_refund(db: AsyncDatabase, order: Order, payment: Payment, **fields) -> Refund:
    n = await next_number(db, "refund_no", REFUND_NO_START)
    refund = Refund(_id=f"RF-{n}", order_id=order.id, payment_id=payment.id, open=fields["status"] in OPEN, **fields)
    try:
        await db[REFUNDS].insert_one(refund.to_mongo())
    except DuplicateKeyError:
        raise REFUND_EXISTS from None
    return refund


async def send_to_razorpay(
    db: AsyncDatabase,
    rzp: Razorpay,
    refund: Refund,
    order: Order,
    payment: Payment,
    actor_id: str | None,
    on_error: str,
    before: Refund | None = None,
) -> None:
    """Asks Razorpay to return the money, then records it. on_error: "delete" (undo a customer's automatic
    request) or "review" (an admin's approval goes back to review, as `before`)."""
    try:
        r = await rzp.refund(
            payment.razorpay_payment_id,
            refund.amount,
            receipt=refund.id,
            notes={"order_id": order.id, "refund_id": refund.id},
        )
    except RazorpayError as e:
        if on_error == "delete":
            await db[REFUNDS].delete_one({"_id": refund.id})
        elif before is not None:
            await db[REFUNDS].replace_one({"_id": refund.id}, before.to_mongo())
        raise ApiError(502, "payment_provider_error", "Razorpay didn’t accept the refund. Please try again.") from e

    refund.razorpay_refund_id = r["id"]
    refund.status = "processed" if r.get("status") == "processed" else "approved"
    refund.decided_at = refund.decided_at or now()
    full = refund.amount >= order.amount
    if refund.status == "processed":
        refund.processed_at = now()
    if full:
        order.status = "cancelled" if refund.reason == "cancel" else "refunded"

    async def record(s):
        await db[REFUNDS].update_one(
            {"_id": refund.id},
            {
                "$set": {
                    "razorpay_refund_id": refund.razorpay_refund_id,
                    "status": refund.status,
                    "decided_at": refund.decided_at,
                    "processed_at": refund.processed_at,
                }
            },
            session=s,
        )
        if refund.status == "processed" and full:
            await db[PAYMENTS].update_one(
                {"_id": payment.id}, {"$set": {"status": "refunded", "updated_at": now()}}, session=s
            )
        if full:
            await db[ORDERS].update_one(
                {"_id": order.id}, {"$set": {"status": order.status, "updated_at": now()}}, session=s
            )
        await audit(
            db,
            actor_id,
            "refund.sent",
            target=refund.id,
            data={"order_id": order.id, "amount": refund.amount, "razorpay_refund_id": r["id"], "auto": refund.auto},
            session=s,
        )

    await transaction(record)


async def on_refund_webhook(db: AsyncDatabase, event: dict) -> None:
    entity = ((event.get("payload") or {}).get("refund") or {}).get("entity") or {}
    refund = Refund.load(await db[REFUNDS].find_one({"razorpay_refund_id": entity.get("id") or "-"}))
    if refund is None:
        return
    if event.get("event") == "refund.processed" and refund.status != "processed":
        order = Order.load(await db[ORDERS].find_one({"_id": refund.order_id}))

        async def processed(s):
            await db[REFUNDS].update_one(
                {"_id": refund.id}, {"$set": {"status": "processed", "processed_at": now()}}, session=s
            )
            if order and refund.amount >= order.amount:
                await db[PAYMENTS].update_one(
                    {"_id": refund.payment_id}, {"$set": {"status": "refunded", "updated_at": now()}}, session=s
                )

        await transaction(processed)
    elif event.get("event") == "refund.failed" and refund.status != "failed":
        await db[REFUNDS].update_one(
            {"_id": refund.id},
            {"$set": {"status": "failed", "open": False, "error": "Razorpay could not complete the refund"}},
        )
        await audit(db, None, "refund.failed", target=refund.id, data={"order_id": refund.order_id})
