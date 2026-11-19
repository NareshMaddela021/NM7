# ruff: noqa: E501
"""Admin → Payments & invoices: Razorpay actions and the daily check.

  POST /api/admin/orders/{id}/razorpay-refund {amount?, reason, note}   refund through the Razorpay API (all that is
                                                                         left, or part); the customer sees the status
  POST /api/admin/orders/{id}/payment-link                              email a Razorpay payment link for an unpaid order
  GET  /api/admin/payments/checks                                       the latest daily checks and their flags
  POST /api/admin/payments/checks/run                                   run the check now
  POST /api/admin/payments/checks/{day}/flags/{n}/resolve {note}        mark a flag as looked at

The daily check (daily_check, run by the automation pass once a day) lists the last 3 days of payments at Razorpay
and compares them with nm7.si's records: money at Razorpay we have no record of, a different status or amount, a
refund total that differs, and payments we marked paid that Razorpay doesn't show. It also copies each payment's
Razorpay fee (and its GST) onto our record for the Admin list. Nothing is changed automatically: flags only.
"""

import logging
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase

from app.admin.deps import AdminAuth
from app.audit import audit
from app.core.db import DB, ORDERS, PAYMENTS, REFUNDS, SETTINGS, USERS
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orders.service import get_order, order_view
from app.payments.razorpay import RazorpayError, get_razorpay
from app.refunds import emails as refund_emails
from app.refunds.service import captured_payment, has_open_refund, new_refund, refundable_amount, send_to_razorpay

log = logging.getLogger("nm7.payments")
admin = APIRouter(prefix="/api/admin", tags=["payments"])
CHECKS = "payment_checks"
CHECK_DAYS = 3


class AdminRefundIn(CamelModel):
    amount: int | None = Field(None, gt=0, le=10_000_000)  # paise; empty: everything left
    reason: Literal["late", "cancel", "quality", "other"] = "other"
    note: str = Field("", max_length=300)


@admin.post("/orders/{order_id}/razorpay-refund")
async def razorpay_refund(
    order_id: str, body: AdminRefundIn, db: DB, mailer: MailerDep, auth: AdminAuth("refunds")
) -> dict[str, Any]:
    order = await get_order(db, order_id)
    if order is None:
        raise ApiError(404, "not_found", "Order not found.")
    if order.kind == "org":
        raise ApiError(409, "org_order", "Refund organization orders from the organization’s billing page.")
    if order.method == "whatsapp":
        raise ApiError(
            409,
            "old_whatsapp",
            "This old WhatsApp order was paid outside Razorpay: record its refund under WhatsApp payments (old).",
        )
    if await has_open_refund(db, order.id):
        raise ApiError(409, "refund_exists", "This order already has a refund in progress (Admin > Refunds).")
    left = await refundable_amount(db, order)
    if left <= 0:
        raise ApiError(409, "already_refunded", "Nothing left to refund.")
    amount = min(body.amount or left, left)
    payment = await captured_payment(db, order)
    if not payment.razorpay_payment_id:
        raise ApiError(409, "not_razorpay", "This payment didn’t go through Razorpay.")
    rzp = get_razorpay()
    refund = await new_refund(db, order, payment, amount=amount, reason=body.reason, details=body.note or None,
                              status="approved", auto=False, requested_by=auth.user.id, decided_by=auth.user.id,
                              decision_note=body.note or None, decided_at=now())  # fmt: skip
    await send_to_razorpay(db, rzp, refund, order, payment, actor_id=auth.user.id, on_error="delete")
    await audit(db, auth.user.id, "refund.admin", target=refund.id, data={"order_id": order.id, "amount": amount})
    u = await db[USERS].find_one({"_id": order.customer_id}, {"email": 1, "name": 1})
    if u:
        await send_safely(mailer, refund_emails.refund_started(u["email"], u.get("name", ""), order.id, amount))
    return (await order_view(db, await get_order(db, order.id))).model_dump(by_alias=True, mode="json")


