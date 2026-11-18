# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T12 endpoints.

Company (only where the Trust switch lets the company in; else 404):
  POST /api/company/{cid}/trust/fairness/check {text, where}   refused phrases and proxy warnings, with why and a
                                                               neutral alternative (logged as "shown")
  POST /api/company/{cid}/trust/fairness/ack {where, findings} the company keeps a warned filter (logged "override")
Admin (read: jobs; change: settings; audited):
  GET  /api/admin/trust/fairness                 blind grading (where it applies), re-grades (settings, last run,
                                                 alerts, the latest disagreements), the pass-rate gap report (latest
                                                 weekly snapshot) and the unfair-filter counts
  PUT  /api/admin/trust/fairness {regrade, report}
  POST /api/admin/trust/fairness/regrade/run     a re-grade pass now (ignores the week; still capped)
  POST /api/admin/trust/fairness/report/run      a pass-rate snapshot now
  POST /api/admin/trust/fairness/regrades/{id}/decide {decision: keep | second}   a T9 label a person decides
"""

from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies.signup import company_for
from app.core.db import DB, TRUST_FAIRNESS, TRUST_REGRADES, TRUST_RUNS, VETTING_INTERVIEWS, VETTING_QUEUE
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust import retention as R
from app.trust.fairness import blind as B
from app.trust.fairness import filters as F
from app.trust.fairness import regrade as RG
from app.trust.fairness import report as RP

company = APIRouter(prefix="/api/company", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/fairness", tags=["trust"])

R.register(R.DataType("regrades", "Second-opinion re-grades of AI-graded answers (the two grades, no answer text)", 365, 90, 730,
                      TRUST_REGRADES, field="at", note="Deleted by the daily job; a material change waits for a person"))  # fmt: skip


async def _company(db, cid: str, hdr: str | None) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, hdr)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return c


class CheckIn(CamelModel):
    text: str = Field("", max_length=20000)
    where: Literal["job", "question", "criteria", "hire_filter"] = "job"


@company.post("/{cid}/trust/fairness/check")
async def check(cid: str, body: CheckIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await _company(db, cid, x_recruiter_account)
    fs = F.check_text(body.text)
    await F.log(db, cid, body.where, fs, "shown")
    return {"findings": F.out(fs), "refused": bool(F.refused(fs))}


class FindingIn(CamelModel):
    topic: str = Field(max_length=20)
    level: Literal["refuse", "warn"] = "warn"
    phrase: str = Field("", max_length=120)


class AckIn(CamelModel):
    where: Literal["job", "question", "criteria", "hire_filter"]
    findings: list[FindingIn] = Field(min_length=1, max_length=10)


@company.post("/{cid}/trust/fairness/ack")
async def ack(cid: str, body: AckIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await _company(db, cid, x_recruiter_account)
    warn = [f.model_dump() for f in body.findings if f.level == "warn" and f.topic in F.LABEL]
    return {"logged": await F.log(db, cid, body.where, warn, "override")}


# --- admin -------------------------------------------------------------------------------------------------------------


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That re-grade isn’t here.") from None


async def _open(db, r: dict[str, Any]) -> bool | None:
    """Still waiting for a person? (V2: the Review queue item; V3: the bias check; T9: here.)"""
    if not r.get("material"):
        return None
    if r["kind"] == "v2":
        return bool(
            await db[VETTING_QUEUE].find_one(
                {"kind": "review", "attempt_id": ObjectId(r["ref"]), "status": "open"}, {"_id": 1}
            )
        )
    if r["kind"] == "v3":
        iv = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(r["ref"])}, {"bias": 1}) or {}
        return not (iv.get("bias") or {}).get("done")
    return r.get("status") == "review"


async def admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    last = await db[TRUST_RUNS].find_one({"_id": "fairness_regrade"}) or {}
    rows = await db[TRUST_REGRADES].find({"material": True}).sort("at", -1).limit(30).to_list(30)
    counts = {k: await db[TRUST_REGRADES].count_documents({"kind": k}) for k in RG.KINDS}
    snap = await db[TRUST_FAIRNESS].find({}).sort("at", -1).limit(1).to_list(1)
    s = snap[0] if snap else None
    return {
        "public": await access.is_public(db),
        "blind": [{"site": k, **v} for k, v in B.BLIND.items()],
        "regrade": {"settings": RG.settings_of(site), "bounds": RG.BOUNDS, "lastAt": ms(last.get("at")), "last": last.get("last") or {},
                    "usedThisWeek": int(last.get("used") or 0), "alerts": await RG.alerts(db), "counts": counts,
                    "review": [RG.item_out(r, await _open(db, r)) for r in rows]},
        "report": {"settings": RP.settings_of(site), "bounds": RP.BOUNDS, "dimensions": RP.DIMENSIONS,
                   "snapshot": {**{k: v for k, v in s.items() if k not in ("_id", "at")}, "week": s["_id"], "at": ms(s.get("at"))} if s else None},
        "filters": await RP.filter_counts(db),
        "regradeDays": R.days_for(site, "regrades"),
    }  # fmt: skip


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    return await admin_out(db)


class RegradeIn(CamelModel):
    sample: int = Field(ge=RG.BOUNDS["sample"][0], le=RG.BOUNDS["sample"][1])
    cap: int = Field(ge=RG.BOUNDS["cap"][0], le=RG.BOUNDS["cap"][1])
    gap: int = Field(ge=RG.BOUNDS["gap"][0], le=RG.BOUNDS["gap"][1])
    alert_share: int = Field(ge=RG.BOUNDS["alert_share"][0], le=RG.BOUNDS["alert_share"][1])
    alert_min: int = Field(ge=RG.BOUNDS["alert_min"][0], le=RG.BOUNDS["alert_min"][1])


class ReportIn(CamelModel):
    min_n: int = Field(ge=RP.BOUNDS["min_n"][0], le=RP.BOUNDS["min_n"][1])
    days: int = Field(ge=RP.BOUNDS["days"][0], le=RP.BOUNDS["days"][1])


class SettingsIn(CamelModel):
    regrade: RegradeIn
    report: ReportIn


@admin.put("")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    site = await get_site(db)
    before = {"regrade": RG.settings_of(site), "report": RP.settings_of(site)}
    new = {"regrade": body.regrade.model_dump(), "report": body.report.model_dump()}
    if new != before:
        await save_site(db, {"trust.fairness": new})
        await audit(
            db,
            auth.user.id,
            "trust.fairness_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await admin_out(db)


@admin.post("/regrade/run")
async def regrade_run(db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    got = await RG.run(db, force=True)
    if not got:
        raise ApiError(429, "busy", "Another background job is running. Try again in a minute.")
    await audit(db, auth.user.id, "trust.fairness_regrade_run", data=got)
    return {"counts": got, **(await admin_out(db))}


@admin.post("/report/run")
async def report_run(db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    doc = await RP.snapshot(db)
    await audit(db, auth.user.id, "trust.fairness_report_run", data={"flags": len(doc["flags"])})
    return await admin_out(db)


class DecideIn(CamelModel):
    decision: Literal["keep", "second"]


@admin.post("/regrades/{rid}/decide")
async def decide(rid: str, body: DecideIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[TRUST_REGRADES].find_one({"_id": _oid(rid)})
    if not r or r["kind"] != "t9" or r.get("status") != "review":
        raise ApiError(404, "not_found", "That re-grade isn’t waiting for a person.")
    t = now()
    if body.decision == "second":
        from app.trust.honesty.explain import LABEL_TEXT

        iv = await db[VETTING_INTERVIEWS].find_one({"_id": ObjectId(r["ref"])}, {"explain": 1})
        if iv and iv.get("explain"):
            await db[VETTING_INTERVIEWS].update_one({"_id": iv["_id"]}, {"$set": {
                "explain.label": r["second"], "explain.by": "admin", "explain.first_label": iv["explain"].get("label"),
                "explain.reason": f"{LABEL_TEXT[r['second']]}: changed after a second check by our team."}})  # fmt: skip
    await db[TRUST_REGRADES].update_one({"_id": r["_id"]}, {"$set": {"status": "changed" if body.decision == "second" else "kept",
                                                                     "decided_by": auth.user.id, "decided_at": t}})  # fmt: skip
    await audit(db, auth.user.id, "trust.fairness_regrade_decide", target=rid, data={"decision": body.decision})
    return await admin_out(db)
