"""One-time repairs after the 17 Nov collector outage, run once each by the automation pass (a flag in settings).

1. send_back_stuck: collector jobs waiting only because the summary wasn't written ("summary_failed", plus maybe
   "city not stated") are sent back to the collector, so its next run sends them again with the page text and nm7.si
   writes the summary then. The jobs of the 17 Nov batch (every summary failed with an API error, none was written)
   get the honest reason "ai_error". Nothing is approved: a job goes live only with a proper summary.
2. tidy_cities: every job's cities in nm7.si's one spelling ("Bangalore" -> "Bengaluru", "PUNE" -> "Pune"); a remote
   job whose only place is "India" shows as Remote (India). Small batches, so it never holds many jobs in memory.

Both are additive and safe: no job is deleted, no live job is hidden.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from pymongo import UpdateOne

from app.audit import audit
from app.core.db import JOBS, SETTINGS
from app.core.time import now
from app.jobsearch.parse import canonical_cities

log = logging.getLogger("nm7.jobs")
FLAG = "repair_runs"
# the 17 Nov morning batch: posted between 00:10 and 00:14 UTC; every summary in it failed with an API error
OUTAGE = (datetime(2026, 11, 17, 0, 0, tzinfo=UTC), datetime(2026, 11, 17, 1, 0, tzinfo=UTC))
SUMMARY_ONLY = {"summary_failed", "ai_error", "city_not_stated"}
BATCH = 300


async def _done(db, key: str) -> bool:
    return bool((await db[SETTINGS].find_one({"_id": FLAG}) or {}).get(key))


async def _mark(db, key: str, data: dict[str, Any]) -> None:
    await db[SETTINGS].update_one({"_id": FLAG}, {"$set": {key: {"at": now(), **data}}}, upsert=True)


def _stuck_query() -> dict[str, Any]:
    return {
        "source": "collector",
        "status": "review",
        "review.reasons": {"$in": ["summary_failed", "ai_error"], "$not": {"$elemMatch": {"$nin": list(SUMMARY_ONLY)}}},
        "collector.removed": {"$ne": True},
    }


async def send_back_stuck(db) -> dict[str, int]:
    q = _stuck_query()
    outage = await db[JOBS].update_many(
        {"$and": [q, {"review.reasons": "summary_failed"}], "updated_at": {"$gte": OUTAGE[0], "$lt": OUTAGE[1]}},
        {"$set": {"review.reasons.$[r]": "ai_error"}},
        array_filters=[{"r": "summary_failed"}],
    )
    sent = await db[JOBS].update_many(
        {**q, "collector.resend": {"$ne": True}}, {"$set": {"collector.resend": True, "updated_at": now()}}
    )
    out = {"relabelled_ai_error": outage.modified_count, "sent_back": sent.modified_count}
    await audit(db, None, "job.collector_resend_repair", target=None, data=out, ip=None)
    log.info("collector repair: %s", out)
    return out


async def tidy_cities(db) -> dict[str, int]:
    changed = remote = 0
    last = ""
    while True:
        rows = [r async for r in db[JOBS].find(
            {"_id": {"$gt": last}, "locations.0": {"$exists": True}}, {"locations": 1, "work_type": 1, "remote": 1}
        ).sort("_id", 1).limit(BATCH)]  # fmt: skip
        if not rows:
            break
        last = rows[-1]["_id"]
        ops = []
        for r in rows:
            old = r.get("locations") or []
            new = canonical_cities(old)
            sets: dict[str, Any] = {}
            if [x.lower() for x in new] == ["india"] and (r.get("work_type") == "remote" or r.get("remote")):
                new = []  # "India" alone on a remote job: Remote (India)
                remote += 1
            if new != old:
                sets["locations"] = new
            if sets:
                ops.append(UpdateOne({"_id": r["_id"]}, {"$set": sets}))
        if ops:
            changed += (await db[JOBS].bulk_write(ops, ordered=False)).modified_count
    out = {"jobs_changed": changed, "remote_india": remote}
    log.info("city tidy: %s", out)
    return out


async def run_once(db) -> dict[str, Any]:
    """Each repair once (the automation pass calls this every time; it does nothing after the first)."""
    done: dict[str, Any] = {}
    for key, fn in (("send_back_stuck_2026_11_17", send_back_stuck), ("tidy_cities_v1", tidy_cities)):
        if await _done(db, key):
            continue
        try:
            res = await fn(db)
        except Exception:  # noqa: BLE001  (a repair must never stop the pass; it tries again next time)
            log.exception("repair %s failed", key)
            continue
        await _mark(db, key, res)
        done[key] = res
    return done
