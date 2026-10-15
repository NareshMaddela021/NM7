"""Who may download a resume or cover letter as PDF / Word.

The files are made in the browser, so the browser asks here first: GET /api/me/entitlements says what the
download buttons should do, and POST /api/me/exports is the check the export function itself runs before it
builds a file (401 for guests, 402 when the 'Fix it yourself' plan is needed).

Rules:
- guests: never (they create a free account first);
- admins (two-step login done): always, for checking files;
- approved experts: always (they check the files they deliver in the order workspace);
- while payments are off (no Razorpay keys): every signed-in account, free;
- once payments are on: an account with a paid, not refunded order for any plan (Fix it yourself, Expert rewrite,
  Career Launch) — unlocked for good after the first payment.
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import Auth, MaybeAuth
from app.core.config import get_settings
from app.core.db import DB, ORDERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.site import get_site

router = APIRouter(prefix="/api/me", tags=["downloads"])

Reason = Literal["guest", "unpaid", "paid", "plan", "admin", "expert", "payments_off"]
PLAN_NAMES = {"diy": "paid", "expert": "plan", "launch": "plan"}
LOST = ("refunded", "cancelled")


class EntitlementsOut(CamelModel):
    can_download: bool
    reason: Reason
    payments_on: bool
    plan_id: str = "diy"  # what to buy when reason is "unpaid"
    price: float  # rupees, from the owner's settings


class ExportIn(CamelModel):
    format: Literal["pdf", "docx"]
    what: Literal["resume", "cover"] = "resume"
    name: str = Field("", max_length=200)


def payments_on() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


async def entitlement(db, auth: Auth | None) -> tuple[bool, str]:
    if auth is None:
        return False, "guest"
    if auth.user.role == "admin" and auth.session.two_step:
        return True, "admin"
    if auth.user.role == "expert" and auth.user.expert_status == "approved":
        return True, "expert"
    return await account_entitlement(db, auth.user.id)


async def account_entitlement(db, user_id) -> tuple[bool, str]:
    """A signed-in account's downloads (also used for a shared resume: its owner's)."""
    if not payments_on():
        return True, "payments_off"
    paid = db[ORDERS].find(
        {"customer_id": user_id, "paid_at": {"$ne": None}, "status": {"$nin": list(LOST)}}, {"plan": 1}
    )
    plans = {o["plan"] async for o in paid}
    if plans & {"expert", "launch"}:
        return True, "plan"
    if "diy" in plans:
        return True, "paid"
    return False, "unpaid"


@router.get("/entitlements")
async def entitlements(auth: MaybeAuth, db: DB) -> EntitlementsOut:
    ok, reason = await entitlement(db, auth)
    diy = (await get_site(db))["plans"]["diy"]
    return EntitlementsOut(can_download=ok, reason=reason, payments_on=payments_on(), price=diy["amount"] / 100)


@router.post("/exports")
async def export_check(body: ExportIn, auth: MaybeAuth, db: DB) -> EntitlementsOut:
    """Run by the browser's export function before it makes a PDF or Word file."""
    out = await entitlements(auth, db)
    if out.reason == "guest":
        raise ApiError(401, "not_signed_in", "Create a free account to download your resume.")
    if not out.can_download:
        raise ApiError(
            402,
            "payment_required",
            f"Unlock downloads - Rs {out.price:g} one-time.",
            extra={"planId": "diy", "price": out.price},
        )
    return out
