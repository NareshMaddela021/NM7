"""GST invoices, credit notes and proformas for organization plans (Phase 4B).

Numbering (each an atomic counter per Indian financial year, April–March, never reused, at most 16 characters):
  tax invoices   NM7/26-27/0001    the same series as resume orders (orders.invoice_no), allocated in the
                                   payment's own transaction, so a number is used once or not at all
  credit notes   NM7CN/26-27/0001  ("NM7-CN/…" would be 17 characters, over the GST limit of 16)
  proformas      NM7PF/26-27/0001  requests for payment, not tax documents

Every document stores a frozen JSON snapshot (supplier, recipient, place of supply, SAC, lines, GST split, totals —
the fields of GST rule 46) and the PDF drawn from it. Documents are never edited or deleted; later changes to plans,
billing settings or the organization's details never touch an issued one. Fields for a future IRN / QR
(e-invoicing, not needed below ₹5 crore turnover) are kept empty.

GST is decided once, at checkout (order.billing): with GST off the invoice is a plain "Invoice" without tax lines.
"""

import logging
import uuid
from datetime import datetime
from typing import Any

from bson import Binary
from pymongo.asynchronous.database import AsyncDatabase

from app.billing.gst import STATES, half_up, tax_label
from app.billing.pdf import in_words, render
from app.billing.settings import get_billing
from app.core.db import INVOICES, Session, next_number
from app.core.time import IST, financial_year, now

log = logging.getLogger("nm7.billing")

CN_PREFIX = "NM7CN"
PF_PREFIX = "NM7PF"
MAX_NUMBER = 16


def ist_date(at: datetime) -> str:
    return at.astimezone(IST).date().isoformat()


