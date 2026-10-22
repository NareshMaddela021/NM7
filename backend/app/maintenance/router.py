"""Owner-only maintenance: the one-time sample-data cleanup (dry run first)."""

from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import DB
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.maintenance.cleanup import clean, scan

router = APIRouter(prefix="/api/admin/maintenance", tags=["admin"])


class CleanupIn(CamelModel):
    dry_run: bool = True
    ids: list[str] | None = None  # only these (from the dry run); all found when left out


@router.post("/sample-cleanup")
async def sample_cleanup(body: CleanupIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict:
    if auth.user.admin_role != "owner":
        raise ApiError(403, "owner_only", "Only the owner can run this.")
    rows = await scan(db) if body.dry_run else await clean(db, body.ids)
    out = [{"id": r["id"], "markers": r["markers"], "fields": r["fields"]} for r in rows]
    action = "maintenance.sample_scan" if body.dry_run else "maintenance.sample_cleanup"
    ids = [r["id"] for r in out][:500]
    await audit(db, auth.user.id, action, data={"count": len(out), "ids": ids}, ip=client_ip(request))
    return {"dryRun": body.dry_run, "count": len(out), "resumes": out}
