"""Old WhatsApp orders (WhatsApp payments are gone; WhatsApp stays for support chat only).

What is kept, because accounts and GST records must be kept: past WhatsApp orders, their invoices and receipts, shown
read-only in Admin → Payments & invoices, labelled "old (WhatsApp)" (order_rows, report). Old orders still waiting
for money can be sent a Razorpay payment link (app/payments/links.py); until they are paid they are cancelled by
themselves after 72 hours, except while a link sent for them is still open (cancel_stale).
"""

import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.core.db import ORDERS, PAYMENTS, USERS
from app.core.exports import CSV_BOM, csv_safe
from app.core.time import IST, now
from app.orders.models import Order
from app.wapay.settings import get_payments

log = logging.getLogger("nm7.wapay")


def rupees(paise: int) -> str:
    r = paise / 100
    return f"{r:,.0f}" if r == int(r) else f"{r:,.2f}"


def item_text(order: Order) -> str:
    """'LinkedIn pack', 'Expert rewrite + Express delivery (24h)', 'Nm7 for Organizations · Drive plan (12 months)'."""
    parts = [i.name for i in order.items if i.kind in ("plan", "addon")]
    return " + ".join(parts) or order.plan


def norm_ref(v: str) -> str:
    return "".join((v or "").split()).upper()


async def pending_count(db: AsyncDatabase) -> int:
    """Old WhatsApp orders still waiting for money (with or without a Razorpay payment link sent)."""
    return await db[ORDERS].count_documents(
        {"status": "awaiting_payment", "$or": [{"method": "whatsapp"}, {"moved_from": "whatsapp"}]}
    )


async def cancel_stale(db: AsyncDatabase) -> int:
    """Automation: unpaid old WhatsApp orders older than the hours in Admin → Settings → Payments are cancelled —
    except while a Razorpay payment link sent for them is still open (they are cancelled once it has expired)."""
    hours = int((await get_payments(db))["cancel_after_hours"] or 72)
    t = now()
    stale = [
        o["_id"]
        async for o in db[ORDERS].find(
            {"status": "awaiting_payment", "created_at": {"$lt": t - timedelta(hours=hours)},
             "$or": [{"payment_link": None}, {"payment_link.expires_at": {"$lt": t}}]},
            {"_id": 1},
        )
    ]  # fmt: skip
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


async def order_rows(db: AsyncDatabase, status: str, limit: int = 200) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"$or": [{"method": "whatsapp"}, {"moved_from": "whatsapp"}]}  # old WhatsApp orders
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
            "label": "old (WhatsApp)",
            "paymentLink": _link_out(o.payment_link),
            "receiptNo": o.receipt_no,
            "invoiceNo": o.invoice_no,
            "payment": {"method": p["method"], "reference": p["reference"], "amount": p["amount"],
                        "paidOn": (p.get("raw") or {}).get("whatsapp", {}).get("paid_on")} if p else None,
        })  # fmt: skip
    return rows


def _link_out(link: dict[str, Any] | None) -> dict[str, Any] | None:
    if not link:
        return None
    sent = link.get("sent_at")
    return {"url": link.get("url", ""), "sentAt": int(sent.timestamp() * 1000) if sent else None}


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
