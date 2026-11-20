# ruff: noqa: E501  (dense registry and response lines)
"""The retention schedule (DPDP): every kind of personal data Vetting Trust keeps, how long it is kept, and the
automatic job that deletes it once that time is over.

Each data type is registered here with a default number of days and safe bounds; the owner can change the days in
Admin → Skill checks → Vetting Trust → Retention, but only within the bounds (a type backed by a Mongo TTL index can
only be made shorter than the index). Later Trust items register their own types (or use the collections below) with
`register(DataType(...))` and add `@on_withdraw("purpose")` hooks for anything that is not a plain collection row.

The job (`run`, once a day from the automation pass) takes the "heavy" lease (heavy_or_skip), works in batches and
stops at a cap per type, so a large backlog is cleared over several days without hurting the 512 MB server. It only
deletes rows whose time is over and records how many it deleted per type (shown on the Admin page).

The existing vetting clean-up (raw IPs in the audit log and device hashes after 30 days, app/hire/vetting/trust.py) is
folded in: those two types are defined here and run by the vetting daily pass, which still waits until the vetting
engine is public before it rewrites old records.

Withdrawing a consent (consent.py) calls `erase_purpose`: every data type tied to that purpose deletes the person's
rows, then the purpose's hooks run. Erasing an account (app/me/erase.py) and erase-after-inactivity call `erase_user`.
"""

import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.core.db import (
    AUDIT_LOG,
    SKILL_ATTEMPTS,
    TRUST_DOCUMENTS,
    TRUST_RUNS,
    TRUST_SELFIES,
    TRUST_SNAPSHOTS,
    TRUST_VOICE,
    VETTING_INTERVIEWS,
    VETTING_PHOTOS,
)
from app.core.time import now

log = logging.getLogger("nm7.trust.retention")

BATCH = 200  # rows deleted per delete_many
CAP = 2000  # rows per type per run (a backlog is cleared over several days)
EVERY = timedelta(hours=23)

Cleaner = Callable[[Any, datetime, int], Awaitable[int]]  # (db, cutoff, cap) → rows deleted or cleared
Eraser = Callable[[Any, str], Awaitable[int]]  # (db, user id) → rows deleted


@dataclass(frozen=True)
class DataType:
    key: str
    label: str  # plain words, shown to the owner and in the candidate's "How long we keep things"
    days: int  # the default
    min_days: int
    max_days: int
    collection: str | None = None  # rows with `user_field` and `field` (a datetime); None: `clean` does the work
    field: str = "created_at"
    user_field: str = "user_id"
    purpose: str | None = None  # the consent this data needs; withdrawing it deletes the person's rows
    clean: Cleaner | None = None  # instead of deleting rows older than the cutoff
    erase: Eraser | None = None  # instead of deleting the person's rows in `collection`
    runner: str = "trust"  # "vetting": run by the vetting daily pass (app/hire/vetting/trust.py), not by `run`
    note: str = ""  # how it is enforced, for the Admin page


TYPES: dict[str, DataType] = {}
WITHDRAW_HOOKS: dict[str, list[Eraser]] = defaultdict(list)


def register(dt: DataType) -> DataType:
    assert dt.min_days <= dt.days <= dt.max_days, dt.key
    TYPES[dt.key] = dt
    return dt


def on_withdraw(purpose: str) -> Callable[[Eraser], Eraser]:
    """A hook for data a plain collection row can't describe: `@on_withdraw("voice") async def f(db, uid) -> int`."""

    def deco(fn: Eraser) -> Eraser:
        if fn not in WITHDRAW_HOOKS[purpose]:
            WITHDRAW_HOOKS[purpose].append(fn)
        return fn

    return deco


def days_for(site: dict[str, Any], key: str) -> int:
    dt = TYPES[key]
    try:
        v = int((site.get("trust") or {}).get("retention", {}).get(key, dt.days))
    except (TypeError, ValueError):
        v = dt.days
    return max(dt.min_days, min(dt.max_days, v))


