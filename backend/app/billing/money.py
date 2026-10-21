"""Money for organization plans beyond checkout (Phase 4B), all by an admin and all audited:

  proforma          a request for payment (NM7PF/…), optionally with a Razorpay payment link; when the link is paid,
                    Razorpay's signed webhook ("payment_link.paid") marks the order paid → plan on, tax invoice
  offline payment   a bank transfer / cheque / PO payment the admin saw arrive: marks the order paid → plan on,
                    tax invoice (the same mark_paid() as Razorpay, so the same single transaction)
  refund            through the existing refund records (Razorpay refund, or an offline refund with a reference):
                    a credit note (NM7CN/…) against the original invoice, and the plan is adjusted

Razorpay is never called inside a database transaction (see refunds/service.py).
"""

import logging
from datetime import date, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.billing.checkout import _check_mode, new_org_order, quote
from app.billing.invoices import issue_credit_note, issue_proforma
from app.billing.settings import get_billing
from app.billing.subscription import _set_subscription, today_ist
from app.core.db import INVOICES, ORDERS, ORG_STAFF, ORGANIZATIONS, PAYMENTS, REFUNDS, Session, transaction
from app.core.errors import ApiError
from app.core.time import now
from app.orders.models import Order
from app.orders.service import PAYABLE, get_order, mark_paid
from app.partners.service import reverse_commission
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay
from app.refunds.models import SETTLED, Refund
from app.refunds.service import new_refund, refundable_amount, refunded_amount, send_to_razorpay

log = logging.getLogger("nm7.billing")

OFFLINE_METHODS = ("bank_transfer", "upi", "cheque", "purchase_order", "cash", "other")


async def _payer_id(db: AsyncDatabase, o: dict[str, Any], fallback: str) -> str:
    """Org orders made by Nm7 are billed to the Owner (receipts go to the Owners either way)."""
    owner = await db[ORG_STAFF].find_one(
        {"org_id": o["_id"], "role": "owner", "status": "active", "user_id": {"$type": "string"}},
        sort=[("created_at", 1)],
    )
    return owner["user_id"] if owner else fallback


async def org_order(db: AsyncDatabase, org_id: str, order_id: str, session: Session = None) -> Order:
    order = await get_order(db, order_id, session=session)
    if order is None or order.kind != "org" or order.org_id != org_id:
        raise ApiError(404, "not_found", "No such order for this organization.")
    return order


# ---------- proforma ----------
async def create_proforma(
    db: AsyncDatabase, o: dict[str, Any], admin_id: str, plan_id: str, extra_discount_pct: int, with_link: bool
) -> dict[str, Any]:
    q = await quote(db, o, plan_id, extra_discount_pct=extra_discount_pct)
    if q["total"] <= 0:
        raise ApiError(409, "nothing_to_pay", "This plan costs nothing after the discount — assign it instead.")
    order = await new_org_order(db, o, await _payer_id(db, o, admin_id), q, via="proforma")
    payment = None
    link = None
    if with_link:
        b = await get_billing(db)
        rzp = get_razorpay()  # 503 until keys are set
        _check_mode(rzp.key_id, bool(b["razorpay_live"]))
        buyer = q["buyer"]
        customer = {k: v for k, v in {"name": buyer.get("legal_name"), "email": buyer.get("email")}.items() if v}
        try:
            r = await rzp.create_payment_link(
                order.amount,
                order.id,
                f"{q['terms']['plan_name']} plan · {o['name']}",
                customer,
                {"order_id": order.id, "org_id": o["_id"], "kind": "org"},
                int((now() + timedelta(days=int(b["payment_link_days"]))).timestamp()),
            )
        except RazorpayError as e:
            log.warning("payment link for %s: %s", order.id, e)
            raise ApiError(502, "payment_provider_error", "Razorpay didn’t create the payment link. Try again.") from e
        link = r.get("short_url")
        payment = Payment(
            order_id=order.id, razorpay_link_id=r["id"], amount=order.amount, status="created", raw={"link": r}
        )

    async def save(s):
        await db[ORDERS].insert_one(order.to_mongo(), session=s)
        if payment:
            await db[PAYMENTS].insert_one(payment.to_mongo(), session=s)

    await transaction(save)
    doc = await issue_proforma(db, order, link)
    data = {"orgs": [o["_id"]], "order_id": order.id, "number": doc["number"], "amount": order.amount,
            "plan": plan_id, "link": bool(link)}  # fmt: skip
    await audit(db, admin_id, "proforma_issued", target=o["_id"], data=data)
    return doc


