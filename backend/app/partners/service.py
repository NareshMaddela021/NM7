"""Partner referrals (Phase 4C): codes, attribution and the commission ledger. Money logic is here only.

- A partner applies (name, organisation, email, phone — no PAN or bank details) and an admin approves them with a code
  like ASX-RAVI. Their link is /for-orgs?ref=CODE; a first-party cookie remembers the code (Billing settings: 90 days),
  and the code can also be typed at checkout.
- An organization is tied to one partner at its **first payment** (the code on that order), never later. Self-referral
  (the partner pays for, owns or runs the organization) is blocked. An admin can correct the tie.
- Commission (Billing settings: 20% for the first 12 months): that % of the **taxable value** (before GST) of every
  payment the organization makes in the months after its first payment; payable 30 days after the payment. A refund
  reverses the matching part (a negative entry, taken off the next payout).
- Partners see their link, code, referred organizations (name and plan only) and commission — never members' data.
"""

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.billing.gst import half_up
from app.billing.plans import add_months
from app.billing.settings import get_billing
from app.billing.subscription import PAID_STATES, state_of, today_ist
from app.core.db import COMMISSIONS, ORDERS, ORG_STAFF, ORGANIZATIONS, PARTNERS, USERS, Session
from app.core.errors import ApiError
from app.core.time import IST, now

REF_COOKIE = "nm7_ref"
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,15}$")
CODE_PREFIX = "ASX-"
EARNING = ("approved", "paused")  # a paused partner keeps earning on organizations already tied to them

BAD_CODE = ApiError(400, "bad_ref_code", "That partner code isn’t valid. Check it, or leave it empty.")
SELF_REFERRAL = ApiError(400, "self_referral", "A partner can’t use their own code for an organization they run.")


def clean_code(code: str | None) -> str:
    return (code or "").strip().upper()[:16]


def suggest_code(name: str) -> str:
    letters = re.sub(r"[^A-Z]", "", (name.split() or ["PARTNER"])[0].upper())[:8] or "PARTNER"
    return CODE_PREFIX + letters


async def unique_code(db: AsyncDatabase, wanted: str) -> str:
    base = wanted
    n = 2
    while await db[PARTNERS].find_one({"code": wanted}, {"_id": 1}):
        wanted = f"{base[:13]}{n}"
        n += 1
    return wanted


async def partner_by_code(db: AsyncDatabase, code: str | None, session: Session = None) -> dict[str, Any] | None:
    code = clean_code(code)
    if not code or not CODE_RE.match(code):
        return None
    return await db[PARTNERS].find_one({"code": code, "status": "approved"}, session=session)


async def is_self_referral(
    db: AsyncDatabase, partner: dict[str, Any], payer_id: str | None, org_id: str, session: Session = None
) -> bool:
    """The partner is the payer, or an Owner / coordinator / viewer of the organization (by account or email)."""
    pid, pemail = partner.get("user_id"), partner.get("email_lc")
    if pid and pid == payer_id:
        return True
    if payer_id:
        payer = await db[USERS].find_one({"_id": payer_id}, {"email_lc": 1}, session=session)
        if payer and payer.get("email_lc") == pemail:
            return True
    who = [{"email_lc": pemail}] + ([{"user_id": pid}] if pid else [])
    staff = await db[ORG_STAFF].find_one({"org_id": org_id, "$or": who}, {"_id": 1}, session=session)
    return staff is not None


async def has_paid_before(db: AsyncDatabase, org_id: str, except_order: str | None = None, session: Session = None):
    q: dict[str, Any] = {"org_id": org_id, "kind": "org", "paid_at": {"$type": "date"}}
    if except_order:
        q["_id"] = {"$ne": except_order}
    return await db[ORDERS].find_one(q, {"_id": 1}, session=session) is not None


async def checkout_ref(
    db: AsyncDatabase, o: dict[str, Any], payer_id: str, typed: str | None, cookie: str | None
) -> dict[str, Any] | None:
    """The partner a checkout (or quote) is credited to: a typed code (wrong → error) or the referral cookie (wrong →
    ignored). Only before the organization's first payment; later payments stay with the partner tied then."""
    if o.get("partner") or await has_paid_before(db, o["_id"]):
        return None
    for code, strict in ((typed, True), (cookie, False)):
        if not clean_code(code):
            continue
        p = await partner_by_code(db, code)
        if p is None:
            if strict:
                raise BAD_CODE
            continue
        if await is_self_referral(db, p, payer_id, o["_id"]):
            if strict:
                raise SELF_REFERRAL
            continue
        return {"partner": p, "via": "typed" if strict else "link"}
    return None


async def partner_discount_pct(db: AsyncDatabase, ref: dict[str, Any] | None) -> int:
    if not ref:
        return 0
    b = await get_billing(db)
    return int(b["partner_discount_pct"]) if b["partner_discount_on"] else 0


def _ist_date(at: datetime) -> date:
    return at.astimezone(IST).date()


# ---------- at payment (inside mark_paid's transaction) ----------
async def on_org_paid(db: AsyncDatabase, order: Any, at: datetime, session: Session) -> None:
    """Ties the organization to the order's partner on its first payment, then books the commission."""
    o = await db[ORGANIZATIONS].find_one({"_id": order.org_id}, session=session)
    if o is None:
        return
    link = o.get("partner")
    bill = order.billing or {}
    if not link and bill.get("ref_code") and not await has_paid_before(db, o["_id"], order.id, session=session):
        p = await partner_by_code(db, bill["ref_code"], session=session)
        if p and not await is_self_referral(db, p, order.customer_id, o["_id"], session=session):
            link = {"partner_id": p["_id"], "code": p["code"], "since": at, "via": bill.get("ref_via") or "link",
                    "order_id": order.id}  # fmt: skip
            await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": {"partner": link}}, session=session)
            data = {"orgs": [o["_id"]], "partner_id": p["_id"], "code": p["code"], "order_id": order.id}
            await audit(db, None, "partner_attributed", target=o["_id"], data=data, session=session)
    if link:
        await book_commission(db, o, link, order, at, session)