def date_text(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%d %b %Y")


async def next_doc_number(db: AsyncDatabase, prefix: str, counter: str, at: datetime, session: Session = None) -> str:
    fy = financial_year(at)
    n = await next_number(db, f"{counter}:{fy}", 1, session=session)
    number = f"{prefix}/{fy}/{n:04d}"
    if len(number) > MAX_NUMBER:  # past 9,999 documents of a kind in one year: never print an over-long number
        raise RuntimeError(f"document number {number} is longer than {MAX_NUMBER} characters")
    return number


def _supplier(b: dict[str, Any]) -> dict[str, Any]:
    s = dict(b["supplier"])
    s["state_name"] = STATES.get(s.get("state_code") or "", "")
    return s


def _recipient(buyer: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": buyer.get("legal_name", ""),
        "address": buyer.get("address", ""),
        "gstin": buyer.get("gstin", ""),
        "state_code": buyer.get("state_code", ""),
        "state_name": STATES.get(buyer.get("state_code", ""), ""),
        "email": buyer.get("email", ""),
    }


def scale(bill: dict[str, Any], amount: int) -> tuple[int, list[dict[str, Any]]]:
    """A part of an order (a partial refund) split like the order: (taxable, tax lines), adding up to `amount`."""
    total = int(bill["total"])
    if amount >= total:
        return int(bill["taxable"]), [dict(t) for t in bill["tax_lines"]]
    lines = []
    taxed = 0
    for t in bill["tax_lines"]:
        part = half_up(int(t["amount"]) * amount, total)
        lines.append({**t, "amount": part})
        taxed += part
    return amount - taxed, lines


def snapshot(
    kind: str,
    number: str,
    at: datetime,
    order: Any,
    b: dict[str, Any],
    *,
    amount: int | None = None,
    original: dict[str, Any] | None = None,
    reason: str | None = None,
    payment_link: str | None = None,
) -> dict[str, Any]:
    """The frozen document. `amount`: for a credit note, how much is credited (GST included)."""
    bill = order.billing or {}
    gst = bool(bill.get("gst_on"))
    if amount is None:
        taxable, taxes = int(bill["taxable"]), [dict(t) for t in bill["tax_lines"]]
        line = {"rate": int(bill["list_price"]), "discount": int(bill.get("discount") or 0), "taxable": taxable}
    else:
        taxable, taxes = scale(bill, amount)
        line = {"rate": taxable, "discount": 0, "taxable": taxable}
    plan_line = next((i for i in order.items if i.kind == "plan"), None)
    description = plan_line.name if plan_line else "Nm7 for Organizations"
    if kind == "credit_note":
        description = f"Credit against {original['number']}: {description}"
    tax_lines = [
        {"kind": t["kind"], "label": tax_label(t["kind"]), "rate_bp": t["rate_bp"], "amount": t["amount"]}
        for t in taxes
    ]
    by_kind = {k: sum(t["amount"] for t in tax_lines if t["kind"] == k) for k in ("cgst", "sgst", "igst")}
    total = taxable + sum(by_kind.values())
    iso = ist_date(at)
    pos = bill.get("place_of_supply") or (bill.get("buyer") or {}).get("state_code", "")
    return {
        "kind": kind,
        "number": number,
        "date": iso,
        "date_text": date_text(iso),
        "fy": financial_year(at),
        "supplier": _supplier(b),
        "recipient": _recipient(bill.get("buyer") or {}),
        "place_of_supply": {"code": pos, "name": STATES.get(pos, "")},
        "sac": b["supplier"].get("sac") or "",
        "reverse_charge": "No",
        "gst_on": gst,
        "lines": [{"description": description, "qty": 1, "unit": "NOS", **line}],
        "tax_lines": tax_lines if gst else [],
        "totals": {
            "taxable": taxable,
            **by_kind,
            "tax": sum(by_kind.values()),
            "total": total,
            "in_words": in_words(total),
        },
        "original": original,
        "reason": reason,
        "payment_link": payment_link,
        "order_id": order.id,
        "plan": (bill.get("terms") or {}).get("plan_id"),
        "irn": None,  # e-invoicing (IRN, acknowledgement, signed QR) — not needed below ₹5 crore turnover
        "ack_no": None,
        "qr": None,
    }


def _doc(kind: str, snap: dict[str, Any], order: Any, **extra) -> dict[str, Any]:
    return {
        "_id": str(uuid.uuid4()),
        "kind": kind,
        "number": snap["number"],
        "fy": snap["fy"],
        "date": snap["date"],
        "org_id": order.org_id,
        "order_id": order.id,
        "total": snap["totals"]["total"],
        "taxable": snap["totals"]["taxable"],
        "snapshot": snap,
        "pdf": None,
        "created_at": now(),
        **extra,
    }


async def issue_invoice(db: AsyncDatabase, order: Any, at: datetime, session: Session = None) -> dict[str, Any]:
    """The tax invoice for a paid organization order, under the number the payment's transaction allocated."""
    b = await get_billing(db, session=session)
    snap = snapshot("invoice", order.invoice_no, at, order, b)
    doc = _doc("invoice", snap, order)
    await db[INVOICES].insert_one(doc, session=session)
    return doc


async def issue_credit_note(
    db: AsyncDatabase, invoice: dict[str, Any], order: Any, amount: int, reason: str, refund_id: str, session: Session
) -> dict[str, Any]:
    at = now()
    number = await next_doc_number(db, CN_PREFIX, "credit_note", at, session=session)
    b = await get_billing(db, session=session)
    original = {"number": invoice["number"], "date": invoice["date"], "date_text": date_text(invoice["date"])}
    snap = snapshot("credit_note", number, at, order, b, amount=amount, original=original, reason=reason)
    doc = _doc("credit_note", snap, order, invoice_id=invoice["_id"], refund_id=refund_id)
    await db[INVOICES].insert_one(doc, session=session)
    return doc


async def issue_proforma(db: AsyncDatabase, order: Any, payment_link: str | None) -> dict[str, Any]:
    at = now()
    number = await next_doc_number(db, PF_PREFIX, "proforma", at)
    snap = snapshot("proforma", number, at, order, await get_billing(db), payment_link=payment_link)
    doc = _doc("proforma", snap, order)
    await db[INVOICES].insert_one(doc)
    return doc


async def pdf_of(db: AsyncDatabase, doc: dict[str, Any]) -> bytes:
    """The stored PDF; drawn once from the snapshot (after the payment's transaction) and kept."""
    if doc.get("pdf"):
        return bytes(doc["pdf"])
    data = render(doc["snapshot"])
    await db[INVOICES].update_one({"_id": doc["_id"], "pdf": None}, {"$set": {"pdf": Binary(data)}})
    return data


def file_name(doc: dict[str, Any]) -> str:
    return f"{doc['number'].replace('/', '-')}.pdf"


def doc_out(doc: dict[str, Any]) -> dict[str, Any]:
    s = doc["snapshot"]
    return {
        "id": doc["_id"],
        "kind": doc["kind"],
        "number": doc["number"],
        "date": doc["date"],
        "fy": doc["fy"],
        "orderId": doc["order_id"],
        "orgId": doc["org_id"],
        "recipient": s["recipient"]["name"],
        "gstin": s["recipient"].get("gstin", ""),
        "taxable": s["totals"]["taxable"],
        "tax": s["totals"]["tax"],
        "total": s["totals"]["total"],
        "gstOn": s["gst_on"],
        "against": (s.get("original") or {}).get("number"),
        "paymentLink": s.get("payment_link"),
        "fileName": file_name(doc),
    }
