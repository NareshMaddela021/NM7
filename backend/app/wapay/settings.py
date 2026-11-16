"""How Nm7 takes payments (Admin → Settings → Payments → "Payment method"). One document in `settings`
(_id "payments").

mode     "razorpay"  Razorpay's checkout (needs the Razorpay keys on the server)
         "off"       payments paused: nothing can be bought (paid buttons show "Coming soon"; downloads stay free)

WhatsApp payments are retired (WhatsApp stays for support chat only): a mode saved as "whatsapp" before counts as
Razorpay (or off while the keys are missing). Past WhatsApp orders stay read-only in Admin, labelled "old (WhatsApp)";
the WhatsApp number is no longer used or shown anywhere for payments.
"""

from typing import Any, Literal

from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings
from app.core.db import SETTINGS, Session

PAYMENTS = "payments"
Mode = Literal["off", "razorpay"]
DEFAULTS: dict[str, Any] = {
    "mode": None,  # not chosen yet: Razorpay as soon as its keys are set, else off
    "cancel_after_hours": 72,  # old unpaid WhatsApp orders are cancelled after this long (unless a link is open)
}


def razorpay_ready() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


async def get_payments(db: AsyncDatabase, session: Session = None) -> dict[str, Any]:
    stored = await db[SETTINGS].find_one({"_id": PAYMENTS}, session=session) or {}
    return {k: stored.get(k, v) for k, v in DEFAULTS.items()}


async def save_payments(db: AsyncDatabase, changes: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": PAYMENTS}, {"$set": changes}, upsert=True)


async def forget_whatsapp_number(db: AsyncDatabase) -> bool:
    """WhatsApp payments are gone: the WhatsApp number and reply hours once saved for them are deleted (run by the
    automation pass; a no-op once done)."""
    r = await db[SETTINGS].update_one(
        {"_id": PAYMENTS, "$or": [{"whatsapp_number": {"$exists": True}}, {"reply_hours": {"$exists": True}}]},
        {"$unset": {"whatsapp_number": "", "reply_hours": ""}},
    )
    return bool(r.modified_count)


def mode_of(p: dict[str, Any]) -> Mode:
    """The mode in effect: Razorpay needs its keys; "off" pauses payments. Not chosen yet (or the retired
    "whatsapp"): Razorpay when its keys are set."""
    if p.get("mode") == "off":
        return "off"
    return "razorpay" if razorpay_ready() else "off"


async def payment_mode(db: AsyncDatabase) -> Mode:
    return mode_of(await get_payments(db))


async def payments_on(db: AsyncDatabase) -> bool:
    """Anything can be bought (and downloads need a paid plan)."""
    return await payment_mode(db) != "off"


def business_ready(billing: dict[str, Any]) -> bool:
    """Business details are set (Admin → Billing settings): a legal name, an address and a GSTIN. Until then a
    WhatsApp payment gets a plain receipt from "Nm7" and no GST invoice."""
    s = billing.get("supplier") or {}
    return bool(s.get("legal_name") and s.get("address") and s.get("gstin"))
