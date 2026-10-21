"""Nm7 for Organizations, Phase 4B API: invoices, credit notes, proformas, offline payments and refunds.

GET  /api/org/{org_id}/billing/invoices                 Owner: this organization's documents (never another's)
GET  /api/org/{org_id}/billing/invoices/{doc_id}/pdf    Owner: download one
GET  /api/admin/org-invoices?fy=&kind=&orgId=               admin: by financial year
GET  /api/admin/org-invoices/{doc_id}/pdf                   admin: download one
GET  /api/admin/org-invoices/gstr1.csv?fy=                  admin: GSTR-1-style register (invoices and credit notes)
POST /api/admin/orgs/{org_id}/billing/proforma          admin: proforma, optionally with a Razorpay payment link
POST /api/admin/orgs/{org_id}/billing/offline-payment   admin: bank / cheque / PO payment → plan on + tax invoice
POST /api/admin/orgs/{org_id}/billing/orders/{order_id}/refund   admin: refund → credit note, plan adjusted
"""

import csv
import io
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.billing.checkout import send_org_receipt
from app.billing.invoices import doc_out, file_name, pdf_of
from app.billing.money import OFFLINE_METHODS, create_proforma, org_order, record_offline, refund_org_order
from app.core.db import DB, INVOICES, ORGANIZATIONS
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.schemas import CamelModel
from app.core.time import financial_year, now
from app.orgs.scope import NOT_FOUND, OrgScope

portal = APIRouter(prefix="/api/org/{org_id}/billing", tags=["billing"])
admin = APIRouter(prefix="/api/admin", tags=["billing"])

FY = r"^\d{2}-\d{2}$"
# GSTR-1: an inter-state sale to an unregistered buyer above this invoice value is reported invoice-wise (B2CL).
# A rule of the GST return, not a business choice.
B2CL_ABOVE = 1_00_000_00  # ₹1,00,000 in paise
NOT_A_DOC = ApiError(404, "not_found", "No such document.")


def _pdf(data: bytes, doc: dict[str, Any]) -> Response:
    return Response(
        data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{file_name(doc)}"', "Cache-Control": "private"},
    )