# --- cleaners for the vetting types (moved here from app/hire/vetting/trust.py) ------------------------------------


async def _audit_ips(db, cutoff: datetime, cap: int) -> int:
    ids = [
        a["_id"]
        async for a in db[AUDIT_LOG].find({"ip": {"$nin": [None, ""]}, "at": {"$lt": cutoff}}, {"_id": 1}).limit(cap)
    ]
    n = 0
    for i in range(0, len(ids), BATCH):
        n += (
            await db[AUDIT_LOG].update_many({"_id": {"$in": ids[i : i + BATCH]}}, {"$set": {"ip": None}})
        ).modified_count
    return n


async def _device_hashes(db, cutoff: datetime, cap: int) -> int:
    q = {"fp": {"$exists": True}, "started_at": {"$lt": cutoff}}
    ids = [a["_id"] async for a in db[SKILL_ATTEMPTS].find(q, {"_id": 1}).limit(cap)]
    n = 0
    for i in range(0, len(ids), BATCH):
        n += (
            await db[SKILL_ATTEMPTS].update_many({"_id": {"$in": ids[i : i + BATCH]}}, {"$unset": {"fp": ""}})
        ).modified_count
    return n


async def _no_user_rows(_db, _uid: str) -> int:
    return 0


# --- the schedule ---------------------------------------------------------------------------------------------------

register(DataType("selfie_face", "Selfies and face-match results", 30, 1, 90, TRUST_SELFIES, purpose="selfie_face",
                  note="Deleted by the daily job"))  # fmt: skip
register(
    DataType("voice", "Voice recordings", 90, 7, 180, TRUST_VOICE, purpose="voice", note="Deleted by the daily job")
)
register(DataType("documents", "Verification documents (DigiLocker / KYC; never Aadhaar)", 180, 30, 365,
                  TRUST_DOCUMENTS, purpose="documents", note="Deleted by the daily job, or sooner when the verification ends"))  # fmt: skip
register(DataType("interview_transcripts", "AI interview transcripts", 180, 30, 180, VETTING_INTERVIEWS,
                  field="started_at", purpose="ai_interview", note="Daily job; a database expiry index also removes them at 180 days"))  # fmt: skip
register(DataType("webcam_snapshots", "Webcam snapshots during a test", 30, 1, 60, TRUST_SNAPSHOTS,
                  purpose="webcam_snapshots", note="Deleted by the daily job"))  # fmt: skip
register(DataType("work_photos", "Photos of past work (practical tasks)", 30, 1, 30, VETTING_PHOTOS,
                  note="Daily job; a database expiry index also removes them at 30 days"))  # fmt: skip
register(DataType("audit_ips", "Raw IP addresses in the activity log", 30, 7, 30, clean=_audit_ips, erase=_no_user_rows,
                  runner="vetting", note="Cleared (set to empty) by the vetting daily pass once Skill checks is live"))  # fmt: skip
register(DataType("device_hashes", "Device fingerprints on skill checks", 30, 7, 30, clean=_device_hashes,
                  erase=_no_user_rows, runner="vetting", note="Cleared by the vetting daily pass once Skill checks is live"))  # fmt: skip


# --- the job --------------------------------------------------------------------------------------------------------


async def clean_type(db, dt: DataType, days: int, t: datetime, cap: int = CAP) -> int:
    cutoff = t - timedelta(days=days)
    if dt.clean:
        return await dt.clean(db, cutoff, cap)
    if not dt.collection:
        return 0
    ids = [d["_id"] async for d in db[dt.collection].find({dt.field: {"$lt": cutoff}}, {"_id": 1}).limit(cap)]
    n = 0
    for i in range(0, len(ids), BATCH):
        n += (
            await db[dt.collection].delete_many({"_id": {"$in": ids[i : i + BATCH]}, dt.field: {"$lt": cutoff}})
        ).deleted_count
    return n


