"""Pay via WhatsApp: the API.

  GET  /api/public/payment-mode                      mode (off / whatsapp / razorpay) and the reply hours
  POST /api/orders/whatsapp                          a signed-in customer: a pending order + the wa.me link
  POST /api/orders/{id}/whatsapp-addon               an add-on / upgrade for a paid order: the chat link only
  GET  /api/admin/payment-settings · PUT             Admin → Settings → Payments ("settings" permission)
  GET  /api/admin/whatsapp/orders?status=            Admin → Orders → WhatsApp payments ("payments": Owner, Finance)
  POST /api/admin/whatsapp/orders/{id}/paid          mark paid (method, UTR, amount, date; reason if the amount differs)
  POST /api/admin/whatsapp/orders/{id}/cancel
  POST /api/admin/whatsapp/orders/{id}/refund        method + reference; a full refund removes access
  GET  /api/admin/whatsapp/report · /report.csv      money in by method, pending / paid / cancelled ("reports")

An organization's plan is ordered with POST /api/org/{org_id}/billing/whatsapp (app/billing/router.py).
"""

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import User
from app.auth.sessions import client_ip
from app.billing.checkout import send_org_receipt
from app.billing.settings import get_billing
from app.core.db import DB, USERS
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.orders.schemas import CreateOrderIn
from app.orders.service import order_view
from app.wapay import service
from app.wapay.emails import payment_received
from app.wapay.settings import business_ready, get_payments, mode_of, normalize_number, razorpay_ready, save_payments

router = APIRouter(tags=["payments"])


@router.get("/api/public/payment-mode")
async def public_mode(db: DB) -> dict[str, Any]:
    p = await get_payments(db)
    return {"mode": mode_of(p), "replyHours": p["reply_hours"] if mode_of(p) == "whatsapp" else ""}


