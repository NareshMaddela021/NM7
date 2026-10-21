"""Billing settings (Admin → Billing settings). Every business value of Nm7 for Organizations lives here with a
default, so Naresh can change it without a code change. One document in `settings` (_id "billing"); missing values
use the defaults below, so a fresh database works without any setup.

GST is off until a supplier GSTIN is entered: then invoices carry tax lines and checkout adds GST on top of the
plan price (prices exclude GST). Razorpay stays in test mode until the admin switches `razorpay_live` on, and
checkout refuses a live key while the switch is off (and a test key while it is on), so real money can't be taken
by accident.
"""

from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.billing.gst import STATES
from app.core.db import SETTINGS, Session

BILLING = "billing"

DEFAULTS: dict[str, Any] = {
    "supplier": {
        "legal_name": "AsuraaX AI Private Limited",
        "trade_name": "Nm7",
        "address": "",
        "state_code": "",
        "gstin": "",
        "signatory": "",
        "sac": "",
        "email": "info@nm7.si",
    },
    "gst_rate_bp": 1800,  # 18%, in basis points
    "grace_days": 7,  # after a paid plan ends, before Free limits apply
    "reminder_days": [14, 7, 1],  # emails to the Owner before the plan ends
    "usage_warn_pct": 80,  # banner when this much of a limit is used
    "ends_soon_days": 7,  # banner when the plan ends within this many days
    "commission_pct": 20,  # partner commission on the taxable value…
    "commission_months": 12,  # …of every payment in the organization's first months
    "commission_payable_days": 30,  # commission becomes payable this long after the payment
    "referral_days": 90,  # how long the referral cookie remembers a partner
    "partner_discount_on": False,  # a partner code also gives the organization a discount
    "partner_discount_pct": 0,
    "razorpay_live": False,  # test mode until Naresh switches it
    "org_signup_open": True,  # "Start free" on /for-orgs creates an organization
}


def _merge(base: dict[str, Any], stored: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in stored.items():
        if k in base:
            out[k] = {**base[k], **v} if isinstance(base[k], dict) and isinstance(v, dict) else v
    return out


async def get_billing(db: AsyncDatabase, session: Session = None) -> dict[str, Any]:
    stored = await db[SETTINGS].find_one({"_id": BILLING}, session=session) or {}
    stored.pop("_id", None)
    return _merge(DEFAULTS, stored)


async def save_billing(db: AsyncDatabase, changes: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": BILLING}, {"$set": changes}, upsert=True)


def gst_on(b: dict[str, Any]) -> bool:
    """GST applies once the supplier GSTIN is filled in (and a supplier state is known)."""
    s = b["supplier"]
    return bool(s.get("gstin") and s.get("state_code"))


def supplier_state_name(b: dict[str, Any]) -> str:
    return STATES.get(b["supplier"].get("state_code") or "", "")
