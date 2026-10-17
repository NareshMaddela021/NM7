"""Daily limits for every Claude API call (Snap photos, the summary writer), shared and race-safe.

Each AI attempt is counted BEFORE the call, failed ones included: the counters are incremented atomically and an
attempt that would go over a limit is rolled back and refused. Requests sent at the same time therefore can't get
past a limit (each one sees the count after its own increment).

Limits (per India calendar day):
- per person: Snap photos 5, summary writer 10 (each quick fix counts 1);
- per kiosk link (all candidates at one event screen together): Snap photos 300, summary writer 600;
- the whole site: 2,000 AI calls. When it is reached, AI features say so quietly and the summary writer uses its
  smart templates; the admin dashboard shows "AI daily cap reached".

Also counted for the admin dashboard: calls, fallbacks (the second model, or the template writer, did the work),
failures, and refusals by a limit.
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import AI_USAGE
from app.core.errors import ApiError
from app.core.time import IST, now

Feature = Literal["photos", "summary"]
FEATURES: tuple[Feature, ...] = ("photos", "summary")
PER_PERSON: dict[str, int] = {"photos": 5, "summary": 10}
PER_KIOSK: dict[str, int] = {"photos": 300, "summary": 600}
DAILY_CAP = 2000  # every AI call on the site, all features together
OUTCOMES = ("fallback", "failed", "limited", "capped")

PERSON_MESSAGE = {
    "photos": "You can read photos 5 times a day. Please try again tomorrow, or type your details in the builder.",
    "summary": "You can write with AI 10 times a day. Here are quick suggestions instead.",
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


async def note(db: AsyncDatabase, feature: Feature, outcome: str, day: str | None = None) -> None:
    """Counts an outcome for the admin dashboard: fallback / failed / limited / capped."""
    d = day or today()
    await _inc(db, _key(d, "stat", feature, outcome), d, keep_days=31)


async def take(db: AsyncDatabase, feature: Feature, user_id: str, kiosk_id: str | None = None) -> None:
    """Counts one AI attempt before it is made. Raises ApiError 429 (this person or this kiosk link is at its
    limit) or CapReached (the site is); nothing stays counted when it raises."""
    d = today()
    taken: list[str] = []

    async def reserve(key: str, limit: int, keep_days: int = 2) -> bool:
        n = await _inc(db, key, d, keep_days=keep_days)
        taken.append(key)
        return n <= limit

    async def undo() -> None:
        for key in taken:
            await _inc(db, key, d, by=-1)

    if not await reserve(_key(d, "person", feature, str(user_id)), PER_PERSON[feature]):
        await undo()
        await note(db, feature, "limited", d)
        raise ApiError(429, "rate_limited", PERSON_MESSAGE[feature], headers={"Retry-After": "86400"})
    if kiosk_id and not await reserve(_key(d, "kiosk", feature, str(kiosk_id)), PER_KIOSK[feature]):
        await undo()
        await note(db, feature, "limited", d)
        raise ApiError(429, "kiosk_limited", KIOSK_MESSAGE, headers={"Retry-After": "86400"})
    if not await reserve(_key(d, "all"), DAILY_CAP, keep_days=31):
        await undo()
        await note(db, feature, "capped", d)
        raise CapReached
    await _inc(db, _key(d, "stat", feature, "calls"), d, keep_days=31)


async def cap_reached(db: AsyncDatabase) -> bool:
    doc = await db[AI_USAGE].find_one({"_id": _key(today(), "all")}, {"n": 1})
    return bool(doc) and int(doc["n"]) >= DAILY_CAP


async def usage(db: AsyncDatabase, days: int = 7) -> dict[str, Any]:
    """Daily counts for the admin dashboard, newest first."""
    dates = [today(now() - timedelta(days=i)) for i in range(days)]
    rows = {d["_id"]: int(d["n"]) async for d in db[AI_USAGE].find({"day": {"$in": dates}}, {"n": 1})}
    out = []
    for d in dates:
        per = {f: {k: rows.get(_key(d, "stat", f, k), 0) for k in ("calls", *OUTCOMES)} for f in FEATURES}
        total = rows.get(_key(d, "all"), 0)
        out.append({"date": d, "total": total, "capReached": total >= DAILY_CAP, **per})
    return {
        "cap": DAILY_CAP,
        "perPerson": PER_PERSON,
        "perKiosk": PER_KIOSK,
        "capReachedToday": out[0]["capReached"],
        "days": out,
    }
