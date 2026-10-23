"""How Nm7 takes payments (Admin → Settings → Payments). One document in `settings` (_id "payments").

mode     "off"       nothing can be bought (paid buttons show "Coming soon"; downloads stay free)
         "whatsapp"  every paid button is "Buy on WhatsApp": a pending order, then a chat with Nm7, and an admin
                     marks it paid once the money has arrived (app/wapay/router.py)
         "razorpay"  Razorpay's checkout, as before (needs the Razorpay keys on the server)

When no mode has been saved yet, the old rule stays: Razorpay when its keys are set, else off. The WhatsApp number
is entered by an admin and lives only in the database (never in the code). A UPI ID is never stored or shown: it is
shared only inside the chat.
"""

import re
from typing import Any, Literal

from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings
from app.core.db import SETTINGS, Session

PAYMENTS = "payments"
Mode = Literal["off", "whatsapp", "razorpay"]
DEFAULTS: dict[str, Any] = {
    "mode": None,  # not chosen yet: Razorpay if its keys are set, else off
    "whatsapp_number": "",  # +91XXXXXXXXXX
    "reply_hours": "",  # e.g. "We reply 9 am - 9 pm"
    "cancel_after_hours": 72,  # unpaid WhatsApp orders are cancelled after this long
}
PHONE = re.compile(r"^(?:\+?91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})$")


def normalize_number(v: str) -> str:
    """'+91 98765 43210' / '9876543210' → '+919876543210'; ValueError when it isn't an Indian mobile number."""
    m = PHONE.match((v or "").strip())
    if not m:
        raise ValueError("Enter an Indian mobile number, like +91 98765 43210.")
    return f"+91{m.group(1)}{m.group(2)}"


def razorpay_ready() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


async def get_payments(db: AsyncDatabase, session: Session = None) -> dict[str, Any]:
    stored = await db[SETTINGS].find_one({"_id": PAYMENTS}, session=session) or {}
    return {k: stored.get(k, v) for k, v in DEFAULTS.items()}


async def save_payments(db: AsyncDatabase, changes: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": PAYMENTS}, {"$set": changes}, upsert=True)


def mode_of(p: dict[str, Any]) -> Mode:
    """The mode in effect: Razorpay needs its keys and WhatsApp needs a number, else nothing is on sale."""
    m = p.get("mode")
    if m is None:
        return "razorpay" if razorpay_ready() else "off"
    if m == "razorpay" and not razorpay_ready():
        return "off"
    if m == "whatsapp" and not p.get("whatsapp_number"):
        return "off"
    return m if m in ("off", "whatsapp", "razorpay") else "off"


async def payment_mode(db: AsyncDatabase) -> Mode:
    return mode_of(await get_payments(db))


async def payments_on(db: AsyncDatabase) -> bool:
    """Anything can be bought (and downloads need a paid plan): WhatsApp or Razorpay."""
    return await payment_mode(db) != "off"


def business_ready(billing: dict[str, Any]) -> bool:
    """Business details are set (Admin → Billing settings): a legal name, an address and a GSTIN. Until then a
    WhatsApp payment gets a plain receipt from "Nm7" and no GST invoice."""
    s = billing.get("supplier") or {}
    return bool(s.get("legal_name") and s.get("address") and s.get("gstin"))
