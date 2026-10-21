"""Buying or renewing an organization plan: billing details, the price quote (plan price − discount, then GST on
top when it's on), and the Razorpay order. It reuses the resume-order machinery (orders + payments + the webhook):
an organization purchase is an order with kind "org". The plan turns on only when Razorpay's verified webhook
reports the payment (or an admin records an offline payment) — never from the browser.

All money is computed here, on the server, in paise. The browser only ever sends a plan id.
"""

import logging
from typing import Any

from pydantic import Field, field_validator
from pymongo.asynchronous.database import AsyncDatabase

from app.billing.emails import plan_active
from app.billing.gst import STATES, gstin_problem, tax_label, tax_lines
from app.billing.plans import get_plans, terms_of
from app.billing.settings import get_billing, gst_on
from app.billing.subscription import owner_emails
from app.core.config import get_settings
from app.core.db import ORDERS, ORGANIZATIONS, PAYMENTS, USERS, next_number, transaction
from app.core.email import Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.orders.models import ORDER_NO_START, Order, OrderItem
from app.payments.models import Payment
from app.payments.razorpay import RazorpayError, get_razorpay

log = logging.getLogger("nm7.billing")

BUYABLE = ("drive", "campus", "custom")


class BillingDetailsIn(CamelModel):
    """Who the invoice is made out to. GSTIN is optional; when given it must be valid and match the state."""

    legal_name: str = Field(min_length=2, max_length=150)
    address: str = Field(min_length=5, max_length=400)
    state_code: str = Field(min_length=2, max_length=2)
    gstin: str = Field("", max_length=15)
    email: str = Field("", max_length=200, pattern=r"^([^\s@]+@[^\s@]+\.[^\s@]{2,})?$")

    @field_validator("legal_name", "address", "email")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split()) if v else v

    @field_validator("gstin")
    @classmethod
    def _upper(cls, v: str) -> str:
        return (v or "").strip().upper()


def check_details(body: BillingDetailsIn) -> dict[str, Any]:
    if body.state_code not in STATES:
        raise ApiError(400, "bad_state", "Choose the state your organization is registered in.")
    if body.gstin:
        problem = gstin_problem(body.gstin, body.state_code)
        if problem:
            raise ApiError(400, "bad_gstin", problem)
    return {**body.model_dump(), "state_name": STATES[body.state_code]}


def details_out(d: dict[str, Any] | None) -> dict[str, Any] | None:
    if not d:
        return None
    return {
        "legalName": d.get("legal_name", ""),
        "address": d.get("address", ""),
        "stateCode": d.get("state_code", ""),
        "stateName": STATES.get(d.get("state_code", ""), ""),
        "gstin": d.get("gstin", ""),
        "email": d.get("email", ""),
    }


