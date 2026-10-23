"""The LinkedIn pack (Phase 2, Rs 149): who owns it, and (app/linkedin/pack_writer.py) its contents.

GET /api/me/linkedin/pack/status: owned or not, how (order, Career Launch, admin grant), the price from the owner's
settings and whether payments are switched on. While payments are off (no Razorpay keys) nothing can be bought:
POST /api/orders answers 503 and the page keeps showing "Coming soon"; an admin can still grant the pack.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter

from app.auth.deps import MaybeAuth
from app.core.db import DB
from app.core.schemas import CamelModel
from app.downloads.router import payments_on
from app.linkedin.pack import pack_status
from app.site import get_site

router = APIRouter(prefix="/api/me/linkedin/pack", tags=["linkedin"])


class PackStatusOut(CamelModel):
    owned: bool
    source: Literal["order", "launch", "grant", ""] = ""
    order_id: str | None = None
    purchased_at: int | None = None  # ms
    payments_on: bool
    on_sale: bool  # payments on and the plan active in Admin > Settings & prices
    price: float  # rupees


def _ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


@router.get("/status")
async def status(auth: MaybeAuth, db: DB) -> PackStatusOut:
    plan = (await get_site(db))["plans"]["linkedin_pack"]
    on = payments_on()
    st = await pack_status(db, auth.user.id) if auth and auth.user.role == "customer" else None
    return PackStatusOut(
        owned=st is not None,
        source=st["source"] if st else "",
        order_id=st["order_id"] if st else None,
        purchased_at=_ms(st["purchased_at"]) if st else None,
        payments_on=on,
        on_sale=on and plan["active"],
        price=plan["amount"] / 100,
    )
