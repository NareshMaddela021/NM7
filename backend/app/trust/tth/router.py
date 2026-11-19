# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T13 endpoints: time to hire.

Company (header X-Recruiter-Account; 404 while Vetting Trust is hidden from this company):
  GET  /api/company/{cid}/trust/tth          its own jobs' minutes per step, its medians / p75 for 7 / 30 / 90 days and
                                             the Nm7 median (from the Daily report; no other company's data)
Admin (read: dashboard; change: settings; audited). The numbers themselves are in Admin → Daily report ("Time to hire"):
  GET  /api/admin/trust/tth                  the "Needs attention" thresholds and their bounds
  PUT  /api/admin/trust/tth {contactHours, staleHours, minJobs}
"""

from typing import Any

from fastapi import APIRouter, Header, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies.signup import company_for
from app.core.db import DB
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.site import get_site, save_site
from app.trust import access
from app.trust.tth import service as S

company = APIRouter(prefix="/api/company/{cid}/trust/tth", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/tth", tags=["trust"])


@company.get("")
async def company_tth(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return await S.company_view(db, cid)


def _out(site: dict[str, Any]) -> dict[str, Any]:
    st = S.settings_of(site)
    return {"contactHours": st["contact_hours"], "staleHours": st["stale_hours"], "minJobs": st["min_jobs"],
            "bounds": {"contactHours": S.BOUNDS["contact_hours"], "staleHours": S.BOUNDS["stale_hours"], "minJobs": S.BOUNDS["min_jobs"]}}  # fmt: skip


@admin.get("")
async def admin_get(db: DB, _: AdminAuth("dashboard")) -> dict[str, Any]:
    return _out(await get_site(db))


class SettingsIn(CamelModel):
    contact_hours: int = Field(ge=S.BOUNDS["contact_hours"][0], le=S.BOUNDS["contact_hours"][1])
    stale_hours: int = Field(ge=S.BOUNDS["stale_hours"][0], le=S.BOUNDS["stale_hours"][1])
    min_jobs: int = Field(ge=S.BOUNDS["min_jobs"][0], le=S.BOUNDS["min_jobs"][1])


@admin.put("")
async def admin_put(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    site = await get_site(db)
    before = S.settings_of(site)
    new = body.model_dump()
    if new != before:
        await save_site(db, {"trust.tth": new})
        await audit(
            db,
            auth.user.id,
            "trust.tth_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
        site = await get_site(db)
    return _out(site)
