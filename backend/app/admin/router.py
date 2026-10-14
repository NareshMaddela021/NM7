"""Admin console API."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import case, func, or_, select

from app.admin.deps import AdminAuth
from app.audit import AuditLog, audit
from app.auth.models import User
from app.auth.sessions import client_ip
from app.core.db import DB
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orders.models import Order
from app.orders.schemas import OrderOut
from app.orders.service import lock_order
from app.payments.models import Payment
from app.payments.razorpay import get_razorpay
from app.refunds import emails as refund_emails
from app.refunds.models import Refund
from app.refunds.service import captured_payment, refunds_by_order, send_to_razorpay

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AuditOut(CamelModel):
    id: int
    actor_id: uuid.UUID | None
    actor_name: str | None
    action: str
    target: str | None
    data: dict[str, Any]
    ip: str | None
    at: datetime


@router.get("/audit-log")
async def audit_log(
    db: DB,
    _: AdminAuth("team"),
    action: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[AuditOut]:
    q = select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        q = q.where(AuditLog.action == action)
    rows = await db.execute(q.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return [
        AuditOut(
            id=a.id,
            actor_id=a.actor_id,
            actor_name=name,
            action=a.action,
            target=a.target,
            data=a.data,
            ip=a.ip,
            at=a.at,
        )
        for a, name in rows
    ]


# ---------- orders ----------

OPEN_ORDER = ("offer", "in_progress", "waiting", "revision")


class CustomerBrief(CamelModel):
    id: uuid.UUID
    name: str
    email: str
    phone: str | None


class AdminOrderOut(OrderOut):
    customer: CustomerBrief
    hours_left: float | None
    late: bool


class Page[T](CamelModel):
    items: list[T]
    total: int


@router.get("/orders")
async def admin_orders(
    db: DB,
    _: AdminAuth("orders"),
    status: str | None = None,
    q: str | None = Query(None, max_length=100),
    late: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[AdminOrderOut]:
    """Open orders first, closest deadline first (the 48-hour queue); everything else newest first."""
    query = select(Order, User).join(User, User.id == Order.customer_id)
    if status:
        query = query.where(Order.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Order.id.ilike(like), User.email.ilike(like), User.name.ilike(like)))
    if late:
        query = query.where(Order.status.in_(OPEN_ORDER), Order.delivered_at.is_(None), Order.deadline_at < now())
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    is_open = case((Order.status.in_(OPEN_ORDER), 0), else_=1)
    rows = (
        await db.execute(
            query.order_by(is_open, Order.deadline_at.asc().nulls_last(), Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    refunds = await refunds_by_order(db, [o.id for o, _ in rows])
    items = []
    for o, u in rows:
        hours = (o.deadline_at - now()).total_seconds() / 3600 if o.deadline_at and o.status in OPEN_ORDER else None
        base = OrderOut.of(o, refunds[o.id]).model_dump()
        items.append(
            AdminOrderOut(
                **base,
                customer=CustomerBrief.model_validate(u),
                hours_left=hours,
                late=hours is not None and hours < 0 and o.delivered_at is None,
            )
        )
    return Page(items=items, total=total)


# ---------- payments ----------


class AdminPaymentOut(CamelModel):
    id: uuid.UUID
    order_id: str | None
    customer_name: str | None
    razorpay_order_id: str | None
    razorpay_payment_id: str | None
    amount: int
    currency: str
    status: str
    method: str | None
    error: str | None
    created_at: datetime
    captured_at: datetime | None


@router.get("/payments")
async def admin_payments(
    db: DB,
    _: AdminAuth("payments"),
    status: str | None = None,
    unmatched: bool = Query(False, description="only money that arrived without a matching order"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[AdminPaymentOut]:
    query = (
        select(Payment, User.name)
        .outerjoin(Order, Order.id == Payment.order_id)
        .outerjoin(User, User.id == Order.customer_id)
    )
    if status:
        query = query.where(Payment.status == status)
    if unmatched:
        query = query.where(Payment.order_id.is_(None))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = await db.execute(query.order_by(Payment.created_at.desc()).limit(limit).offset(offset))
    items = [
        AdminPaymentOut(
            id=p.id,
            order_id=p.order_id,
            customer_name=name,
            razorpay_order_id=p.razorpay_order_id,
            razorpay_payment_id=p.razorpay_payment_id,
            amount=p.amount,
            currency=p.currency,
            status=p.status,
            method=p.method,
            error=p.error,
            created_at=p.created_at,
            captured_at=p.captured_at,
        )
        for p, name in rows
    ]
    return Page(items=items, total=total)


# ---------- refunds ----------


class AdminRefundOut(CamelModel):
    id: str
    order_id: str
    customer: CustomerBrief
    amount: int
    order_amount: int
    reason: str
    details: str | None
    status: str
    auto: bool
    decision_note: str | None
    error: str | None
    razorpay_refund_id: str | None
    created_at: datetime
    decided_at: datetime | None
    processed_at: datetime | None


def _refund_out(r: Refund, o: Order, u: User) -> AdminRefundOut:
    return AdminRefundOut(
        id=r.id,
        order_id=r.order_id,
        customer=CustomerBrief.model_validate(u),
        amount=r.amount,
        order_amount=o.amount,
        reason=r.reason,
        details=r.details,
        status=r.status,
        auto=r.auto,
        decision_note=r.decision_note,
        error=r.error,
        razorpay_refund_id=r.razorpay_refund_id,
        created_at=r.created_at,
        decided_at=r.decided_at,
        processed_at=r.processed_at,
    )


@router.get("/refunds")
async def admin_refunds(
    db: DB,
    _: AdminAuth("refunds"),
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[AdminRefundOut]:
    query = (
        select(Refund, Order, User).join(Order, Order.id == Refund.order_id).join(User, User.id == Order.customer_id)
    )
    if status:
        query = query.where(Refund.status == status)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = await db.execute(query.order_by(Refund.created_at.desc()).limit(limit).offset(offset))
    return Page(items=[_refund_out(r, o, u) for r, o, u in rows], total=total)


class ApproveIn(CamelModel):
    amount: int | None = Field(default=None, gt=0, description="paise; leave empty for a full refund")
    note: str | None = Field(default=None, max_length=1000)


class RejectIn(CamelModel):
    note: str = Field(min_length=5, max_length=1000)


async def _refund_in_review(db, refund_id: str) -> tuple[Refund, Order, User]:
    refund = (await db.execute(select(Refund).where(Refund.id == refund_id).with_for_update())).scalar_one_or_none()
    if refund is None:
        raise ApiError(404, "not_found", "No such refund.")
    if refund.status != "review":
        raise ApiError(409, "already_decided", "This refund has already been decided.")
    order = await lock_order(db, refund.order_id)
    user = await db.get(User, order.customer_id)
    return refund, order, user


@router.post("/refunds/{refund_id}/approve")
async def approve_refund(
    refund_id: str, body: ApproveIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("refunds")
) -> AdminRefundOut:
    rzp = get_razorpay()
    refund, order, user = await _refund_in_review(db, refund_id)
    amount = body.amount or refund.amount
    if amount > order.amount:
        raise ApiError(400, "amount_too_high", "The refund can’t be more than the order total.")
    payment = await captured_payment(db, order)
    refund.amount, refund.decided_by, refund.decided_at, refund.decision_note = amount, auth.user.id, now(), body.note
    audit(
        db,
        auth.user.id,
        "refund.approved",
        target=refund.id,
        data={"order_id": order.id, "amount": amount},
        ip=client_ip(request),
    )
    await send_to_razorpay(db, rzp, refund, order, payment, actor_id=auth.user.id)
    await db.commit()
    await send_safely(mailer, refund_emails.refund_started(user.email, user.name, order.id, amount))
    return _refund_out(refund, order, user)


@router.post("/refunds/{refund_id}/reject")
async def reject_refund(
    refund_id: str, body: RejectIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("refunds")
) -> AdminRefundOut:
    refund, order, user = await _refund_in_review(db, refund_id)
    refund.status, refund.decided_by, refund.decided_at = "rejected", auth.user.id, now()
    refund.decision_note = body.note.strip()
    audit(db, auth.user.id, "refund.rejected", target=refund.id, data={"order_id": order.id}, ip=client_ip(request))
    await db.commit()
    await send_safely(mailer, refund_emails.refund_rejected(user.email, user.name, order.id, refund.decision_note))
    return _refund_out(refund, order, user)
