"""Nm7 for Organizations, Phase 4A API: plans, an organization's billing page, checkout, "Start free", and the
admin's plan editor, billing settings and per-organization billing.

  GET  /api/public/org-plans                      the plans table on /for-orgs (prices exclude GST)
  POST /api/me/orgs                               "Start free": a signed-in person creates an organization (Owner)
  GET  /api/org/{org_id}/billing                  Owner: plan, usage, banners, billing details, payments
  PUT  /api/org/{org_id}/billing/details          Owner: legal name, address, state, optional GSTIN
  GET  /api/org/{org_id}/billing/quote?plan=      Owner: price − discount + GST, before paying
  POST /api/org/{org_id}/billing/checkout         Owner: a Razorpay order (the plan turns on from the webhook)
  GET/PUT  /api/admin/billing/settings            supplier details, GST rate, grace, commission, test/live …
  GET  /api/admin/billing/plans · PUT …/{plan}    the plans editor (each save is a new version)
  GET  /api/admin/billing/summary                 org revenue after refunds, active paid orgs, renewals due
  GET  /api/admin/orgs/{org_id}/billing           one organization's plan, history, orders, pricing
  PUT  …/billing/plan · POST …/billing/extend · PUT …/billing/pricing
"""

from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field, model_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.billing.checkout import BillingDetailsIn, check_details, details_out, quote, quote_out, start_checkout
from app.billing.gst import STATES, gstin_problem
from app.billing.plans import LIMIT_KEYS, PLAN_IDS, describe_period, get_plans, save_plan
from app.billing.settings import DEFAULTS, get_billing, gst_on, save_billing
from app.billing.subscription import (
    PAID_STATES,
    assign_by_admin,
    billing_summary,
    extend,
    state_of,
    today_ist,
)
from app.core import rate_limit
from app.core.db import DB, ORDERS, ORG_STAFF, ORGANIZATIONS, REFUNDS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, AdminScope, OrgScope
from app.orgs.shapes import OrgType

public = APIRouter(prefix="/api/public", tags=["billing"])
me = APIRouter(prefix="/api/me/orgs", tags=["billing"])
portal = APIRouter(prefix="/api/org/{org_id}/billing", tags=["billing"])
admin = APIRouter(prefix="/api/admin", tags=["billing"])

CHECKOUT_RULES = [(10, timedelta(hours=1))]
SIGNUP_RULES = [(3, timedelta(days=1))]


