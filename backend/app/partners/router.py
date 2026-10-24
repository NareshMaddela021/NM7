"""Partner referrals API (Phase 4C).

POST /api/public/partners/apply            the /partners form (name, organisation, email, phone — nothing else)
POST /api/public/referral                  remember a partner code from /for-orgs?ref=CODE (first-party cookie)
GET  /api/public/referral                  the remembered code (shown at checkout)
GET  /api/partner                          the signed-in partner: link, code, referred organizations, commission
GET  /api/admin/partners                   applications and partners, with what each is owed
GET  /api/admin/partners/{id}              one partner: referred organizations, ledger, payouts
POST /api/admin/partners/{id}/approve      approve with a code (ASX-RAVI)
PUT  /api/admin/partners/{id}/status       pause / resume / reject
POST /api/admin/partners/{id}/payouts      mark everything payable as paid (reference, TDS note)
PUT  /api/admin/orgs/{org_id}/partner      correct which partner an organization is tied to
"""

import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request, Response
from pydantic import EmailStr, Field
from pymongo import ReturnDocument

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import clear_cookie, client_ip, set_cookie
from app.billing.settings import get_billing
from app.billing.subscription import today_ist
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import COMMISSIONS, DB, ORDERS, ORGANIZATIONS, PARTNER_PAYOUTS, PARTNERS, USERS, transaction
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.partners import emails
from app.partners.service import (
    CODE_RE,
    REF_COOKIE,
    clean_code,
    entry_out,
    is_self_referral,
    partner_by_code,
    referred_orgs,
    suggest_code,
    totals,
    unique_code,
)

public = APIRouter(prefix="/api/public", tags=["partners"])
me = APIRouter(prefix="/api/partner", tags=["partners"])
admin = APIRouter(prefix="/api/admin", tags=["partners"])

APPLY_RULES = [(3, timedelta(hours=1)), (10, timedelta(days=1))]
NOT_FOUND = ApiError(404, "not_found", "No such partner.")


def link_for(code: str) -> str:
    return f"{get_settings().site_url}/for-orgs?ref={code}"


# ---------- public ----------
class ApplyIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    organisation: str = Field("", max_length=120)
    email: EmailStr
    phone: str = Field(min_length=8, max_length=20, pattern=r"^[0-9+\- ()]+$")
    note: str = Field("", max_length=500)


