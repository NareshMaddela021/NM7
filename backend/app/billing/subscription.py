"""An organization's plan: what is in effect today, usage against its limits, activation after a verified payment,
admin changes, and the end-of-plan reminders.

The subscription is stored on the organization (`subscription`), with a copy of the terms it was sold on (limits and
features), so editing a plan later never changes it. Dates are IST calendar days (YYYY-MM-DD), inclusive:

  active   today <= ends_on
  grace    ends_on < today <= grace_until (grace_days after the end): still the paid limits, with a banner
  expired  after grace_until: Free limits apply; nothing is deleted and everything stays readable

Over a limit, the action that would add more (a join, a new group, a coordinator invite, a new kiosk) is refused with
"ask your Owner to upgrade". Nothing already there is removed.
"""

import logging
from datetime import date, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.billing import emails
from app.billing.plans import DEFAULT_PLANS, LIMIT_KEYS, free_plan, get_plans, period_end, terms_of
from app.billing.settings import get_billing
from app.core.db import KIOSKS, MEMBERSHIPS, ORG_GROUPS, ORG_STAFF, ORGANIZATIONS, USERS, Session
from app.core.email import Mailer, send_safely
from app.core.errors import ApiError
from app.core.time import ist_day, now

log = logging.getLogger("nm7.billing")

PAID_STATES = ("active", "grace")
STAFF_ROLES_COUNTED = ("coordinator", "viewer")  # the Owner isn't counted against the coordinator limit

LIMIT_WORDS = {
    "members": ("member", "members"),
    "groups": ("group", "groups"),
    "coordinators": ("coordinator", "coordinators"),
    "kiosks": ("kiosk stall", "kiosk stalls"),
}


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def today_ist() -> date:
    return date.fromisoformat(ist_day())


def state_of(o: dict[str, Any] | None, today: date | None = None) -> str:
    """free (no paid plan bought or assigned) / active / grace / expired."""
    sub = (o or {}).get("subscription") or {}
    if not sub or sub.get("plan_id") in (None, "free") or not sub.get("ends_on"):
        return "free"
    t = today or today_ist()
    if t <= _d(sub["ends_on"]):
        return "active"
    if t <= _d(sub.get("grace_until") or sub["ends_on"]):
        return "grace"
    return "expired"


def in_effect(o: dict[str, Any] | None, today: date | None = None) -> dict[str, Any]:
    """The terms that apply today: the subscription's frozen terms while paid (active or grace), else Free."""
    if state_of(o, today) in PAID_STATES:
        return (o or {})["subscription"]
    f = free_plan()
    return {"plan_id": "free", "plan_name": f["name"], "limits": f["limits"], "features": f["features"]}


def plan_features(o: dict[str, Any] | None, today: date | None = None) -> dict[str, bool]:
    """The plan's feature switches (before the admin's per-organization overrides)."""
    t = in_effect(o, today)
    kiosks = (t.get("limits") or {}).get("kiosks", 0)
    f = t.get("features") or {}

    def later(key: str) -> bool:
        """A switch added after these terms were frozen: what the same plan gives by default (Free: off)."""
        if key in f:
            return bool(f[key])
        return bool((DEFAULT_PLANS.get(t.get("plan_id") or "free") or DEFAULT_PLANS["free"])["features"].get(key))

    return {
        "kiosk": kiosks is None or kiosks > 0,
        "branding": bool(f.get("branding")),
        "recruiter_links": bool(f.get("recruiter_links")),
        "members_download_free": bool(f.get("members_download_free")),
        "placement_insights": later("placement_insights"),
        "template_rules": later("template_rules"),
    }


