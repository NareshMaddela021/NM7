"""Report this job (Phase 2, C4): signed-in students flag a job; three reports from different people pause it until
an admin checks it.

  POST /api/jobs/{job_id}/report {reason, note}        one report per person per job
  GET  /api/admin/job-reports?state=open|done    jobs with reports, their reasons and notes (Admin → Jobs → Reports)
  POST /api/admin/job-reports/{job_id}/resolve {action: dismiss | close, note}
       dismiss: the reports were wrong; a job paused by them goes live again. close: the job is closed with the note.
"""

from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field
from pymongo.errors import DuplicateKeyError

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import DB, JOB_REPORTS, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms

router = APIRouter(prefix="/api/jobs", tags=["job reports"])
admin = APIRouter(prefix="/api/admin/job-reports", tags=["job reports"])
PAUSE_AT = 3
REASONS = ("scam", "fake", "unfair", "wrong_info", "expired", "other")


class ReportIn(CamelModel):
    reason: Literal[REASONS]  # type: ignore[valid-type]
    note: str = Field("", max_length=500)


@router.post("/{job_id}/report", status_code=201)
async def report(job_id: str, body: ReportIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": job_id, "demo": {"$ne": True}}, {"status": 1, "title": 1, "company_id": 1})
    if not j:
        raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
    try:
        await db[JOB_REPORTS].insert_one(
            {
                "_id": f"{auth.user.id}:{job_id}",
                "job_id": job_id,
                "user_id": auth.user.id,
                "reason": body.reason,
                "note": body.note.strip(),
                "at": now(),
                "state": "open",
            }
        )
    except DuplicateKeyError:
        raise ApiError(409, "already", "You’ve already reported this job. Our team will check it.") from None
    n = await db[JOB_REPORTS].count_documents({"job_id": job_id, "state": "open"})
    paused = False
    if n >= PAUSE_AT and j["status"] == "active":
        await db[JOBS].update_one(
            {"_id": job_id}, {"$set": {"status": "paused", "reports_hold": True, "updated_at": now()}}
        )
        await audit(db, None, "job.reports_paused", target=job_id, data={"reports": n, "title": j["title"]})
        paused = True
    if j.get("company_id"):
        from app.companies.trust import refresh

        await refresh(db, j["company_id"])
    return {"reported": True, "paused": paused}


@admin.get("")
async def reports(db: DB, _: AdminAuth("jobs"), state: str = Query("open", max_length=6)) -> list[dict[str, Any]]:
    rows = (
        await db[JOB_REPORTS]
        .find({"state": state if state in ("open", "done") else "open"})
        .sort("at", -1)
        .to_list(1000)
    )
    by_job: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_job.setdefault(r["job_id"], []).append(r)
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": list(by_job)}}, {"description": 0})}
    out = []
    for jid, rs in by_job.items():
        j = jobs.get(jid)
        if not j:
            continue
        out.append(
            {
                "jobId": jid,
                "title": j["title"],
                "company": j["company"]["name"],
                "slug": j["slug"],
                "status": j["status"],
                "held": bool(j.get("reports_hold")),
                "count": len(rs),
                "reports": [{"reason": r["reason"], "note": r.get("note", ""), "at": ms(r["at"])} for r in rs],
            }
        )
    return sorted(out, key=lambda x: -x["count"])


class ResolveIn(CamelModel):
    action: Literal["dismiss", "close"]
    note: str = Field("", max_length=300)


@admin.post("/{job_id}/resolve")
async def resolve(job_id: str, body: ResolveIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": job_id})
    if not j:
        raise ApiError(404, "not_found", "No such job.")
    if body.action == "close" and len(body.note.strip()) < 5:
        raise ApiError(400, "note", "Say why the job is closed.")
    t = now()
    sets: dict[str, Any] = {"reports_hold": False, "updated_at": t}
    if body.action == "close":
        sets |= {"status": "closed", "closed_reason": f"closed after reports: {body.note.strip()}"}
    elif j.get("reports_hold") and j["status"] == "paused":
        sets["status"] = "active"
    await db[JOBS].update_one({"_id": job_id}, {"$set": sets})
    await db[JOB_REPORTS].update_many(
        {"job_id": job_id, "state": "open"}, {"$set": {"state": "done", "resolution": body.action, "resolved_at": t}}
    )
    await audit(
        db,
        auth.user.id,
        f"job.reports_{body.action}",
        target=job_id,
        data={"note": body.note.strip(), "title": j["title"]},
        ip=client_ip(request),
    )
    if j.get("company_id"):
        from app.companies.trust import refresh

        await refresh(db, j["company_id"])
    return {"status": sets.get("status", j["status"])}
