"""Audit log: who did what, for the admin console."""

from datetime import datetime
from typing import Any

from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import AUDIT_LOG, Doc, Session, next_number
from app.core.time import now


class AuditLog(Doc):
    id: int = Field(alias="_id")  # 1, 2, 3, … (shown in the admin console)
    actor_id: str | None = None
    action: str
    target: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    ip: str | None = None
    at: datetime = Field(default_factory=now)


async def audit(
    db: AsyncDatabase,
    actor_id: str | None,
    action: str,
    target: str | None = None,
    data: dict[str, Any] | None = None,
    ip: str | None = None,
    session: Session = None,
) -> None:
    """Writes an entry. Pass `session` to make it part of a transaction (it then disappears if that aborts)."""
    n = await next_number(db, "audit", 1, session=session)
    entry = AuditLog(_id=n, actor_id=actor_id, action=action, target=target, data=data or {}, ip=ip)
    await db[AUDIT_LOG].insert_one(entry.to_mongo(), session=session)
