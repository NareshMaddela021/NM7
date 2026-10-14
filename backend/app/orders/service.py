"""Creating orders and marking them paid."""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.time import IST, now
from app.orders.models import ORDER_NO, InvoiceCounter, Order, OrderItem
from app.orders.pricing import CURRENCY, DELIVERY_HOURS, price
from app.payments.models import Payment

log = logging.getLogger("nm7.orders")

PAYABLE = ("pending_payment", "expired")  # a late payment for an expired order still counts
UNPAID_EXPIRES_AFTER = timedelta(hours=24)


def financial_year(at: datetime) -> str:
    d = at.astimezone(IST)
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


async def next_invoice_no(db: AsyncSession, at: datetime) -> str:
    fy = financial_year(at)
    stmt = (
        insert(InvoiceCounter)
        .values(financial_year=fy, last_no=1)
        .on_conflict_do_update(index_elements=["financial_year"], set_={"last_no": InvoiceCounter.last_no + 1})
        .returning(InvoiceCounter.last_no)
    )
    n = (await db.execute(stmt)).scalar_one()
    return f"NM7/{fy}/{n:04d}"


async def new_order(db: AsyncSession, customer: User, plan: str, role: str | None, addons: list[str]) -> Order:
    items = price(plan, addons)
    n = (await db.execute(select(ORDER_NO.next_value()))).scalar_one()
    order = Order(
        id=f"RS-{n}",
        customer_id=customer.id,
        plan=plan,
        target_role=(role or "").strip() or None,
        status="pending_payment",
        amount=sum(i[3] for i in items),
        currency=CURRENCY,
    )
    order.items = [
        OrderItem(position=pos, kind=kind, code=code, name=name, amount=amount)
        for pos, (kind, code, name, amount) in enumerate(items)
    ]
    order.payments = []
    db.add(order)
    await db.flush()
    return order


async def lock_order(db: AsyncSession, order_id: str) -> Order | None:
    return (
        await db.execute(
            select(Order).where(Order.id == order_id).with_for_update().execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def mark_paid(
    db: AsyncSession, order: Order, payment: Payment, razorpay_payment_id: str, method: str | None = None
) -> bool:
    """Records a successful payment. Safe to call more than once (checkout handler and webhook both do).
    Returns True only the first time, so the receipt email goes out once. The order row must be locked."""
    if method:
        payment.method = method
    if payment.status == "captured" or order.status not in PAYABLE:
        return False
    at = now()
    payment.status = "captured"
    payment.razorpay_payment_id = razorpay_payment_id
    payment.captured_at = at
    payment.error = None
    order.paid_at = at
    order.invoice_no = await next_invoice_no(db, at)
    if order.plan == "diy":
        order.status = "done"
    else:
        order.status = "offer"  # paid; finding an expert
        express = any(i.code == "express" for i in order.items)
        order.deadline_at = at + timedelta(hours=24 if express else DELIVERY_HOURS)
    log.info("Order %s paid (%s)", order.id, razorpay_payment_id)
    return True


async def expire_unpaid(db: AsyncSession) -> int:
    r = await db.execute(
        text(
            "UPDATE orders SET status = 'expired', updated_at = now() "
            "WHERE status = 'pending_payment' AND created_at < :cutoff"
        ),
        {"cutoff": now() - UNPAID_EXPIRES_AFTER},
    )
    return r.rowcount


def is_owner(order: Order, user_id: uuid.UUID) -> bool:
    return order.customer_id == user_id