@router.post("/api/orders/whatsapp", status_code=201)
async def whatsapp_order(body: CreateOrderIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.coupons.flow import free_order, free_out, order_code

    c = await order_code(db, auth.user.id, body.code, body.plan_id, client_ip(request))
    free = await free_order(db, auth.user.id, c, body.plan_id, body.addons, body.role)
    if free:  # a free code: unlocked now, no WhatsApp step
        return free_out(free)
    order, out = await service.create_customer_order(db, auth.user, body.plan_id, body.role, body.addons, c)
    await audit(
        db, auth.user.id, "whatsapp.ordered", target=order.id, data={"order_id": order.id, "amount": order.amount}
    )
    return out


class AddonChatIn(CamelModel):
    item: str = Field(min_length=1, max_length=40)  # an add-on code, or "upgrade:expert" / "upgrade:launch"


@router.post("/api/orders/{order_id}/whatsapp-addon")
async def whatsapp_addon(order_id: str, body: AddonChatIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return await service.addon_chat(db, auth.user, order_id, body.item)


# ---------- settings ----------


class PaymentSettingsIn(CamelModel):
    mode: Literal["off", "whatsapp", "razorpay"]
    whatsapp_number: str = Field("", max_length=20)
    reply_hours: str = Field("", max_length=80)
    cancel_after_hours: int = Field(72, ge=1, le=720)


async def _settings_out(db) -> dict[str, Any]:
    p = await get_payments(db)
    return {
        "mode": p["mode"] or mode_of(p),
        "active": mode_of(p),
        "whatsappNumber": p["whatsapp_number"],
        "replyHours": p["reply_hours"],
        "cancelAfterHours": p["cancel_after_hours"],
        "razorpayReady": razorpay_ready(),
        "businessReady": business_ready(await get_billing(db)),
    }


@router.get("/api/admin/payment-settings")
async def get_payment_settings(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _settings_out(db)


@router.put("/api/admin/payment-settings")
async def put_payment_settings(
    body: PaymentSettingsIn, request: Request, db: DB, auth: AdminAuth("settings")
) -> dict[str, Any]:
    number = ""
    if body.whatsapp_number.strip():
        try:
            number = normalize_number(body.whatsapp_number)
        except ValueError as e:
            raise ApiError(400, "bad_number", str(e)) from None
    if body.mode == "whatsapp" and not number:
        raise ApiError(400, "number_required", "Add the WhatsApp number first.")
    if body.mode == "razorpay" and not razorpay_ready():
        raise ApiError(400, "razorpay_not_ready", "Razorpay keys aren’t set on the server yet.")
    before = await get_payments(db)
    changes = {
        "mode": body.mode,
        "whatsapp_number": number,
        "reply_hours": " ".join(body.reply_hours.split()),
        "cancel_after_hours": body.cancel_after_hours,
    }
    await save_payments(db, changes)
    diff = {k: {"from": before.get(k), "to": v} for k, v in changes.items() if before.get(k) != v}
    if "whatsapp_number" in diff:  # never the number itself in the log
        diff["whatsapp_number"] = {"changed": True}
    if diff:
        await audit(db, auth.user.id, "settings.payments", target="payments", data=diff, ip=client_ip(request))
    return await _settings_out(db)


# ---------- orders ----------


@router.get("/api/admin/whatsapp/orders")
async def wa_orders(
    db: DB, _: AdminAuth("payments"), status: Literal["awaiting", "paid", "cancelled", "all"] = "awaiting"
) -> list[dict[str, Any]]:
    return await service.order_rows(db, status)


class PaidIn(CamelModel):
    method: Literal["upi", "bank", "cash"]
    reference: str = Field(min_length=1, max_length=64)
    amount: int = Field(gt=0, le=10_000_000)  # paise
    paid_on: date
    reason: str = Field("", max_length=300)


@router.post("/api/admin/whatsapp/orders/{order_id}/paid")
async def mark_paid(
    order_id: str, body: PaidIn, db: DB, mailer: MailerDep, auth: AdminAuth("payments")
) -> dict[str, Any]:
    order, _ = await service.mark_paid_whatsapp(
        db,
        order_id,
        auth.user.id,
        method=body.method,
        reference=body.reference,
        amount=body.amount,
        paid_on=body.paid_on,
        reason=body.reason,
    )
    user = User.load(await db[USERS].find_one({"_id": order.customer_id}))
    if user:
        ref = service.norm_ref(body.reference)
        await send_safely(mailer, payment_received(user.email, user.name, order, body.method, ref, body.amount))
    if order.kind == "org":
        await send_org_receipt(db, mailer, order)
    return (await order_view(db, order)).model_dump(by_alias=True, mode="json")


class CancelIn(CamelModel):
    reason: str = Field("", max_length=300)


@router.post("/api/admin/whatsapp/orders/{order_id}/cancel")
async def cancel(order_id: str, body: CancelIn, db: DB, auth: AdminAuth("payments")) -> dict[str, Any]:
    order = await service.cancel(db, order_id, auth.user.id, body.reason or "Cancelled by Nm7")
    return (await order_view(db, order)).model_dump(by_alias=True, mode="json")


class RefundIn(CamelModel):
    method: Literal["upi", "bank", "cash"]
    reference: str = Field(min_length=1, max_length=64)
    amount: int | None = Field(None, gt=0, le=10_000_000)  # paise; empty: everything left
    note: str = Field("", max_length=300)


@router.post("/api/admin/whatsapp/orders/{order_id}/refund")
async def refund(order_id: str, body: RefundIn, db: DB, auth: AdminAuth("payments")) -> dict[str, Any]:
    order = await service.refund(
        db, order_id, auth.user.id, method=body.method, reference=body.reference, amount=body.amount, note=body.note
    )
    return (await order_view(db, order)).model_dump(by_alias=True, mode="json")


# ---------- reports ----------


@router.get("/api/admin/whatsapp/report")
async def report(db: DB, _: AdminAuth("reports"), days: int = Query(30, ge=1, le=366)) -> dict[str, Any]:
    return await service.report(db, days)


@router.get("/api/admin/whatsapp/report.csv")
async def report_csv(db: DB, auth: AdminAuth("reports"), request: Request, days: int = Query(30, ge=1, le=366)):
    await audit(db, auth.user.id, "report.exported", target="payments.csv", data={"days": days}, ip=client_ip(request))
    return Response(
        await service.report_csv(db, days),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="nm7-payments-{days}d.csv"'},
    )
