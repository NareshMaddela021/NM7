"""Creating orders, marking them paid, and building the order views the API returns."""

import logging
from datetime import datetime, timedelta

from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.auth.models import User
from app.core.db import ORDERS, PAYMENTS, REFUNDS, Session, next_number, transaction
from app.core.time import IST, now
from app.orders.models import ORDER_NO_START, Order, OrderItem
from app.orders.pricing import CURRENCY, price
from app.orders.schemas import OrderOut
from app.payments.models import Payment
from app.refunds.models import Refund
from app.site import get_site

log = logging.getLogger("nm7.orders")

PAYABLE = ("pending_payment", "expired")  # a late payment for an expired order still counts
UNPAID_EXPIRES_AFTER = timedelta(hours=24)


def financial_year(at: datetime) -> str:
    d = at.astimezone(IST)
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


async def next_invoice_no(db: AsyncDatabase, at: datetime, session: Session = None) -> str:
    fy = financial_year(at)
    n = await next_number(db, f"invoice:{fy}", 1, session=session)
    return f"NM7/{fy}/{n:04d}"


async def build_order(db: AsyncDatabase, customer: User, plan: str, role: str | None, addons: list[str]) -> Order:
    """Prices the order and reserves its number. Not saved yet (the caller saves it with its payment)."""
    items = price(plan, addons, await get_site(db))
    n = await next_number(db, "order_no", ORDER_NO_START)
    return Order(
        _id=f"RS-{n}",
        customer_id=customer.id,
        plan=plan,
        target_role=(role or "").strip() or None,
        status="pending_payment",
        amount=sum(i[3] for i in items),
        currency=CURRENCY,
        items=[
            OrderItem(position=pos, kind=kind, code=code, name=name, amount=amount)
            for pos, (kind, code, name, amount) in enumerate(items)
        ],
    )


async def get_order(db: AsyncDatabase, order_id: str, session: Session = None) -> Order | None:
    return Order.load(await db[ORDERS].find_one({"_id": order_id}, session=session))


async def mark_paid(
    db: AsyncDatabase, payment_id: str, razorpay_payment_id: str, method: str | None = None, raw: dict | None = None
) -> tuple[Order, bool]:
    """Records a successful payment in one transaction (payment, order, invoice number). Safe to call more than
    once (checkout handler and webhook both do): returns (order, True) only the first time, so the receipt email
    goes out once. Two callers at the same moment conflict and one is retried, then sees it already paid."""

    async def run(s):
        payment = Payment.load(await db[PAYMENTS].find_one({"_id": payment_id}, session=s))
        order = await get_order(db, payment.order_id, session=s)
        extra = {**({"method": method} if method else {}), **({"raw.payment": raw} if raw else {})}
        if payment.status == "captured" or order.status not in PAYABLE:
            if extra:
                await db[PAYMENTS].update_one({"_id": payment.id}, {"$set": extra}, session=s)
            return order, False
        at = now()
        order.paid_at = at
        order.invoice_no = await next_invoice_no(db, at, session=s)
        if order.plan == "diy":
            order.status = "done"
        else:
            order.status = "offer"  # paid; finding an expert
            express = any(i.code == "express" for i in order.items)
            hours = (await get_site(db, session=s))["delivery_hours"]
            order.deadline_at = at + timedelta(hours=min(24, hours) if express else hours)
        await db[PAYMENTS].update_one(
            {"_id": payment.id},
            {
                "$set": {
                    "status": "captured",
                    "razorpay_payment_id": razorpay_payment_id,
                    "captured_at": at,
                    "error": None,
                    "updated_at": at,
                    **extra,
                }
            },
            session=s,
        )
        await db[ORDERS].update_one(
            {"_id": order.id},
            {
                "$set": {
                    "status": order.status,
                    "paid_at": at,
                    "invoice_no": order.invoice_no,
                    "deadline_at": order.deadline_at,
                    "updated_at": at,
                }
            },
            session=s,
        )
        return order, True

    order, first = await transaction(run)
    if first:
        log.info("Order %s paid (%s)", order.id, razorpay_payment_id)
    return order, first


async def expire_unpaid(db: AsyncDatabase) -> int:
    r = await db[ORDERS].update_many(
        {"status": "pending_payment", "created_at": {"$lt": now() - UNPAID_EXPIRES_AFTER}},
        {"$set": {"status": "expired", "updated_at": now()}},
    )
    return r.modified_count


async def order_views(db: AsyncDatabase, orders: list[Order]) -> list[OrderOut]:
    """Orders with their payments and refunds (three queries for any number of orders)."""
    ids = [o.id for o in orders]
    payments: dict[str, list[Payment]] = {i: [] for i in ids}
    refunds: dict[str, list[Refund]] = {i: [] for i in ids}
    if ids:
        async for raw in db[PAYMENTS].find({"order_id": {"$in": ids}}).sort("created_at", ASCENDING):
            payments[raw["order_id"]].append(Payment.load(raw))
        async for raw in db[REFUNDS].find({"order_id": {"$in": ids}}).sort("created_at", ASCENDING):
            refunds[raw["order_id"]].append(Refund.load(raw))
    return [OrderOut.of(o, payments[o.id], refunds[o.id]) for o in orders]


async def order_view(db: AsyncDatabase, order: Order) -> OrderOut:
    return (await order_views(db, [order]))[0]
