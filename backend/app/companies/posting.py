"""Companies post jobs (Phase 2, C3) into the job board's own jobs (source "company", company_id), safely.

  POST /api/company/{id}/jobs/check {job}        what would happen: field problems, blocked wording, scam signs,
                                                 fresher-fit warnings, a duplicate — nothing saved
  POST /api/company/{id}/jobs {job}              post (main / full / posting admins, within the trust level's limit):
                                                 blocked wording → 400; a duplicate open job → 409; scam signs or the
                                                 AI check (once per job) → waits for Admin review; else live
  GET  /api/company/{id}/jobs                    the company's jobs, any state
  PUT  /api/company/{id}/jobs/{job_id} {job}     edit (checked again); a live job can be edited 2 times, then support
  POST /api/company/{id}/jobs/{job_id}/status {status: active | paused | closed}
  POST /api/company/{id}/jobs/write {role, skills, place}   the AI description writer (never invents facts)

`job` is the same shape as the collector's / Admin's (app/jobs/model.py) without company: the company comes from the
account. Every change is in the activity log.
"""

from typing import Any, Literal

from fastapi import APIRouter, Header
from pydantic import Field, ValidationError

from app.audit import audit
from app.auth.models import new_id
from app.companies import jobcheck
from app.companies.limits import posting_room
from app.companies.model import POST
from app.companies.signup import company_for
from app.core.db import DB, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs.model import JobIn, errors_of, slug_for, to_doc
from app.me.service import ms
from app.site import get_site

router = APIRouter(prefix="/api/company", tags=["company jobs"])
MAX_EDITS = 2
OPEN = ("active", "paused", "review")


class JobBody(CamelModel):
    job: dict[str, Any]


def _job_in(c: dict[str, Any], raw: dict[str, Any]) -> tuple[JobIn | None, list[str]]:
    d = c["details"]
    body = {k: v for k, v in raw.items() if k not in ("company", "status", "source")}
    body["company"] = {"name": d["legal_name"], "website": d.get("website") or ""}
    body.setdefault("applyMethod", "nm7")
    try:
        return JobIn.model_validate(body), []
    except ValidationError as e:
        return None, errors_of(e)


async def _duplicate(db, cid: str, job: JobIn, not_id: str | None = None) -> bool:
    places = sorted(p.lower() for p in job.locations) if job.work_type != "remote" else ["remote"]
    q: dict[str, Any] = {
        "company_id": cid,
        "status": {"$in": list(OPEN)},
        "title": {"$regex": f"^{_rx(job.title)}$", "$options": "i"},
    }
    if not_id:
        q["_id"] = {"$ne": not_id}
    async for j in db[JOBS].find(q, {"locations": 1, "remote": 1}):
        theirs = sorted(p.lower() for p in j.get("locations") or []) if not j.get("remote") else ["remote"]
        if set(theirs) & set(places):
            return True
    return False


def _rx(s: str) -> str:
    import re

    return re.escape(s.strip())


async def _lists(db) -> dict[str, list[str]]:
    return (await get_site(db))["job_checks"]


def company_job_out(j: dict[str, Any]) -> dict[str, Any]:
    rv = j.get("review") or {}
    return {
        "id": j["_id"],
        "slug": j["slug"],
        "title": j["title"],
        "status": j["status"],
        "locations": j.get("locations") or [],
        "remote": bool(j.get("remote")),
        "workType": j["work_type"],
        "jobType": j["job_type"],
        "experience": j["experience"],
        "salary": j.get("salary"),
        "skills": j.get("skills") or [],
        "description": j["description"],
        "apply": {
            "method": j["apply"]["method"],
            "url": j["apply"].get("url", ""),
            "email": j["apply"].get("email", ""),
        },
        "closesAt": ms(j.get("closes_at")),
        "postedAt": ms(j.get("posted_at")),
        "editsLeft": max(0, MAX_EDITS - int(j.get("edit_count", 0))),
        "review": {"reasons": rv.get("reasons") or [], "note": rv.get("note", "")},
        "closedReason": j.get("closed_reason", ""),
    }