@admin.post("/orders/{order_id}/payment-link")
async def order_payment_link(order_id: str, db: DB, mailer: MailerDep, auth: AdminAuth("payments")) -> dict[str, Any]:
    from app.payments.links import send_link

    out = await send_link(db, mailer, order_id, auth.user.id)
    return {**out, "expiresAt": out["expiresAt"].isoformat()}


# ---------- the daily check ----------


def _flag(kind: str, text: str, **data) -> dict[str, Any]:
    return {"kind": kind, "text": text, **data, "resolved": False}


async def daily_check(db: AsyncDatabase, days: int = CHECK_DAYS) -> dict[str, Any]:
    """Compares Razorpay with nm7.si for the last `days`; saves the result (one document per day) and returns it."""
    t = now()
    start = t - timedelta(days=days)
    rzp = get_razorpay()
    theirs: list[dict[str, Any]] = []
    for skip in range(0, 1000, 100):
        page = await rzp.list_payments(int(start.timestamp()), int(t.timestamp()), 100, skip)
        theirs.extend(page)
        if len(page) < 100:
            break
    ours = {
        p["razorpay_payment_id"]: p
        async for p in db[PAYMENTS].find({"razorpay_payment_id": {"$in": [x["id"] for x in theirs]}})
    }
    refunded: dict[str, int] = {}
    async for rf in db[REFUNDS].find(
        {
            "status": "processed",
            "payment_id": {"$in": [str(p["_id"]) for p in ours.values()] + [p["_id"] for p in ours.values()]},
        }
    ):
        refunded[str(rf["payment_id"])] = refunded.get(str(rf["payment_id"]), 0) + int(rf.get("amount") or 0)
    flags: list[dict[str, Any]] = []
    for x in theirs:
        status, amount = x.get("status"), int(x.get("amount") or 0)
        mine = ours.get(x["id"])
        if mine is None:
            if status in ("captured", "refunded"):
                flags.append(
                    _flag(
                        "missing",
                        f"Razorpay has a {status} payment of ₹{amount / 100:,.0f} that nm7.si has no record of.",
                        payment_id=x["id"],
                        razorpay_order_id=x.get("order_id"),
                        amount=amount,
                    )
                )
            continue
        sets = {k: v for k, v in {"fee": x.get("fee"), "fee_tax": x.get("tax")}.items() if v is not None}
        if sets:
            await db[PAYMENTS].update_one({"_id": mine["_id"]}, {"$set": sets})
        if amount != int(mine.get("amount") or 0):
            flags.append(
                _flag(
                    "amount",
                    f"Amount differs: Razorpay ₹{amount / 100:,.2f}, nm7.si ₹{int(mine.get('amount') or 0) / 100:,.2f}.",
                    payment_id=x["id"],
                    order_id=mine.get("order_id"),
                )
            )
        if status == "captured" and mine.get("status") not in ("captured", "refunded"):
            flags.append(
                _flag(
                    "status",
                    f"Captured at Razorpay but “{mine.get('status')}” on nm7.si (the order may still be unpaid).",
                    payment_id=x["id"],
                    order_id=mine.get("order_id"),
                )
            )
        if status == "failed" and mine.get("status") == "captured":
            flags.append(
                _flag(
                    "status",
                    "Failed at Razorpay but marked paid on nm7.si.",
                    payment_id=x["id"],
                    order_id=mine.get("order_id"),
                )
            )
        theirs_refunded = int(x.get("amount_refunded") or 0)
        if theirs_refunded != refunded.get(str(mine["_id"]), 0):
            flags.append(
                _flag(
                    "refund",
                    f"Refunds differ: Razorpay ₹{theirs_refunded / 100:,.2f}, nm7.si ₹{refunded.get(str(mine['_id']), 0) / 100:,.2f}.",
                    payment_id=x["id"],
                    order_id=mine.get("order_id"),
                )
            )
    seen = {x["id"] for x in theirs}
    async for p in db[PAYMENTS].find(
        {
            "status": "captured",
            "razorpay_payment_id": {"$type": "string"},
            "captured_at": {"$gte": start, "$lt": t - timedelta(minutes=30)},
        }
    ):
        if p["razorpay_payment_id"] not in seen:
            flags.append(
                _flag(
                    "not_at_razorpay",
                    "Marked paid on nm7.si, but Razorpay didn’t list this payment.",
                    payment_id=p["razorpay_payment_id"],
                    order_id=p.get("order_id"),
                )
            )
    day = t.strftime("%Y-%m-%d")
    doc = {"_id": day, "at": t, "from": start, "checked": len(theirs), "flags": flags}
    old = await db[CHECKS].find_one({"_id": day}) or {}
    done = {(f.get("kind"), f.get("payment_id")) for f in old.get("flags", []) if f.get("resolved")}
    for f in flags:  # a flag someone already looked at today stays resolved when the check runs again
        if (f["kind"], f.get("payment_id")) in done:
            f["resolved"] = True
    await db[CHECKS].replace_one({"_id": day}, doc, upsert=True)
    if flags:
        log.warning("payment check %s: %d flag(s)", day, len(flags))
    return doc


