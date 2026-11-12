"""H7 Bulk hiring mode (Phase 5): one post for 20–500 openings, with batch actions, a walk-in drive and a progress
board.

Company (header X-Recruiter-Account; main / full / posting admins act):
  PUT  /api/company/{cid}/hire/bulk/{job} {on, openings}      bulk hiring for this job (a paid company feature:
                                                              Admin → Plans → Company hiring, open by default)
  GET  /api/company/{cid}/hire/bulk/{job}/board               the progress board (counts, % filled)
  POST /api/company/{cid}/hire/bulk/{job}/status {people, status}   move many applications at once
  POST /api/company/{cid}/hire/bulk/{job}/offers {people, salary, joinDate, place, notes, respondDays}
  GET  /api/company/{cid}/hire/bulk/{job}/csv                 everyone in the pipeline (contact only where shared)
  POST /api/company/{cid}/hire/bulk/{job}/walkin {date, time, place}   a walk-in drive day with its own QR link
  GET  /api/company/{cid}/hire/bulk/{job}/walkin              the walk-in drive and who checked in
Candidate (signed in):
  GET  /api/hire/walkin/{token}                               the drive (company, role, date, place)
  POST /api/hire/walkin/{token}/checkin {consent}             "I'm here": checks in and shares the profile with the
                                                              company (the box is needed); the company sees them in
                                                              Applicants at Shortlisted

With bulk on, the instant shortlist shows up to 100 people and invites go out up to 100 at a time (H2).
"""

import csv
import io
import secrets
from datetime import date, datetime, time, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Header, Response
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import POST, trust_of
from app.companies.signup import company_for
from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    DB,
    HIRE_INVITES,
    HIRE_OFFERS,
    HIRE_SLOTS,
    HIRE_WALKINS,
    JOBS,
    RESUMES,
    USERS,
)
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.hire import offers as offers_mod
from app.hire.shortlist import gate
from app.jobs.apply import FOLLOW_AFTER, app_key, job_page, status_change
from app.me.service import ms

company = APIRouter(prefix="/api/company", tags=["hire in 30 minutes"])
walkin_public = APIRouter(prefix="/api/hire/walkin", tags=["hire in 30 minutes"])

MAX_BATCH = 500


async def _job(db, cid: str, job_id: str, session: str | None, roles=None) -> tuple[dict, dict, dict]:
    acc, c, _ = await company_for(db, cid, session, roles)
    j = await db[JOBS].find_one({"_id": job_id, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "That job isn’t one of yours.")
    return acc, c, j


async def _bulk_job(db, cid: str, job_id: str, session: str | None, roles=None) -> tuple[dict, dict, dict]:
    acc, c, j = await _job(db, cid, job_id, session, roles)
    if not (j.get("hire_bulk") or {}).get("on"):
        raise ApiError(409, "not_bulk", "Turn on bulk hiring for this job first.")
    return acc, c, j


class BulkIn(CamelModel):
    on: bool
    openings: int = Field(20, ge=20, le=500)


@company.put("/{cid}/hire/bulk/{job_id}")
async def set_bulk(cid: str, job_id: str, body: BulkIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict:
    acc, c, j = await _job(db, cid, job_id, x_recruiter_account, POST)
    if body.on:
        if trust_of(c) != "verified":
            raise ApiError(403, "verified_only", "Bulk hiring is for Verified companies.")
        if not await gate(db, c, "bulk"):
            raise ApiError(402, "plan", "Bulk hiring isn’t turned on for your company. Ask Nm7 to turn it on.")
    hb = {"on": body.on, "openings": body.openings, "updated_at": now()}
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"hire_bulk": hb}})
    await audit(db, None, "hire.bulk", target=cid, data={"by": acc["email_lc"], "job": job_id, **body.model_dump()})
    return {"on": body.on, "openings": body.openings}


async def board(db, cid: str, j: dict[str, Any]) -> dict[str, Any]:
    jid = j["_id"]
    count = lambda coll, q: db[coll].count_documents({"job_id": jid, **q})  # noqa: E731
    stages = {}
    async for a in db[APPLICATIONS].find({"job_id": jid, "company_id": cid, "company_removed_at": None}, {"status": 1}):
        stages[a["status"]] = stages.get(a["status"], 0) + 1
    joined = await count(HIRE_OFFERS, {"status": "joined"})
    openings = int((j.get("hire_bulk") or {}).get("openings") or 0)
    w = await db[HIRE_WALKINS].find_one({"company_id": cid, "job_id": jid})
    return {
        "openings": openings,
        "invited": await count(HIRE_INVITES, {}),
        "accepted": await count(HIRE_INVITES, {"status": "accepted"}),
        "applicants": sum(stages.values()),
        "stages": stages,
        "interviewsBooked": await count(HIRE_SLOTS, {"status": "booked"}),
        "attended": await count(HIRE_SLOTS, {"mark": "attended"}),
        "offersSent": await count(HIRE_OFFERS, {"status": {"$ne": "withdrawn"}}),
        "offersAccepted": await count(HIRE_OFFERS, {"status": {"$in": ["accepted", "joined"]}}),
        "joined": joined,
        "checkedIn": len((w or {}).get("checkins") or []),
        "filledPct": round(100 * joined / openings) if openings else 0,
    }