def limits_of(o: dict[str, Any] | None, today: date | None = None) -> dict[str, int | None]:
    lim = dict(in_effect(o, today).get("limits") or {})
    # Nm7 switched kiosks on for an organization whose plan has none: the switch is the grant, no stall limit
    if ((o or {}).get("features") or {}).get("kiosk") is True and lim.get("kiosks") == 0:
        lim["kiosks"] = None
    custom = (o or {}).get("limit_overrides") or {}  # admin: a different limit for this organization (None = no limit)
    return {k: custom[k] if k in custom else lim.get(k) for k in LIMIT_KEYS}


async def usage(db: AsyncDatabase, org_id: str) -> dict[str, int]:
    return {
        "members": await db[MEMBERSHIPS].count_documents(
            {"org_id": org_id, "left_at": None, "approval": {"$ne": "rejected"}}
        ),
        "groups": await db[ORG_GROUPS].count_documents({"org_id": org_id}),
        "coordinators": await db[ORG_STAFF].count_documents(
            {"org_id": org_id, "status": {"$in": ["invited", "active"]}, "role": {"$in": list(STAFF_ROLES_COUNTED)}}
        ),
        "kiosks": await db[KIOSKS].count_documents(
            {"org_id": org_id, "revoked_at": None, "expires_at": {"$gt": now()}}
        ),
    }


def _limit_error(key: str, limit: int, member_side: bool) -> ApiError:
    one, many = LIMIT_WORDS[key]
    if member_side:
        return ApiError(
            409,
            "org_limit",
            "This organization’s Nm7 plan is full right now, so new members can’t join yet. "
            "Please ask the organization to upgrade their plan.",
        )
    words = one if limit == 1 else many
    return ApiError(
        409,
        "plan_limit",
        f"Your organization’s plan allows {limit} {words}, and that’s reached. Nothing has been deleted — "
        "ask your Owner to upgrade the plan (Organization → Billing) to add more.",
    )


async def check_limit(
    db: AsyncDatabase,
    o: dict[str, Any],
    key: str,
    *,
    adding: int = 1,
    member_side: bool = False,
    bypass: bool = False,
) -> None:
    """Refuses (409) an action that would take `key` over the plan in effect. Unlimited (None) always passes.
    `bypass`: Nm7's own admins (their console) may go over a limit on purpose; joins never bypass."""
    if bypass:
        return
    limit = limits_of(o)[key]
    if limit is None:
        return
    used = (await usage(db, o["_id"]))[key]
    if used + adding > limit:
        log.info("plan limit: org %s %s %s/%s", o["_id"], key, used, limit)
        raise _limit_error(key, limit, member_side)


async def billing_summary(db: AsyncDatabase, o: dict[str, Any], b: dict[str, Any] | None = None) -> dict[str, Any]:
    """Plan, dates, usage against limits and the banners to show (80% used, ends within 7 days, grace)."""
    b = b or await get_billing(db)
    st = state_of(o)
    t = in_effect(o)
    sub = o.get("subscription") or {}
    lim = limits_of(o)
    used = await usage(db, o["_id"])
    days_left = (_d(sub["ends_on"]) - today_ist()).days if st in PAID_STATES and sub.get("ends_on") else None
    warnings = []
    for k in LIMIT_KEYS:
        if lim[k] and used[k] * 100 >= lim[k] * int(b["usage_warn_pct"]):
            warnings.append({"kind": "usage", "key": k, "used": used[k], "limit": lim[k], "full": used[k] >= lim[k]})
    if st == "active" and days_left is not None and days_left <= int(b["ends_soon_days"]):
        warnings.append({"kind": "ends_soon", "endsOn": sub["ends_on"], "daysLeft": days_left})
    if st == "grace":
        warnings.append({"kind": "grace", "endsOn": sub["ends_on"], "graceUntil": sub.get("grace_until")})
    if st == "expired":
        warnings.append({"kind": "expired", "endedOn": sub.get("ends_on")})
    return {
        "planId": t.get("plan_id", "free"),
        "planName": t.get("plan_name", "Free"),
        "state": st,
        "startsOn": sub.get("starts_on") if st != "free" else None,
        "endsOn": sub.get("ends_on") if st != "free" else None,
        "graceUntil": sub.get("grace_until") if st != "free" else None,
        "daysLeft": days_left,
        "lastPlan": sub.get("plan_name") if st == "expired" else None,
        "limits": lim,
        "usage": used,
        "features": plan_features(o),
        "warnings": warnings,
    }


