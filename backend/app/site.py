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


from app.companies.jobcheck import BLOCKED, SCAM  # noqa: E402  (plain lists, no import cycle)

AUTO_APPLY = {
    "on": True,  # the global off switch: off = nothing is applied or sent
    "min_score": 70,  # a new user's minimum match score
    "daily_limit": 5,  # a new user's daily limit
    "max_daily_limit": 10,  # the most a user may choose
    "preview_days": 3,  # days each auto application waits for the user's Approve
    "company_cap": 2,  # applications to one company per 30 days
    "trust_min": 40,  # company trust score below this: skipped
    "borderline": 5,  # points below the user's minimum that go to "Needs your answer"
    "ats_min": 60,  # the resume's ATS score needed to turn Auto Apply on
    "email_daily_cap": 80,  # Auto Apply emails a day across the site (the Resend free plan sends 100)
    "irrelevant_stop": 2,  # a company's "Not relevant" marks before one student's auto applications there stop
}


SIMPLE = {
    "on": True,  # the Easy dashboard (Phase 4) for everyone; off = everyone gets the full dashboard
    "default_te_hi": "simple",  # the dashboard for people who picked Telugu or Hindi and haven't chosen one
    "default_other": "full",  # … and for everyone else
    # job readiness score (E5): points per part, adding up to 100 (app/simple/readiness.py)
    "weights": {"resume": 20, "score": 25, "linkedin": 10, "interview": 15, "skills": 20, "certs": 10},
}


def defaults() -> dict[str, Any]:
    return {
        "plans": {k: {"name": n, "amount": a, "active": True} for k, (n, a) in PLANS.items()},
        "addons": {k: {"name": n, "amount": a, "active": True} for k, (n, a) in ADDONS.items()},
        "delivery_hours": DELIVERY_HOURS,
        "rules": {k: {"on": v["on"], "value": v["value"]} for k, v in RULES.items()},
        "referral": {"on": True, "needed": 3},  # referral rewards (app/me/rewards.py)
        "daily_summary": {"on": True},  # 8:00 IST email to the Owner admins (app/admin/daily.py)
        # company accounts (Phase 2): what each trust level may post, how long Verified lasts, sign-up flags
        "companies": {
            "basic_jobs_per_week": 1,
            "verified_live_jobs": 3,
            "verified_months": 12,
            "ip_burst": 3,
            "no_reply_days": 14,
            "applicant_months": 12,
        },
        # safe job posting (C3): phrases that block a company job / send it to Admin review (one per line in Settings)
        "job_checks": {"blocked": list(BLOCKED), "scam": list(SCAM)},
        # Auto Apply (Phase 3): the off switch and every default (Admin → Auto Apply)
        "auto_apply": dict(AUTO_APPLY),
        # the Easy dashboard (Phase 4): on / off and which dashboard people get before they choose (Admin → Settings)
        "simple": {**SIMPLE, "weights": dict(SIMPLE["weights"])},
        # Telugu and Hindi (switches, voice, emails): hidden until a native speaker has checked them (Admin → Settings)
        "languages": {"te_hi": False},
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
    out["companies"] = {**out["companies"], **(stored.get("companies") or {})}
    out["job_checks"] = {**out["job_checks"], **(stored.get("job_checks") or {})}
    out["auto_apply"] = {**out["auto_apply"], **(stored.get("auto_apply") or {})}
    out["simple"] = {**out["simple"], **(stored.get("simple") or {})}
    out["languages"] = {**out["languages"], **(stored.get("languages") or {})}
    out["daily_summary_sent"] = stored.get("daily_summary_sent")
    out["rule_runs"] = stored.get("rule_runs", {})
    return out


async def save_site(db: AsyncDatabase, changes: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": SITE}, {"$set": changes}, upsert=True)


def langs_on(site: dict[str, Any]) -> bool:
    """Telugu and Hindi shown (Admin → Settings → "Show Telugu and Hindi"); off: everything is in English."""
    return bool(site.get("languages", {}).get("te_hi"))


def lang_for(site: dict[str, Any], lang: str | None) -> str:
    """A saved language, or English when Telugu and Hindi are hidden (or nothing is saved)."""
    return lang if lang in ("te", "hi") and langs_on(site) else "en"
