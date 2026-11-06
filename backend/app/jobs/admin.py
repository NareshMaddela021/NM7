"""Admin → Jobs (permission "jobs": Owner and Operations). Every change is in the audit log.

GET    /api/admin/jobs?q=&status=&source=&experience=&page=   list + counts by source, experience and status
GET    /api/admin/jobs/expired                                jobs whose apply link failed its last check
GET    /api/admin/jobs/{id}                                   one job (the form)
POST   /api/admin/jobs                                        add (409 when the same job is already there)
PUT    /api/admin/jobs/{id}                                   edit
POST   /api/admin/jobs/{id}/status {status, reason}           pause / close / reopen
DELETE /api/admin/jobs/{id}
POST   /api/admin/jobs/import {format: json|csv, text, commit}  preview (commit false) or import, per-row errors
GET    /api/admin/jobs/{id}/applications                      who applied (Manual Apply), newest first
"""

import json
import re
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import APPLICATIONS, DB, JOBS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs import service
from app.jobs.apply import status_change
from app.jobs.model import APPLY, EXPERIENCE, JOB_TYPES, SOURCES, STATUSES, WORK_TYPES, JobIn, to_doc
from app.me.service import ms

router = APIRouter(prefix="/api/admin/jobs", tags=["admin jobs"])
PAGE = 50
NOT_FOUND = ApiError(404, "not_found", "That job isn’t here any more.")


def job_out(j: dict[str, Any], full: bool = False) -> dict[str, Any]:
    lc = j.get("link_check") or {}
    out = {
        "id": j["_id"],
        "slug": j["slug"],
        "title": j["title"],
        "company": j["company"],
        "locations": j.get("locations") or [],
        "remote": bool(j.get("remote")),
        "workType": j["work_type"],
        "jobType": j["job_type"],
        "experience": j["experience"],
        "salary": j.get("salary"),
        "skills": j.get("skills") or [],
        "apply": j["apply"],
        "status": j["status"],
        "closedReason": j.get("closed_reason") or "",
        "postedAt": ms(j.get("posted_at")),
        "closesAt": ms(j.get("closes_at")),
        "source": j["source"],
        "linkCheck": {
            "at": ms(lc.get("at")),
            "ok": lc.get("ok"),
            "status": lc.get("status"),
            "fails": lc.get("fails", 0),
            "error": lc.get("error", ""),
        },  # fmt: skip
        "demo": bool(j.get("demo")),
        "createdAt": ms(j.get("created_at")),
        "updatedAt": ms(j.get("updated_at")),
    }
    if full:
        out["description"] = j["description"]
    return out


def _ip(request: Request) -> str | None:
    return client_ip(request)


async def _job(db, job_id: str) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": job_id})
    if not j:
        raise NOT_FOUND
    return j