@company.get("/{cid}/hire/bulk/{job_id}/board")
async def get_board(cid: str, job_id: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, _, j = await _bulk_job(db, cid, job_id, x_recruiter_account)
    return await board(db, cid, j)


class StatusIn(CamelModel):
    people: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    status: Literal["viewed", "shortlisted", "interview", "offer", "rejected"]


@company.post("/{cid}/hire/bulk/{job_id}/status")
async def batch_status(
    cid: str, job_id: str, body: StatusIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict:
    acc, _, j = await _bulk_job(db, cid, job_id, x_recruiter_account, POST)
    t = now()
    moved = 0
    async for a in db[APPLICATIONS].find({"job_id": j["_id"], "company_id": cid, "user_id": {"$in": body.people},
                                          "company_removed_at": None}):  # fmt: skip
        change = status_change(a, body.status, t)
        if change:
            await db[APPLICATIONS].update_one({"_id": a["_id"]}, change)
            moved += 1
    await audit(db, None, "hire.bulk_status", target=cid, data={"by": acc["email_lc"], "job": job_id, "n": moved,
                                                                "status": body.status})  # fmt: skip
    return {"moved": moved}


class BatchOfferIn(CamelModel):
    people: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    salary: offers_mod.SalaryIn
    join_date: str = Field(min_length=10, max_length=10)
    place: str = Field("", max_length=120)
    notes: str = Field("", max_length=1000)
    respond_days: int = Field(3, ge=1, le=14)


@company.post("/{cid}/hire/bulk/{job_id}/offers")
async def batch_offers(
    cid: str, job_id: str, body: BatchOfferIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    await _bulk_job(db, cid, job_id, x_recruiter_account, POST)
    sent, skipped = 0, []
    for p in dict.fromkeys(body.people):
        one = offers_mod.OfferIn(job=job_id, person=p, salary=body.salary, join_date=body.join_date, place=body.place,
                                 notes=body.notes, respond_days=body.respond_days)  # fmt: skip
        try:
            await offers_mod.send_offer(cid, one, db, mailer, x_recruiter_account)
            sent += 1
        except ApiError as e:
            skipped.append({"person": p, "why": e.code})
    return {"sent": sent, "skipped": skipped}


@company.get("/{cid}/hire/bulk/{job_id}/csv")
async def export_csv(cid: str, job_id: str, db: DB, x_recruiter_account: str | None = Header(None)) -> Response:
    acc, _, j = await _bulk_job(db, cid, job_id, x_recruiter_account)
    apps = (
        await db[APPLICATIONS].find({"job_id": j["_id"], "company_id": cid, "company_removed_at": None}).to_list(5000)
    )
    uids = [a["user_id"] for a in apps]
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "email": 1})}
    offers = {o["user_id"]: o async for o in db[HIRE_OFFERS].find({"job_id": j["_id"], "status": {"$ne": "withdrawn"}})}
    slots = {s["user_id"]: s async for s in db[HIRE_SLOTS].find({"job_id": j["_id"], "status": "booked"})}
    w = await db[HIRE_WALKINS].find_one({"company_id": cid, "job_id": j["_id"]}) or {}
    checked = {x["user_id"] for x in w.get("checkins") or []}
    out = io.StringIO()
    wr = csv.writer(out)
    wr.writerow(
        ["Name", "Stage", "Email", "Phone", "Interview (IST)", "Attended", "Offer", "Joined", "Walk-in check-in"]
    )
    for a in apps:
        u = users.get(a["user_id"]) or {}
        shared = a.get("status") in ("shortlisted", "interview", "offer")
        phone = ""
        if shared:
            r = await db[RESUMES].find_one({"user_id": a["user_id"], "active": True}, {"data.personal.phone": 1})
            phone = str((((r or {}).get("data") or {}).get("personal") or {}).get("phone") or "")
        s = slots.get(a["user_id"])
        o = offers.get(a["user_id"]) or {}
        name = u.get("name", "")
        wr.writerow([
            ("'" + name) if name[:1] in "=+-@" else name, a.get("status", ""), u.get("email", "") if shared else "",
            phone, s["starts_at"].astimezone(IST).strftime("%Y-%m-%d %H:%M") if s else "", (s or {}).get("mark", ""),
            o.get("status", ""), "yes" if o.get("status") == "joined" else "", "yes" if a["user_id"] in checked else "",
        ])  # fmt: skip
    await audit(db, None, "hire.bulk_csv", target=cid, data={"by": acc["email_lc"], "job": job_id, "n": len(apps)})
    return Response("﻿" + out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="hiring-{job_id}.csv"'})  # fmt: skip


class WalkinIn(CamelModel):
    date: str = Field(min_length=10, max_length=10)
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    place: str = Field(min_length=3, max_length=200)


def walkin_out(w: dict[str, Any], names: dict[str, str] | None = None) -> dict[str, Any]:
    return {"token": w["_id"], "at": ms(w["starts_at"]), "place": w["place"], "path": f"/hire/walkin/{w['_id']}",
            "checkins": [{"name": (names or {}).get(x["user_id"], ""), "at": ms(x["at"])}
                         for x in w.get("checkins") or []]}  # fmt: skip


@company.post("/{cid}/hire/bulk/{job_id}/walkin", status_code=201)
async def make_walkin(
    cid: str, job_id: str, body: WalkinIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict:
    acc, _, j = await _bulk_job(db, cid, job_id, x_recruiter_account, POST)
    try:
        h, m = (int(x) for x in body.time.split(":"))
        at = datetime.combine(date.fromisoformat(body.date), time(h, m), IST)
    except ValueError:
        raise ApiError(400, "bad_time", "Give the date and time like 2026-11-20 and 10:00.") from None
    if at < now() - timedelta(hours=12) or at > now() + timedelta(days=90):
        raise ApiError(400, "bad_time", "Pick a day from today up to 90 days ahead.")
    old = await db[HIRE_WALKINS].find_one({"company_id": cid, "job_id": j["_id"]})
    sets = {"starts_at": at, "place": body.place.strip(), "updated_at": now()}
    if old:
        await db[HIRE_WALKINS].update_one({"_id": old["_id"]}, {"$set": sets})
        w = {**old, **sets}
    else:
        w = {"_id": secrets.token_urlsafe(12), "company_id": cid, "job_id": j["_id"], "checkins": [], **sets,
             "created_at": now(), "by": acc["email_lc"]}  # fmt: skip
        await db[HIRE_WALKINS].insert_one(w)
    return walkin_out(w)


@company.get("/{cid}/hire/bulk/{job_id}/walkin")
async def get_walkin(cid: str, job_id: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict | None:
    _, _, j = await _bulk_job(db, cid, job_id, x_recruiter_account)
    w = await db[HIRE_WALKINS].find_one({"company_id": cid, "job_id": j["_id"]})
    if not w:
        return None
    ids = [x["user_id"] for x in w.get("checkins") or []]
    names = {u["_id"]: u.get("name", "") async for u in db[USERS].find({"_id": {"$in": ids}}, {"name": 1})}
    return walkin_out(w, names)


async def _walkin(db, token: str) -> tuple[dict, dict, dict]:
    w = await db[HIRE_WALKINS].find_one({"_id": token[:40]})
    j = w and await db[JOBS].find_one({"_id": w["job_id"]})
    c = w and await db[COMPANIES].find_one({"_id": w["company_id"]}, {"details.legal_name": 1})
    if not w or not j or not c:
        raise ApiError(404, "not_found", "This walk-in link isn’t right. Ask the desk for the QR code.")
    return w, j, c


@walkin_public.get("/{token}")
async def walkin_info(token: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    w, j, c = await _walkin(db, token)
    return {"company": c["details"]["legal_name"], "role": j["title"], "at": ms(w["starts_at"]), "place": w["place"],
            "checkedIn": any(x["user_id"] == auth.user.id for x in w.get("checkins") or [])}  # fmt: skip


class CheckinIn(CamelModel):
    consent: bool = False


@walkin_public.post("/{token}/checkin")
async def walkin_checkin(token: str, body: CheckinIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    w, j, c = await _walkin(db, token)
    if not body.consent:
        raise ApiError(400, "consent", f"Tick the box to share your profile with {c['details']['legal_name']}.")
    uid = auth.user.id
    t = now()
    if not any(x["user_id"] == uid for x in w.get("checkins") or []):
        await db[HIRE_WALKINS].update_one({"_id": w["_id"], "checkins.user_id": {"$ne": uid}},
                                          {"$push": {"checkins": {"user_id": uid, "at": t}}})  # fmt: skip
    key = app_key(j["_id"])
    a = await db[APPLICATIONS].find_one({"user_id": uid, "key": key})
    if a:
        change = status_change(a, "shortlisted", t) if a.get("status") in ("applied", "viewed") else {}
        upd = change or {"$set": {}}
        upd["$set"] |= {"company_removed_at": None, "consent_at": a.get("consent_at") or t}
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, upd)
    else:
        r = await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
            {"user_id": uid}, sort=[("updated_at", -1)]
        )
        await db[APPLICATIONS].insert_one({
            "key": key, "user_id": uid, "company": j["company"]["name"][:120], "role": j["title"][:120],
            "status": "shortlisted", "date": int(t.timestamp() * 1000), "resume_id": (r or {}).get("key"),
            "resume_name": (r or {}).get("name", ""), "url": job_page(j), "notes": "",
            "next": int((t + FOLLOW_AFTER).timestamp() * 1000), "job_id": j["_id"], "channel": "nm7",
            "origin": "walkin", "company_id": w["company_id"], "consent_at": t, "answers": {},
            "fit": {"ok": True, "reasons": []},
            "timeline": [{"status": "shortlisted", "at": t}], "created_at": t, "updated_at": t,
        })  # fmt: skip
    await audit(db, uid, "hire.walkin_checkin", target=w["company_id"], data={"job": j["_id"]})
    return {"ok": True, "company": c["details"]["legal_name"], "role": j["title"]}
