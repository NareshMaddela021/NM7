"""Round J: requests to remove a job (mostly a company asking about a job the collector found on its careers site).

  POST /api/public/job-removal {company, jobLink, email, reason}       the form at /contact?topic=job-removal and the
                                                                       "Request removal of this job" link on job pages
Admin ("jobs"):
  GET  /api/admin/jobs/removals?status=open|done|dismissed
  POST /api/admin/jobs/removals/{id}/close-job                         one click: the job is closed ("removed on
                                                                       request") and never reopened by the collector
  POST /api/admin/jobs/removals/{id}/dismiss {note}

The requester's email is kept only to reply about this request.
"""

import re
from datetime import timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Query, Request
from pydantic import EmailStr, Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, JOB_REMOVALS, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash
from app.core.time import now
from app.jobs.collector import url_key
from app.me.service import ms

public = APIRouter(prefix="/api/public/job-removal", tags=["job board"])
admin = APIRouter(prefix="/api/admin/jobs/removals", tags=["job board"])


class RemovalIn(CamelModel):
    company: str = Field(min_length=1, max_length=120)
    job_link: str = Field(min_length=8, max_length=2000)
    email: EmailStr
    reason: str = Field("", max_length=1000)


async def find_job(db, link: str) -> dict[str, Any] | None:
    """The job a link points to: an nm7.si job page (/jobs/<slug>) or the job's own apply link."""
    m = re.search(r"/jobs/([a-z0-9-]{3,120})", link or "", re.I)
    if m and "nm7" in link.lower():
        j = await db[JOBS].find_one({"slug": m.group(1).lower()})
        if j:
            return j
    key = url_key(link)
    return await db[JOBS].find_one({"collector.url_key": key}) or await db[JOBS].find_one(
        {"apply.url": {"$regex": f"^https?://(www\\.)?{re.escape(key)}/?(\\?.*)?$", "$options": "i"}}
    )


@public.post("", status_code=201)
async def request_removal(body: RemovalIn, request: Request, db: DB) -> dict[str, Any]:
    ip = keyed_hash("ip", client_ip(request) or "-")[:24]
    await rate_limit.check(db, f"job-removal:{ip}", [(5, timedelta(hours=1)), (20, timedelta(days=1))])
    await rate_limit.record(db, f"job-removal:{ip}")
    j = await find_job(db, body.job_link)
    doc = {
        "company": " ".join(body.company.split()),
        "job_link": body.job_link.strip(),
        "email": str(body.email).lower(),
        "reason": body.reason.strip(),
        "job_id": j["_id"] if j else None,
        "job_title": j["title"] if j else "",
        "status": "open",
        "at": now(),
        "ip": ip,
    }
    rid = (await db[JOB_REMOVALS].insert_one(doc)).inserted_id
    await audit(db, None, "job.removal_requested", target=doc["job_id"] or "", data={"request": str(rid)}, ip=None)
    return {"ok": True, "found": bool(j)}


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "No such request.") from None


def out(r: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(r["_id"]), "company": r["company"], "jobLink": r["job_link"], "email": r["email"],
            "reason": r["reason"], "jobId": r.get("job_id"), "jobTitle": r.get("job_title") or "",
            "status": r["status"], "at": ms(r["at"]), "note": r.get("note") or ""}  # fmt: skip


@admin.get("")
async def removals(db: DB, _: AdminAuth("jobs"), status: str = Query("open", max_length=10)) -> list[dict[str, Any]]:
    q = {"status": status} if status in ("open", "done", "dismissed") else {}
    return [out(r) async for r in db[JOB_REMOVALS].find(q).sort("at", -1).limit(200)]


async def close_job(db, job_id: str, reason: str) -> bool:
    r = await db[JOBS].update_one(
        {"_id": job_id},
        {"$set": {"status": "closed", "closed_reason": reason, "collector.removed": True, "updated_at": now()}},
    )
    return bool(r.matched_count)


@admin.post("/{rid}/close-job")
async def close_requested(rid: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[JOB_REMOVALS].find_one({"_id": _oid(rid)})
    if not r:
        raise ApiError(404, "not_found", "No such request.")
    job_id = r.get("job_id") or ((await find_job(db, r["job_link"])) or {}).get("_id")
    if not job_id or not await close_job(db, job_id, "removed on request"):
        raise ApiError(404, "no_job", "We couldn't find that job on Nm7. Dismiss the request, or check the link.")
    await db[JOB_REMOVALS].update_one(
        {"_id": r["_id"]}, {"$set": {"status": "done", "job_id": job_id, "done_at": now(), "by": auth.user.id}}
    )
    await audit(db, auth.user.id, "job.removed_on_request", target=job_id, data={"request": rid}, ip=client_ip(request))
    return {"status": "done", "jobId": job_id}


class DismissIn(CamelModel):
    note: str = Field("", max_length=500)


@admin.post("/{rid}/dismiss")
async def dismiss(rid: str, body: DismissIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[JOB_REMOVALS].update_one(
        {"_id": _oid(rid)},
        {"$set": {"status": "dismissed", "note": body.note.strip(), "done_at": now(), "by": auth.user.id}},
    )
    if not r.matched_count:
        raise ApiError(404, "not_found", "No such request.")
    await audit(db, auth.user.id, "job.removal_dismissed", target=rid, data={}, ip=None)
    return {"status": "dismissed"}