async def book_commission(
    db: AsyncDatabase, o: dict[str, Any], link: dict[str, Any], order: Any, at: datetime, session: Session
) -> dict[str, Any] | None:
    p = await db[PARTNERS].find_one({"_id": link["partner_id"]}, session=session)
    if p is None or p.get("status") not in EARNING:
        return None
    b = await get_billing(db, session=session)
    since = _ist_date(link["since"])
    paid_on = _ist_date(at)
    if paid_on >= add_months(since, int(b["commission_months"])):
        return None  # past the commission period
    taxable = int((order.billing or {}).get("taxable") or 0)
    pct = int(b["commission_pct"])
    amount = half_up(taxable * pct, 100)
    if amount <= 0:
        return None
    entry = {
        "_id": str(uuid.uuid4()),
        "kind": "commission",
        "partner_id": p["_id"],
        "org_id": o["_id"],
        "org_name": o["name"],
        "order_id": order.id,
        "document": order.invoice_no,
        "base": taxable,
        "pct": pct,
        "amount": amount,
        "earned_on": paid_on.isoformat(),
        "payable_on": (paid_on + timedelta(days=int(b["commission_payable_days"]))).isoformat(),
        "status": "open",
        "payout_id": None,
        "created_at": now(),
    }
    await db[COMMISSIONS].insert_one(entry, session=session)
    data = {"orgs": [o["_id"]], "partner_id": p["_id"], "order_id": order.id, "amount": amount, "base": taxable,
            "pct": pct}  # fmt: skip
    await audit(db, None, "commission_earned", target=p["_id"], data=data, session=session)
    return entry


# ---------- at refund (inside the credit note's transaction) ----------
async def reverse_commission(
    db: AsyncDatabase, order: Any, refund_id: str, credit_note: dict[str, Any], session: Session
) -> dict[str, Any] | None:
    """The part of the order's commission that matches the refund's taxable value, as a negative entry."""
    c = await db[COMMISSIONS].find_one({"order_id": order.id, "kind": "commission"}, session=session)
    if c is None:
        return None
    reversed_so_far = -sum(
        [r["amount"] async for r in db[COMMISSIONS].find({"order_id": order.id, "kind": "reversal"}, session=session)]
    )
    base = int(c["base"]) or 1
    part = half_up(int(c["amount"]) * int(credit_note["taxable"]), base)
    part = min(part, int(c["amount"]) - reversed_so_far)
    if part <= 0:
        return None
    today = today_ist().isoformat()
    entry = {
        "_id": str(uuid.uuid4()),
        "kind": "reversal",
        "partner_id": c["partner_id"],
        "org_id": c["org_id"],
        "org_name": c.get("org_name", ""),
        "order_id": order.id,
        "refund_id": refund_id,
        "document": credit_note["number"],
        "base": int(credit_note["taxable"]),
        "pct": c["pct"],
        "amount": -part,
        "earned_on": today,
        "payable_on": today,  # taken off the next payout
        "status": "open",
        "payout_id": None,
        "created_at": now(),
    }
    await db[COMMISSIONS].insert_one(entry, session=session)
    data = {"orgs": [c["org_id"]], "partner_id": c["partner_id"], "order_id": order.id, "refund_id": refund_id,
            "amount": -part}  # fmt: skip
    await audit(db, None, "commission_reversed", target=c["partner_id"], data=data, session=session)
    return entry


# ---------- views ----------
def entry_state(e: dict[str, Any], today: str) -> str:
    if e["status"] == "paid":
        return "paid"
    return "payable" if e["payable_on"] <= today else "pending"


def totals(entries: list[dict[str, Any]], today: str | None = None) -> dict[str, int]:
    t = today or today_ist().isoformat()
    out = {"earned": 0, "pending": 0, "payable": 0, "paid": 0}
    for e in entries:
        out["earned"] += e["amount"]
        out[entry_state(e, t)] += e["amount"]
    return out


def entry_out(e: dict[str, Any], today: str) -> dict[str, Any]:
    return {
        "id": e["_id"],
        "kind": e["kind"],
        "orgName": e.get("org_name", ""),
        "document": e.get("document"),
        "base": e["base"],
        "pct": e["pct"],
        "amount": e["amount"],
        "earnedOn": e["earned_on"],
        "payableOn": e["payable_on"],
        "state": entry_state(e, today),
        "payoutId": e.get("payout_id"),
    }


async def referred_orgs(db: AsyncDatabase, partner_id: str) -> list[dict[str, Any]]:
    """Name and plan only — never members, groups, resumes or contact details."""
    rows = (
        await db[ORGANIZATIONS]
        .find({"partner.partner_id": partner_id}, {"name": 1, "subscription": 1, "partner.since": 1})
        .to_list(1000)
    )
    out = []
    for o in rows:
        paid = state_of(o) in PAID_STATES
        out.append(
            {
                "name": o["name"],
                "plan": (o.get("subscription") or {}).get("plan_name") if paid else "Free",
                "since": (o.get("partner") or {}).get("since"),
            }
        )
    return sorted(out, key=lambda r: r["since"] or now(), reverse=True)
