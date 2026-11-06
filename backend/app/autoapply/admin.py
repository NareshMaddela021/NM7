"""Admin → Auto Apply (Phase 3, A7) and the company's "Not relevant" mark.

Admin (permission "jobs": Owner, Operations):
  GET  /api/admin/auto-apply?days=14          per day: applications Auto vs Manual by channel, emails sent / bounced /
                                              complaints / waiting for the cap; students on / paused; stuck items;
                                              company "Not relevant" marks; the run log with errors; the settings
  PUT  /api/admin/auto-apply/settings {...}   the off switch and every default (match score, daily limit and its
                                              maximum, preview days, company 30-day cap, trust threshold, borderline
                                              band, ATS gate, site email cap, marks before stopping)
  GET  /api/admin/auto-apply/users?q=         students with Auto Apply, their state and today's numbers
  POST /api/admin/auto-apply/users/{id}/pause {paused, reason}
  GET  /api/admin/auto-apply/companies        companies receiving auto applications, marks, paused or not
  POST /api/admin/auto-apply/companies/{id}/pause {paused, reason}
Company (signed in; main / full / posting admins):
  POST /api/company/{id}/applicants/{app_id}/irrelevant {on}   an auto application that doesn't fit; after 2 marks
                                              (setting) Auto Apply stops sending that student's applications there
Everything is in the activity log.
"""

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies.model import POST
from app.companies.signup import company_for
from app.core.db import APPLICATIONS, AUTO_ITEMS, AUTO_RUNS, COMPANIES, DB, EMAIL_BLOCKS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.service import ms
from app.site import get_site, save_site

router = APIRouter(prefix="/api/admin/auto-apply", tags=["auto apply admin"])
company = APIRouter(prefix="/api/company", tags=["auto apply"])


class SettingsIn(CamelModel):
    on: bool
    min_score: int = Field(ge=50, le=100)
    daily_limit: int = Field(ge=1, le=50)
    max_daily_limit: int = Field(ge=1, le=50)
    preview_days: int = Field(ge=0, le=30)
    company_cap: int = Field(ge=1, le=20)
    trust_min: int = Field(ge=0, le=100)
    borderline: int = Field(ge=0, le=30)
    ats_min: int = Field(ge=0, le=100)
    email_daily_cap: int = Field(ge=0, le=10_000)
    irrelevant_stop: int = Field(2, ge=1, le=20)


def _settings_out(d: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "on",
        "min_score",
        "daily_limit",
        "max_daily_limit",
        "preview_days",
        "company_cap",
        "trust_min",
        "borderline",
        "ats_min",
        "email_daily_cap",
        "irrelevant_stop",
    )
    camel = {k: "".join(w.capitalize() if i else w for i, w in enumerate(k.split("_"))) for k in keys}
    return {camel[k]: d.get(k, 2 if k == "irrelevant_stop" else None) for k in keys}


def _day(t: datetime) -> str:
    return t.astimezone(IST).date().isoformat()


@router.get("")
async def overview(db: DB, _: AdminAuth("jobs"), days: int = Query(14, ge=1, le=60)) -> dict[str, Any]:
    site = await get_site(db)
    start = datetime.combine(date.today() - timedelta(days=days - 1), time(0, 0), IST)
    per: dict[str, dict[str, Any]] = {}

    def row(d: str) -> dict[str, Any]:
        return per.setdefault(d, {"day": d, "auto": {}, "manual": {}, "sent": 0, "bounced": 0, "complained": 0})

    async for a in db[APPLICATIONS].find(
        {"created_at": {"$gte": start}, "job_id": {"$exists": True}}, {"created_at": 1, "origin": 1, "channel": 1}
    ):
        r = row(_day(a["created_at"]))
        side = r["auto" if a.get("origin") == "auto" else "manual"]
        side[a.get("channel") or "other"] = side.get(a.get("channel") or "other", 0) + 1
    async for it in db[AUTO_ITEMS].find(
        {"state": "sent", "applied_at": {"$gte": start}}, {"applied_at": 1, "delivery": 1}
    ):
        r = row(_day(it["applied_at"]))
        r["sent"] += 1
        if it.get("delivery") in ("bounced", "complained"):
            r[it["delivery"]] += 1
    runs = await db[AUTO_RUNS].find({}).sort("_id", -1).limit(days).to_list(None)
    marks = await db[APPLICATIONS].count_documents({"irrelevant_at": {"$ne": None}, "origin": "auto"})
    return {
        "settings": _settings_out(site["auto_apply"]),
        "days": sorted(per.values(), key=lambda x: x["day"], reverse=True),
        "students": {
            "on": await db[USERS].count_documents({"auto_apply.on": True, "auto_apply.admin_paused": {"$ne": True}}),
            "paused": await db[USERS].count_documents(
                {
                    "auto_apply.consent_at": {"$ne": None},
                    "$or": [{"auto_apply.on": False}, {"auto_apply.admin_paused": True}],
                }
            ),
        },
        "stuck": await db[AUTO_ITEMS].count_documents({"state": "needs_answer"}),
        "ready": await db[AUTO_ITEMS].count_documents({"state": "ready"}),
        "waitingCap": await db[AUTO_ITEMS].count_documents({"state": "queued", "reason": "email_cap"}),
        "emailBlocks": await db[EMAIL_BLOCKS].count_documents({}),
        "irrelevantMarks": marks,
        "runs": [
            {
                "day": r["_id"],
                "users": r.get("users", 0),
                "counts": r.get("counts") or {},
                "errors": [
                    {"user": e.get("user"), "error": e.get("error"), "at": ms(e.get("at"))}
                    for e in r.get("errors") or []
                ][-10:],
                "at": ms(r.get("updated_at") or r.get("started_at")),
            }
            for r in runs
        ],
    }