@router.post("/{cid}/jobs/check")
async def check_job(cid: str, body: JobBody, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    job, errors = _job_in(c, body.job)
    if not job:
        return {"errors": errors, "blocked": [], "scam": [], "warnings": [], "duplicate": False}
    res = jobcheck.check(job.model_dump(), await _lists(db))
    return {"errors": [], **res, "duplicate": await _duplicate(db, cid, job)}


@router.post("/{cid}/jobs", status_code=201)
async def post_job(cid: str, body: JobBody, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    room = await posting_room(db, c)
    if not room["allowed"]:
        raise ApiError(403, "limit", room["reason"])
    job, errors = _job_in(c, body.job)
    if not job:
        raise ApiError(400, "invalid", " ".join(errors), extra={"errors": errors})
    res = jobcheck.check(job.model_dump(), await _lists(db))
    if res["blocked"]:
        raise ApiError(
            400,
            "unfair_wording",
            f"Please remove: {', '.join(res['blocked'])}. Jobs on Nm7 must be open to everyone who can do the work.",
            extra={"blocked": res["blocked"]},
        )
    if await _duplicate(db, cid, job):
        raise ApiError(409, "duplicate", "You already have this job open in the same city. Edit that one instead.")
    ai = await jobcheck.ai_check(db, cid, {**job.model_dump(), "company_name": c["details"]["legal_name"]})
    reasons = [f"Scam sign: “{p}”" for p in res["scam"]] + (
        [f"AI check: {r}" for r in ai["reasons"]] if ai and ai["suspicious"] else []
    )
    t = now()
    doc = {
        **to_doc(job),
        "_id": new_id(),
        "slug": slug_for(job.title, job.company.name),
        "status": "review" if reasons else "active",
        "posted_at": t,
        "source": "company",
        "company_id": cid,
        "created_at": t,
        "updated_at": t,
        "created_by": acc["email_lc"],
        "edit_count": 0,
        "demo": bool(c.get("demo")),
        "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""},
        "closed_reason": "",
        "review": {"reasons": reasons, "ai": ai, "warnings": res["warnings"]},
    }
    doc["dedupe_key"] = f"company:{cid}:{doc['_id']}"  # company jobs are kept apart from collector duplicates
    await db[JOBS].insert_one(doc)
    await audit(
        db,
        None,
        "company.job_post",
        target=cid,
        data={
            "by": acc["email_lc"],
            "job": doc["_id"],
            "title": job.title,
            "status": doc["status"],
            "reasons": reasons,
        },
    )
    return {**company_job_out(doc), "warnings": res["warnings"]}


@router.get("/{cid}/jobs")
async def my_jobs(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    rows = await db[JOBS].find({"company_id": cid}).sort("created_at", -1).to_list(500)
    return [company_job_out(j) for j in rows]


async def _mine(db, cid: str, jid: str) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": jid, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "This job isn’t yours.")
    return j


@router.put("/{cid}/jobs/{jid}")
async def edit_job(
    cid: str, jid: str, body: JobBody, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    old = await _mine(db, cid, jid)
    if old["status"] == "closed":
        raise ApiError(409, "closed", "This job is closed. Post a new one instead.")
    live = old["status"] == "active"
    if live and int(old.get("edit_count", 0)) >= MAX_EDITS:
        raise ApiError(
            409, "edit_limit", f"A live job can be edited {MAX_EDITS} times. Contact Nm7 support for more changes."
        )
    job, errors = _job_in(c, body.job)
    if not job:
        raise ApiError(400, "invalid", " ".join(errors), extra={"errors": errors})
    res = jobcheck.check(job.model_dump(), await _lists(db))
    if res["blocked"]:
        raise ApiError(
            400, "unfair_wording", f"Please remove: {', '.join(res['blocked'])}.", extra={"blocked": res["blocked"]}
        )
    if await _duplicate(db, cid, job, not_id=jid):
        raise ApiError(409, "duplicate", "You already have this job open in the same city.")
    sets = {**to_doc(job), "updated_at": now(), "dedupe_key": old["dedupe_key"]}
    if res["scam"]:  # new scam signs: back to Admin review
        sets["status"] = "review"
        sets["review"] = {**(old.get("review") or {}), "reasons": [f"Scam sign: “{p}”" for p in res["scam"]]}
    upd: dict[str, Any] = {"$set": sets}
    if live:
        upd["$inc"] = {"edit_count": 1}
    await db[JOBS].update_one({"_id": jid}, upd)
    await audit(db, None, "company.job_edit", target=cid, data={"by": acc["email_lc"], "job": jid, "title": job.title})
    return {**company_job_out(await _mine(db, cid, jid)), "warnings": res["warnings"]}


class StatusIn(CamelModel):
    status: Literal["active", "paused", "closed"]


@router.post("/{cid}/jobs/{jid}/status")
async def job_status(
    cid: str, jid: str, body: StatusIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    j = await _mine(db, cid, jid)
    if j["status"] == "review" and body.status == "active":
        raise ApiError(409, "in_review", "This job is waiting for our team’s review.")
    if j["status"] == "closed" and body.status != "closed":
        raise ApiError(409, "closed", "A closed job can’t be opened again. Post a new one.")
    if body.status == "active" and j["status"] != "active":
        room = await posting_room(db, c)
        if not room["allowed"]:
            raise ApiError(403, "limit", room["reason"])
    sets: dict[str, Any] = {"status": body.status, "updated_at": now()}
    if body.status == "closed":
        sets["closed_reason"] = "closed by the company"
    await db[JOBS].update_one({"_id": jid}, {"$set": sets})
    await audit(
        db,
        None,
        f"company.job_{body.status}",
        target=cid,
        data={"by": acc["email_lc"], "job": jid, "title": j["title"]},
    )
    return company_job_out(await _mine(db, cid, jid))


class WriteIn(CamelModel):
    role: str = Field(min_length=2, max_length=120)
    skills: str = Field("", max_length=300)
    place: str = Field("", max_length=200)  # city and salary, as the company types them


@router.post("/{cid}/jobs/write")
async def write_description(
    cid: str, body: WriteIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    _, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    return await jobcheck.write(db, cid, c["details"]["legal_name"], body.role, body.skills, body.place)
