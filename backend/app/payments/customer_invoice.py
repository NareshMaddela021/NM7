"""GST invoices for customer orders (resume plans, packs, the student pass), on the existing invoice system
(app/billing/invoices.py: the same number series, frozen snapshot, PDF and Admin → Organization invoices list).

Customer prices INCLUDE GST, so the order's tax lines are taken out of the price: taxable = total × 100 / 118
(rounded half-up), CGST + SGST inside the supplier's state, else IGST; the parts always add up to the amount paid.
While Admin → Billing settings has no supplier GSTIN, the invoice carries no tax lines (as for organizations).

The buyer may give a company name and GSTIN at checkout (both optional) for an input tax credit; else the invoice
is made out to the person.
"""

from typing import Any

from pydantic import Field, field_validator
from pymongo.asynchronous.database import AsyncDatabase

from app.billing.gst import STATES, gstin_problem, half_up, tax_lines
from app.billing.settings import get_billing, gst_on
from app.core.db import INVOICES
from app.core.errors import ApiError
from app.core.schemas import CamelModel


class CustomerBillingIn(CamelModel):
    """Optional, at checkout: invoice the payment to a company (for input tax credit)."""

    company_name: str = Field("", max_length=150)
    gstin: str = Field("", max_length=15)
    state_code: str = Field("", max_length=2)  # two-digit GST state code; from the GSTIN when one is given
    address: str = Field("", max_length=300)

    @field_validator("company_name", "address")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return " ".join((v or "").split())

    @field_validator("gstin")
    @classmethod
    def _upper(cls, v: str) -> str:
        return (v or "").strip().upper()


def split_inclusive(total: int, on: bool, rate_bp: int, supplier_state: str, buyer_state: str) -> tuple[int, list]:
    """(taxable, tax lines) for a GST-inclusive `total` (paise); taxable + taxes == total exactly."""
    if not on or total <= 0:
        return total, []
    taxable = half_up(total * 10_000, 10_000 + rate_bp)
    lines = tax_lines(taxable, True, rate_bp, supplier_state, buyer_state)
    taxable = total - sum(t["amount"] for t in lines)  # rounding pennies stay in the taxable value
    return taxable, lines


async def customer_billing(
    db: AsyncDatabase, name: str, email: str, total: int, given: CustomerBillingIn | None
) -> dict[str, Any]:
    """The frozen billing block for a customer order (Order.billing), read by the invoice snapshot."""
    b = await get_billing(db)
    on = gst_on(b)
    supplier_state = b["supplier"].get("state_code") or ""
    g = given or CustomerBillingIn()
    gstin, state = g.gstin, g.state_code
    if gstin:
        problem = gstin_problem(gstin, state or None)
        if problem:
            raise ApiError(400, "bad_gstin", problem)
        state = state or gstin[:2]
    if state and state not in STATES:
        raise ApiError(400, "bad_state", "Pick your state from the list.")
    if gstin and not g.company_name:
        raise ApiError(400, "company_required", "Add the company name that goes with this GSTIN.")
    pos = state or supplier_state  # an unregistered buyer without a state: the supplier's state
    rate = int(b["gst_rate_bp"])
    taxable, lines = split_inclusive(total, on, rate, supplier_state, pos)
    return {
        "inclusive": True,
        "gst_on": on,
        "rate_bp": rate if on else 0,
        "list_price": taxable,
        "discount": 0,
        "taxable": taxable,
        "tax_lines": lines,
        "tax": sum(t["amount"] for t in lines),
        "total": total,
        "supplier_state": supplier_state,
        "place_of_supply": pos,
        "buyer": {"legal_name": g.company_name or name, "gstin": gstin, "state_code": state, "address": g.address,
                  "email": email},
    }  # fmt: skip


async def invoice_for(db: AsyncDatabase, order_id: str) -> dict[str, Any] | None:
    return await db[INVOICES].find_one({"order_id": order_id, "kind": "invoice"})
