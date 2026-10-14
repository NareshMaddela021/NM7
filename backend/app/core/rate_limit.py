"""Simple rate limits stored in MongoDB, so they hold across several API instances.
Old events are removed by a TTL index after a day."""

from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import RATE_EVENTS
from app.core.errors import ApiError
from app.core.time import now

TOO_MANY = "Too many tries. Please wait a little and try again."


async def count(db: AsyncDatabase, key: str, window: timedelta) -> int:
    return await db[RATE_EVENTS].count_documents({"key": key, "at": {"$gt": now() - window}})


async def record(db: AsyncDatabase, *keys: str) -> None:
    if keys:
        at = now()
        await db[RATE_EVENTS].insert_many([{"key": k, "at": at} for k in keys])


async def clear(db: AsyncDatabase, key: str) -> None:
    await db[RATE_EVENTS].delete_many({"key": key})


async def check(db: AsyncDatabase, key: str, rules: list[tuple[int, timedelta]], message: str = TOO_MANY) -> None:
    """Raises 429 if `key` already reached any (max, window) rule. Does not record anything."""
    for max_, window in rules:
        if await count(db, key, window) >= max_:
            raise ApiError(429, "rate_limited", message, headers={"Retry-After": str(int(window.total_seconds()))})