async def daily_if_due(db: AsyncDatabase) -> int:
    """Automation: once a day, when Razorpay is set up. Returns the number of open flags (-1: not run)."""
    from app.wapay.settings import razorpay_ready

    if not razorpay_ready():
        return -1
    mark = await db[SETTINGS].find_one({"_id": "payment_check"}) or {}
    if mark.get("at") and mark["at"] > now() - timedelta(hours=23):
        return -1
    from app.core.heavy import heavy_or_skip

    async with heavy_or_skip(db) as ok:  # another heavy job running: try again on the next pass
        if not ok:
            return -1
        await db[SETTINGS].update_one({"_id": "payment_check"}, {"$set": {"at": now()}}, upsert=True)
        try:
            doc = await daily_check(db)
        except (RazorpayError, ApiError) as e:
            log.warning("payment check failed: %s", e)
            return -1
    return sum(1 for f in doc["flags"] if not f["resolved"])


def _check_out(d: dict[str, Any]) -> dict[str, Any]:
    return {"day": d["_id"], "at": d["at"], "checked": d.get("checked", 0),
            "flags": [{**{k: v for k, v in f.items()}, "n": i} for i, f in enumerate(d.get("flags", []))]}  # fmt: skip


@admin.get("/payments/checks")
async def checks(db: DB, _: AdminAuth("payments")) -> dict[str, Any]:
    rows = [_check_out(d) async for d in db[CHECKS].find().sort("_id", -1).limit(14)]
    return {"items": rows, "open": sum(1 for d in rows[:1] for f in d["flags"] if not f["resolved"])}


@admin.post("/payments/checks/run")
async def run_check(db: DB, auth: AdminAuth("payments")) -> dict[str, Any]:
    try:
        doc = await daily_check(db)
    except RazorpayError as e:
        raise ApiError(502, "payment_provider_error", "Razorpay didn’t answer. Try again in a minute.") from e
    await audit(db, auth.user.id, "payments.checked", data={"flags": len(doc["flags"])})
    return _check_out(doc)


class ResolveIn(CamelModel):
    note: str = Field(min_length=3, max_length=300)


@admin.post("/payments/checks/{day}/flags/{n}/resolve")
async def resolve(day: str, n: int, body: ResolveIn, db: DB, auth: AdminAuth("payments")) -> dict[str, Any]:
    d = await db[CHECKS].find_one({"_id": day})
    if not d or not 0 <= n < len(d.get("flags", [])):
        raise ApiError(404, "not_found", "That flag isn’t here.")
    await db[CHECKS].update_one({"_id": day}, {"$set": {f"flags.{n}.resolved": True, f"flags.{n}.note": body.note,
                                                        f"flags.{n}.by": auth.user.id, f"flags.{n}.resolved_at": now()}})  # fmt: skip
    await audit(db, auth.user.id, "payments.flag_resolved", target=day, data={"n": n})
    return _check_out(await db[CHECKS].find_one({"_id": day}))


__all__ = ["ORDERS"]
