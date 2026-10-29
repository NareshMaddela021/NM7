"""Organization plans (Admin → Plans). Each plan is a document in `org_plans`; the defaults below are used until an
admin saves a change. Every save bumps the plan's `version` and keeps the old terms in `history`, and a purchase
copies the terms it was sold on (price, period, limits, features) into the order and the organization's
subscription, so editing a plan never changes what someone already bought or an invoice already issued.

Limits: None means unlimited. The kiosk feature is on when a plan allows at least one kiosk stall.
"""

import calendar
from datetime import date, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import ORG_PLANS, Session
from app.core.time import now

LIMIT_KEYS = ("members", "groups", "coordinators", "kiosks", "recruiters")  # recruiters: active recruiter invites
FEATURE_KEYS = (
    "branding",
    "recruiter_links",
    "members_download_free",
    "placement_insights",
    "template_rules",
    "recruiter_job_match",
    "drives",
    "eligibility",
    "offers",
    "wa_reminders",
    "alumni",
    "faculty_review",
    "multi_campus",
    "recruiter_accounts",
    "recruiter_compare",
    "interview_scheduling",
)
PLAN_IDS = ("free", "drive", "campus", "custom")

DEFAULT_PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "name": "Free",
        "blurb": "Try Nm7 with one batch.",
        "price": 0,
        "period_days": None,
        "period_months": None,
        "limits": {"members": 50, "groups": 1, "coordinators": 1, "kiosks": 0, "recruiters": 0},
        "features": {
            "branding": False,
            "recruiter_links": False,
            "members_download_free": False,
            "placement_insights": False,  # placement dashboard charts, missing lists, reminders, roll list
            "template_rules": False,  # placement template: section order and rules (Campus)
            "recruiter_job_match": False,  # recruiter portal: job match mode (Campus)
            "drives": False,
            "eligibility": False,
            "offers": False,
            "wa_reminders": False,
            "alumni": False,
            "faculty_review": False,
            "multi_campus": False,
            "recruiter_accounts": False,
            "recruiter_compare": False,
            "interview_scheduling": False,
        },
        "on_sale": True,
        "public": True,
        "sort": 0,
    },
    "drive": {
        "name": "Drive",
        "blurb": "One placement drive or event.",
        "price": 4999_00,
        "period_days": 60,
        "period_months": None,
        "limits": {"members": 500, "groups": 5, "coordinators": 3, "kiosks": 3, "recruiters": 1},
        "features": {
            "branding": True,
            "recruiter_links": True,
            "members_download_free": True,
            "placement_insights": True,
            "template_rules": False,
            "recruiter_job_match": False,
            "drives": True,
            "eligibility": True,
            "offers": True,
            "wa_reminders": True,
            "alumni": False,
            "faculty_review": True,
            "multi_campus": False,
            "recruiter_accounts": True,
            "recruiter_compare": False,
            "interview_scheduling": False,
        },
        "on_sale": True,
        "public": True,
        "sort": 1,
    },
    "campus": {
        "name": "Campus",
        "blurb": "A whole year of batches and drives.",
        "price": 24999_00,
        "period_days": None,
        "period_months": 12,
        "limits": {"members": 3000, "groups": None, "coordinators": 10, "kiosks": 10, "recruiters": None},
        "features": {
            "branding": True,
            "recruiter_links": True,
            "members_download_free": True,
            "placement_insights": True,
            "template_rules": True,
            "recruiter_job_match": True,
            "drives": True,
            "eligibility": True,
            "offers": True,
            "wa_reminders": True,
            "alumni": True,
            "faculty_review": True,
            "multi_campus": True,
            "recruiter_accounts": True,
            "recruiter_compare": True,
            "interview_scheduling": True,
        },
        "on_sale": True,
        "public": True,
        "sort": 2,
    },
    "custom": {
        "name": "Custom",
        "blurb": "Your own limits and price, set up by Nm7.",
        "price": None,  # set per organization by the admin
        "period_days": None,
        "period_months": 12,
        "limits": {"members": None, "groups": None, "coordinators": None, "kiosks": None, "recruiters": None},
        "features": {
            "branding": True,
            "recruiter_links": True,
            "members_download_free": True,
            "placement_insights": True,
            "template_rules": True,
            "recruiter_job_match": True,
            "drives": True,
            "eligibility": True,
            "offers": True,
            "wa_reminders": True,
            "alumni": True,
            "faculty_review": True,
            "multi_campus": True,
            "recruiter_accounts": True,
            "recruiter_compare": True,
            "interview_scheduling": True,
        },
        "on_sale": False,  # never bought at checkout: the admin assigns it
        "public": True,
        "sort": 3,
    },
}

# The Free plan's current terms, kept in memory so the (synchronous) feature checks can fall back to them when an
# organization has no paid plan in effect. Refreshed whenever plans are read from the database.
_free: dict[str, Any] = {**DEFAULT_PLANS["free"], "_id": "free", "version": 1}


def free_plan() -> dict[str, Any]:
    return _free


def _with_defaults(pid: str, stored: dict[str, Any] | None) -> dict[str, Any]:
    base = {**DEFAULT_PLANS[pid], "_id": pid, "version": 1, "history": []}
    if not stored:
        return base
    out = {**base, **{k: v for k, v in stored.items() if k != "_id"}}
    out["limits"] = {**base["limits"], **(stored.get("limits") or {})}
    out["features"] = {**base["features"], **(stored.get("features") or {})}
    return out


async def get_plans(db: AsyncDatabase, session: Session = None) -> dict[str, dict[str, Any]]:
    global _free
    stored = {p["_id"]: p async for p in db[ORG_PLANS].find({"_id": {"$in": list(PLAN_IDS)}}, session=session)}
    plans = {pid: _with_defaults(pid, stored.get(pid)) for pid in PLAN_IDS}
    _free = plans["free"]
    return plans


async def save_plan(db: AsyncDatabase, pid: str, terms: dict[str, Any], actor_id: str) -> dict[str, Any]:
    """Saves new terms as the next version; the previous terms go to `history` (never rewritten)."""
    old = (await get_plans(db))[pid]
    keep = {k: old.get(k) for k in ("price", "period_days", "period_months", "limits", "features")}
    version = int(old.get("version") or 1) + 1
    t = now()
    await db[ORG_PLANS].update_one(
        {"_id": pid},
        {
            "$set": {**terms, "version": version, "updated_at": t, "updated_by": actor_id},
            "$push": {"history": {"version": version - 1, **keep, "until": t}},
        },
        upsert=True,
    )
    return (await get_plans(db))[pid]


def terms_of(plan: dict[str, Any]) -> dict[str, Any]:
    """What a purchase copies from a plan: the frozen terms."""
    return {
        "plan_id": plan["_id"],
        "plan_name": plan["name"],
        "plan_version": int(plan.get("version") or 1),
        "price": plan.get("price"),
        "period_days": plan.get("period_days"),
        "period_months": plan.get("period_months"),
        "limits": dict(plan["limits"]),
        "features": dict(plan["features"]),
    }


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def period_end(start: date, period_days: int | None, period_months: int | None) -> date:
    """The last day (inclusive) of a period that starts on `start`: 60 days from 1 Jan ends on 1 Mar."""
    if period_months:
        return add_months(start, period_months) - timedelta(days=1)
    return start + timedelta(days=(period_days or 30) - 1)


def describe_period(p: dict[str, Any]) -> str:
    if p.get("period_months"):
        n = p["period_months"]
        return f"{n} months" if n != 1 else "1 month"
    if p.get("period_days"):
        return f"{p['period_days']} days"
    return ""
