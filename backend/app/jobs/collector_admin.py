"""Round M: Admin → Jobs → Job collector. The jobs waiting for review, counted by reason; "Send back to the
collector" for the ones held only for something a new try can fix (no page text, today's AI allowance used up, the
summary failed); and closing the ones that turn out to be abroad.

  GET  /api/admin/jobs/collector/review           {total, byReason: {reason: n}, retryable: {reason: n}, sentBack,
                                                   outsideIndia}
  POST /api/admin/jobs/collector/resend {reason}  mark them: the collector sends them again on its next run
                                                  (GET /api/jobs/collector/resend), and a job leaves the list when it
                                                  arrives again
  POST /api/admin/jobs/collector/close-outside-india   close the waiting ones whose location is clearly abroad
"""

from typing import Any, Literal

from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import DB, JOBS
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs.collector import OUTSIDE_INDIA, RETRY, outside_india

router = APIRouter(prefix="/api/admin/jobs/collector", tags=["job board"])
WAITING = {"source": "collector", "status": "review"}


def _only(reason: str) -> dict[str, Any]:
    """Waiting jobs whose reasons are all retryable and include this one (a job also missing its city still needs
    Admin, so it is never sent back)."""
    return {**WAITING, "review.reasons": {"$all": [reason], "$not": {"$elemMatch": {"$nin": list(RETRY)}}}}


async def _abroad(db) -> list[str]:
    rows = db[JOBS].find(WAITING, {"collector.location": 1})  # stored since round M; older ones close when resent
    out = []
    async for r in rows:
        loc = (r.get("collector") or {}).get("location") or ""
        if loc and outside_india(loc):
            out.append(r["_id"])
    return out


@router.get("/review")
async def review(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    rows = await db[JOBS].aggregate([{"$match": WAITING}, {"$unwind": "$review.reasons"},
                               {"$group": {"_id": "$review.reasons", "n": {"$sum": 1}}}])  # fmt: skip
    by = {r["_id"]: r["n"] async for r in rows}
    return {
        "total": await db[JOBS].count_documents(WAITING),
        "byReason": dict(sorted(by.items(), key=lambda x: -x[1])),
        # not sent back yet
        "retryable": {
            r: await db[JOBS].count_documents({**_only(r), "collector.resend": {"$ne": True}}) for r in RETRY
        },
        "sentBack": await db[JOBS].count_documents({**WAITING, "collector.resend": True}),
        "outsideIndia": len(await _abroad(db)),
    }


class ResendIn(CamelModel):
    reason: Literal["no_page_text", "ai_daily_limit", "summary_failed", "summary_unavailable"]


@router.post("/resend")
async def resend(body: ResendIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[JOBS].update_many(_only(body.reason), {"$set": {"collector.resend": True, "updated_at": now()}})
    await audit(db, auth.user.id, "job.collector_resend", target=None, data={"reason": body.reason,
                "jobs": r.modified_count}, ip=client_ip(request))  # fmt: skip
    return {"sentBack": r.modified_count}


@router.post("/close-outside-india")
async def close_outside_india(request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    ids = await _abroad(db)
    closed = {"status": "closed", "closed_reason": OUTSIDE_INDIA, "updated_at": now()}
    r = await db[JOBS].update_many({"_id": {"$in": ids}, **WAITING}, {"$set": closed})
    await audit(db, auth.user.id, "job.collector_close_abroad", target=None, data={"closed": r.modified_count},
                ip=client_ip(request))  # fmt: skip
    return {"closed": r.modified_count}
