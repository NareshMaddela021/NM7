"""Old WhatsApp payments, now retired (payments are Razorpay only; WhatsApp stays for support chat).

  GET  /api/public/payment-mode                      "razorpay" or "off" (payments paused)
  POST /api/orders/whatsapp · /{id}/whatsapp-addon   410: paying on WhatsApp has been replaced by Razorpay
  GET  /api/admin/payment-settings · PUT             Admin → Settings → Payments → payment method: Razorpay / off
  GET  /api/admin/whatsapp/orders?status=            the old WhatsApp orders, read-only ("payments": Owner, Finance)
  GET  /api/admin/whatsapp/pending                   how many old WhatsApp orders still wait for money
  POST /api/admin/whatsapp/orders/{id}/payment-link  email that customer a Razorpay payment link
  POST /api/admin/whatsapp/payment-links             a link to every pending one (once each)
  POST /api/admin/whatsapp/orders/{id}/cancel
  POST /api/admin/whatsapp/orders/{id}/refund        an old WhatsApp payment refunded outside Razorpay (records it)
  GET  /api/admin/whatsapp/report · /report.csv      money in by method (old WhatsApp vs Razorpay) ("reports")

Past WhatsApp orders keep their invoices / receipts (accounts and GST records must be kept).
"""

from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.billing.settings import get_billing
from app.core.db import DB
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.orders.service import order_view
from app.wapay import service
from app.wapay.settings import business_ready, get_payments, mode_of, razorpay_ready, save_payments

router = APIRouter(tags=["payments"])


@router.get("/api/public/payment-mode")
async def public_mode(db: DB) -> dict[str, Any]:
    return {"mode": mode_of(await get_payments(db)), "replyHours": ""}


GONE = ApiError(
    410,
    "whatsapp_payments_retired",
    "Paying on WhatsApp has been replaced by Razorpay. Please pay with the Pay button on the page.",
)


@router.post("/api/orders/whatsapp", status_code=201)
async def whatsapp_order(auth: CustomerAuth) -> dict[str, Any]:
    raise GONE


@router.post("/api/orders/{order_id}/whatsapp-addon")
async def whatsapp_addon(order_id: str, auth: CustomerAuth) -> dict[str, Any]:
    raise GONE


# ---------- settings ----------


class PaymentSettingsIn(CamelModel):
    """Admin → Settings → Payments: the payment method. "off" pauses payments without a code change."""

    mode: Literal["off", "razorpay"]


async def _settings_out(db) -> dict[str, Any]:
    p = await get_payments(db)
    return {
        "mode": "off" if p["mode"] == "off" else "razorpay",
        "active": mode_of(p),
        "razorpayReady": razorpay_ready(),
        "businessReady": business_ready(await get_billing(db)),
        "pendingWhatsapp": await service.pending_count(db),
    }


@router.get("/api/admin/payment-settings")
async def get_payment_settings(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _settings_out(db)


@router.put("/api/admin/payment-settings")
async def put_payment_settings(
    body: PaymentSettingsIn, request: Request, db: DB, auth: AdminAuth("settings")
) -> dict[str, Any]:
    if body.mode == "razorpay" and not razorpay_ready():
        raise ApiError(400, "razorpay_not_ready", "Razorpay keys aren’t set on the server yet.")
    before = await get_payments(db)
    # the old WhatsApp number is no longer used anywhere: it is removed from the settings
    await save_payments(db, {"mode": body.mode, "whatsapp_number": "", "reply_hours": ""})
    if before.get("mode") != body.mode or before.get("whatsapp_number"):
        data = {"mode": {"from": before.get("mode"), "to": body.mode}}
        if before.get("whatsapp_number"):
            data["whatsapp_number"] = {"removed": True}
        await audit(db, auth.user.id, "settings.payments", target="payments", data=data, ip=client_ip(request))
    return await _settings_out(db)


# ---------- orders ----------


@router.get("/api/admin/whatsapp/orders")
async def wa_orders(
    db: DB, _: AdminAuth("payments"), status: Literal["awaiting", "paid", "cancelled", "all"] = "awaiting"
) -> list[dict[str, Any]]:
    return await service.order_rows(db, status)


@router.get("/api/admin/whatsapp/pending")
async def wa_pending(db: DB, _: AdminAuth("payments")) -> dict[str, int]:
    """The Admin "WhatsApp payments (old)" page shows only while something here is above zero."""
    return {"pending": await service.pending_count(db)}


@router.post("/api/admin/whatsapp/orders/{order_id}/paid")
async def mark_paid(order_id: str, auth: AdminAuth("payments")) -> dict[str, Any]:
    raise ApiError(
        410, "whatsapp_payments_retired", "Old WhatsApp orders are read-only. Send a Razorpay payment link instead."
    )


@router.post("/api/admin/whatsapp/orders/{order_id}/payment-link")
async def payment_link(order_id: str, db: DB, mailer: MailerDep, auth: AdminAuth("payments")) -> dict[str, Any]:
    from app.payments.links import send_link

    out = await send_link(db, mailer, order_id, auth.user.id)
    return {**out, "expiresAt": out["expiresAt"].isoformat()}


@router.post("/api/admin/whatsapp/payment-links")
async def payment_links(db: DB, mailer: MailerDep, auth: AdminAuth("payments")) -> dict[str, int]:
    from app.payments.links import send_links_to_pending_whatsapp

    return await send_links_to_pending_whatsapp(db, mailer, auth.user.id)


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
