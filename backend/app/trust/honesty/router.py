# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T9 endpoints (behind the Trust switch: 404 for people it is off for).

  GET /api/me/trust/honesty?kind=skill|interview&test=SQL    the pledge (version, texts in English / Hindi / Telugu) and,
                                                             with a test, my retake limits for it (allowed per period,
                                                             used, when the next attempt opens, what counts)
  Admin (settings permission to change; audited):
  GET /api/admin/trust/honesty                               the numbers, their bounds, the pledge texts
  PUT /api/admin/trust/honesty {skillAttempts, skillDays, interviewAttempts, interviewDays, refreshDays, explainOn,
                                explainQuestions}
The pledge is enforced by the skill check / practical task / interview start endpoints themselves (409 "pledge"), and
the limits by the same start endpoints (409 "too_soon").
"""

from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import DB, SKILL_ATTEMPTS, VETTING_INTERVIEWS
from app.core.schemas import CamelModel
from app.core.time import now
from app.site import get_site, save_site
from app.trust import access
from app.trust.honesty import pledge as P
from app.trust.honesty import retake as RK

me = APIRouter(prefix="/api/me/trust/honesty", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust/honesty", tags=["trust"])


@me.get("")
async def mine(
    db: DB, auth: CustomerAuth, kind: Literal["skill", "task", "interview"] = "skill", test: str = ""
) -> dict[str, Any]:
    uid, t = auth.user.id, now()
    out: dict[str, Any] = {"pledge": P.texts()}
    if test and kind in ("skill", "interview"):
        if kind == "skill":
            last = await db[SKILL_ATTEMPTS].find_one({"user_id": uid, "skill": test[:80]}, sort=[("started_at", -1)])
            out["retake"] = await RK.skill_status(db, uid, test[:80], t, last)
        else:
            last = await db[VETTING_INTERVIEWS].find_one({"user_id": uid, "test": test[:80]}, sort=[("started_at", -1)])
            out["retake"] = await RK.interview_status(db, uid, test[:80], t, last)
    return out


def _settings_out(s: dict[str, Any]) -> dict[str, Any]:
    return {
        "skillAttempts": s["skill_attempts"], "skillDays": s["skill_days"], "interviewAttempts": s["interview_attempts"],
        "interviewDays": s["interview_days"], "refreshDays": s["refresh_days"], "explainOn": s["explain_on"],
        "explainQuestions": s["explain_questions"],
        "bounds": {"attempts": list(RK.BOUNDS["skill_attempts"]), "days": list(RK.BOUNDS["skill_days"]), "refreshDays": list(RK.BOUNDS["refresh_days"]),
                   "explainQuestions": list(RK.BOUNDS["explain_questions"])},
        "counts": RK.COUNTS, "pledge": P.texts(),
    }  # fmt: skip


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    return _settings_out(RK.settings_of(await get_site(db)))


class SettingsIn(CamelModel):
    skill_attempts: int = Field(1, ge=1, le=3)
    skill_days: int = Field(30, ge=7, le=90)
    interview_attempts: int = Field(1, ge=1, le=3)
    interview_days: int = Field(30, ge=7, le=90)
    refresh_days: int = Field(7, ge=1, le=30)
    explain_on: bool = True
    explain_questions: int = Field(1, ge=1, le=2)


@admin.put("")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = RK.settings_of(await get_site(db))
    new = body.model_dump()
    if new != before:
        await save_site(db, {"trust.honesty": new})
        await audit(
            db,
            auth.user.id,
            "trust.honesty_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return _settings_out(RK.settings_of(await get_site(db)))