# ---------- shapes ----------
def plan_out(p: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
    out = {
        "id": p["_id"],
        "name": p["name"],
        "blurb": p.get("blurb", ""),
        "price": p.get("price"),
        "periodDays": p.get("period_days"),
        "periodMonths": p.get("period_months"),
        "period": describe_period(p),
        "limits": {k: p["limits"].get(k) for k in LIMIT_KEYS},
        "features": {
            "kiosk": p["limits"].get("kiosks") is None or (p["limits"].get("kiosks") or 0) > 0,
            "branding": bool(p["features"].get("branding")),
            "recruiterLinks": bool(p["features"].get("recruiter_links")),
            "membersDownloadFree": bool(p["features"].get("members_download_free")),
        },
        "onSale": bool(p.get("on_sale")),
        "public": bool(p.get("public")),
        "version": int(p.get("version") or 1),
    }
    if full:
        out["history"] = [
            {
                "version": h.get("version"),
                "price": h.get("price"),
                "periodDays": h.get("period_days"),
                "periodMonths": h.get("period_months"),
                "limits": h.get("limits"),
                "features": h.get("features"),
                "until": ms(h.get("until")),
            }
            for h in reversed(p.get("history") or [])
        ]
    return out


def _sub_out(sub: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sub:
        return None
    return {
        "planId": sub.get("plan_id"),
        "planName": sub.get("plan_name"),
        "planVersion": sub.get("plan_version"),
        "price": sub.get("price"),
        "discount": sub.get("discount", 0),
        "pricePaid": sub.get("price_paid"),
        "startsOn": sub.get("starts_on"),
        "endsOn": sub.get("ends_on"),
        "graceUntil": sub.get("grace_until"),
        "source": sub.get("source"),
        "orderId": sub.get("order_id"),
        "activatedAt": ms(sub.get("activated_at")),
        "replacedAt": ms(sub.get("replaced_at")),
    }


def _order_out(o: dict[str, Any]) -> dict[str, Any]:
    bill = o.get("billing") or {}
    return {
        "id": o["_id"],
        "planName": (bill.get("terms") or {}).get("plan_name", ""),
        "amount": o["amount"],
        "taxable": bill.get("taxable"),
        "tax": bill.get("tax", 0),
        "status": o["status"],
        "invoiceNo": o.get("invoice_no"),
        "createdAt": ms(o.get("created_at")),
        "paidAt": ms(o.get("paid_at")),
        "via": bill.get("via", "razorpay"),
    }


async def _org(db, org_id: str) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": org_id})
    if not o:
        raise NOT_FOUND
    return o


async def _org_orders(db, org_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = await db[ORDERS].find({"org_id": org_id, "kind": "org"}).sort("created_at", -1).limit(limit).to_list(None)
    return [_order_out(r) for r in rows if r["status"] != "expired" or r.get("paid_at")]


# ---------- public ----------
@public.get("/org-plans")
async def org_plans(db: DB) -> dict[str, Any]:
    plans = await get_plans(db)
    b = await get_billing(db)
    return {
        "plans": [plan_out(p) for p in sorted(plans.values(), key=lambda p: p.get("sort", 9)) if p.get("public")],
        "gstOn": gst_on(b),
        "gstRatePct": int(b["gst_rate_bp"]) / 100,
        "graceDays": int(b["grace_days"]),
        "signupOpen": bool(b["org_signup_open"]),
        "states": [{"code": c, "name": n} for c, n in STATES.items()],
    }


# ---------- "Start free" ----------
class NewOrgIn(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    type: OrgType
    city: str = Field("", max_length=60)


@me.post("", status_code=201)
async def start_free(body: NewOrgIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Creates an organization on the Free plan with the signed-in person as its Owner."""
    b = await get_billing(db)
    if not b["org_signup_open"]:
        raise ApiError(403, "signup_closed", "New organizations are set up by Nm7 for now. Use “Talk to us”.")
    if not auth.user.email_verified_at:
        raise ApiError(403, "email_unverified", "Please confirm your email address first.")
    key = f"org-signup:{auth.user.id}"
    await rate_limit.check(db, key, SIGNUP_RULES)
    await rate_limit.record(db, key)
    t = now()
    oid = new_id()
    o = {
        "_id": oid,
        "name": " ".join(body.name.split()),
        "type": body.type,
        "city": body.city.strip(),
        "logo_url": "",
        "status": "active",
        "roles": [],
        "created_by": auth.user.id,
        "self_serve": True,
        "created_at": t,
        "updated_at": t,
    }
    await db[ORGANIZATIONS].insert_one(o)
    staff = {
        "_id": new_id(),
        "org_id": oid,
        "email": auth.user.email,
        "email_lc": auth.user.email.lower(),
        "user_id": auth.user.id,
        "role": "owner",
        "group_ids": None,
        "status": "active",
        "invited_by": auth.user.id,
        "created_at": t,
        "accepted_at": t,
    }
    await db[ORG_STAFF].insert_one(staff)
    data = {"orgs": [oid], "name": o["name"], "by": "staff", "role": "owner", "selfServe": True}
    await audit(db, auth.user.id, "org_create", target=oid, data=data, ip=client_ip(request))
    return {"orgId": oid}


# ---------- the Owner's billing page ----------
@portal.get("")
async def billing_page(db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("billing")
    o = await _org(db, scope.org_id)
    b = await get_billing(db)
    plans = await get_plans(db)
    buyable = [
        plan_out(p)
        for p in sorted(plans.values(), key=lambda p: p.get("sort", 9))
        if p["_id"] in ("drive", "campus") and p.get("on_sale") and p.get("price")
    ]
    if (o.get("custom_plan") or {}).get("price"):
        c = o["custom_plan"]
        custom = {**plans["custom"], **{k: c[k] for k in ("price", "period_days", "period_months") if k in c}}
        custom["limits"] = {**plans["custom"]["limits"], **(c.get("limits") or {})}
        custom["features"] = {**plans["custom"]["features"], **(c.get("features") or {})}
        buyable.append({**plan_out(custom), "onSale": True})
    pending = await db[ORDERS].find_one(
        {"org_id": o["_id"], "kind": "org", "status": "pending_payment"}, sort=[("created_at", -1)]
    )
    return {
        "orgId": o["_id"],
        "orgName": o["name"],
        "summary": await billing_summary(db, o, b),
        "details": details_out(o.get("billing_details")),
        "plans": buyable,
        "discountPct": int(o.get("discount_pct") or 0),
        "gstOn": gst_on(b),
        "gstRatePct": int(b["gst_rate_bp"]) / 100,
        "testMode": not b["razorpay_live"],
        "orders": await _org_orders(db, o["_id"]),
        "pendingOrderId": pending["_id"] if pending else None,
        "states": [{"code": c, "name": n} for c, n in STATES.items()],
    }


@portal.put("/details")
async def save_details(body: BillingDetailsIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("billing")
    await _org(db, scope.org_id)
    details = check_details(body)
    await db[ORGANIZATIONS].update_one(
        {"_id": scope.org_id}, {"$set": {"billing_details": details, "updated_at": now()}}
    )
    data = scope.audit_data(state=details["state_code"], gstin=bool(details["gstin"]))
    await audit(db, scope.actor_id, "billing_details", target=scope.org_id, data=data, ip=client_ip(request))
    return details_out(details)


@portal.get("/quote")
async def price_quote(db: DB, scope: OrgScope, plan: str = Query(max_length=20)) -> dict[str, Any]:
    scope.require("billing")
    return quote_out(await quote(db, await _org(db, scope.org_id), plan))


class CheckoutIn(CamelModel):
    plan_id: Literal["drive", "campus", "custom"]


@portal.post("/checkout", status_code=201)
async def checkout(body: CheckoutIn, request: Request, auth: CustomerAuth, db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("billing")
    if scope.role == "admin":
        raise ApiError(403, "owner_only", "Only the organization’s Owner pays. Nm7 can assign a plan instead.")
    key = f"org-checkout:{scope.org_id}"
    await rate_limit.check(db, key, CHECKOUT_RULES)
    await rate_limit.record(db, key)
    o = await _org(db, scope.org_id)
    out = await start_checkout(db, o, auth.user, body.plan_id)
    data = scope.audit_data(plan=body.plan_id, order_id=out["orderId"], amount=out["amount"])
    await audit(db, scope.actor_id, "billing_checkout", target=scope.org_id, data=data, ip=client_ip(request))
    return out


# ---------- admin: billing settings ----------
class SupplierIn(CamelModel):
    legal_name: str = Field(min_length=2, max_length=150)
    trade_name: str = Field("", max_length=80)
    address: str = Field("", max_length=400)
    state_code: str = Field("", max_length=2)
    gstin: str = Field("", max_length=15)
    signatory: str = Field("", max_length=100)
    sac: str = Field("", max_length=8, pattern=r"^[0-9]*$")
    email: str = Field("", max_length=200)


class BillingSettingsIn(CamelModel):
    supplier: SupplierIn
    gst_rate_bp: int = Field(ge=0, le=2800)
    grace_days: int = Field(ge=0, le=60)
    reminder_days: list[int] = Field(min_length=1, max_length=5)
    usage_warn_pct: int = Field(ge=50, le=100)
    ends_soon_days: int = Field(ge=1, le=60)
    commission_pct: int = Field(ge=0, le=100)
    commission_months: int = Field(ge=1, le=60)
    commission_payable_days: int = Field(ge=0, le=365)
    referral_days: int = Field(ge=1, le=365)
    partner_discount_on: bool
    partner_discount_pct: int = Field(ge=0, le=50)
    razorpay_live: bool
    org_signup_open: bool


def settings_out(b: dict[str, Any]) -> dict[str, Any]:
    s = b["supplier"]
    return {
        "supplier": {
            "legalName": s["legal_name"],
            "tradeName": s.get("trade_name", ""),
            "address": s["address"],
            "stateCode": s["state_code"],
            "gstin": s["gstin"],
            "signatory": s["signatory"],
            "sac": s["sac"],
            "email": s.get("email", ""),
        },
        **{CamelModel.model_config["alias_generator"](k): b[k] for k in DEFAULTS if k != "supplier"},
        "gstOn": gst_on(b),
        "missing": [label for k, label in MUST_FILL if not s.get(k)],
    }


MUST_FILL = [
    ("gstin", "GSTIN"),
    ("address", "Supplier address"),
    ("state_code", "Supplier state"),
    ("signatory", "Authorised signatory"),
    ("sac", "SAC code"),
]


@admin.get("/billing/settings")
async def get_billing_settings(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return settings_out(await get_billing(db))


@admin.put("/billing/settings")
async def put_billing_settings(
    body: BillingSettingsIn, request: Request, db: DB, auth: AdminAuth("settings")
) -> dict[str, Any]:
    s = body.supplier
    gstin = s.gstin.strip().upper()
    if s.state_code and s.state_code not in STATES:
        raise ApiError(400, "bad_state", "Choose the supplier’s state.")
    if gstin:
        problem = gstin_problem(gstin, s.state_code or None)
        if problem:
            raise ApiError(400, "bad_gstin", problem)
        if not s.state_code:
            raise ApiError(400, "bad_state", "Choose the supplier’s state (it must match the GSTIN).")
    before = await get_billing(db)
    changes = body.model_dump()
    changes["supplier"] = {**s.model_dump(), "gstin": gstin, "legal_name": " ".join(s.legal_name.split())}
    changes["reminder_days"] = sorted({d for d in body.reminder_days if 0 < d <= 60}, reverse=True) or [14, 7, 1]
    await save_billing(db, changes)
    after = await get_billing(db)
    diff = {k: after[k] for k in DEFAULTS if k != "supplier" and after[k] != before[k]} | {
        f"supplier.{k}": v for k, v in after["supplier"].items() if before["supplier"].get(k) != v
    }
    await audit(db, auth.user.id, "billing_settings", data=diff, ip=client_ip(request))
    return settings_out(after)


# ---------- admin: plans ----------
class LimitsIn(CamelModel):
    members: int | None = Field(None, ge=0, le=1_000_000)
    groups: int | None = Field(None, ge=0, le=10_000)
    coordinators: int | None = Field(None, ge=0, le=1_000)
    kiosks: int | None = Field(None, ge=0, le=1_000)


class FeaturesIn(CamelModel):
    branding: bool = False
    recruiter_links: bool = False
    members_download_free: bool = False


class PlanIn(CamelModel):
    name: str = Field(min_length=2, max_length=40)
    blurb: str = Field("", max_length=160)
    price: int | None = Field(None, ge=0, le=100_000_000_00)  # paise
    period_days: int | None = Field(None, ge=1, le=1_000)
    period_months: int | None = Field(None, ge=1, le=60)
    limits: LimitsIn
    features: FeaturesIn
    on_sale: bool = True
    public: bool = True

    @model_validator(mode="after")
    def _period(self):
        if self.period_days and self.period_months:
            raise ValueError("Give the period in days or in months, not both.")
        return self


@admin.get("/billing/plans")
async def list_plans(db: DB, _: AdminScope) -> list[dict[str, Any]]:
    plans = await get_plans(db)
    return [plan_out(p, full=True) for p in sorted(plans.values(), key=lambda p: p.get("sort", 9))]


@admin.put("/billing/plans/{plan_id}")
async def edit_plan(plan_id: str, body: PlanIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    if plan_id not in PLAN_IDS:
        raise NOT_FOUND
    terms = body.model_dump()
    if plan_id == "free":
        terms.update(price=0, period_days=None, period_months=None, on_sale=True)
    elif plan_id != "custom":
        if not body.price:
            raise ApiError(400, "price_required", "A paid plan needs a price.")
        if not (body.period_days or body.period_months):
            raise ApiError(400, "period_required", "Give the plan a period (days or months).")
    else:
        terms["on_sale"] = False  # the custom plan is set per organization
    p = await save_plan(db, plan_id, terms, scope.actor_id)
    data = {"plan": plan_id, "version": p["version"], "price": p.get("price"), "limits": p["limits"]}
    await audit(db, scope.actor_id, "plan_edit", target=plan_id, data=data, ip=client_ip(request))
    return plan_out(p, full=True)


# ---------- admin: one organization's billing ----------
@admin.get("/orgs/{org_id}/billing")
async def org_billing(org_id: str, db: DB, _: AdminScope) -> dict[str, Any]:
    o = await _org(db, org_id)
    c = o.get("custom_plan")
    return {
        "summary": await billing_summary(db, o),
        "subscription": _sub_out(o.get("subscription")),
        "history": [_sub_out(h) for h in reversed(o.get("subscription_history") or [])][:20],
        "details": details_out(o.get("billing_details")),
        "orders": await _org_orders(db, org_id),
        "discountPct": int(o.get("discount_pct") or 0),
        "customPlan": {
            "price": c.get("price"),
            "periodDays": c.get("period_days"),
            "periodMonths": c.get("period_months"),
            "limits": c.get("limits") or {},
            "features": {
                CamelModel.model_config["alias_generator"](k): v for k, v in (c.get("features") or {}).items()
            },
        }
        if c
        else None,
        "limitOverrides": o.get("limit_overrides"),
        "legacyUnlimited": bool(o.get("legacy_unlimited")),
    }


class AssignIn(CamelModel):
    plan_id: Literal["free", "drive", "campus", "custom"]
    starts_on: date | None = None
    ends_on: date | None = None
    price: int | None = Field(None, ge=0, le=100_000_000_00)
    discount: int = Field(0, ge=0, le=100_000_000_00)
    limits: LimitsIn | None = None
    features: FeaturesIn | None = None
    note: str = Field("", max_length=300)


@admin.put("/orgs/{org_id}/billing/plan")
async def assign_plan(org_id: str, body: AssignIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    """Assign a plan without a payment (a trial, a deal agreed offline, a correction). Logged."""
    o = await _org(db, org_id)
    sub = await assign_by_admin(
        db,
        o,
        body.plan_id,
        starts_on=body.starts_on,
        ends_on=body.ends_on,
        price=body.price,
        discount=body.discount,
        limits=body.limits.model_dump() if body.limits else None,
        features=body.features.model_dump() if body.features else None,
    )
    if sub is not None:  # a real plan replaces the "keep working as before" limits of an old organization
        await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$unset": {"limit_overrides": "", "legacy_unlimited": ""}})
    data = scope.audit_data(
        [org_id], plan=body.plan_id, ends_on=(sub or {}).get("ends_on"), price=body.price, note=body.note or None
    )
    await audit(db, scope.actor_id, "plan_assign", target=org_id, data=data, ip=client_ip(request))
    return await org_billing(org_id, db, scope)


class ExtendIn(CamelModel):
    ends_on: date
    note: str = Field("", max_length=300)


@admin.post("/orgs/{org_id}/billing/extend")
async def extend_plan(org_id: str, body: ExtendIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    o = await _org(db, org_id)
    before = (o.get("subscription") or {}).get("ends_on")
    sub = await extend(db, o, body.ends_on)
    data = scope.audit_data([org_id], ends_on=sub["ends_on"], was=before, note=body.note or None)
    await audit(db, scope.actor_id, "plan_extend", target=org_id, data=data, ip=client_ip(request))
    return await org_billing(org_id, db, scope)


class CustomPlanIn(CamelModel):
    price: int = Field(ge=1, le=100_000_000_00)
    period_days: int | None = Field(None, ge=1, le=1_000)
    period_months: int | None = Field(None, ge=1, le=60)
    limits: LimitsIn
    features: FeaturesIn

    @model_validator(mode="after")
    def _period(self):
        if bool(self.period_days) == bool(self.period_months):
            raise ValueError("Give the period in days or in months.")
        return self


class PricingIn(CamelModel):
    discount_pct: int = Field(0, ge=0, le=100)
    custom_plan: CustomPlanIn | None = None
    limit_overrides: LimitsIn | None = None  # a different limit for this organization (null field = no limit)
    clear_limit_overrides: bool = False


@admin.put("/orgs/{org_id}/billing/pricing")
async def set_pricing(org_id: str, body: PricingIn, request: Request, db: DB, scope: AdminScope) -> dict[str, Any]:
    """A discount for this organization's checkouts, a custom plan only it can buy, and per-organization limits."""
    await _org(db, org_id)
    sets: dict[str, Any] = {"discount_pct": body.discount_pct, "updated_at": now()}
    unsets: dict[str, str] = {}
    if body.custom_plan:
        sets["custom_plan"] = body.custom_plan.model_dump()
    else:
        unsets["custom_plan"] = ""
    if body.limit_overrides is not None:
        sets["limit_overrides"] = body.limit_overrides.model_dump(exclude_unset=True)
    elif body.clear_limit_overrides:
        unsets["limit_overrides"] = ""
        unsets["legacy_unlimited"] = ""
    await db[ORGANIZATIONS].update_one({"_id": org_id}, {"$set": sets, **({"$unset": unsets} if unsets else {})})
    data = scope.audit_data(
        [org_id],
        discount_pct=body.discount_pct,
        custom_price=body.custom_plan.price if body.custom_plan else None,
        limits=sets.get("limit_overrides"),
        cleared_limits=body.clear_limit_overrides or None,
    )
    await audit(db, scope.actor_id, "org_pricing", target=org_id, data=data, ip=client_ip(request))
    return await org_billing(org_id, db, scope)


# ---------- admin: dashboard ----------
@admin.get("/billing/summary")
async def billing_dashboard(db: DB, _: AdminAuth("dashboard"), days: int = Query(30, ge=1, le=366)) -> dict[str, Any]:
    since = now() - timedelta(days=days)
    paid = (
        await db[ORDERS]
        .find({"kind": "org", "paid_at": {"$gte": since}}, {"amount": 1, "billing.taxable": 1})
        .to_list(None)
    )
    ids = [p["_id"] for p in paid]
    refunded = sum(
        [
            r["amount"]
            async for r in db[REFUNDS].find(
                {"order_id": {"$in": ids}, "status": {"$in": ["approved", "processed"]}}, {"amount": 1}
            )
        ]
    )
    orgs = await db[ORGANIZATIONS].find({"subscription.ends_on": {"$type": "string"}}).to_list(None)
    today = today_ist()
    soon = (today + timedelta(days=30)).isoformat()
    active = [o for o in orgs if state_of(o, today) in PAID_STATES]
    due = sorted(
        (o for o in active if o["subscription"]["ends_on"] <= soon),
        key=lambda o: o["subscription"]["ends_on"],
    )
    return {
        "days": days,
        "moneyIn": sum(p["amount"] for p in paid),
        "refunded": refunded,
        "revenue": sum(p["amount"] for p in paid) - refunded,  # paise, GST included
        "taxable": sum((p.get("billing") or {}).get("taxable") or 0 for p in paid),
        "paidOrders": len(paid),
        "activePaidOrgs": len(active),
        "renewalsDue": [
            {
                "orgId": o["_id"],
                "name": o["name"],
                "plan": o["subscription"]["plan_name"],
                "endsOn": o["subscription"]["ends_on"],
            }
            for o in due
        ],
        "pendingCheckouts": await db[ORDERS].count_documents({"kind": "org", "status": "pending_payment"}),
    }
