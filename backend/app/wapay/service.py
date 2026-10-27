"""Paying on WhatsApp: a pending order, a chat with Nm7, and an admin who marks it paid once the money is in.

Order numbers: NM7-24001, NM7-24002, … (their own counter). Status awaiting_payment until an Owner / Finance admin
marks it paid (method UPI / bank / cash, the UTR or reference, the amount received, the date) or cancels it; unpaid
orders are cancelled by themselves after the hours set in Admin → Settings → Payments.

Marking paid runs the same mark_paid() as a Razorpay payment, in one transaction: the LinkedIn pack unlocks, DIY
downloads unlock, an expert order goes to "finding your expert" (its delivery time starts now), an organization's
plan turns on. Until business details are set (Admin → Billing settings: legal name, address, GSTIN) the payment
gets a receipt number from "Nm7" (NM7R/…) and no GST invoice.

Safety, all checked here (the screens only hide buttons):
- only an admin with the "payments" permission (Owner, Finance) can mark paid, cancel or refund; customers never;
- a UTR / reference is used once across all orders (also a unique index on payments.reference);
- an amount different from the order total needs a reason;
- an order is marked paid once; a cancelled order can't be paid.
"""

import csv
import io
import logging
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote as urlquote

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.models import User
from app.billing.settings import get_billing
from app.core.db import ORDERS, PAYMENTS, REFUNDS, USERS, next_number, transaction
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.time import IST, now
from app.linkedin.pack import on_order_refunded as pack_refunded
from app.orders.models import Order, OrderItem
from app.orders.pricing import CURRENCY, price
from app.orders.service import get_order, mark_paid
from app.payments.models import Payment
from app.refunds.service import new_refund, refundable_amount, refunded_amount
from app.site import get_site
from app.wapay.settings import business_ready, get_payments, payment_mode

log = logging.getLogger("nm7.wapay")

WA_ORDER_START = 24001
METHODS = ("upi", "bank", "cash")
MAX_OPEN = 5  # unpaid WhatsApp orders a person may have at once
NOT_WHATSAPP = ApiError(409, "not_whatsapp", "Payments on WhatsApp aren’t switched on.")


async def new_order_id(db: AsyncDatabase) -> str:
    return f"NM7-{await next_number(db, 'wa_order_no', WA_ORDER_START)}"


def rupees(paise: int) -> str:
    r = paise / 100
    return f"{r:,.0f}" if r == int(r) else f"{r:,.2f}"


def item_text(order: Order) -> str:
    """'LinkedIn pack', 'Expert rewrite + Express delivery (24h)', 'Nm7 for Organizations · Drive plan (12 months)'."""
    parts = [i.name for i in order.items if i.kind in ("plan", "addon")]
    return " + ".join(parts) or order.plan


def wa_message(order: Order) -> str:
    """Only the item, the price, the code (if any) and the order number: no email, phone or other personal data in
    the link."""
    c = order.coupon
    if c and c.get("discount"):
        return (f"Hi Nm7, I want to buy {item_text(order)} (Rs {rupees(c['original'])} -> Rs {rupees(order.amount)} "
                f"with code {c['code']}). Order {order.id}.")  # fmt: skip
    return f"Hi Nm7, I want to buy {item_text(order)} (Rs {rupees(order.amount)}). Order {order.id}."


def wa_url(number: str, text: str) -> str:
    digits = "".join(c for c in number if c.isdigit())
    return f"https://wa.me/{digits}?text={urlquote(text, safe='')}"


async def _whatsapp_on(db: AsyncDatabase) -> dict[str, Any]:
    p = await get_payments(db)
    if await payment_mode(db) != "whatsapp":
        raise NOT_WHATSAPP
    return p


async def _limit_open(db: AsyncDatabase, user_id: str) -> None:
    n = await db[ORDERS].count_documents({"customer_id": user_id, "status": "awaiting_payment"})
    if n >= MAX_OPEN:
        raise ApiError(429, "too_many_open", "You have several orders waiting for payment. Finish or cancel one first.")


def checkout_out(order: Order, p: dict[str, Any]) -> dict[str, Any]:
    text = wa_message(order)
    return {
        "orderId": order.id,
        "item": item_text(order),
        "amount": order.amount,
        "message": text,
        "waUrl": wa_url(p["whatsapp_number"], text),
        "replyHours": p["reply_hours"],
    }