@router.put("/settings")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    if body.daily_limit > body.max_daily_limit:
        raise ApiError(400, "daily_limit", "The default daily limit can't be above the maximum.")
    before = (await get_site(db))["auto_apply"]
    new = body.model_dump()
    diff = {k: [before.get(k), v] for k, v in new.items() if before.get(k) != v}
    await save_site(db, {"auto_apply": {**before, **new}})
    if diff:
        await audit(db, auth.user.id, "auto_apply.admin_settings", data=diff, ip=client_ip(request))
    return _settings_out({**before, **new})


@router.get("/users")
async def users(db: DB, _: AdminAuth("jobs"), q: str = Query("", max_length=80)) -> list[dict[str, Any]]:
    import re

    query: dict[str, Any] = {"auto_apply.consent_at": {"$ne": None}}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"email": rx}, {"name": rx}]
    rows = await db[USERS].find(query, {"name": 1, "email": 1, "auto_apply": 1}).limit(100).to_list(None)
    out = []
    for u in rows:
        a = u.get("auto_apply") or {}
        out.append(
            {
                "id": u["_id"],
                "name": u.get("name", ""),
                "email": u.get("email", ""),
                "on": bool(a.get("on")),
                "adminPaused": bool(a.get("admin_paused")),
                "reason": a.get("admin_reason", ""),
                "applied": await db[APPLICATIONS].count_documents({"user_id": u["_id"], "origin": "auto"}),
                "stuck": await db[AUTO_ITEMS].count_documents({"user_id": u["_id"], "state": "needs_answer"}),
                "blockedCompanies": len(a.get("blocked_companies") or []),
            }
        )
    return out


class PauseIn(CamelModel):
    paused: bool
    reason: str = Field("", max_length=200)


@router.post("/users/{uid}/pause")
async def pause_user(uid: str, body: PauseIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[USERS].update_one(
        {"_id": uid, "auto_apply.consent_at": {"$ne": None}},
        {"$set": {"auto_apply.admin_paused": body.paused, "auto_apply.admin_reason": body.reason.strip()}},
    )
    if not r.matched_count:
        raise ApiError(404, "not_found", "This student hasn’t set up Auto Apply.")
    await audit(
        db,
        auth.user.id,
        "auto_apply.admin_pause_user" if body.paused else "auto_apply.admin_resume_user",
        target=uid,
        data={"reason": body.reason.strip()},
        ip=client_ip(request),
    )
    return {"paused": body.paused}


@router.get("/companies")
async def companies(db: DB, _: AdminAuth("jobs")) -> list[dict[str, Any]]:
    cids = await db[APPLICATIONS].distinct("company_id", {"origin": "auto", "company_id": {"$ne": None}})
    paused = await db[COMPANIES].distinct("_id", {"auto_paused": True})
    out = []
    async for c in db[COMPANIES].find({"_id": {"$in": list({*cids, *paused})}}, {"details": 1, "auto_paused": 1}):
        out.append(
            {
                "id": c["_id"],
                "name": (c.get("details") or {}).get("legal_name", ""),
                "paused": bool(c.get("auto_paused")),
                "auto": await db[APPLICATIONS].count_documents({"company_id": c["_id"], "origin": "auto"}),
                "marks": await db[APPLICATIONS].count_documents(
                    {"company_id": c["_id"], "origin": "auto", "irrelevant_at": {"$ne": None}}
                ),
            }
        )
    return sorted(out, key=lambda x: (-x["marks"], -x["auto"]))


@router.post("/companies/{cid}/pause")
async def pause_company(cid: str, body: PauseIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[COMPANIES].update_one(
        {"_id": cid}, {"$set": {"auto_paused": body.paused, "auto_paused_reason": body.reason.strip()}}
    )
    if not r.matched_count:
        raise ApiError(404, "not_found", "No such company.")
    await audit(
        db,
        auth.user.id,
        "auto_apply.admin_pause_company" if body.paused else "auto_apply.admin_resume_company",
        target=cid,
        data={"reason": body.reason.strip()},
        ip=client_ip(request),
    )
    return {"paused": body.paused}


# ---------- the company's "Not relevant" mark ----------


class MarkIn(CamelModel):
    on: bool = True


@company.post("/{cid}/applicants/{app_id}/irrelevant")
async def irrelevant(
    cid: str, app_id: str, body: MarkIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    from bson import ObjectId
    from bson.errors import InvalidId

    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    try:
        oid = ObjectId(app_id)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That applicant isn’t here.") from None
    a = await db[APPLICATIONS].find_one({"_id": oid, "company_id": cid, "company_removed_at": None})
    if not a:
        raise ApiError(404, "not_found", "That applicant isn’t here.")
    if a.get("origin") != "auto":
        raise ApiError(409, "manual", "Only applications sent by Auto Apply can be marked.")
    await db[APPLICATIONS].update_one(
        {"_id": oid}, {"$set": {"irrelevant_at": now() if body.on else None, "irrelevant_by": acc["email_lc"]}}
    )
    marks = await db[APPLICATIONS].count_documents(
        {"user_id": a["user_id"], "company_id": cid, "origin": "auto", "irrelevant_at": {"$ne": None}}
    )
    stop = int((await get_site(db))["auto_apply"].get("irrelevant_stop", 2))
    stopped = False
    if body.on and marks >= stop:
        await db[USERS].update_one({"_id": a["user_id"]}, {"$addToSet": {"auto_apply.blocked_companies": cid}})
        stopped = True
    await audit(
        db,
        None,
        "company.auto_irrelevant",
        target=cid,
        data={"by": acc["email_lc"], "app": app_id, "on": body.on, "marks": marks, "stopped": stopped},
    )
    return {"irrelevant": body.on, "marks": marks, "stopped": stopped}
