"""Creating orders, marking them paid, and building the order views the API returns."""

import logging
from datetime import datetime, timedelta

from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.auth.models import User
from app.billing.invoices import issue_invoice
from app.billing.subscription import activate_paid
from app.core.db import ORDERS, PAYMENTS, REFUNDS, Session, next_number, transaction
from app.core.time import financial_year, now
from app.coupons.service import mark_used as coupon_used
from app.linkedin.pack import on_order_paid as pack_paid
from app.orders.models import ORDER_NO_START, Order, OrderItem
from app.orders.pricing import CURRENCY, SELF_SERVE, price
from app.orders.schemas import OrderOut
from app.partners.service import on_org_paid
from app.payments.models import Payment
from app.refunds.models import Refund
from app.site import get_site

log = logging.getLogger("nm7.orders")

PAYABLE = ("pending_payment", "expired", "awaiting_payment")  # a late payment for an expired order still counts
UNPAID_EXPIRES_AFTER = timedelta(hours=24)


async def next_invoice_no(db: AsyncDatabase, at: datetime, session: Session = None) -> str:
    fy = financial_year(at)
    n = await next_number(db, f"invoice:{fy}", 1, session=session)
    return f"NM7/{fy}/{n:04d}"


async def next_receipt_no(db: AsyncDatabase, at: datetime, session: Session = None) -> str:
    """A payment receipt (not a tax invoice): WhatsApp payments while business details aren't set."""
    fy = financial_year(at)
    n = await next_number(db, f"receipt:{fy}", 1, session=session)
    return f"NM7R/{fy}/{n:04d}"


async def build_order(
    db: AsyncDatabase, customer: User, plan: str, role: str | None, addons: list[str], coupon: dict | None = None
) -> Order:
    """Prices the order and reserves its number. Not saved yet (the caller saves it with its payment, then reserves
    the code's use with app.coupons.flow.reserve_for). `coupon`: a checked code, its discount lowers the amount."""
    from app.coupons.flow import coupon_doc, discounted

    items = price(plan, addons, await get_site(db))
    original = d = 0
    if coupon:
        items, original, d = discounted(items, coupon)
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
        coupon=coupon_doc(coupon, original, d) if coupon else None,
    )


async def addon_price(db: AsyncDatabase, parent: Order, item: str) -> tuple[str, str, str, int]:
    """(kind, code, name, amount) for an add-on ("express", "revision", "linkedin") or an upgrade
    ("upgrade:expert" / "upgrade:launch") on a paid order; the price always comes from the server."""
    from app.core.errors import ApiError

    site = await get_site(db)
    if item.startswith("upgrade:"):
        to = item.split(":", 1)[1]
        plans = site["plans"]
        if to not in ("expert", "launch") or to == parent.plan or not plans.get(to, {}).get("active"):
            raise ApiError(400, "bad_item", "That upgrade isn’t available.")
        amount = plans[to]["amount"] - plans.get(parent.plan, {}).get("amount", 0)
        kind, code, name = "upgrade", to, f"Upgrade to {plans[to]['name']}"
    else:
        a = site["addons"].get(item)
        if not a or not a.get("active") or parent.plan in SELF_SERVE:
            raise ApiError(400, "bad_item", "That add-on isn’t available.")
        if any(i.code == item for i in parent.items):
            raise ApiError(409, "already_added", "This order already has that.")
        kind, code, name, amount = "addon", item, a["name"], a["amount"]
    if amount <= 0:
        raise ApiError(400, "bad_item", "That upgrade isn’t available.")
    return kind, code, name, amount


async def build_addon_order(db: AsyncDatabase, customer: User, parent: Order, item: str) -> Order:
    """A separate order (kind "addon") for one add-on / upgrade on a paid order; paid through Razorpay like any
    order, then added to the parent order (apply_addon)."""
    kind, code, name, amount = await addon_price(db, parent, item)
    n = await next_number(db, "order_no", ORDER_NO_START)
    return Order(
        _id=f"RS-{n}",
        kind="addon",
        parent_id=parent.id,
        customer_id=customer.id,
        plan=code if kind == "upgrade" else parent.plan,
        target_role=parent.target_role,
        status="pending_payment",
        amount=amount,
        currency=CURRENCY,
        items=[OrderItem(position=0, kind=kind, code=code, name=name, amount=amount)],
    )