async def addon_chat(db: AsyncDatabase, user: User, order_id: str, item: str) -> dict[str, Any]:
    """An add-on or an upgrade for a paid order the customer owns: the chat link only (Nm7 adds it after payment,
    as before). Only the item, the price and the order number go in the message."""
    p = await _whatsapp_on(db)
    order = await get_order(db, order_id)
    if order.customer_id != user.id or order.kind == "org" or not order.paid_at or order.status == "refunded":
        raise ApiError(404, "not_found", "Order not found.")
    site = await get_site(db)
    if item.startswith("upgrade:"):
        to = item.split(":", 1)[1]
        plans = site["plans"]
        if to not in ("expert", "launch") or to == order.plan or not plans.get(to, {}).get("active"):
            raise ApiError(400, "bad_item", "That upgrade isn’t available.")
        name, amount = f"Upgrade to {plans[to]['name']}", plans[to]["amount"] - plans[order.plan]["amount"]
    else:
        a = site["addons"].get(item)
        if not a or not a.get("active"):
            raise ApiError(400, "bad_item", "That add-on isn’t available.")
        name, amount = a["name"], a["amount"]
    if amount <= 0:
        raise ApiError(400, "bad_item", "That upgrade isn’t available.")
    text = f"Hi Nm7, I want to add {name} (Rs {rupees(amount)}) to order {order.id}."
    return {"orderId": order.id, "item": name, "amount": amount, "message": text,
            "waUrl": wa_url(p["whatsapp_number"], text), "replyHours": p["reply_hours"]}  # fmt: skip


async def create_customer_order(
    db: AsyncDatabase, user: User, plan: str, role: str | None, addons: list[str], coupon: dict | None = None
):
    """`coupon`: a checked code (app/coupons); its discount comes off the order and its use is reserved until the
    order is paid (given back if it is cancelled)."""
    from app.coupons.flow import coupon_doc, discounted, reserve_for

    p = await _whatsapp_on(db)
    await _limit_open(db, user.id)
    items = price(plan, addons, await get_site(db))
    original = d = 0
    if coupon:
        items, original, d = discounted(items, coupon)
    order = Order(
        _id=await new_order_id(db),
        customer_id=user.id,
        plan=plan,
        target_role=(role or "").strip() or None,
        status="awaiting_payment",
        method="whatsapp",
        amount=sum(i[3] for i in items),
        currency=CURRENCY,
        items=[
            OrderItem(position=pos, kind=kind, code=code, name=name, amount=amount)
            for pos, (kind, code, name, amount) in enumerate(items)
        ],
        coupon=coupon_doc(coupon, original, d) if coupon else None,
    )
    await db[ORDERS].insert_one(order.to_mongo())
    if coupon:
        await reserve_for(db, order, coupon)
    return order, checkout_out(order, p)


async def create_org_order(db: AsyncDatabase, o: dict[str, Any], payer: User, q: dict[str, Any], **extra):
    """An organization's plan, paid on WhatsApp (the same quote, discount and GST as Razorpay's checkout; a code in
    the quote is reserved until the order is paid)."""
    from app.billing.checkout import new_org_order  # (billing imports this package)
    from app.coupons.flow import reserve_for
    from app.coupons.service import get as get_coupon

    p = await _whatsapp_on(db)
    await _limit_open(db, payer.id)
    order = await new_org_order(db, o, payer.id, q, **extra)
    order.id = await new_order_id(db)
    order.status = "awaiting_payment"
    order.method = "whatsapp"
    await db[ORDERS].insert_one(order.to_mongo())
    if order.coupon:
        await reserve_for(db, order, await get_coupon(db, order.coupon["code"]))
    return order, checkout_out(order, p)


# ---------- admin ----------


def norm_ref(v: str) -> str:
    return "".join((v or "").split()).upper()


async def _wa_order(db: AsyncDatabase, order_id: str) -> Order:
    order = await get_order(db, order_id)
    if order is None or order.method != "whatsapp":
        raise ApiError(404, "not_found", "No such WhatsApp order.")
    return order


