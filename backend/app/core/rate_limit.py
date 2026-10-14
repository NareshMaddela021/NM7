"""Simple rate limits stored in Postgres, so they hold across several API instances."""

from datetime import datetime, timedelta

from sqlalchemy import BigInteger, DateTime, Identity, String, delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.errors import ApiError
from app.core.time import now

TOO_MANY = "Too many tries. Please wait a little and try again."


class RateEvent(Base):
    __tablename__ = "rate_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    key: Mapped[str] = mapped_column(String(200), index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


async def count(db: AsyncSession, key: str, window: timedelta) -> int:
    q = select(func.count()).select_from(RateEvent).where(RateEvent.key == key, RateEvent.at > now() - window)
    return (await db.execute(q)).scalar_one()


async def record(db: AsyncSession, *keys: str) -> None:
    for key in keys:
        # Keep the table small: drop this key's events older than a day.
        await db.execute(delete(RateEvent).where(RateEvent.key == key, RateEvent.at < now() - timedelta(days=1)))
        await db.execute(insert(RateEvent).values(key=key, at=now()))


async def clear(db: AsyncSession, key: str) -> None:
    await db.execute(delete(RateEvent).where(RateEvent.key == key))


async def check(db: AsyncSession, key: str, rules: list[tuple[int, timedelta]], message: str = TOO_MANY) -> None:
    """Raises 429 if `key` already reached any (max, window) rule. Does not record anything."""
    for max_, window in rules:
        if await count(db, key, window) >= max_:
            raise ApiError(429, "rate_limited", message, headers={"Retry-After": str(int(window.total_seconds()))})
