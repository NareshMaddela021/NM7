from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field
from pymongo import DESCENDING

from app.admin.roles import can
from app.audit import audit
from app.auth.deps import CurrentAuth, CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import DB, ORDERS, PAYMENTS, transaction
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.orders.models import Order
from app.orders.pricing import PLANS
from app.orders.schemas import CreateOrderIn, CreateOrderOut, OrderOut, Prefill
from app.orders.service import build_order, get_order, order_view, order_views
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay
from app.refunds import emails as refund_emails
from app.refunds.service import REFUNDABLE, captured_payment, has_open_refund, is_late, new_refund, send_to_razorpay

router = APIRouter(prefix="/api/orders", tags=["orders"])

NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that order.")


@router.post("", status_code=201)
async def create_order(body: CreateOrderIn, auth: CustomerAuth, db: DB) -> CreateOrderOut:
    rzp = get_razorpay()  # 503 until keys are set
    user = auth.user
    order = await build_order(db, user, body.plan_id, body.role, body.addons)
    try:
        r = await rzp.create_order(
            order.amount, order.currency, receipt=order.id, notes={"order_id": order.id, "customer_id": str(user.id)}
        )
    except RazorpayError:
        # Nothing was saved (the reserved order number is simply skipped).
        raise ApiError(502, "payment_provider_error", "We couldn’t start the payment. Please try again.") from None
    payment = Payment(
        order_id=order.id,
        razorpay_order_id=r["id"],
        amount=order.amount,
        currency=order.currency,
        status="created",
        raw={"order": r},
    )

    async def save(s):
        await db[ORDERS].insert_one(order.to_mongo(), session=s)
        await db[PAYMENTS].insert_one(payment.to_mongo(), session=s)

    await transaction(save)
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
    cursor = db[ORDERS].find({"customer_id": auth.user.id}).sort([("created_at", DESCENDING), ("_id", DESCENDING)])
    orders = [Order.load(raw) async for raw in cursor]
    return await order_views(db, orders)


@router.get("/{order_id}")
async def get_one_order(order_id: str, auth: CurrentAuth, db: DB) -> OrderOut:
    order = await get_order(db, order_id)
    if order is None:
        raise NOT_FOUND
    is_admin = auth.user.role == "admin" and auth.session.two_step and can(auth.user.admin_role, "orders")
    if order.customer_id != auth.user.id and not is_admin:
        raise NOT_FOUND  # don't reveal other people's order numbers
    return await order_view(db, order)


class RefundIn(CamelModel):
    reason: Literal["late", "cancel", "quality", "other"]
    details: str = Field(default="", max_length=2000)


@router.post("/{order_id}/refund")
async def request_refund(
    order_id: str, body: RefundIn, auth: CustomerAuth, db: DB, mailer: MailerDep, request: Request
) -> OrderOut:
    order = await get_order(db, order_id)
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
    rzp = get_razorpay() if auto else None  # 503 before anything is saved
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
    if rzp:
        await send_to_razorpay(db, rzp, refund, order, payment, actor_id=None, on_error="delete")
    await audit(
        db,
        auth.user.id,
        "refund.requested",
        target=refund.id,
        data={"order_id": order.id, "reason": body.reason, "auto": auto},
        ip=client_ip(request),
    )
    user = auth.user
    msg = (
        refund_emails.refund_started(user.email, user.name, order.id, refund.amount)
        if auto
        else refund_emails.refund_under_review(user.email, user.name, order.id)
    )
    await send_safely(mailer, msg)
    return await order_view(db, await get_order(db, order.id))