@router.get("")
async def list_jobs(
    db: DB,
    _: AdminAuth("jobs"),
    q: str = Query("", max_length=100),
    status: str = Query("", max_length=20),
    source: str = Query("", max_length=20),
    experience: str = Query("", max_length=20),
    page: int = Query(1, ge=1, le=1000),
) -> dict[str, Any]:
    match: dict[str, Any] = {}
    if status in STATUSES:
        match["status"] = status
    if source in SOURCES:
        match["source"] = source
    if experience in EXPERIENCE:
        match["experience"] = experience
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        match["$or"] = [{"title": rx}, {"company.name": rx}, {"locations": rx}, {"skills": rx}]
    total = await db[JOBS].count_documents(match)
    rows = db[JOBS].find(match, {"description": 0}).sort("created_at", -1).skip((page - 1) * PAGE).limit(PAGE)
    items = [job_out(j) async for j in rows]

    async def counts(field: str) -> dict[str, int]:
        cur = await db[JOBS].aggregate([{"$group": {"_id": f"${field}", "n": {"$sum": 1}}}])
        return {r["_id"]: r["n"] async for r in cur if r["_id"]}

    return {
        "items": items,
        "total": total,
        "page": page,
        "pages": max(1, -(-total // PAGE)),
        "counts": {
            "source": await counts("source"),
            "experience": await counts("experience"),
            "status": await counts("status"),
        },  # fmt: skip
        "labels": {"workType": WORK_TYPES, "jobType": JOB_TYPES, "experience": EXPERIENCE, "apply": APPLY},
    }


@router.get("/expired")
async def expired(db: DB, _: AdminAuth("jobs")) -> list[dict[str, Any]]:
    """Jobs whose apply link failed (one failure: watched; two in a row: closed by the daily check)."""
    rows = db[JOBS].find({"link_check.fails": {"$gte": 1}}, {"description": 0}).sort("link_check.at", -1)
    return [job_out(j) async for j in rows.limit(500)]


@router.get("/{job_id}")
async def get_job(job_id: str, db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    return job_out(await _job(db, job_id), full=True)


@router.post("", status_code=201)
async def add_job(body: JobIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    old = await db[JOBS].find_one({"dedupe_key": to_doc(body)["dedupe_key"]}, {"_id": 1, "title": 1})
    if old:
        raise ApiError(409, "duplicate", "This job is already on the board (same company, title, places and apply "
                       "link). Edit that one instead.", extra={"id": old["_id"]})  # fmt: skip
    _, doc = await service.save(db, body, "admin", auth.user.id)
    await audit(db, auth.user.id, "job.create", target=doc["_id"], data={"title": doc["title"]}, ip=_ip(request))
    return job_out(doc, full=True)


@router.put("/{job_id}")
async def edit_job(job_id: str, body: JobIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    j = await _job(db, job_id)
    fields = to_doc(body)
    other = await db[JOBS].find_one({"dedupe_key": fields["dedupe_key"], "_id": {"$ne": job_id}}, {"_id": 1})
    if other:
        raise ApiError(409, "duplicate", "Another job on the board already has this company, title, places and "
                       "apply link.", extra={"id": other["_id"]})  # fmt: skip
    sets = {**fields, "status": body.status, "updated_at": now()}
    if body.posted_at:
        sets["posted_at"] = body.posted_at
    if body.status != "closed":
        sets["closed_reason"] = ""
    elif j["status"] != "closed":
        sets["closed_reason"] = "closed by an admin"
    await db[JOBS].update_one({"_id": job_id}, {"$set": sets})
    changed = sorted(k for k in sets if k != "updated_at" and j.get(k) != sets[k])
    await audit(db, auth.user.id, "job.edit", target=job_id, data={"title": body.title, "changed": changed},
                ip=_ip(request))  # fmt: skip
    return job_out({**j, **sets}, full=True)


class StatusIn(CamelModel):
    status: Literal["active", "paused", "closed"]
    reason: str = Field("", max_length=200)


@router.post("/{job_id}/status")
async def set_status(job_id: str, body: StatusIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict:
    j = await _job(db, job_id)
    sets: dict[str, Any] = {"status": body.status, "updated_at": now()}
    sets["closed_reason"] = (body.reason.strip() or "closed by an admin") if body.status == "closed" else ""
    if body.status == "active":  # reopened: the link check starts again from zero
        sets["link_check.fails"] = 0
    await db[JOBS].update_one({"_id": job_id}, {"$set": sets})
    action = {"active": "job.reopen" if j["status"] != "active" else "job.status", "paused": "job.pause",
              "closed": "job.close"}[body.status]  # fmt: skip
    await audit(db, auth.user.id, action, target=job_id, data={"title": j["title"], "reason": body.reason},
                ip=_ip(request))  # fmt: skip
    return job_out(await _job(db, job_id))


@router.delete("/{job_id}")
async def delete_job(job_id: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    j = await _job(db, job_id)
    await db[JOBS].delete_one({"_id": job_id})
    await audit(db, auth.user.id, "job.delete", target=job_id, data={"title": j["title"]}, ip=_ip(request))
    return {"ok": True}


class ImportIn(CamelModel):
    format: Literal["json", "csv"]
    text: str = Field(min_length=2, max_length=5_000_000)
    commit: bool = False


@router.post("/import")
async def import_jobs(body: ImportIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    """Preview first (commit false: what would be created / updated / skipped, and each bad row's reasons), then
    import the valid rows (commit true). Bad rows never stop the good ones."""
    try:
        rows = service.parse_rows(body.format, body.text)
    except (json.JSONDecodeError, ValueError) as e:
        raise ApiError(400, "bad_file", f"Couldn’t read the {body.format.upper()}: {e}") from None
    if not rows:
        raise ApiError(400, "empty", "No jobs found in what you pasted.")
    out = await service.save_batch(db, rows, "bulk", auth.user.id, commit=body.commit)
    if body.commit:
        counts = {k: out[k] for k in ("created", "updated", "skipped", "rejected")}
        await audit(db, auth.user.id, "job.import", target=None, data={**counts, "format": body.format},
                    ip=_ip(request))  # fmt: skip
    return {**out, "committed": body.commit}


@router.get("/{job_id}/applications")
async def job_applications(job_id: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> list[dict[str, Any]]:
    """Everyone who applied. Opening the list marks applications sent on Nm7 as Viewed (the person sees that)."""
    await _job(db, job_id)
    apps = await db[APPLICATIONS].find({"job_id": job_id}).sort("created_at", -1).to_list(500)
    fresh = [a for a in apps if a.get("channel") == "nm7" and a.get("status") == "applied"]
    for a in fresh:
        await db[APPLICATIONS].update_one({"_id": a["_id"], "status": "applied"}, status_change(a, "viewed"))
        a["status"] = "viewed"
    if fresh:
        await audit(db, auth.user.id, "job.applications_viewed", target=job_id, data={"n": len(fresh)}, ip=_ip(request))
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [a["user_id"] for a in apps]}},
                                                       {"name": 1, "email": 1})}  # fmt: skip
    return [
        {"user": a["user_id"], "id": a.get("key"), "name": (users.get(a["user_id"]) or {}).get("name", ""),
         "email": (users.get(a["user_id"]) or {}).get("email", ""), "status": a.get("status"),
         "channel": a.get("channel", ""), "resume": a.get("resume_name", ""), "at": ms(a.get("created_at"))}
        for a in apps
    ]  # fmt: skip


class AppStatusIn(CamelModel):
    status: Literal["viewed", "shortlisted", "interview", "offer", "rejected"]


@router.post("/{job_id}/applications/{user_id}/status")
async def set_application_status(
    job_id: str, user_id: str, body: AppStatusIn, request: Request, db: DB, auth: AdminAuth("jobs")
) -> dict[str, Any]:
    """Moves an application sent on Nm7 along: Shortlisted → Interview → Offer / Rejected."""
    a = await db[APPLICATIONS].find_one({"job_id": job_id, "user_id": user_id, "channel": "nm7"})
    if not a:
        raise ApiError(404, "not_found", "That application isn’t here.")
    change = status_change(a, body.status)
    if change:
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, change)
        await audit(db, auth.user.id, "job.application_status", target=job_id,
                    data={"user": user_id, "from": a.get("status"), "to": body.status}, ip=_ip(request))  # fmt: skip
    return {"status": body.status}
