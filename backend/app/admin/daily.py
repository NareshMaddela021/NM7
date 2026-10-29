"""Admin daily summary. Every day at 8:00 IST the automation pass emails the site's Owner admins yesterday's numbers:
new users, resumes, paid orders and revenue, codes used, new organizations and server errors. Admin > Dashboard has a
"Today" card with the same numbers so far today and a "Share to WhatsApp" button (a wa.me link with the text, sent
from the admin's own phone: automatic WhatsApp sending needs a paid API). Admin > Settings turns the email on or off.

  GET /api/admin/today          today's numbers so far and the message text
"""

import logging
from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter
from pymongo.asynchronous.database import AsyncDatabase

from app.admin.deps import AdminAuth
from app.core.db import (
    COUPON_USES,
    DB,
    OPS_DAILY,
    ORDERS,
    ORGANIZATIONS,
    PAYMENTS,
    REFUNDS,
    RESUMES,
    USERS,
    get_database,
)
from app.core.email import Email, Mailer, send_safely
from app.core.time import IST, now
from app.site import get_site, save_site

log = logging.getLogger("nm7.daily")
router = APIRouter(prefix="/api/admin/today", tags=["admin"])

SEND_AT = time(8, 0)


def ist_day(t: datetime | None = None) -> date:
    return (t or now()).astimezone(IST).date()


def _span(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, IST)
    return start, start + timedelta(days=1)


async def count_error() -> None:
    """Called for every request that failed with an unexpected error (app/core/observability.py)."""
    try:
        await get_database()[OPS_DAILY].update_one(
            {"_id": f"errors:{ist_day().isoformat()}"}, {"$inc": {"n": 1}}, upsert=True
        )
    except Exception:  # noqa: BLE001 — counting must never make an error worse
        log.warning("could not count a server error")


async def numbers(db: AsyncDatabase, day: date, until: datetime | None = None) -> dict[str, Any]:
    """One IST day's numbers (until `until` for today so far). Demo accounts and organizations aren't counted."""
    start, end = _span(day)
    end = min(end, until) if until else end
    w = {"$gte": start, "$lt": end}
    paid = await (
        await db[PAYMENTS].aggregate(
            [{"$match": {"status": {"$in": ["captured", "refunded"]}, "captured_at": w}},
             {"$group": {"_id": None, "n": {"$sum": "$amount"}}}]
        )
    ).to_list()  # fmt: skip
    refunded = await (
        await db[REFUNDS].aggregate(
            [{"$match": {"status": "processed", "processed_at": w}},
             {"$group": {"_id": None, "n": {"$sum": "$amount"}}}]
        )
    ).to_list()  # fmt: skip
    errors = await db[OPS_DAILY].find_one({"_id": f"errors:{day.isoformat()}"}) or {}
    return {
        "day": day.isoformat(),
        "newUsers": await db[USERS].count_documents({"role": "customer", "created_at": w, "demo": {"$ne": True}}),
        "resumes": await db[RESUMES].count_documents({"created_at": w}),
        "ordersPaid": await db[ORDERS].count_documents({"paid_at": w}),
        "revenue": (paid[0]["n"] if paid else 0) - (refunded[0]["n"] if refunded else 0),  # paise
        "codesUsed": await db[COUPON_USES].count_documents({"at": w, "status": {"$ne": "reserved"}}),
        "orgSignups": await db[ORGANIZATIONS].count_documents({"created_at": w, "demo": {"$ne": True}}),
        "errors": errors.get("n", 0),
    }


def rupees(paise: int) -> str:
    r = paise / 100
    return f"Rs {r:,.0f}" if r == int(r) else f"Rs {r:,.2f}"


def message(n: dict[str, Any], title: str) -> str:
    return "\n".join(
        [
            title,
            f"New users: {n['newUsers']}",
            f"Resumes started: {n['resumes']}",
            f"Paid orders: {n['ordersPaid']} · Revenue: {rupees(n['revenue'])}",
            f"Codes used: {n['codesUsed']}",
            f"New organizations: {n['orgSignups']}",
            f"Server errors: {n['errors']}",
        ]
    )


async def _owners(db: AsyncDatabase) -> list[tuple[str, str]]:
    q = {"role": "admin", "admin_role": "owner", "disabled_at": None}
    return [(u["email"], u.get("name", "")) async for u in db[USERS].find(q, {"email": 1, "name": 1})]


async def send_daily(db: AsyncDatabase, mailer: Mailer, t: datetime | None = None) -> int:
    """Run by every automation pass: once a day, from 8:00 IST, email yesterday's summary to the Owner admins."""
    t = t or now()
    site = await get_site(db)
    if not site["daily_summary"]["on"]:
        return 0
    local = t.astimezone(IST)
    today = local.date()
    if local.time() < SEND_AT or site.get("daily_summary_sent") == today.isoformat():
        return 0
    await save_site(db, {"daily_summary_sent": today.isoformat()})  # first: never twice, even if a send fails
    y = today - timedelta(days=1)
    n = await numbers(db, y)
    text = message(n, f"Nm7 · {y:%a %d %b %Y}")
    sent = 0
    for email, name in await _owners(db):
        html = "<p>" + text.replace("\n", "<br>") + '</p><p style="color:#888">Admin › Settings turns this off.</p>'
        sent += await send_safely(mailer, Email(email, name, f"Nm7 yesterday: {n['newUsers']} new users, "
                                                f"{rupees(n['revenue'])}", text, html))  # fmt: skip
    return sent


@router.get("")
async def today(db: DB, _: AdminAuth("dashboard")) -> dict[str, Any]:
    t = now()
    n = await numbers(db, ist_day(t), until=t)
    return {**n, "text": message(n, f"Nm7 today so far · {t.astimezone(IST):%d %b, %I:%M %p}")}
