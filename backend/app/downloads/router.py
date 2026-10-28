"""Who may download a resume or cover letter as PDF / Word.

The files are made in the browser, so the browser asks here first: GET /api/me/entitlements says what the
download buttons should do, and POST /api/me/exports is the check the export function itself runs before it
builds a file (401 for guests, 402 when the 'Fix it yourself' plan is needed).

Rules:
- guests: never (they create a free account first);
- admins (two-step login done): always, for checking files;
- approved experts: always (they check the files they deliver in the order workspace);
- while payments are off (Admin → Settings → Payments: Off): every signed-in account, free;
- once payments are on (WhatsApp or Razorpay): an account with a paid, not refunded order for any plan (Fix it
  yourself, Expert rewrite, Career Launch) — unlocked for good after the first payment;
- a member of an active group whose organization made downloads free for its members (reason "group");
- one resume unlocked for good by a free code (reason "resume"): an order at Rs 0 that names the resume; it
  unlocks that resume's PDF and Word only, not the whole account.
"""

from typing import Literal

from fastapi import APIRouter, Query
from pydantic import Field

from app.auth.deps import Auth, MaybeAuth
from app.core.db import DB, ORDERS, RESUMES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.me.rewards import reward_unlocks
from app.orgs.service import group_downloads_free
from app.site import get_site
from app.wapay.settings import payments_on as _payments_on

router = APIRouter(prefix="/api/me", tags=["downloads"])

Reason = Literal["guest", "unpaid", "paid", "plan", "admin", "expert", "payments_off", "group", "resume", "referral"]
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
    resume_id: str | None = Field(None, max_length=100)  # the resume being downloaded (else the active one)


async def payments_on(db) -> bool:
    """WhatsApp or Razorpay is on (Admin → Settings → Payments; see app/wapay/settings.py)."""
    return await _payments_on(db)


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
    if not await payments_on(db):
        return True, "payments_off"
    paid = db[ORDERS].find(
        {
            "customer_id": user_id,
            "paid_at": {"$ne": None},
            "status": {"$nin": list(LOST)},
            "kind": {"$ne": "org"},
            "resume_id": None,
        },  # a code that unlocked one resume doesn't unlock the account
        {"plan": 1},
    )
    plans = {o["plan"] async for o in paid}
    if plans & {"expert", "launch"}:
        return True, "plan"
    if "diy" in plans:
        return True, "paid"
    if await group_downloads_free(db, user_id):
        return True, "group"
    if await reward_unlocks(db, user_id):
        return True, "referral"
    return False, "unpaid"


async def resume_unlocked(db, user_id: str, key: str) -> bool:
    """This resume was unlocked for good by a free code (PDF and Word, any number of downloads)."""
    q = {"customer_id": user_id, "resume_id": key, "paid_at": {"$ne": None}, "status": {"$nin": list(LOST)}}
    return await db[ORDERS].find_one(q, {"_id": 1}) is not None


async def resume_key_of(db, user_id: str, resume_id: str | None) -> str | None:
    q = {"user_id": user_id}
    r = await db[RESUMES].find_one({**q, "key": resume_id}, {"key": 1}) if resume_id else None
    r = r or await db[RESUMES].find_one({**q, "active": True}, {"key": 1})
    return r["key"] if r else None


@router.get("/entitlements")
async def entitlements(
    auth: MaybeAuth, db: DB, resume_id: str | None = Query(None, alias="resumeId", max_length=100)
) -> EntitlementsOut:
    ok, reason = await entitlement(db, auth)
    if not ok and auth is not None:
        key = await resume_key_of(db, auth.user.id, resume_id)
        if key and await resume_unlocked(db, auth.user.id, key):
            ok, reason = True, "resume"
    diy = (await get_site(db))["plans"]["diy"]
    return EntitlementsOut(can_download=ok, reason=reason, payments_on=await payments_on(db), price=diy["amount"] / 100)


@router.post("/exports")
async def export_check(body: ExportIn, auth: MaybeAuth, db: DB) -> EntitlementsOut:
    """Run by the browser's export function before it makes a PDF or Word file."""
    out = await entitlements(auth, db, body.resume_id)
    if out.reason == "resume" and body.what != "resume":  # a code unlocked the resume, not cover letters
        out.can_download, out.reason = False, "unpaid"
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