# ---------- the Owner ----------
@portal.get("/invoices")
async def org_invoices(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    scope.require("billing")
    rows = await db[INVOICES].find({"org_id": scope.org_id}, {"pdf": 0}).sort("created_at", -1).to_list(200)
    return [doc_out(d) for d in rows]


@portal.get("/invoices/{doc_id}/pdf")
async def org_invoice_pdf(doc_id: str, db: DB, scope: OrgScope) -> Response:
    scope.require("billing")
    doc = await db[INVOICES].find_one({"_id": doc_id, "org_id": scope.org_id})  # another org's id → 404
    if not doc:
        raise NOT_A_DOC
    return _pdf(await pdf_of(db, doc), doc)


# ---------- admin: documents ----------
@admin.get("/org-invoices")
async def list_invoices(
    db: DB,
    _: AdminAuth("payments"),
    fy: str | None = Query(None, pattern=FY),
    kind: Literal["invoice", "credit_note", "proforma"] | None = None,
    org_id: str | None = Query(None, alias="orgId", max_length=64),
) -> dict[str, Any]:
    year = fy or financial_year(now())
    q: dict[str, Any] = {"fy": year}
    if kind:
        q["kind"] = kind
    if org_id:
        q = {"org_id": org_id, **({"kind": kind} if kind else {})}  # one organization: every year
    rows = await db[INVOICES].find(q, {"pdf": 0}).sort([("created_at", -1)]).to_list(2000)
    years = sorted(await db[INVOICES].distinct("fy"), reverse=True)
    totals = {
        k: {
            "count": sum(1 for r in rows if r["kind"] == k),
            "taxable": sum(r["taxable"] for r in rows if r["kind"] == k),
            "total": sum(r["total"] for r in rows if r["kind"] == k),
        }
        for k in ("invoice", "credit_note")
    }
    return {"fy": year, "years": years or [year], "rows": [doc_out(r) for r in rows], "totals": totals}


@admin.get("/org-invoices/gstr1.csv")
async def gstr1_csv(request: Request, db: DB, auth: AdminAuth("payments"), fy: str = Query(pattern=FY)) -> Response:
    """One line per invoice / credit note, in the shape of the GSTR-1 tables (B2B, B2CL, B2CS, CDNR, CDNUR), for
    the accountant. Proformas are not tax documents and are left out."""
    rows = (
        await db[INVOICES]
        .find({"fy": fy, "kind": {"$in": ["invoice", "credit_note"]}}, {"pdf": 0})
        .sort([("kind", -1), ("number", 1)])
        .to_list(None)
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["gstr1_table", "document_type", "number", "date", "original_invoice", "original_date", "recipient",
         "recipient_gstin", "place_of_supply", "reverse_charge", "sac", "rate_pct", "taxable_value", "igst", "cgst",
         "sgst", "cess", "total", "order"]
    )  # fmt: skip
    for d in rows:
        s = d["snapshot"]
        t = s["totals"]
        gstin = s["recipient"].get("gstin") or ""
        inter = bool(t.get("igst"))
        if d["kind"] == "credit_note":
            table = "CDNR" if gstin else "CDNUR"
        elif gstin:
            table = "B2B"
        else:
            table = "B2CL" if inter and t["total"] > B2CL_ABOVE else "B2CS"
        if not s.get("gst_on"):
            table = "NOT_GST"  # issued while GST was off (no GSTIN yet): not part of a GST return
        rate = sum(x["rate_bp"] for x in s.get("tax_lines") or []) / 100
        orig = s.get("original") or {}
        pos = s.get("place_of_supply") or {}
        w.writerow(
            [
                csv_safe(x)
                for x in (
                    table,
                    "Credit note" if d["kind"] == "credit_note" else "Invoice",
                    d["number"],
                    s["date"],
                    orig.get("number", ""),
                    orig.get("date", ""),
                    s["recipient"]["name"],
                    gstin,
                    f"{pos.get('code', '')}-{pos.get('name', '')}" if pos.get("code") else "",
                    s.get("reverse_charge", "No")[:1],
                    s.get("sac") or "",
                    f"{rate:g}",
                    f"{t['taxable'] / 100:.2f}",
                    f"{(t.get('igst') or 0) / 100:.2f}",
                    f"{(t.get('cgst') or 0) / 100:.2f}",
                    f"{(t.get('sgst') or 0) / 100:.2f}",
                    "0.00",
                    f"{t['total'] / 100:.2f}",
                    d["order_id"],
                )
            ]
        )
    await audit(db, auth.user.id, "report.exported", target="gstr1.csv", data={"fy": fy}, ip=client_ip(request))
    return Response(
        CSV_BOM + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="nm7-gstr1-{fy}.csv"'},
    )


@admin.get("/org-invoices/{doc_id}/pdf")
async def admin_invoice_pdf(doc_id: str, db: DB, _: AdminAuth("payments")) -> Response:
    doc = await db[INVOICES].find_one({"_id": doc_id})
    if not doc:
        raise NOT_A_DOC
    return _pdf(await pdf_of(db, doc), doc)


# ---------- admin: proforma, offline payment, refund ----------
async def _org(db, org_id: str) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not o:
        raise NOT_FOUND
    return o


class ProformaIn(CamelModel):
    plan_id: Literal["drive", "campus", "custom"]
    extra_discount_pct: int = Field(0, ge=0, le=100)
    payment_link: bool = False


@admin.post("/orgs/{org_id}/billing/proforma", status_code=201)
async def proforma(org_id: str, body: ProformaIn, db: DB, auth: AdminAuth("payments")) -> dict[str, Any]:
    doc = await create_proforma(
        db, await _org(db, org_id), auth.user.id, body.plan_id, body.extra_discount_pct, body.payment_link
    )
    return doc_out(doc)


class OfflineIn(CamelModel):
    order_id: str | None = Field(None, max_length=40)  # a proforma's order; else a new order for plan_id
    plan_id: Literal["drive", "campus", "custom"] | None = None
    extra_discount_pct: int = Field(0, ge=0, le=100)
    method: Literal[OFFLINE_METHODS]  # type: ignore[valid-type]
    reference: str = Field(min_length=3, max_length=80)  # UTR / cheque no. / PO no.
    paid_on: date
    amount: int = Field(gt=0, le=100_000_000_00)  # paise, GST included — must equal the order total


@admin.post("/orgs/{org_id}/billing/offline-payment", status_code=201)
async def offline_payment(
    org_id: str, body: OfflineIn, db: DB, mailer: MailerDep, auth: AdminAuth("payments")
) -> dict[str, Any]:
    order = await record_offline(
        db,
        await _org(db, org_id),
        auth.user.id,
        order_id=body.order_id,
        plan_id=body.plan_id,
        extra_discount_pct=body.extra_discount_pct,
        method=body.method,
        reference=body.reference.strip(),
        paid_on=body.paid_on,
        amount=body.amount,
    )
    await send_org_receipt(db, mailer, order)  # the Owners get the tax invoice, as after an online payment
    return {"orderId": order.id, "invoiceNo": order.invoice_no, "status": order.status}


class OrgRefundIn(CamelModel):
    amount: int | None = Field(None, gt=0, le=100_000_000_00)  # paise; empty: everything not yet refunded
    note: str = Field(min_length=3, max_length=300)  # printed on the credit note as the reason
    offline_reference: str | None = Field(None, min_length=3, max_length=80)  # money sent back by bank


@admin.post("/orgs/{org_id}/billing/orders/{order_id}/refund", status_code=201)
async def refund(org_id: str, order_id: str, body: OrgRefundIn, db: DB, auth: AdminAuth("refunds")) -> dict[str, Any]:
    order = await org_order(db, org_id, order_id)
    notes = await refund_org_order(db, order, auth.user.id, body.amount, body.note.strip(), body.offline_reference)
    return {"creditNotes": [doc_out(n) for n in notes]}
