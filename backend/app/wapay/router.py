"""Payments settings and the old WhatsApp orders (WhatsApp payments are gone; WhatsApp is for support chat only).

  GET  /api/public/payment-mode                      "razorpay" or "off" (paid buttons show "Payments coming soon")
  GET  /api/admin/payments/status                    any admin: are the Razorpay keys set (the Admin banner)
  GET  /api/admin/payment-settings · PUT             Admin → Settings → Payments → payment method: Razorpay / off
  GET  /api/admin/whatsapp/orders?status=            old WhatsApp orders, read-only (Admin → Payments & invoices)
  GET  /api/admin/whatsapp/pending                   how many old WhatsApp orders still wait for money
  POST /api/admin/whatsapp/orders/{id}/payment-link  email that customer a Razorpay payment link
  POST /api/admin/whatsapp/payment-links             a link to every pending one (once each)
  GET  /api/admin/whatsapp/report · /report.csv      money in by method (old WhatsApp vs Razorpay) ("reports")

Past WhatsApp orders keep their invoices / receipts (accounts and GST records must be kept).
"""

from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.billing.settings import get_billing
from app.core.db import DB
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.wapay import service
from app.wapay.settings import business_ready, get_payments, mode_of, razorpay_ready, save_payments

router = APIRouter(tags=["payments"])


@router.get("/api/public/payment-mode")
async def public_mode(db: DB) -> dict[str, Any]:
    return {"mode": mode_of(await get_payments(db)), "replyHours": ""}


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


@router.get("/api/admin/payments/status")
async def payments_status(db: DB, _: AdminAuth("dashboard")) -> dict[str, Any]:
    """For the banner on every Admin page: which Razorpay keys are missing on the server (names only, never values)."""
    from app.core.config import get_settings

    s = get_settings()
    keys = (
        ("RAZORPAY_KEY_ID", s.razorpay_key_id),
        ("RAZORPAY_KEY_SECRET", s.razorpay_key_secret),
        ("RAZORPAY_WEBHOOK_SECRET", s.razorpay_webhook_secret),
    )
    missing = [name for name, v in keys if not v]
    return {"razorpayReady": razorpay_ready(), "missing": missing, "mode": mode_of(await get_payments(db))}


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
    await save_payments(db, {"mode": body.mode})
    if before.get("mode") != body.mode:
        data = {"mode": {"from": before.get("mode"), "to": body.mode}}
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


@router.post("/api/admin/whatsapp/orders/{order_id}/payment-link")
async def payment_link(order_id: str, db: DB, mailer: MailerDep, auth: AdminAuth("payments")) -> dict[str, Any]:
    from app.payments.links import send_link

    out = await send_link(db, mailer, order_id, auth.user.id)
    return {**out, "expiresAt": out["expiresAt"].isoformat()}


@router.post("/api/admin/whatsapp/payment-links")
async def payment_links(db: DB, mailer: MailerDep, auth: AdminAuth("payments")) -> dict[str, int]:
    from app.payments.links import send_links_to_pending_whatsapp

    return await send_links_to_pending_whatsapp(db, mailer, auth.user.id)


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