# ---------- offline payment ----------
async def record_offline(
    db: AsyncDatabase,
    o: dict[str, Any],
    admin_id: str,
    *,
    order_id: str | None,
    plan_id: str | None,
    extra_discount_pct: int,
    method: str,
    reference: str,
    paid_on: date,
    amount: int,
) -> Order:
    """The admin saw the money arrive (bank, cheque, PO …): the order is paid → plan on, tax invoice issued."""
    if order_id:
        order = await org_order(db, o["_id"], order_id)
        if order.status not in PAYABLE:
            raise ApiError(409, "already_paid", "This order is already paid.")
    else:
        if not plan_id:
            raise ApiError(400, "plan_required", "Choose the plan that was paid for.")
        q = await quote(db, o, plan_id, extra_discount_pct=extra_discount_pct)
        if q["total"] <= 0:
            raise ApiError(409, "nothing_to_pay", "This plan costs nothing after the discount — assign it instead.")
        order = await new_org_order(db, o, await _payer_id(db, o, admin_id), q, via="offline")
    if amount != order.amount:
        raise ApiError(
            400, "amount_mismatch", f"The order total is {order.amount / 100:.2f} rupees (GST included); "
            "record the payment for exactly that amount, or issue a new proforma.",
        )  # fmt: skip
    if paid_on > today_ist():
        raise ApiError(400, "bad_date", "The payment date can’t be in the future.")
    payment = Payment(
        order_id=order.id,
        amount=order.amount,
        status="created",
        method=method,
        raw={"offline": {"reference": reference, "paid_on": paid_on.isoformat(), "recorded_by": admin_id}},
    )

    async def save(s):
        if not order_id:
            await db[ORDERS].insert_one(order.to_mongo(), session=s)
        await db[PAYMENTS].insert_one(payment.to_mongo(), session=s)

    await transaction(save)
    paid, first = await mark_paid(db, payment.id, None, method, source="offline")
    if not first:  # paid a moment ago by other means (its payment link): keep the record, say so
        await db[PAYMENTS].update_one({"_id": payment.id}, {"$set": {"error": "Order was already paid"}})
        raise ApiError(409, "already_paid", "This order was already paid (by its payment link). Nothing recorded.")
    await db[ORDERS].update_one({"_id": order.id}, {"$set": {"billing.paid_via": "offline"}})
    await _cancel_links(db, order.id)
    data = {"orgs": [o["_id"]], "order_id": order.id, "amount": amount, "method": method, "reference": reference,
            "paid_on": paid_on.isoformat(), "invoice_no": paid.invoice_no}  # fmt: skip
    await audit(db, admin_id, "payment_offline", target=o["_id"], data=data)
    return paid


async def _cancel_links(db: AsyncDatabase, order_id: str) -> None:
    """Paid another way: close the proforma's payment link so it can't be paid twice (best effort)."""
    async for p in db[PAYMENTS].find(
        {"order_id": order_id, "razorpay_link_id": {"$type": "string"}, "status": "created"}
    ):
        try:
            await get_razorpay().cancel_payment_link(p["razorpay_link_id"])
            await db[PAYMENTS].update_one({"_id": p["_id"]}, {"$set": {"status": "failed", "error": "Link cancelled"}})
        except (ApiError, RazorpayError) as e:
            log.warning("cancel payment link %s: %s", p["razorpay_link_id"], e)