async def apply_addon(db: AsyncDatabase, order: Order, at: datetime, session: Session = None) -> None:
    """A paid add-on / upgrade lands on its parent order: the line is added (marked paid through this order); an
    upgrade changes the plan (a finished self-serve order goes back to "finding an expert"); Express brings the
    deadline forward to 24 hours from now at the latest."""
    parent = await get_order(db, order.parent_id or "", session=session)
    if parent is None:
        return
    line = order.items[0]
    nxt = max((i.position for i in parent.items), default=-1) + 1
    item = {**OrderItem(position=nxt, kind=line.kind, code=line.code, name=line.name, amount=line.amount).model_dump(),
            "paid_via": order.id}  # fmt: skip
    sets: dict = {"updated_at": at}
    if line.kind == "upgrade":
        sets["plan"] = line.code
        if parent.status == "done" and parent.plan in SELF_SERVE:
            hours = (await get_site(db, session=session))["delivery_hours"]
            sets.update(status="offer", deadline_at=at + timedelta(hours=hours))
    elif line.code == "express" and parent.deadline_at and parent.status in ("offer", "in_progress", "waiting"):
        sets["deadline_at"] = min(parent.deadline_at, at + timedelta(hours=24))
    await db[ORDERS].update_one({"_id": parent.id}, {"$push": {"items": item}, "$set": sets}, session=session)


async def get_order(db: AsyncDatabase, order_id: str, session: Session = None) -> Order | None:
    return Order.load(await db[ORDERS].find_one({"_id": order_id}, session=session))


async def mark_paid(
    db: AsyncDatabase,
    payment_id: str,
    razorpay_payment_id: str | None,
    method: str | None = None,
    raw: dict | None = None,
    source: str = "razorpay",
    invoice: bool = True,
) -> tuple[Order, bool]:
    """Records a successful payment in one transaction (payment, order, invoice number). Safe to call more than
    once (checkout handler and webhook both do): returns (order, True) only the first time, so the receipt email
    goes out once. Two callers at the same moment conflict and one is retried, then sees it already paid.
    `invoice=False` (a WhatsApp payment before business details are set): a receipt number instead of a tax
    invoice, and no invoice document for an organization."""

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
        if invoice:
            order.invoice_no = await next_invoice_no(db, at, session=s)
        else:
            order.receipt_no = await next_receipt_no(db, at, session=s)
        if order.kind == "org":
            order.status = "done"  # the organization's plan turns on in this same transaction
            await activate_paid(db, order, source=source, session=s)
            if invoice:
                await issue_invoice(db, order, at, session=s)  # its tax invoice, under the same number
            await on_org_paid(db, order, at, session=s)  # partner tie (first payment) and commission
        elif order.kind == "addon":
            order.status = "done"  # an add-on / upgrade for a paid order: added to that order below
            if invoice and order.billing:
                await issue_invoice(db, order, at, session=s)
            await apply_addon(db, order, at, session=s)
        elif order.plan in SELF_SERVE:
            order.status = "done"  # unlocked at once: downloads (diy) or the LinkedIn pack
            if invoice and order.billing:  # its GST invoice, under the same number (app/payments/customer_invoice.py)
                await issue_invoice(db, order, at, session=s)
        else:
            order.status = "offer"  # paid; finding an expert
            express = any(i.code == "express" for i in order.items)
            hours = (await get_site(db, session=s))["delivery_hours"]
            order.deadline_at = at + timedelta(hours=min(24, hours) if express else hours)
            if invoice and order.billing:
                await issue_invoice(db, order, at, session=s)
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
                    "receipt_no": order.receipt_no,
                    "deadline_at": order.deadline_at,
                    "updated_at": at,
                }
            },
            session=s,
        )
        await pack_paid(db, order, at, session=s)  # the LinkedIn pack (its own order, or Career Launch)
        await coupon_used(db, order.id, session=s)  # a code reserved by this order now counts for good
        return order, True

    order, first = await transaction(run)
    if first:
        log.info("Order %s paid (%s)", order.id, razorpay_payment_id)
    return order, first


async def expire_unpaid(db: AsyncDatabase) -> int:
    from app.coupons.service import release

    q = {"status": "pending_payment", "created_at": {"$lt": now() - UNPAID_EXPIRES_AFTER}}
    with_code = [o["_id"] async for o in db[ORDERS].find({**q, "coupon": {"$ne": None}}, {"_id": 1})]
    r = await db[ORDERS].update_many(q, {"$set": {"status": "expired", "updated_at": now()}})
    if with_code:
        await release(db, with_code)  # unpaid orders give their code's use back
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
