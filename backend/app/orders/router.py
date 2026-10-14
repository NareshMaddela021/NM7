from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field
from sqlalchemy import select

from app.admin.roles import can
from app.audit import audit
from app.auth.deps import CurrentAuth, CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import DB
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.orders.models import Order
from app.orders.pricing import PLANS
from app.orders.schemas import CreateOrderIn, CreateOrderOut, OrderOut, Prefill
from app.orders.service import lock_order, new_order
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay
from app.refunds import emails as refund_emails
from app.refunds.service import (
    REFUNDABLE,
    captured_payment,
    has_open_refund,
    is_late,
    new_refund,
    refunds_by_order,
    send_to_razorpay,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])

NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that order.")


async def refunds_for(db, order_id: str) -> list:
    return (await refunds_by_order(db, [order_id]))[order_id]


@router.post("", status_code=201)
async def create_order(body: CreateOrderIn, auth: CustomerAuth, db: DB) -> CreateOrderOut:
    rzp = get_razorpay()  # 503 until keys are set
    user = auth.user
    order = await new_order(db, user, body.plan_id, body.role, body.addons)
    try:
        r = await rzp.create_order(
            order.amount, order.currency, receipt=order.id, notes={"order_id": order.id, "customer_id": str(user.id)}
        )
    except RazorpayError:
        await db.rollback()
        raise ApiError(502, "payment_provider_error", "We couldn’t start the payment. Please try again.") from None
    payment = Payment(
        order_id=order.id,
        razorpay_order_id=r["id"],
        amount=order.amount,
        currency=order.currency,
        status="created",
        raw={"order": r},
    )
    db.add(payment)
    await db.commit()
    return CreateOrderOut(
        order_id=order.id,
        razorpay_order_id=r["id"],
        amount=order.amount,
        currency=order.currency,
        key_id=rzp.key_id,
        description=f"{PLANS[order.plan][0]} · {order.id}",
        prefill=Prefill(name=user.name, email=user.email, contact=user.phone),
    )


@router.get("")
async def my_orders(auth: CustomerAuth, db: DB) -> list[OrderOut]:
    rows = await db.execute(select(Order).where(Order.customer_id == auth.user.id).order_by(Order.created_at.desc()))
    orders = list(rows.scalars())
    refunds = await refunds_by_order(db, [o.id for o in orders])
    return [OrderOut.of(o, refunds[o.id]) for o in orders]


@router.get("/{order_id}")
async def get_order(order_id: str, auth: CurrentAuth, db: DB) -> OrderOut:
    order = await db.get(Order, order_id)
    if order is None:
        raise NOT_FOUND
    is_admin = auth.user.role == "admin" and auth.session.two_step and can(auth.user.admin_role, "orders")
    if order.customer_id != auth.user.id and not is_admin:
        raise NOT_FOUND  # don't reveal other people's order numbers
    return OrderOut.of(order, await refunds_for(db, order.id))


class RefundIn(CamelModel):
    reason: Literal["late", "cancel", "quality", "other"]
    details: str = Field(default="", max_length=2000)


@router.post("/{order_id}/refund")
async def request_refund(
    order_id: str, body: RefundIn, auth: CustomerAuth, db: DB, mailer: MailerDep, request: Request
) -> OrderOut:
    order = await lock_order(db, order_id)
    if order is None or order.customer_id != auth.user.id:
        raise NOT_FOUND
    if order.status not in REFUNDABLE:
        raise ApiError(409, "not_refundable", "This order can’t be refunded now.")
    if await has_open_refund(db, order.id):
        raise ApiError(409, "refund_exists", "You’ve already asked for a refund on this order.")
    details = body.details.strip()
    if body.reason in ("quality", "other") and len(details) < 10:
        raise ApiError(400, "details_required", "Tell us a little more (at least 10 characters).")
    if body.reason == "late" and not is_late(order):
        raise ApiError(400, "not_late", "This order isn’t late yet. Choose another reason if something is wrong.")
    if body.reason == "cancel" and order.status != "offer":
        raise ApiError(409, "cannot_cancel", "An expert has already started. Choose another reason instead.")

    payment = await captured_payment(db, order)
    auto = body.reason in ("late", "cancel")
    refund = await new_refund(
        db,
        order,
        payment,
        amount=order.amount,
        reason=body.reason,
        details=details or None,
        status="approved" if auto else "review",
        auto=auto,
        requested_by=auth.user.id,
    )
    audit(
        db,
        auth.user.id,
        "refund.requested",
        target=refund.id,
        data={"order_id": order.id, "reason": body.reason, "auto": auto},
        ip=client_ip(request),
    )
    if auto:
        rzp = get_razorpay()
        await send_to_razorpay(db, rzp, refund, order, payment, actor_id=None)
    await db.commit()
    user = auth.user
    msg = (
        refund_emails.refund_started(user.email, user.name, order.id, refund.amount)
        if auto
        else refund_emails.refund_under_review(user.email, user.name, order.id)
    )
    await send_safely(mailer, msg)
    return OrderOut.of(order, await refunds_for(db, order.id))
