"""The company's "Connect your hiring system" page (Auto Apply 2.0, A4). Signed in with X-Recruiter-Account; shown only
to companies the 2.0 switch lets in (app/autoapply/access.for_company), else 404.

  GET    /api/company/{id}/ats                    partners and the fields each needs, the connection (only "•••• last 4"
                                                  and dates, never a key), the company's Nm7 jobs with their links,
                                                  delivery counts                                     (any team role)
  POST   /api/company/{id}/ats/connect {partner, fields}   test with the partner, then save (keys encrypted) (main/full)
  POST   /api/company/{id}/ats/test               test the saved connection again                  (main / full)
  DELETE /api/company/{id}/ats                    disconnect: keys deleted, waiting ones stay on Nm7 (main / full)
  GET    /api/company/{id}/ats/jobs               the partner's open jobs, to link     (main / full / posting)
  PUT    /api/company/{id}/jobs/{job}/ats {partnerJob: {id, title} | null}   link / unlink an Nm7 job

Every change is in the activity log, without the key.
"""

from typing import Any

from fastapi import APIRouter, Header
from pydantic import Field

from app.autoapply import access as aa_access
from app.autoapply import instant
from app.autoapply.ats import service
from app.companies.model import MANAGE, POST
from app.companies.signup import company_for
from app.core.db import DB, JOBS
from app.core.errors import ApiError
from app.core.schemas import CamelModel

router = APIRouter(prefix="/api/company", tags=["company hiring system"])


class ConnectIn(CamelModel):
    partner: str = Field(max_length=20)
    fields: dict[str, str] = Field(default_factory=dict, max_length=10)


class PartnerJobIn(CamelModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field("", max_length=160)


class LinkIn(CamelModel):
    partner_job: PartnerJobIn | None = None


async def _ctx(db, cid: str, session: str | None, roles: set[str] | None = None):
    acc, c, m = await company_for(db, cid, session, roles)
    if not await aa_access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return acc, c, m


async def _page(db, c: dict[str, Any], m: dict[str, Any]) -> dict[str, Any]:
    conn = await service.connection(db, c["_id"])
    jobs = (
        await db[JOBS]
        .find(
            {"company_id": c["_id"], "status": {"$in": ["active", "paused", "review"]}},
            {"title": 1, "status": 1, "apply": 1, "company_id": 1, "partner_job": 1},
        )
        .sort("created_at", -1)
        .to_list(200)
    )
    return {
        "partners": service.catalogue(),
        "connection": service.safe(conn),
        "canManage": m["role"] in MANAGE,
        "canLink": m["role"] in POST,
        "jobs": [
            {
                "id": j["_id"],
                "title": j["title"],
                "status": j["status"],
                "link": {"id": j["partner_job"]["id"], "title": j["partner_job"].get("title") or ""}
                if j.get("partner_job") and conn and j["partner_job"].get("partner") == conn["partner"]
                else None,
            }
            for j in jobs
            if instant.eligible(j)
        ],
        "counts": await service.company_counts(db, c["_id"]),
    }


@router.get("/{cid}/ats")
async def page(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, c, m = await _ctx(db, cid, x_recruiter_account)
    return await _page(db, c, m)


@router.post("/{cid}/ats/connect")
async def connect(cid: str, body: ConnectIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict:
    acc, c, m = await _ctx(db, cid, x_recruiter_account, MANAGE)
    await service.connect(db, c, acc, body.partner, body.fields)
    return await _page(db, c, m)


@router.post("/{cid}/ats/test")
async def test(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, m = await _ctx(db, cid, x_recruiter_account, MANAGE)
    await service.test_saved(db, c, acc)
    return await _page(db, c, m)


@router.delete("/{cid}/ats")
async def disconnect(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, m = await _ctx(db, cid, x_recruiter_account, MANAGE)
    kept = await service.disconnect(db, c, acc)
    return {**(await _page(db, c, m)), "keptOnNm7": kept}


@router.get("/{cid}/ats/jobs")
async def partner_jobs(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, c, _ = await _ctx(db, cid, x_recruiter_account, POST)
    return {"jobs": await service.partner_jobs(db, c)}


@router.put("/{cid}/jobs/{jid}/ats")
async def link(cid: str, jid: str, body: LinkIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict:
    acc, c, _ = await _ctx(db, cid, x_recruiter_account, POST)
    got = await service.link_job(db, c, acc, jid, body.partner_job.model_dump() if body.partner_job else None)
    return {"link": got or None}