async def mark_paid_whatsapp(
    db: AsyncDatabase,
    order_id: str,
    admin_id: str,
    *,
    method: str,
    reference: str,
    amount: int,
    paid_on: date,
    reason: str = "",
) -> tuple[Order, bool]:
    """The admin saw the money arrive. Returns (order, issued_invoice)."""
    order = await _wa_order(db, order_id)
    if order.status == "cancelled":
        raise ApiError(409, "cancelled", "This order was cancelled. Ask the customer to place a new one.")
    if order.status != "awaiting_payment":
        raise ApiError(409, "already_paid", "This order is already paid.")
    ref = norm_ref(reference)
    if len(ref) < 4:
        raise ApiError(400, "reference_required", "Enter the UTR or reference of the payment.")
    if amount <= 0:
        raise ApiError(400, "bad_amount", "Enter the amount received.")
    if amount != order.amount and len(reason.strip()) < 3:
        raise ApiError(400, "reason_required", "The amount is different from the order total: say why.")
    if paid_on > now().astimezone(IST).date():
        raise ApiError(400, "bad_date", "The payment date can’t be in the future.")
    if paid_on < (now() - timedelta(days=60)).astimezone(IST).date():
        raise ApiError(400, "bad_date", "That payment date is more than 60 days ago.")
    if await _reference_used(db, ref):
        raise ApiError(409, "duplicate_reference", "This UTR / reference is already recorded on another payment.")
    payment = Payment(
        order_id=order.id,
        amount=amount,
        status="created",
        method=method,
        reference=ref,
        raw={"whatsapp": {"paid_on": paid_on.isoformat(), "recorded_by": admin_id, "reason": reason.strip()}},
    )
    try:
        await db[PAYMENTS].insert_one(payment.to_mongo())
    except DuplicateKeyError:
        raise ApiError(
            409, "duplicate_reference", "This UTR / reference is already recorded on another payment."
        ) from None
    invoice = business_ready(await get_billing(db))
    paid, first = await mark_paid(db, payment.id, None, method, source="whatsapp", invoice=invoice)
    if not first:  # marked paid a moment ago by another admin
        await db[PAYMENTS].delete_one({"_id": payment.id})
        raise ApiError(409, "already_paid", "This order is already paid.")
    data = {"order_id": order.id, "method": method, "reference": ref, "amount": amount, "order_amount": order.amount,
            "paid_on": paid_on.isoformat(), "reason": reason.strip(), "receipt_no": paid.receipt_no,
            "invoice_no": paid.invoice_no}  # fmt: skip
    if order.kind == "org":
        data["orgs"] = [order.org_id]
    await audit(db, admin_id, "whatsapp.paid", target=order.id, data=data)
    return paid, invoice


async def _reference_used(db: AsyncDatabase, ref: str) -> bool:
    """Across all orders: WhatsApp payments, and the references of offline payments recorded for organizations."""
    if await db[PAYMENTS].find_one({"reference": ref}, {"_id": 1}):
        return True
    async for p in db[PAYMENTS].find({"raw.offline.reference": {"$type": "string"}}, {"raw.offline.reference": 1}):
        if norm_ref(p["raw"]["offline"]["reference"]) == ref:
            return True
    return False


async def cancel(db: AsyncDatabase, order_id: str, actor_id: str | None, reason: str) -> Order:
    order = await _wa_order(db, order_id)
    r = await db[ORDERS].update_one(
        {"_id": order.id, "status": "awaiting_payment"},
        {"$set": {"status": "cancelled", "cancel_reason": reason.strip()[:300], "updated_at": now()}},
    )
    if not r.modified_count:
        raise ApiError(409, "not_cancellable", "Only an order waiting for payment can be cancelled.")
    await release_codes(db, [order.id])
    await audit(db, actor_id, "whatsapp.cancelled", target=order.id, data={"order_id": order.id, "reason": reason})
    return await get_order(db, order.id)


async def cancel_stale(db: AsyncDatabase) -> int:
    """Automation: unpaid WhatsApp orders older than the hours in Admin → Settings → Payments are cancelled."""
    hours = int((await get_payments(db))["cancel_after_hours"] or 72)
    stale = [
        o["_id"]
        async for o in db[ORDERS].find(
            {"status": "awaiting_payment", "created_at": {"$lt": now() - timedelta(hours=hours)}}, {"_id": 1}
        )
    ]
    if not stale:
        return 0
    r = await db[ORDERS].update_many(
        {"_id": {"$in": stale}, "status": "awaiting_payment"},
        {"$set": {"status": "cancelled", "cancel_reason": f"Not paid within {hours} hours", "updated_at": now()}},
    )
    await release_codes(db, stale)
    for oid in stale:
        await audit(
            db, None, "whatsapp.cancelled", target=oid, data={"order_id": oid, "reason": "auto", "hours": hours}
        )
    return r.modified_count


