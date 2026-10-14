"""Admin console API."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.admin.deps import AdminAuth
from app.audit import AuditLog
from app.auth.models import User
from app.core.db import DB
from app.core.schemas import CamelModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AuditOut(CamelModel):
    id: int
    actor_id: uuid.UUID | None
    actor_name: str | None
    action: str
    target: str | None
    data: dict[str, Any]
    ip: str | None
    at: datetime


@router.get("/audit-log")
async def audit_log(
    db: DB,
    _: AdminAuth("team"),
    action: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[AuditOut]:
    q = select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.actor_id)
    if action:
        q = q.where(AuditLog.action == action)
    rows = await db.execute(q.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return [
        AuditOut(
            id=a.id,
            actor_id=a.actor_id,
            actor_name=name,
            action=a.action,
            target=a.target,
            data=a.data,
            ip=a.ip,
            at=a.at,
        )
        for a, name in rows
    ]
