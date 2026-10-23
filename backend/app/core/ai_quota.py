"""Daily limits for every Claude API call (Snap photos, the summary writer), shared and race-safe.

Each AI attempt is counted BEFORE the call, failed ones included: the counters are incremented atomically and an
attempt that would go over a limit is rolled back and refused. Requests sent at the same time therefore can't get
past a limit (each one sees the count after its own increment).

Limits (per India calendar day):
- per person: Snap photos 5, summary writer 10 (each quick fix counts 1), LinkedIn headlines 10;
- per kiosk link (all candidates at one event screen together): Snap photos 300, summary writer 600;
- the whole site: 2,000 AI calls. When it is reached, AI features say so quietly and the summary writer uses its
  smart templates; the admin dashboard shows "AI daily cap reached".

Also counted for the admin dashboard: calls, fallbacks (the second model did the work) with the reason the first
model's answer was unusable (`unusable:too_long`, `unusable:empty`, ...), failures, refusals by a limit, and the
summary options dropped by the server's checks.
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import AI_USAGE
from app.core.errors import ApiError
from app.core.time import IST, now

Feature = Literal["photos", "summary", "linkedin"]
FEATURES: tuple[Feature, ...] = ("photos", "summary", "linkedin")
PER_PERSON: dict[str, int] = {"photos": 5, "summary": 10, "linkedin": 10}
PER_KIOSK: dict[str, int] = {"photos": 300, "summary": 600, "linkedin": 600}
DAILY_CAP = 2000  # every AI call on the site, all features together
OUTCOMES = ("fallback", "failed", "limited", "capped", "dropped")  # always present per feature in usage()
UNUSABLE = "unusable:"  # `note(..., "unusable:<reason>")`: why the configured model's answer was unusable

PERSON_MESSAGE = {
    "photos": "You can read photos 5 times a day. Please try again tomorrow, or type your details in the builder.",
    "summary": "You can write with AI 10 times a day. Here are quick suggestions instead.",
    "linkedin": "You can use AI for LinkedIn 10 times a day. Here are quick suggestions instead.",
}
KIOSK_MESSAGE = "This kiosk has used today's AI limit. Please type your details instead."


class CapReached(Exception):
    """The site-wide daily AI cap is used up."""


def today(at: datetime | None = None) -> str:
    return (at or now()).astimezone(IST).date().isoformat()


def _key(day: str, *parts: str) -> str:
    return "|".join((day, *parts))


async def _inc(db: AsyncDatabase, key: str, day: str, by: int = 1, keep_days: int = 2) -> int:
    doc = await db[AI_USAGE].find_one_and_update(
        {"_id": key},
        {"$inc": {"n": by}, "$setOnInsert": {"day": day, "expires_at": now() + timedelta(days=keep_days)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc["n"])


async def note(db: AsyncDatabase, feature: Feature, outcome: str, day: str | None = None, by: int = 1) -> None:
    """Counts an outcome for the admin dashboard: any short string (fallback / failed / limited / capped / dropped /
    unusable:<reason>); `by` counts several at once (dropped options)."""
    d = day or today()
    await _inc(db, _key(d, "stat", feature, outcome), d, by=by, keep_days=31)


async def take(db: AsyncDatabase, feature: Feature, user_id: str, kiosk_id: str | None = None) -> None:
    """Counts one AI attempt before it is made. Raises ApiError 429 (this person or this kiosk link is at its
    limit) or CapReached (the site is); nothing stays counted when it raises."""
    d = today()
    taken: list[str] = []

    async def reserve(key: str, limit: int, keep_days: int = 2) -> bool:
        # noted before the increment is awaited: if the request fails after the server applied it, undo() still
        # takes it back (an increment that never reached the server is taken back too - one spare attempt, never
        # one lost)
        taken.append(key)
        return await _inc(db, key, d, keep_days=keep_days) <= limit

    async def undo() -> None:
        for key in taken:
            await _inc(db, key, d, by=-1)

    refused: Exception
    try:
        if not await reserve(_key(d, "person", feature, str(user_id)), PER_PERSON[feature]):
            outcome = "limited"
            refused = ApiError(429, "rate_limited", PERSON_MESSAGE[feature], headers={"Retry-After": "86400"})
        elif kiosk_id and not await reserve(_key(d, "kiosk", feature, str(kiosk_id)), PER_KIOSK[feature]):
            outcome = "limited"
            refused = ApiError(429, "kiosk_limited", KIOSK_MESSAGE, headers={"Retry-After": "86400"})
        elif not await reserve(_key(d, "all"), DAILY_CAP, keep_days=31):
            outcome = "capped"
            refused = CapReached()
        else:
            await _inc(db, _key(d, "stat", feature, "calls"), d, keep_days=31)
            return
    except Exception:  # a database error part-way through: nothing stays counted
        await undo()
        raise
    await undo()
    await note(db, feature, outcome, d)
    raise refused


async def cap_reached(db: AsyncDatabase) -> bool:
    doc = await db[AI_USAGE].find_one({"_id": _key(today(), "all")}, {"n": 1})
    return bool(doc) and int(doc["n"]) >= DAILY_CAP


def _per_feature(rows: dict[str, int], day: str, feature: str) -> dict[str, Any]:
    """{calls, fallback, failed, limited, capped, dropped, unusable: {reason: n}} - every outcome noted that day
    (the known ones are always present, at 0 when nothing happened)."""
    prefix = _key(day, "stat", feature, "")
    out: dict[str, Any] = dict.fromkeys(("calls", *OUTCOMES), 0)
    unusable: dict[str, int] = {}
    for key, n in rows.items():
        if not key.startswith(prefix):
            continue
        outcome = key[len(prefix) :]
        if outcome.startswith(UNUSABLE):
            unusable[outcome[len(UNUSABLE) :]] = n
        else:
            out[outcome] = n
    out["unusable"] = dict(sorted(unusable.items()))
    return out


async def usage(db: AsyncDatabase, days: int = 7) -> dict[str, Any]:
    """Daily counts for the admin dashboard, newest first: per feature the calls and every outcome (`_per_feature`)."""
    dates = [today(now() - timedelta(days=i)) for i in range(days)]
    rows = {d["_id"]: int(d["n"]) async for d in db[AI_USAGE].find({"day": {"$in": dates}}, {"n": 1})}
    out = []
    for d in dates:
        per = {f: _per_feature(rows, d, f) for f in FEATURES}
        total = rows.get(_key(d, "all"), 0)
        out.append({"date": d, "total": total, "capReached": total >= DAILY_CAP, **per})
    return {
        "cap": DAILY_CAP,
        "perPerson": PER_PERSON,
        "perKiosk": PER_KIOSK,
        "capReachedToday": out[0]["capReached"],
        "days": out,
    }
