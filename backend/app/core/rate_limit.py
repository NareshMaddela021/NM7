"""Simple rate limits stored in MongoDB, so they hold across several API instances.
Old events are removed by a TTL index after a day.

A key is "<prefix>:<who>", e.g. "login:asha@example.com" or "login-ip:203.0.113.9". Only the prefix is stored as it
is; the identifying part is replaced by a keyed hash (`stored`), so the collection never holds email or IP addresses.
"""

from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import RATE_EVENTS
from app.core.errors import ApiError
from app.core.security import keyed_hash
from app.core.time import now

TOO_MANY = "Too many tries. Please wait a little and try again."


def stored(key: str) -> str:
    """The key as kept in the database: the prefix stays readable, whatever follows the first ":" is hashed."""
    prefix, sep, who = key.partition(":")
    return f"{prefix}:{keyed_hash('rate', prefix, who)[:24]}" if sep else key


async def count(db: AsyncDatabase, key: str, window: timedelta) -> int:
    return await db[RATE_EVENTS].count_documents({"key": stored(key), "at": {"$gt": now() - window}})


async def record(db: AsyncDatabase, *keys: str) -> None:
    if keys:
        at = now()
        await db[RATE_EVENTS].insert_many([{"key": stored(k), "at": at} for k in keys])


async def clear(db: AsyncDatabase, key: str) -> None:
    await db[RATE_EVENTS].delete_many({"key": stored(key)})


async def check(db: AsyncDatabase, key: str, rules: list[tuple[int, timedelta]], message: str = TOO_MANY) -> None:
    """Raises 429 if `key` already reached any (max, window) rule. Does not record anything."""
    for max_, window in rules:
        if await count(db, key, window) >= max_:
            raise ApiError(429, "rate_limited", message, headers={"Retry-After": str(int(window.total_seconds()))})