async def release_codes(db: AsyncDatabase, order_ids: list[str]) -> None:
    from app.coupons.service import release

    await release(db, order_ids)


async def refund(
    db: AsyncDatabase, order_id: str, admin_id: str, *, method: str, reference: str, amount: int | None, note: str
) -> Order:
    """Money sent back to the customer's UPI / bank (the existing refund records, as a processed offline refund).
    A full refund removes access: the LinkedIn pack, DIY downloads (the order no longer counts), an organization's
    plan (back to Free, or the plan it was renewing)."""
    order = await _wa_order(db, order_id)
    if order.paid_at is None or order.status in ("refunded", "cancelled"):
        raise ApiError(409, "not_refundable", "This order isn’t paid, so there’s nothing to refund.")
    payment = Payment.load(await db[PAYMENTS].find_one({"order_id": order.id, "status": "captured"}))
    if payment is None:
        raise ApiError(409, "not_refundable", "This order has no recorded payment to refund.")
    ref = norm_ref(reference)
    if len(ref) < 4:
        raise ApiError(400, "reference_required", "Enter the UTR or reference of the money sent back.")
    remaining = await refundable_amount(db, order)
    amount = amount or remaining
    if remaining <= 0:
        raise ApiError(409, "already_refunded", "This order has already been refunded in full.")
    if amount > remaining:
        raise ApiError(400, "amount_too_high", "The refund can’t be more than what’s left of the order total.")
    t = now()
    open_ = await db[REFUNDS].find_one({"order_id": order.id, "open": True})
    decision = f"{note.strip()} · sent back by {method}, ref {ref}".strip(" ·")
    if open_:  # the customer asked for it: settle that request
        await db[REFUNDS].update_one(
            {"_id": open_["_id"]},
            {"$set": {"status": "processed", "open": False, "amount": amount, "decided_by": admin_id,
                      "decided_at": t, "processed_at": t, "decision_note": decision}},
        )  # fmt: skip
        refund_id = open_["_id"]
    else:
        fields = {"amount": amount, "reason": "other", "details": note.strip() or None, "requested_by": admin_id,
                  "decided_by": admin_id, "decided_at": t, "decision_note": decision}  # fmt: skip
        refund_id = (await new_refund(db, order, payment, status="processed", processed_at=t, **fields)).id
    full = amount + await refunded_amount(db, order.id, exclude=refund_id) >= order.amount

    async def record(s):
        if full:
            await db[ORDERS].update_one({"_id": order.id}, {"$set": {"status": "refunded", "updated_at": t}}, session=s)
            await db[PAYMENTS].update_one(
                {"_id": payment.id}, {"$set": {"status": "refunded", "updated_at": t}}, session=s
            )
            await pack_refunded(db, order, session=s)
            if order.kind == "org":
                from app.billing.money import _adjust_plan  # (billing imports this package)

                await _adjust_plan(db, order, full=True, session=s)
        data = {"order_id": order.id, "amount": amount, "method": method, "reference": ref, "full": full}
        if order.kind == "org":
            data["orgs"] = [order.org_id]
        await audit(db, admin_id, "whatsapp.refunded", target=refund_id, data=data, session=s)

    await transaction(record)
    return await get_order(db, order.id)


# ---------- list and reports ----------


def _chat_url(phone: str | None) -> str | None:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    return f"https://wa.me/{digits}" if len(digits) == 12 else None


