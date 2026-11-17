"""One heavy job at a time, so a single big admin action or background job can't take the whole API down.

The API runs on a 512 MB server. Demo resets (they delete and rebuild hundreds of made-up records) and the big
background passes (the daily fraud scan, the hourly level refresh and ready shortlists, the daily payment check) each
take a lease called "heavy" (the same lease mechanism as the automation pass, in the locks collection, so it also
holds across two server instances) and also an in-process lock. While one runs:

- an admin pressing a demo reset gets a calm 429 "Another big job is running. Try again in a minute." (heavy_or_busy);
- a background job just skips this pass and runs on the next one (heavy_or_skip returns False).

A lease that is never released (a crash) expires on its own after HOLD.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from app.core.errors import ApiError

NAME = "heavy"
HOLD = timedelta(minutes=10)
_local = asyncio.Lock()

BUSY = ApiError(429, "busy", "Another big job is running on the server. Try again in a minute.")


async def _take(db: AsyncDatabase) -> bool:
    from app.automation import take_lease

    return await take_lease(db, NAME, HOLD)


async def _give(db: AsyncDatabase) -> None:
    from app.automation import release_lease

    await release_lease(db, NAME)


@asynccontextmanager
async def heavy_or_busy(db: AsyncDatabase) -> AsyncIterator[None]:
    """For admin actions: run now, or answer 429 if another heavy job is running."""
    if _local.locked():
        raise BUSY
    async with _local:
        if not await _take(db):
            raise BUSY
        try:
            yield
        finally:
            await _give(db)


@asynccontextmanager
async def heavy_or_skip(db: AsyncDatabase) -> AsyncIterator[bool]:
    """For background jobs: `async with heavy_or_skip(db) as ok:` — ok is False when another heavy job runs (skip)."""
    if _local.locked():
        yield False
        return
    async with _local:
        if not await _take(db):
            yield False
            return
        try:
            yield True
        finally:
            await _give(db)