def _terms_for(o: dict[str, Any], plan_id: str, plans: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if plan_id == "custom":
        c = o.get("custom_plan")
        if not c or not c.get("price"):
            raise ApiError(409, "no_custom_plan", "Nm7 hasn’t set up a custom plan for your organization yet.")
        t = terms_of(plans["custom"])
        return {**t, **{k: c[k] for k in ("price", "period_days", "period_months", "limits", "features") if k in c}}
    plan = plans.get(plan_id)
    if plan_id not in BUYABLE or not plan or not plan.get("on_sale") or not plan.get("price"):
        raise ApiError(400, "unknown_plan", "That plan isn’t on sale. Choose another one.")
    return terms_of(plan)


def discount_for(o: dict[str, Any], list_price: int, extra_pct: int = 0) -> tuple[int, str | None]:
    """The organization's discount (set by Nm7 in Admin → Organization → Billing) plus any partner discount.
    Percentages apply to the list price; the result is rounded down to a whole paisa and never above the price."""
    pct = int(o.get("discount_pct") or 0) + int(extra_pct or 0)
    pct = max(0, min(pct, 100))
    if not pct:
        return 0, None
    return min(list_price * pct // 100, list_price), f"Discount ({pct}%)"


async def quote(db: AsyncDatabase, o: dict[str, Any], plan_id: str, *, extra_discount_pct: int = 0) -> dict[str, Any]:
    """The full price breakdown for buying `plan_id` now. Raises when billing details are missing."""
    plans = await get_plans(db)
    b = await get_billing(db)
    terms = _terms_for(o, plan_id, plans)
    buyer = o.get("billing_details")
    if not buyer:
        raise ApiError(409, "billing_details_required", "Add your organization’s billing details first.")
    list_price = int(terms["price"])
    discount, discount_label = discount_for(o, list_price, extra_discount_pct)
    taxable = list_price - discount
    on = gst_on(b)
    supplier_state = b["supplier"].get("state_code") or ""
    lines = tax_lines(taxable, on, int(b["gst_rate_bp"]), supplier_state, buyer["state_code"])
    return {
        "terms": terms,
        "list_price": list_price,
        "discount": discount,
        "discount_label": discount_label,
        "taxable": taxable,
        "gst_on": on,
        "rate_bp": int(b["gst_rate_bp"]) if on else 0,
        "tax_lines": lines,
        "tax": sum(t["amount"] for t in lines),
        "total": taxable + sum(t["amount"] for t in lines),
        "supplier_state": supplier_state,
        "place_of_supply": buyer["state_code"],
        "buyer": dict(buyer),
    }


def quote_out(q: dict[str, Any]) -> dict[str, Any]:
    return {
        "planId": q["terms"]["plan_id"],
        "planName": q["terms"]["plan_name"],
        "listPrice": q["list_price"],
        "discount": q["discount"],
        "discountLabel": q["discount_label"],
        "taxable": q["taxable"],
        "gstOn": q["gst_on"],
        "taxLines": [
            {"label": tax_label(t["kind"]), "ratePct": t["rate_bp"] / 100, "amount": t["amount"]}
            for t in q["tax_lines"]
        ],
        "tax": q["tax"],
        "total": q["total"],
    }


def _check_mode(key_id: str, live_wanted: bool) -> None:
    """Razorpay stays in test mode until Naresh switches it in Billing settings: a live key is refused while the
    switch is off (and a test key once it is on), so real money can't be taken by accident."""
    live_key = key_id.startswith("rzp_live_")
    if live_key and not live_wanted:
        raise ApiError(503, "payments_test_mode", "Payments are in test mode. Nm7 will switch them on soon.")
    if live_wanted and not live_key:
        raise ApiError(503, "payments_unavailable", "Payments aren’t set up for live use yet. Please try later.")


def order_items(q: dict[str, Any]) -> list[OrderItem]:
    period = q["terms"]
    span = f"{period['period_months']} months" if period.get("period_months") else f"{period.get('period_days')} days"
    items = [
        (
            "plan",
            q["terms"]["plan_id"],
            f"Nm7 for Organizations · {q['terms']['plan_name']} plan ({span})",
            q["list_price"],
        )
    ]
    if q["discount"]:
        items.append(("discount", "discount", q["discount_label"] or "Discount", -q["discount"]))
    items += [
        ("tax", t["kind"], f"{tax_label(t['kind'])} {t['rate_bp'] / 100:g}%", t["amount"]) for t in q["tax_lines"]
    ]
    return [OrderItem(position=i, kind=k, code=c, name=n, amount=a) for i, (k, c, n, a) in enumerate(items)]


async def new_org_order(db: AsyncDatabase, o: dict[str, Any], payer_id: str, q: dict[str, Any], **extra) -> Order:
    n = await next_number(db, "order_no", ORDER_NO_START)
    return Order(
        _id=f"RS-{n}",
        kind="org",
        org_id=o["_id"],
        customer_id=payer_id,
        plan=f"org:{q['terms']['plan_id']}",
        status="pending_payment",
        amount=q["total"],
        currency="INR",
        items=order_items(q),
        billing={
            k: q[k]
            for k in ("terms", "list_price", "discount", "discount_label", "taxable", "gst_on", "rate_bp",
                      "tax_lines", "tax", "total", "supplier_state", "place_of_supply", "buyer")
        } | extra,
    )  # fmt: skip


async def start_checkout(
    db: AsyncDatabase, o: dict[str, Any], payer: Any, plan_id: str, *, extra_discount_pct: int = 0, **extra
) -> dict[str, Any]:
    b = await get_billing(db)
    rzp = get_razorpay()  # 503 until keys are set
    _check_mode(rzp.key_id, bool(b["razorpay_live"]))
    q = await quote(db, o, plan_id, extra_discount_pct=extra_discount_pct)
    if q["total"] <= 0:
        raise ApiError(409, "nothing_to_pay", "This plan costs nothing after the discount — ask Nm7 to assign it.")
    order = await new_org_order(db, o, payer.id, q, **extra)
    try:
        r = await rzp.create_order(
            order.amount, "INR", receipt=order.id, notes={"order_id": order.id, "org_id": o["_id"], "kind": "org"}
        )
    except RazorpayError:
        raise ApiError(502, "payment_provider_error", "We couldn’t start the payment. Please try again.") from None
    payment = Payment(
        order_id=order.id, razorpay_order_id=r["id"], amount=order.amount, status="created", raw={"order": r}
    )

    async def save(s):
        await db[ORDERS].insert_one(order.to_mongo(), session=s)
        await db[PAYMENTS].insert_one(payment.to_mongo(), session=s)

    await transaction(save)
    return {
        "orderId": order.id,
        "razorpayOrderId": r["id"],
        "amount": order.amount,
        "currency": "INR",
        "keyId": rzp.key_id,
        "name": "Nm7",
        "description": f"{q['terms']['plan_name']} plan · {o['name']}",
        "prefill": {"name": payer.name, "email": payer.email, "contact": payer.phone},
        "quote": quote_out(q),
    }


async def send_org_receipt(db: AsyncDatabase, mailer: Mailer, order: Order) -> None:
    """After a verified payment: tell the Owners (and whoever paid) that the plan is on."""
    o = await db[ORGANIZATIONS].find_one({"_id": order.org_id})
    if not o or not o.get("subscription"):
        return
    to = dict(await owner_emails(db, o["_id"]))
    payer = await db[USERS].find_one({"_id": order.customer_id}, {"email": 1, "name": 1})
    if payer:
        to.setdefault(payer["email"], payer.get("name") or "")
    bill_to = (o.get("billing_details") or {}).get("email")
    if bill_to:
        to.setdefault(bill_to, "")
    for email, name in to.items():
        await send_safely(mailer, plan_active(email, name, o, o["subscription"], order.amount))
    log.info("org %s: plan %s active (order %s)", o["_id"], o["subscription"].get("plan_id"), order.id)


def site_url() -> str:
    return get_settings().site_url
