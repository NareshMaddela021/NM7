"""Automation rules (switched on/off and tuned in the admin console). `run_rules` does one pass; the API runs a
pass every few minutes while it is awake, and admins can run one by hand."""

import asyncio
import logging
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings
from app.core.db import ORDER_WORK, ORDERS
from app.core.email import Email, Mailer, get_mailer, send_safely
from app.core.time import now
from app.site import get_site, save_site

log = logging.getLogger("nm7.automation")
EVERY = timedelta(minutes=10)
OPEN = ("offer", "in_progress", "revision")


async def _expire_unpaid(db: AsyncDatabase, hours: int, _mailer: Mailer) -> int:
    r = await db[ORDERS].update_many(
        {"status": "pending_payment", "created_at": {"$lt": now() - timedelta(hours=hours)}},
        {"$set": {"status": "expired", "updated_at": now()}},
    )
    return r.modified_count


async def _offer_timeout(db: AsyncDatabase, _minutes: int, _mailer: Mailer) -> int:
    """Offers not accepted in time go back to the queue (the expiry is set from this rule when the offer is made)."""
    r = await db[ORDER_WORK].update_many(
        {"expert_id": {"$ne": None}, "accepted_at": None, "offer_expires_at": {"$lt": now()}},
        {"$set": {"expert_id": None, "offer_expires_at": None, "updated_at": now()}},
    )
    return r.modified_count


async def _deadline_alert(db: AsyncDatabase, hours: int, mailer: Mailer) -> int:
    soon = now() + timedelta(hours=hours)
    n = 0
    async for o in db[ORDERS].find({"status": {"$in": OPEN}, "deadline_at": {"$lt": soon}, "delivered_at": None}):
        work = await db[ORDER_WORK].find_one({"_id": o["_id"]}) or {}
        sent = [v for v in (work.get("data") or {}).get("versions", []) if isinstance(v, dict) and v.get("sent")]
        if sent or work.get("alerted_at"):
            continue
        late = o["deadline_at"] < now()
        text = (
            f"Order {o['_id']} has no draft yet and its deadline is "
            f"{'past' if late else 'in under ' + str(hours) + ' hours'} ({o['deadline_at']:%d %b %H:%M} UTC).\n"
            f"Open it: {get_settings().site_url}/admin/orders?q={o['_id']}"
        )
        inbox = get_settings().support_inbox
        await send_safely(mailer, Email(inbox, "Nm7 ops", f"[Deadline] {o['_id']} has no draft yet", text, text))
        await db[ORDER_WORK].update_one(
            {"_id": o["_id"]}, {"$set": {"alerted_at": now()}, "$setOnInsert": {"data": {}}}, upsert=True
        )
        n += 1
    return n


RUNNERS = {"expire_unpaid": _expire_unpaid, "offer_timeout": _offer_timeout, "deadline_alert": _deadline_alert}


async def run_rules(db: AsyncDatabase, mailer: Mailer | None = None) -> dict[str, int]:
    """One pass over the rules that are on. Returns how many items each rule acted on."""
    site = await get_site(db)
    done: dict[str, int] = {}
    runs = dict(site["rule_runs"])
    for key, rule in site["rules"].items():
        if not rule["on"] or key not in RUNNERS:
            continue
        done[key] = await RUNNERS[key](db, int(rule["value"]), mailer or get_mailer())
        prev = runs.get(key, {})
        runs[key] = {"last_run": now(), "acted": prev.get("acted", 0) + done[key]}
    await save_site(db, {"rule_runs": runs})
    return done


async def loop(get_db) -> None:
    while True:
        try:
            await run_rules(get_db())
        except Exception:
            log.exception("Automation pass failed")
        await asyncio.sleep(EVERY.total_seconds())