def subscription_doc(
    terms: dict[str, Any],
    start: date,
    grace_days: int,
    *,
    source: str,
    order_id: str | None = None,
    list_price: int | None = None,
    discount: int = 0,
    ends_on: date | None = None,
) -> dict[str, Any]:
    end = ends_on or period_end(start, terms.get("period_days"), terms.get("period_months"))
    price = terms.get("price") if list_price is None else list_price
    return {
        **{k: terms[k] for k in ("plan_id", "plan_name", "plan_version", "period_days", "period_months")},
        "limits": dict(terms["limits"]),
        "features": dict(terms["features"]),
        "price": price,
        "discount": discount,
        "price_paid": max((price or 0) - discount, 0),
        "starts_on": start.isoformat(),
        "ends_on": end.isoformat(),
        "grace_until": (end + timedelta(days=grace_days)).isoformat(),
        "source": source,  # razorpay / offline / admin
        "order_id": order_id,
        "activated_at": now(),
        "reminders": [],
    }


def renewal_start(o: dict[str, Any], plan_id: str) -> date:
    """Renewing the same plan before it lapses continues from the day after it ends; anything else starts today."""
    sub = o.get("subscription") or {}
    if sub.get("plan_id") == plan_id and state_of(o) in PAID_STATES:
        return max(_d(sub["ends_on"]) + timedelta(days=1), today_ist())
    return today_ist()


async def activate_paid(db: AsyncDatabase, order: Any, *, source: str, session: Session = None) -> dict[str, Any]:
    """A verified payment (Razorpay webhook / offline payment recorded by an admin) turns the plan on. Runs inside
    the payment's transaction, so the plan and the paid order are saved together or not at all."""
    o = await db[ORGANIZATIONS].find_one({"_id": order.org_id}, session=session)
    b = await get_billing(db, session=session)
    bill = order.billing or {}
    terms = bill["terms"]
    sub = subscription_doc(
        terms,
        renewal_start(o, terms["plan_id"]),
        int(b["grace_days"]),
        source=source,
        order_id=order.id,
        list_price=bill.get("list_price"),
        discount=int(bill.get("discount") or 0),
    )
    await _set_subscription(db, o, sub, session=session)
    await audit(
        db,
        None,
        "plan_activated",
        target=o["_id"],
        data={"orgs": [o["_id"]], "plan": terms["plan_id"], "order_id": order.id, "ends_on": sub["ends_on"],
              "source": source, "amount": order.amount},
        session=session,
    )  # fmt: skip
    return sub


async def _set_subscription(db: AsyncDatabase, o: dict[str, Any], sub: dict[str, Any], session: Session = None):
    old = o.get("subscription")
    update: dict[str, Any] = {"$set": {"subscription": sub, "updated_at": now()}}
    if old:
        update["$push"] = {"subscription_history": {**old, "replaced_at": now()}}
    await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, update, session=session)


