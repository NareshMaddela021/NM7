"""Automation rules (switched on/off and tuned in the admin console). `run_rules` does one pass; the API runs a
pass every few minutes while it is awake, and admins can run one by hand."""

import asyncio
import logging
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.admin.daily import send_daily
from app.billing.subscription import run_reminders
from app.core.config import get_settings
from app.core.db import LOCKS, ORDER_WORK, ORDERS
from app.core.email import Email, Mailer, get_mailer, send_safely
from app.core.time import now
from app.health.service import daily_batch as health_batch
from app.me.delete import erase_due
from app.me.student_pass import send_reminders as pass_reminders
from app.orgs.interviews import send_reminders as interview_reminders
from app.site import get_site, save_site
from app.wapay.service import cancel_stale

log = logging.getLogger("nm7.automation")
EVERY = timedelta(minutes=10)
LEASE = timedelta(minutes=8)  # one pass at a time across instances, admin "Run now" included
OPEN = ("offer", "in_progress", "revision")


async def take_lease(db: AsyncDatabase, name: str = "automation", for_: timedelta = LEASE) -> bool:
    """True when this caller may run a pass now: the lease was free (or expired) and is now held until `for_`
    passes. Two instances (or an instance and an admin click) can never both get it."""
    t = now()
    try:
        await db[LOCKS].update_one(
            {"_id": name, "$or": [{"until": {"$lt": t}}, {"until": None}]},
            {"$set": {"until": t + for_, "taken_at": t}},
            upsert=True,
        )
    except DuplicateKeyError:  # the document exists with a live lease: the filter did not match, the upsert tried
        return False
    return True


async def release_lease(db: AsyncDatabase, name: str = "automation") -> None:
    await db[LOCKS].update_one({"_id": name}, {"$set": {"until": None}})


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
        # claim the alert before sending: a second pass running at the same time finds it taken and sends nothing
        try:
            claimed = await db[ORDER_WORK].update_one(
                {"_id": o["_id"], "alerted_at": None},
                {"$set": {"alerted_at": now()}, "$setOnInsert": {"data": {}}},
                upsert=True,
            )
        except DuplicateKeyError:
            continue
        if not claimed.modified_count and not claimed.upserted_id:
            continue
        late = o["deadline_at"] < now()
        text = (
            f"Order {o['_id']} has no draft yet and its deadline is "
            f"{'past' if late else 'in under ' + str(hours) + ' hours'} ({o['deadline_at']:%d %b %H:%M} UTC).\n"
            f"Open it: {get_settings().site_url}/admin/orders?q={o['_id']}"
        )
        inbox = get_settings().support_inbox
        await send_safely(mailer, Email(inbox, "Nm7 ops", f"[Deadline] {o['_id']} has no draft yet", text, text))
        n += 1
    return n


RUNNERS = {
    "expire_unpaid": _expire_unpaid,
    "offer_timeout": _offer_timeout,
    "deadline_alert": _deadline_alert,
    "org_plan_reminders": run_reminders,
}


async def run_rules(db: AsyncDatabase, mailer: Mailer | None = None) -> dict[str, int]:
    """One pass over the rules that are on. Returns how many items each rule acted on ({} when another pass is
    running at the moment: a second instance, or the scheduler and an admin click at once)."""
    if not await take_lease(db):
        log.info("automation: another pass is running, skipping this one")
        return {}
    try:
        site = await get_site(db)
        done: dict[str, int] = {}
        runs = dict(site["rule_runs"])
        for key, rule in site["rules"].items():
            if not rule["on"] or key not in RUNNERS:
                continue
            done[key] = await RUNNERS[key](db, int(rule["value"]), mailer or get_mailer())
            prev = runs.get(key, {})
            runs[key] = {"last_run": now(), "acted": prev.get("acted", 0) + done[key]}
        done["whatsapp_cancel"] = await cancel_stale(db)  # hours from Admin → Settings → Payments
        done["health_emails"] = await health_batch(db, mailer or get_mailer())  # once a day; each person ≤ 1 / 14 days
        done["accounts_erased"] = await erase_due(db)  # self-serve deletions whose 7-day undo window is over
        done["daily_summary"] = await send_daily(db, mailer or get_mailer())  # 8:00 IST, once a day
        done["pass_reminders"] = await pass_reminders(db, mailer or get_mailer())  # 7 days before a pass ends
        done["interview_reminders"] = await interview_reminders(db, mailer or get_mailer())  # the day before, 9:00 IST
        await save_site(db, {"rule_runs": runs})
        return done
    finally:
        await release_lease(db)


async def loop(get_db) -> None:
    while True:
        try:
            await run_rules(get_db())
        except Exception:
            log.exception("Automation pass failed")
        await asyncio.sleep(EVERY.total_seconds())