async def order_rows(db: AsyncDatabase, status: str, limit: int = 200) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"method": "whatsapp"}
    if status == "awaiting":
        q["status"] = "awaiting_payment"
    elif status == "paid":
        q["paid_at"] = {"$ne": None}
    elif status == "cancelled":
        q["status"] = "cancelled"
    orders = [Order.load(o) async for o in db[ORDERS].find(q).sort("created_at", -1).limit(limit)]
    ids = list({o.customer_id for o in orders})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": ids}}, {"name": 1, "email": 1, "phone": 1})}
    q_pay = {"order_id": {"$in": [o.id for o in orders]}, "reference": {"$type": "string"}}
    pays = {p["order_id"]: p async for p in db[PAYMENTS].find(q_pay)}
    t = now()
    rows = []
    for o in orders:
        u = users.get(o.customer_id, {})
        p = pays.get(o.id)
        rows.append({
            "id": o.id,
            "kind": o.kind,
            "customer": {"name": u.get("name", ""), "email": u.get("email", ""), "phone": u.get("phone") or ""},
            "item": item_text(o),
            "amount": o.amount,
            "coupon": _coupon_out(o),
            "status": o.status,
            "createdAt": int(o.created_at.timestamp() * 1000),
            "ageHours": int((t - o.created_at).total_seconds() // 3600),
            "chatUrl": _chat_url(u.get("phone")),
            "receiptNo": o.receipt_no,
            "invoiceNo": o.invoice_no,
            "payment": {"method": p["method"], "reference": p["reference"], "amount": p["amount"],
                        "paidOn": (p.get("raw") or {}).get("whatsapp", {}).get("paid_on")} if p else None,
        })  # fmt: skip
    return rows


def _coupon_out(o: Order) -> dict[str, Any] | None:
    c = o.coupon
    return {"code": c["code"], "original": c["original"], "discount": c["discount"], "final": c["final"]} if c else None


async def report(db: AsyncDatabase, days: int) -> dict[str, Any]:
    since = now() - timedelta(days=days)
    money = {"whatsapp": 0, "razorpay": 0}
    async for p in db[PAYMENTS].find({"status": {"$in": ["captured", "refunded"]}, "captured_at": {"$gte": since}}):
        key = "whatsapp" if p.get("reference") else "razorpay" if p.get("razorpay_payment_id") else "other"
        money[key] = money.get(key, 0) + int(p["amount"])
    counts = {}
    for name, q in (
        ("pending", {"status": "awaiting_payment"}),
        ("paid", {"paid_at": {"$ne": None}}),
        ("cancelled", {"status": "cancelled"}),
    ):
        counts[name] = await db[ORDERS].count_documents({"method": "whatsapp", "created_at": {"$gte": since}, **q})
    codes = {"orders": 0, "discount": 0, "free": 0}  # paid orders that used a code: how much the codes took off
    q_codes = {"coupon": {"$ne": None}, "paid_at": {"$gte": since}, "status": {"$nin": ["refunded", "cancelled"]}}
    async for o in db[ORDERS].find(q_codes, {"coupon": 1}):
        codes["orders"] += 1
        codes["discount"] += int(o["coupon"].get("discount") or 0)
        codes["free"] += int(o["coupon"].get("final", 1) <= 0)
    return {"days": days, "moneyIn": money, "counts": counts, "codes": codes}


async def report_csv(db: AsyncDatabase, days: int) -> str:
    """Every paid order in the period: order number, customer, item, amount, method, UTR, date."""
    since = now() - timedelta(days=days)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Order", "Customer", "Email", "Item", "Amount (Rs)", "Method", "UTR / reference", "Paid on", "Status",
                "Code", "Original (Rs)", "Discount (Rs)"])  # fmt: skip
    pays = [p async for p in db[PAYMENTS].find(
        {"status": {"$in": ["captured", "refunded"]}, "captured_at": {"$gte": since}, "order_id": {"$type": "string"}}
    ).sort("captured_at", 1)]  # fmt: skip
    orders = {o["_id"]: Order.load(o) async for o in db[ORDERS].find({"_id": {"$in": [p["order_id"] for p in pays]}})}
    users = {u["_id"]: u async for u in db[USERS].find(
        {"_id": {"$in": list({o.customer_id for o in orders.values()})}}, {"name": 1, "email": 1})}  # fmt: skip
    for p in pays:
        o = orders.get(p["order_id"])
        if o is None:
            continue
        u = users.get(o.customer_id, {})
        wa = p.get("reference")
        paid_on = (p.get("raw") or {}).get("whatsapp", {}).get("paid_on") or _ist(p.get("captured_at"))
        w.writerow([csv_safe(x) for x in (
            o.id, u.get("name", ""), u.get("email", ""), item_text(o), rupees(int(p["amount"])),
            f"WhatsApp · {p.get('method') or ''}" if wa else f"Razorpay · {p.get('method') or ''}",
            wa or p.get("razorpay_payment_id") or "", paid_on, o.status,
            *_coupon_cells(o),
        )])  # fmt: skip
    return CSV_BOM + buf.getvalue()


def _coupon_cells(o: Order) -> tuple[str, str, str]:
    c = o.coupon
    return (c["code"], rupees(c["original"]), rupees(c["discount"])) if c else ("", "", "")


def _ist(dt: datetime | None) -> str:
    return dt.astimezone(IST).date().isoformat() if dt else ""