async def assign_by_admin(
    db: AsyncDatabase,
    o: dict[str, Any],
    plan_id: str,
    *,
    starts_on: date | None,
    ends_on: date | None,
    price: int | None,
    discount: int,
    limits: dict[str, Any] | None,
    features: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Admin → Organization → Billing → assign a plan (no payment). "free" removes the paid plan."""
    if plan_id == "free":
        if o.get("subscription"):
            await _set_subscription(db, o, {"plan_id": "free", "plan_name": "Free", "source": "admin"})
        return None
    plans = await get_plans(db)
    terms = terms_of(plans[plan_id])
    if limits is not None:
        terms["limits"] = {**terms["limits"], **limits}
    if features is not None:
        terms["features"] = {**terms["features"], **features}
    b = await get_billing(db)
    start = starts_on or today_ist()
    sub = subscription_doc(
        terms, start, int(b["grace_days"]), source="admin", list_price=price, discount=discount, ends_on=ends_on
    )
    if _d(sub["ends_on"]) < start:
        raise ApiError(400, "bad_dates", "The end date is before the start date.")
    await _set_subscription(db, o, sub)
    return sub


async def extend(db: AsyncDatabase, o: dict[str, Any], ends_on: date) -> dict[str, Any]:
    sub = dict(o.get("subscription") or {})
    if not sub or sub.get("plan_id") in (None, "free"):
        raise ApiError(409, "no_plan", "This organization has no paid plan to extend. Assign one first.")
    if ends_on < _d(sub["starts_on"]):
        raise ApiError(400, "bad_dates", "The end date is before the plan started.")
    b = await get_billing(db)
    sub["ends_on"] = ends_on.isoformat()
    sub["grace_until"] = (ends_on + timedelta(days=int(b["grace_days"]))).isoformat()
    sub["reminders"] = []  # reminders count down to the new end date
    await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": {"subscription": sub, "updated_at": now()}})
    return sub


# ---------- reminders (automation rule "org_plan_reminders") ----------


async def owner_emails(db: AsyncDatabase, org_id: str) -> list[tuple[str, str]]:
    rows = await db[ORG_STAFF].find({"org_id": org_id, "role": "owner", "status": "active"}).to_list(None)
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r.get("user_id") for r in rows]}})}
    return [(r["email"], (users.get(r.get("user_id")) or {}).get("name") or "") for r in rows]


async def _claim(db: AsyncDatabase, org_id: str, ends_on: str, key: str) -> bool:
    """Marks a reminder as sent before sending it; a second pass at the same time finds it taken."""
    r = await db[ORGANIZATIONS].update_one(
        {"_id": org_id, "subscription.ends_on": ends_on, "subscription.reminders": {"$ne": key}},
        {"$push": {"subscription.reminders": key}},
    )
    return r.modified_count == 1


def _due(days_left: int, state: str, days: list[int]) -> str | None:
    """Which reminder applies now: the closest of 14 / 7 / 1 days before the end, then grace, then expired."""
    if state == "expired":
        return "expired"
    if state == "grace":
        return "grace"
    hits = sorted(d for d in days if days_left <= d)
    return f"d{hits[0]}" if hits else None


async def run_reminders(db: AsyncDatabase, _value: int, mailer: Mailer) -> int:
    b = await get_billing(db)
    days = sorted({int(d) for d in b["reminder_days"] if int(d) > 0}, reverse=True)
    today = today_ist()
    sent = 0
    async for o in db[ORGANIZATIONS].find({"subscription.ends_on": {"$type": "string"}, "status": {"$ne": "archived"}}):
        sub = o["subscription"]
        state = state_of(o, today)
        due = _due((_d(sub["ends_on"]) - today).days, state, days)
        if not due or due in (sub.get("reminders") or []):
            continue
        if not await _claim(db, o["_id"], sub["ends_on"], due):
            continue
        # skip the earlier ones too (a pass that missed day 14 must not send it on day 6)
        earlier = [f"d{d}" for d in days if due.startswith("d") and d > int(due[1:])]
        if due in ("grace", "expired"):
            earlier = [f"d{d}" for d in days] + (["grace"] if due == "expired" else [])
        if earlier:
            await db[ORGANIZATIONS].update_one(
                {"_id": o["_id"]}, {"$addToSet": {"subscription.reminders": {"$each": earlier}}}
            )
        for email, name in await owner_emails(db, o["_id"]):
            await send_safely(mailer, emails.plan_reminder(email, name, o, due))
        await audit(db, None, "plan_reminder", target=o["_id"], data={"orgs": [o["_id"]], "reminder": due})
        sent += 1
    return sent