async def _record(db, counts: dict[str, int], t: datetime) -> None:
    sets: dict[str, Any] = {"at": t}
    inc: dict[str, int] = {}
    for k, n in counts.items():
        sets[f"types.{k}.at"] = t
        sets[f"types.{k}.deleted"] = n
        inc[f"types.{k}.total"] = n
    await db[TRUST_RUNS].update_one({"_id": "retention"}, {"$set": sets, "$inc": inc}, upsert=True)


async def run_types(db, runner: str, t: datetime | None = None) -> dict[str, int]:
    """Every type of this runner, once (no lease of its own: the caller holds heavy_or_skip or heavy_or_busy)."""
    from app.site import get_site

    t = t or now()
    site = await get_site(db)
    counts = {k: await clean_type(db, dt, days_for(site, k), t) for k, dt in TYPES.items() if dt.runner == runner}
    await _record(db, counts, t)
    if any(counts.values()):
        log.info("retention (%s): %s", runner, counts)
    return counts


async def run(db, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """The automation pass, once a day (force: Admin's "Run now", which holds heavy_or_busy itself)."""
    from app.core.heavy import heavy_or_skip

    t = t or now()
    if not force:
        last = await db[TRUST_RUNS].find_one({"_id": "retention"}, {"ran_at": 1}) or {}
        if last.get("ran_at") and last["ran_at"] > t - EVERY:
            return {}
        async with heavy_or_skip(db) as ok:
            if not ok:
                return {}
            out = await run_types(db, "trust", t)
    else:
        out = await run_types(db, "trust", t)
    await db[TRUST_RUNS].update_one({"_id": "retention"}, {"$set": {"ran_at": t}}, upsert=True)
    return out


async def schedule(db) -> list[dict[str, Any]]:
    from app.me.service import ms
    from app.site import get_site

    site = await get_site(db)
    runs = (await db[TRUST_RUNS].find_one({"_id": "retention"}) or {}).get("types") or {}
    return [
        {"key": k, "label": dt.label, "days": days_for(site, k), "defaultDays": dt.days, "minDays": dt.min_days,
         "maxDays": dt.max_days, "purpose": dt.purpose, "note": dt.note, "runner": dt.runner,
         "lastAt": ms((runs.get(k) or {}).get("at")), "lastDeleted": (runs.get(k) or {}).get("deleted"),
         "totalDeleted": (runs.get(k) or {}).get("total", 0)}
        for k, dt in TYPES.items()
    ]  # fmt: skip


# --- per person: withdrawal, inactivity, account erase ----------------------------------------------------------------


async def _erase_rows(db, dt: DataType, uid: str) -> int:
    if dt.erase:
        return await dt.erase(db, uid)
    if not dt.collection:
        return 0
    return (await db[dt.collection].delete_many({dt.user_field: uid})).deleted_count


async def erase_purpose(db, uid: str, purpose: str) -> dict[str, int]:
    """A withdrawn consent: the person's data of every type tied to it, then the purpose's hooks."""
    out = {k: await _erase_rows(db, dt, uid) for k, dt in TYPES.items() if dt.purpose == purpose}
    for i, hook in enumerate(WITHDRAW_HOOKS.get(purpose, [])):
        out[f"hook_{getattr(hook, '__name__', i)}"] = int(await hook(db, uid) or 0)
    return out


async def erase_user(db, uid: str) -> dict[str, int]:
    """Every Trust data type of this person (erase-after-inactivity and account deletion)."""
    out = {k: await _erase_rows(db, dt, uid) for k, dt in TYPES.items()}
    for purpose, hooks in WITHDRAW_HOOKS.items():
        for hook in hooks:
            out[f"hook_{purpose}_{getattr(hook, '__name__', '')}"] = int(await hook(db, uid) or 0)
    return out
