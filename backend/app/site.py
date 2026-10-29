"""Site settings the owner changes in the admin console: plan and add-on prices, which plans are on sale, the
delivery promise and the automation rules. One document (`settings`, _id "site"); missing values use the
defaults in orders/pricing.py, so a fresh database works without any setup."""

from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import SETTINGS, Session
from app.orders.pricing import ADDONS, DELIVERY_HOURS, PLANS

SITE = "site"

# Automation rules the server actually runs (app/automation.py). value = hours or minutes, see `unit`.
RULES: dict[str, dict[str, Any]] = {
    "expire_unpaid": {"on": True, "value": 24, "unit": "hours", "label": "Unpaid checkouts expire after"},
    "offer_timeout": {
        "on": True,
        "value": 30,
        "unit": "minutes",
        "label": "An expert who hasn’t accepted an offered order loses it after",
    },
    "deadline_alert": {
        "on": True,
        "value": 6,
        "unit": "hours",
        "label": "Email the support inbox when an order has no draft this close to its deadline",
    },
    "org_plan_reminders": {
        "on": True,
        "value": 1,
        "unit": "pass",
        "label": "Email organization Owners before their plan ends (days set in Billing settings), then at the "
        "grace period and when Free limits apply",
    },
}


def defaults() -> dict[str, Any]:
    return {
        "plans": {k: {"name": n, "amount": a, "active": True} for k, (n, a) in PLANS.items()},
        "addons": {k: {"name": n, "amount": a, "active": True} for k, (n, a) in ADDONS.items()},
        "delivery_hours": DELIVERY_HOURS,
        "rules": {k: {"on": v["on"], "value": v["value"]} for k, v in RULES.items()},
        "referral": {"on": True, "needed": 3},  # referral rewards (app/me/rewards.py)
        "daily_summary": {"on": True},  # 8:00 IST email to the Owner admins (app/admin/daily.py)
    }


async def get_site(db: AsyncDatabase, session: Session = None) -> dict[str, Any]:
    stored = await db[SETTINGS].find_one({"_id": SITE}, session=session) or {}
    out = defaults()
    for group in ("plans", "addons", "rules"):
        for k, v in (stored.get(group) or {}).items():
            if k in out[group]:
                out[group][k] = {**out[group][k], **v}
    if stored.get("delivery_hours"):
        out["delivery_hours"] = stored["delivery_hours"]
    out["referral"] = {**out["referral"], **(stored.get("referral") or {})}
    out["daily_summary"] = {**out["daily_summary"], **(stored.get("daily_summary") or {})}
    out["daily_summary_sent"] = stored.get("daily_summary_sent")
    out["rule_runs"] = stored.get("rule_runs", {})
    return out


async def save_site(db: AsyncDatabase, changes: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": SITE}, {"$set": changes}, upsert=True)
