"""Who owns the LinkedIn pack (Phase 2, Rs 149).

The pack belongs to an account when:
- it paid for a "linkedin_pack" order, or a Career Launch order (Career Launch includes the pack), and that order
  is not refunded or cancelled; or
- an admin granted it by hand (Admin > Customers > Grant LinkedIn pack, written to the audit log), so it can be
  tested before payments are switched on.

`linkedin_packs` keeps one document per account (_id = user id) as the record ("linkedinPack: true, orderId,
purchasedAt"). It is written when the order is paid (in the same transaction) and removed when the order is
refunded in full; access is still checked against the order itself, so a refunded order never unlocks anything
even if the record were left behind.
"""

from datetime import datetime
from typing import Any

from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import LINKEDIN_PACKS, ORDERS, Session
from app.core.time import now

PACK_PLANS = ("linkedin_pack", "launch")
LOST = ("refunded", "cancelled")
PAID = ("order", "launch")


async def on_order_paid(db: AsyncDatabase, order: Any, at: datetime, session: Session = None) -> None:
    """Called by mark_paid() inside its transaction. A paying order replaces an admin grant; when the account
    already bought (e.g. Career Launch, then the pack), the first order stays the record."""
    if order.plan not in PACK_PLANS or order.kind == "org":
        return
    cur = await db[LINKEDIN_PACKS].find_one({"_id": order.customer_id}, session=session)
    if cur and cur.get("source") in PAID:
        return
    await db[LINKEDIN_PACKS].update_one(
        {"_id": order.customer_id},
        {
            "$set": {
                "order_id": order.id,
                "purchased_at": at,
                "source": "launch" if order.plan == "launch" else "order",
            },
            "$unset": {"granted_by": "", "note": ""},
        },
        upsert=True,
        session=session,
    )


async def on_order_refunded(db: AsyncDatabase, order: Any, session: Session = None) -> None:
    """Called when an order is refunded in full: its record goes (another paid order or a grant keeps access)."""
    if order.plan in PACK_PLANS:
        await db[LINKEDIN_PACKS].delete_one({"_id": order.customer_id, "order_id": order.id}, session=session)


async def paying_order(db: AsyncDatabase, user_id: str) -> dict[str, Any] | None:
    return await db[ORDERS].find_one(
        {
            "customer_id": user_id,
            "kind": {"$ne": "org"},
            "plan": {"$in": list(PACK_PLANS)},
            "paid_at": {"$ne": None},
            "status": {"$nin": list(LOST)},
        },
        {"plan": 1, "paid_at": 1},
        sort=[("paid_at", ASCENDING)],
    )


async def pack_status(db: AsyncDatabase, user_id: str) -> dict[str, Any] | None:
    """{order_id, purchased_at, source: order | launch | grant} when the account owns the pack, else None."""
    o = await paying_order(db, user_id)
    if o:
        return {
            "order_id": o["_id"],
            "purchased_at": o["paid_at"],
            "source": "launch" if o["plan"] == "launch" else "order",
        }
    rec = await db[LINKEDIN_PACKS].find_one({"_id": user_id, "source": "grant"})
    if rec:
        return {"order_id": None, "purchased_at": rec["purchased_at"], "source": "grant"}
    return None


async def grant(db: AsyncDatabase, user_id: str, admin_id: str, note: str = "") -> bool:
    """An admin grant. False when the account already paid (nothing to grant)."""
    if await db[LINKEDIN_PACKS].find_one({"_id": user_id, "source": {"$in": list(PAID)}}):
        return False
    await db[LINKEDIN_PACKS].update_one(
        {"_id": user_id},
        {"$set": {"source": "grant", "order_id": None, "purchased_at": now(), "granted_by": admin_id, "note": note}},
        upsert=True,
    )
    return True


async def revoke(db: AsyncDatabase, user_id: str) -> None:
    """Removes an admin grant only (a paid order keeps its access until it is refunded)."""
    await db[LINKEDIN_PACKS].delete_one({"_id": user_id, "source": "grant"})
