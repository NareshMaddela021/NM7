"""Admin console API."""

import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.admin.deps import AdminAuth
from app.audit import AuditLog, audit
from app.auth.models import User
from app.auth.sessions import client_ip
from app.core.db import AUDIT_LOG, DB, ORDERS, PAYMENTS, REFUNDS, USERS
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orders.models import Order
from app.orders.schemas import OrderOut
from app.orders.service import get_order, order_views
from app.payments.models import Payment
from app.payments.razorpay import get_razorpay
from app.refunds import emails as refund_emails
from app.refunds.models import Refund
from app.refunds.service import captured_payment, send_to_razorpay

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _lookup_one(collection: str, local: str, as_: str) -> list[dict]:
    """Pipeline stages that attach one related document (or null) as `as_`."""
    return [
        {"$lookup": {"from": collection, "localField": local, "foreignField": "_id", "as": as_}},
        {"$set": {as_: {"$first": f"${as_}"}}},
    ]


def _page(match_stages: list[dict], sort: dict, offset: int, limit: int) -> list[dict]:
    return [
        *match_stages,
        {"$facet": {"items": [{"$sort": sort}, {"$skip": offset}, {"$limit": limit}], "total": [{"$count": "n"}]}},
    ]


async def _run_page(db: AsyncDatabase, collection: str, pipeline: list[dict]) -> tuple[list[dict], int]:
    result = await (await db[collection].aggregate(pipeline)).to_list()
    facet = result[0] if result else {"items": [], "total": []}
    return facet["items"], (facet["total"][0]["n"] if facet["total"] else 0)


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
    pipeline = [
        *([{"$match": {"action": action}}] if action else []),
        {"$sort": {"_id": -1}},
        {"$skip": offset},
        {"$limit": limit},
        *_lookup_one(USERS, "actor_id", "actor"),
    ]
    out = []
    async for raw in await db[AUDIT_LOG].aggregate(pipeline):
        a = AuditLog.load(raw)
        actor = raw.get("actor")
        out.append(
            AuditOut(
                id=a.id,
                actor_id=a.actor_id,
                actor_name=actor["name"] if actor else None,
                action=a.action,
                target=a.target,
                data=a.data,
                ip=a.ip,
                at=a.at,
            )
        )
    return out


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
    match: dict[str, Any] = {}
    if status:
        match["status"] = status
    if late:
        match.update({"status": {"$in": OPEN_ORDER}, "delivered_at": None, "deadline_at": {"$lt": now()}})
    stages: list[dict] = [{"$match": match}, *_lookup_one(USERS, "customer_id", "customer")]
    if q:
        like = {"$regex": re.escape(q.strip()), "$options": "i"}
        stages.append({"$match": {"$or": [{"_id": like}, {"customer.email": like}, {"customer.name": like}]}})
    stages.append(
        {
            "$set": {
                "_open": {"$cond": [{"$in": ["$status", OPEN_ORDER]}, 0, 1]},
                "_no_deadline": {"$cond": [{"$eq": [{"$ifNull": ["$deadline_at", None]}, None]}, 1, 0]},
            }
        }
    )
    sort = {"_open": 1, "_no_deadline": 1, "deadline_at": 1, "created_at": -1, "_id": -1}
    rows, total = await _run_page(db, ORDERS, _page(stages, sort, offset, limit))

    orders = [Order.load(r) for r in rows]
    views = await order_views(db, orders)
    items = []
    for o, view, raw in zip(orders, views, rows, strict=True):
        hours = (o.deadline_at - now()).total_seconds() / 3600 if o.deadline_at and o.status in OPEN_ORDER else None
        items.append(
            AdminOrderOut(
                **view.model_dump(),
                customer=CustomerBrief.model_validate(User.load(raw["customer"])),
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
    match: dict[str, Any] = {}
    if status:
        match["status"] = status
    if unmatched:
        match["order_id"] = None
    stages = [
        {"$match": match},
        *_lookup_one(ORDERS, "order_id", "order"),
        *_lookup_one(USERS, "order.customer_id", "customer"),
    ]
    rows, total = await _run_page(db, PAYMENTS, _page(stages, {"created_at": -1, "_id": -1}, offset, limit))
    items = []
    for raw in rows:
        p = Payment.load(raw)
        customer = raw.get("customer")
        items.append(
            AdminPaymentOut(
                id=p.id,
                order_id=p.order_id,
                customer_name=customer["name"] if customer else None,
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
        )
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
    stages = [
        {"$match": {"status": status} if status else {}},
        *_lookup_one(ORDERS, "order_id", "order"),
        *_lookup_one(USERS, "order.customer_id", "customer"),
    ]
    rows, total = await _run_page(db, REFUNDS, _page(stages, {"created_at": -1, "_id": -1}, offset, limit))
    items = [_refund_out(Refund.load(r), Order.load(r["order"]), User.load(r["customer"])) for r in rows]
    return Page(items=items, total=total)


class ApproveIn(CamelModel):
    amount: int | None = Field(default=None, gt=0, description="paise; leave empty for a full refund")
    note: str | None = Field(default=None, max_length=1000)


class RejectIn(CamelModel):
    note: str = Field(min_length=5, max_length=1000)


ALREADY_DECIDED = ApiError(409, "already_decided", "This refund has already been decided.")


async def _refund_in_review(db: AsyncDatabase, refund_id: str) -> tuple[Refund, Order, User]:
    refund = Refund.load(await db[REFUNDS].find_one({"_id": refund_id}))
    if refund is None:
        raise ApiError(404, "not_found", "No such refund.")
    if refund.status != "review":
        raise ALREADY_DECIDED
    order = await get_order(db, refund.order_id)
    user = User.load(await db[USERS].find_one({"_id": order.customer_id}))
    return refund, order, user


@router.post("/refunds/{refund_id}/approve")
async def approve_refund(
    refund_id: str, body: ApproveIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("refunds")
) -> AdminRefundOut:
    rzp = get_razorpay()
    before, order, user = await _refund_in_review(db, refund_id)
    amount = body.amount or before.amount
    if amount > order.amount:
        raise ApiError(400, "amount_too_high", "The refund can’t be more than the order total.")
    payment = await captured_payment(db, order)
    # Claim it atomically: if two admins approve at the same moment, only one sends money.
    claimed = await db[REFUNDS].find_one_and_update(
        {"_id": refund_id, "status": "review"},
        {
            "$set": {
                "status": "approved",
                "amount": amount,
                "decided_by": auth.user.id,
                "decided_at": now(),
                "decision_note": body.note,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if claimed is None:
        raise ALREADY_DECIDED
    refund = Refund.load(claimed)
    await send_to_razorpay(db, rzp, refund, order, payment, actor_id=auth.user.id, on_error="review", before=before)
    await audit(
        db,
        auth.user.id,
        "refund.approved",
        target=refund.id,
        data={"order_id": order.id, "amount": amount},
        ip=client_ip(request),
    )
    await send_safely(mailer, refund_emails.refund_started(user.email, user.name, order.id, amount))
    return _refund_out(refund, order, user)


@router.post("/refunds/{refund_id}/reject")
async def reject_refund(
    refund_id: str, body: RejectIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("refunds")
) -> AdminRefundOut:
    _, order, user = await _refund_in_review(db, refund_id)
    claimed = await db[REFUNDS].find_one_and_update(
        {"_id": refund_id, "status": "review"},
        {
            "$set": {
                "status": "rejected",
                "open": False,
                "decided_by": auth.user.id,
                "decided_at": now(),
                "decision_note": body.note.strip(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if claimed is None:
        raise ALREADY_DECIDED
    refund = Refund.load(claimed)
    await audit(
        db, auth.user.id, "refund.rejected", target=refund.id, data={"order_id": order.id}, ip=client_ip(request)
    )
    await send_safely(mailer, refund_emails.refund_rejected(user.email, user.name, order.id, refund.decision_note))
    return _refund_out(refund, order, user)