# ---------- refunds → credit notes ----------
async def refund_org_order(
    db: AsyncDatabase, order: Order, admin_id: str, amount: int | None, note: str, offline_reference: str | None
) -> list[dict[str, Any]]:
    """Refund (all or part of) a paid organization order through the existing refund records. Returns the credit
    notes issued."""
    if order.paid_at is None or not order.invoice_no:
        raise ApiError(409, "not_refundable", "This order isn’t paid, so there’s nothing to refund.")
    remaining = await refundable_amount(db, order)
    amount = amount or remaining
    if remaining <= 0:
        raise ApiError(409, "already_refunded", "This order has already been refunded in full.")
    if amount > remaining:
        raise ApiError(400, "amount_too_high", "The refund can’t be more than what’s left of the order total.")
    payment = Payment.load(await db[PAYMENTS].find_one({"order_id": order.id, "status": "captured"}))
    if payment is None:
        raise ApiError(409, "not_refundable", "This order has no completed payment to refund.")
    t = now()
    fields = {"amount": amount, "reason": "other", "details": note, "requested_by": admin_id, "decided_by": admin_id,
              "decided_at": t, "decision_note": note}  # fmt: skip
    if payment.razorpay_payment_id:
        if offline_reference:
            raise ApiError(400, "online_payment", "This was paid through Razorpay: refund it through Razorpay.")
        refund = await new_refund(db, order, payment, status="approved", **fields)
        await send_to_razorpay(db, get_razorpay(), refund, order, payment, actor_id=admin_id, on_error="delete")
    else:
        if not offline_reference:
            raise ApiError(400, "reference_required", "Give the bank / UTR reference of the money sent back.")
        fields["decision_note"] = f"{note} · sent back offline, ref {offline_reference}".strip(" ·")
        refund = await new_refund(db, order, payment, status="processed", processed_at=t, **fields)
        full = amount + await refunded_amount(db, order.id, exclude=refund.id) >= order.amount

        async def record(s):
            if full:
                await db[ORDERS].update_one(
                    {"_id": order.id}, {"$set": {"status": "refunded", "updated_at": t}}, session=s
                )
                await db[PAYMENTS].update_one(
                    {"_id": payment.id}, {"$set": {"status": "refunded", "updated_at": t}}, session=s
                )
            data = {"order_id": order.id, "amount": amount, "reference": offline_reference}
            await audit(db, admin_id, "refund.offline", target=refund.id, data=data, session=s)

        await transaction(record)
    return await settle_credit_notes(db, order.id, admin_id)


async def settle_credit_notes(db: AsyncDatabase, order_id: str, actor_id: str | None = None) -> list[dict[str, Any]]:
    """A credit note for every sent refund of the order that has none yet (safe to repeat: one per refund), and the
    plan adjusted when the order is refunded in full. Also catches up after a crash between refund and note."""
    issued = []
    async for r in db[REFUNDS].find({"order_id": order_id, "status": {"$in": list(SETTLED)}}).sort("created_at", 1):
        refund = Refund.load(r)

        async def run(s, refund=refund):
            if await db[INVOICES].find_one({"refund_id": refund.id}, {"_id": 1}, session=s):
                return None
            order = await get_order(db, order_id, session=s)
            invoice = await db[INVOICES].find_one({"order_id": order_id, "kind": "invoice"}, session=s)
            if order is None or invoice is None:
                return None
            reason = refund.decision_note or refund.details or "Refund"
            note = await issue_credit_note(db, invoice, order, refund.amount, reason, refund.id, session=s)
            settled = sum(
                [x["amount"] async for x in db[REFUNDS].find(
                    {"order_id": order_id, "status": {"$in": list(SETTLED)}}, {"amount": 1}, session=s
                )]
            )  # fmt: skip
            await _adjust_plan(db, order, full=settled >= order.amount, session=s)
            data = {"orgs": [order.org_id], "order_id": order_id, "refund_id": refund.id, "number": note["number"],
                    "invoice": invoice["number"], "amount": refund.amount}  # fmt: skip
            await audit(db, actor_id, "credit_note_issued", target=order.org_id, data=data, session=s)
            await reverse_commission(db, order, refund.id, note, session=s)  # the matching partner commission
            return note

        note = await transaction(run)
        if note:
            issued.append(note)
    return issued


async def _adjust_plan(db: AsyncDatabase, order: Order, *, full: bool, session: Session) -> None:
    """A full refund of the order that bought the current plan takes that plan back: a renewal refunded before it
    started gives back the plan it was renewing; otherwise the organization is on Free (nothing is deleted). A
    part refund keeps the plan (a goodwill discount); the admin can still change dates under Billing."""
    if not full:
        return
    o = await db[ORGANIZATIONS].find_one({"_id": order.org_id}, session=session)
    sub = (o or {}).get("subscription") or {}
    if sub.get("order_id") != order.id:
        return  # the plan has moved on since (a later renewal or an admin's assignment): leave it to the admin
    history = o.get("subscription_history") or []
    prev = history[-1] if history else None
    today = today_ist().isoformat()
    if prev and prev.get("plan_id") not in (None, "free") and (prev.get("ends_on") or "") >= today:
        back = {k: v for k, v in prev.items() if k != "replaced_at"}
    else:
        back = {"plan_id": "free", "plan_name": "Free", "source": "refund", "order_id": order.id}
    await _set_subscription(db, o, back, session=session)
    data = {"orgs": [o["_id"]], "order_id": order.id, "plan": back["plan_id"], "was": sub.get("plan_id")}
    await audit(db, None, "plan_refunded", target=o["_id"], data=data, session=session)