@public.post("/partners/apply", status_code=201)
async def apply(body: ApplyIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    ip = client_ip(request) or "-"
    await rate_limit.check(db, f"partner-apply:{ip}", APPLY_RULES)
    await rate_limit.record(db, f"partner-apply:{ip}")
    email_lc = str(body.email).lower()
    if await db[PARTNERS].find_one({"email_lc": email_lc}, {"_id": 1}):
        return {"ok": True}  # already applied: the same answer, nothing changed
    doc = {
        "_id": str(uuid.uuid4()),
        "name": " ".join(body.name.split()),
        "organisation": body.organisation.strip(),
        "email": str(body.email),
        "email_lc": email_lc,
        "phone": body.phone.strip(),
        "note": body.note.strip(),
        "status": "applied",
        "code": None,
        "user_id": None,
        "created_at": now(),
    }
    await db[PARTNERS].insert_one(doc)
    await audit(db, None, "partner_apply", target=doc["_id"], data={"email": email_lc}, ip=ip)
    await send_safely(mailer, emails.applied(doc))
    return {"ok": True}


class RefIn(CamelModel):
    code: str = Field(max_length=20)


@public.get("/partner-terms")
async def partner_terms(db: DB) -> dict[str, Any]:
    """The programme's terms for /partners (all from Billing settings)."""
    b = await get_billing(db)
    return {
        "commissionPct": int(b["commission_pct"]),
        "commissionMonths": int(b["commission_months"]),
        "payableDays": int(b["commission_payable_days"]),
        "referralDays": int(b["referral_days"]),
    }


@public.post("/referral")
async def remember_ref(body: RefIn, response: Response, db: DB) -> dict[str, Any]:
    p = await partner_by_code(db, body.code)
    if p is None:
        return {"code": None}
    b = await get_billing(db)
    set_cookie(response, REF_COOKIE, p["code"], timedelta(days=int(b["referral_days"])))
    return {"code": p["code"], "discountPct": int(b["partner_discount_pct"]) if b["partner_discount_on"] else 0}


@public.get("/referral")
async def current_ref(request: Request, response: Response, db: DB) -> dict[str, Any]:
    code = request.cookies.get(REF_COOKIE)
    p = await partner_by_code(db, code) if code else None
    if code and p is None:
        clear_cookie(response, REF_COOKIE)  # the partner was paused or removed
    return {"code": p["code"] if p else None}


# ---------- the partner ----------
async def _my_partner(db, user) -> dict[str, Any]:
    p = await db[PARTNERS].find_one({"user_id": user.id})
    if p is None and user.email_verified_at:
        # approved before they had an account (or before it was linked): link by their confirmed email
        p = await db[PARTNERS].find_one_and_update(
            {"email_lc": user.email.lower(), "user_id": None, "status": {"$in": ["approved", "paused"]}},
            {"$set": {"user_id": user.id}},
            return_document=ReturnDocument.AFTER,
        )
        if p:
            await db[USERS].update_one({"_id": user.id}, {"$set": {"partner_id": p["_id"]}})
    if p is None or p["status"] not in ("approved", "paused"):
        raise ApiError(403, "not_a_partner", "This account isn’t an approved Nm7 partner. Apply at nm7.si/partners.")
    return p


@me.get("")
async def partner_home(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    p = await _my_partner(db, auth.user)
    today = today_ist().isoformat()
    entries = await db[COMMISSIONS].find({"partner_id": p["_id"]}).sort("created_at", -1).to_list(2000)
    b = await get_billing(db)
    return {
        "name": p["name"],
        "status": p["status"],
        "code": p["code"],
        "link": link_for(p["code"]),
        "terms": {
            "commissionPct": int(b["commission_pct"]),
            "commissionMonths": int(b["commission_months"]),
            "payableDays": int(b["commission_payable_days"]),
            "referralDays": int(b["referral_days"]),
            "discountPct": int(b["partner_discount_pct"]) if b["partner_discount_on"] else 0,
        },
        "orgs": [
            {"name": o["name"], "plan": o["plan"], "since": ms(o["since"])} for o in await referred_orgs(db, p["_id"])
        ],
        "totals": totals(entries, today),
        "entries": [entry_out(e, today) for e in entries[:200]],
    }


# ---------- admin ----------
def _partner_out(p: dict[str, Any], t: dict[str, int] | None = None, orgs: int = 0) -> dict[str, Any]:
    return {
        "id": p["_id"],
        "name": p["name"],
        "organisation": p.get("organisation", ""),
        "email": p["email"],
        "phone": p.get("phone", ""),
        "note": p.get("note", ""),
        "status": p["status"],
        "code": p.get("code"),
        "link": link_for(p["code"]) if p.get("code") else None,
        "hasAccount": bool(p.get("user_id")),
        "createdAt": ms(p.get("created_at")),
        "approvedAt": ms(p.get("approved_at")),
        "tdsNote": p.get("tds_note", ""),
        "orgs": orgs,
        "totals": t or {"earned": 0, "pending": 0, "payable": 0, "paid": 0},
    }


@admin.get("/partners")
async def list_partners(db: DB, _: AdminAuth("payments")) -> list[dict[str, Any]]:
    today = today_ist().isoformat()
    partners = await db[PARTNERS].find().sort("created_at", -1).to_list(1000)
    by: dict[str, list] = {}
    async for e in db[COMMISSIONS].find({}, {"partner_id": 1, "amount": 1, "status": 1, "payable_on": 1}):
        by.setdefault(e["partner_id"], []).append(e)
    counts = {
        r["_id"]: r["n"]
        async for r in await db[ORGANIZATIONS].aggregate(
            [
                {"$match": {"partner.partner_id": {"$type": "string"}}},
                {"$group": {"_id": "$partner.partner_id", "n": {"$sum": 1}}},
            ]
        )
    }
    return [_partner_out(p, totals(by.get(p["_id"], []), today), counts.get(p["_id"], 0)) for p in partners]


async def _partner(db, partner_id: str) -> dict[str, Any]:
    p = await db[PARTNERS].find_one({"_id": partner_id})
    if not p:
        raise NOT_FOUND
    return p


@admin.get("/partners/{partner_id}")
async def get_partner(partner_id: str, db: DB, _: AdminAuth("payments")) -> dict[str, Any]:
    p = await _partner(db, partner_id)
    today = today_ist().isoformat()
    entries = await db[COMMISSIONS].find({"partner_id": p["_id"]}).sort("created_at", -1).to_list(5000)
    orgs = (
        await db[ORGANIZATIONS]
        .find({"partner.partner_id": p["_id"]}, {"name": 1, "partner": 1, "subscription.plan_name": 1})
        .to_list(1000)
    )
    payouts = await db[PARTNER_PAYOUTS].find({"partner_id": p["_id"]}).sort("created_at", -1).to_list(200)
    return {
        **_partner_out(p, totals(entries, today), len(orgs)),
        "suggestedCode": await unique_code(db, suggest_code(p["name"])) if not p.get("code") else None,
        "referredOrgs": [
            {
                "id": o["_id"],
                "name": o["name"],
                "since": ms(o["partner"].get("since")),
                "via": o["partner"].get("via"),
                "plan": (o.get("subscription") or {}).get("plan_name") or "Free",
            }  # fmt: skip
            for o in orgs
        ],
        "entries": [{**entry_out(e, today), "orgId": e["org_id"], "orderId": e["order_id"]} for e in entries],
        "payouts": [
            {
                "id": x["_id"],
                "amount": x["amount"],
                "reference": x["reference"],
                "tdsNote": x.get("tds_note", ""),
                "entries": len(x.get("entry_ids") or []),
                "at": ms(x["created_at"]),
            }  # fmt: skip
            for x in payouts
        ],
    }


class ApproveIn(CamelModel):
    code: str | None = Field(None, max_length=16)


@admin.post("/partners/{partner_id}/approve")
async def approve(
    partner_id: str, body: ApproveIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("payments")
) -> dict[str, Any]:
    p = await _partner(db, partner_id)
    if p["status"] not in ("applied", "rejected"):
        raise ApiError(409, "already_decided", "This partner is already approved.")
    code = clean_code(body.code) or await unique_code(db, suggest_code(p["name"]))
    if not CODE_RE.match(code):
        raise ApiError(400, "bad_code", "A code is 3–16 letters, digits or dashes, like ASX-RAVI.")
    if await db[PARTNERS].find_one({"code": code, "_id": {"$ne": p["_id"]}}, {"_id": 1}):
        raise ApiError(409, "code_taken", "That code is taken. Choose another.")
    user = await db[USERS].find_one({"email_lc": p["email_lc"], "email_verified_at": {"$type": "date"}}, {"_id": 1})
    sets = {"status": "approved", "code": code, "approved_at": now(), "approved_by": auth.user.id}
    if user:
        sets["user_id"] = user["_id"]
    await db[PARTNERS].update_one({"_id": p["_id"]}, {"$set": sets})
    if user:
        await db[USERS].update_one({"_id": user["_id"]}, {"$set": {"partner_id": p["_id"]}})
    await audit(db, auth.user.id, "partner_approve", target=p["_id"], data={"code": code}, ip=client_ip(request))
    p = {**p, **sets}
    await send_safely(mailer, emails.approved(p, link_for(code)))
    return _partner_out(p)


class StatusIn(CamelModel):
    status: Literal["approved", "paused", "rejected"]
    note: str = Field("", max_length=300)
    tds_note: str | None = Field(None, max_length=300)


@admin.put("/partners/{partner_id}/status")
async def set_status(
    partner_id: str, body: StatusIn, request: Request, db: DB, auth: AdminAuth("payments")
) -> dict[str, Any]:
    p = await _partner(db, partner_id)
    if body.status == "approved" and not p.get("code"):
        raise ApiError(409, "not_approved", "Approve the application first (it gives the partner a code).")
    if body.status == "rejected" and p["status"] != "applied":
        raise ApiError(409, "already_approved", "An approved partner can be paused, not rejected.")
    sets: dict[str, Any] = {"status": body.status, "updated_at": now()}
    if body.tds_note is not None:
        sets["tds_note"] = body.tds_note.strip()
    await db[PARTNERS].update_one({"_id": p["_id"]}, {"$set": sets})
    data = {"from": p["status"], "to": body.status, "note": body.note or None}
    await audit(db, auth.user.id, "partner_status", target=p["_id"], data=data, ip=client_ip(request))
    return _partner_out({**p, **sets})


class PayoutIn(CamelModel):
    reference: str = Field(min_length=3, max_length=80)  # UTR / transfer reference
    tds_note: str = Field("", max_length=300)  # e.g. "TDS 194H 2% deducted: ₹…" — PAN is never stored here


@admin.post("/partners/{partner_id}/payouts", status_code=201)
async def payout(
    partner_id: str, body: PayoutIn, request: Request, db: DB, auth: AdminAuth("payments")
) -> dict[str, Any]:
    p = await _partner(db, partner_id)
    today = today_ist().isoformat()

    async def run(s):
        due = (
            await db[COMMISSIONS]
            .find({"partner_id": p["_id"], "status": "open", "payable_on": {"$lte": today}}, session=s)
            .to_list(None)
        )
        amount = sum(e["amount"] for e in due)
        if not due or amount <= 0:
            raise ApiError(409, "nothing_payable", "Nothing is payable to this partner yet.")
        pid = str(uuid.uuid4())
        ids = [e["_id"] for e in due]
        await db[COMMISSIONS].update_many(
            {"_id": {"$in": ids}, "status": "open"},
            {"$set": {"status": "paid", "payout_id": pid, "paid_at": now()}},
            session=s,
        )
        doc = {
            "_id": pid,
            "partner_id": p["_id"],
            "amount": amount,
            "reference": body.reference.strip(),
            "tds_note": body.tds_note.strip(),
            "entry_ids": ids,
            "by": auth.user.id,
            "created_at": now(),
        }
        await db[PARTNER_PAYOUTS].insert_one(doc, session=s)
        data = {"payout_id": pid, "amount": amount, "entries": len(ids), "reference": doc["reference"],
                "tds_note": doc["tds_note"] or None}  # fmt: skip
        await audit(db, auth.user.id, "commission_payout", target=p["_id"], data=data, ip=client_ip(request), session=s)
        return doc

    doc = await transaction(run)
    return {"id": doc["_id"], "amount": doc["amount"], "entries": len(doc["entry_ids"])}


class OrgPartnerIn(CamelModel):
    partner_id: str | None = Field(None, max_length=64)  # null: not tied to a partner
    note: str = Field(min_length=3, max_length=300)


@admin.put("/orgs/{org_id}/partner")
async def set_org_partner(
    org_id: str, body: OrgPartnerIn, request: Request, db: DB, auth: AdminAuth("payments")
) -> dict[str, Any]:
    """Correct the tie (a code typed wrong, a partner who brought them offline). Commission already booked stays
    with the partner it was booked for; later payments in the commission period go to the new partner."""
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not o:
        raise ApiError(404, "not_found", "No such organization.")
    before = (o.get("partner") or {}).get("partner_id")
    if body.partner_id:
        p = await _partner(db, body.partner_id)
        if p["status"] not in ("approved", "paused"):
            raise ApiError(409, "not_approved", "Only an approved partner can be tied to an organization.")
        if await is_self_referral(db, p, None, org_id):
            raise ApiError(409, "self_referral", "This partner runs the organization: self-referral isn’t allowed.")
        # the commission period runs from the organization's first payment (or from now, if it hasn't paid yet)
        since = (o.get("partner") or {}).get("since") or await first_paid_at(db, org_id)
        link = {"partner_id": p["_id"], "code": p["code"], "since": since or now(), "via": "admin"}
        await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$set": {"partner": link}})
    else:
        await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$unset": {"partner": ""}})
    data = {"orgs": [org_id], "from": before, "to": body.partner_id, "note": body.note}
    await audit(db, auth.user.id, "org_partner_set", target=org_id, data=data, ip=client_ip(request))
    return {"partnerId": body.partner_id}


async def first_paid_at(db, org_id: str):
    first = await db[ORDERS].find_one(
        {"org_id": org_id, "kind": "org", "paid_at": {"$type": "date"}}, {"paid_at": 1}, sort=[("paid_at", 1)]
    )
    return first["paid_at"] if first else None
