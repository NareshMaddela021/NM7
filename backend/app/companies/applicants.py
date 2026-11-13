"""Applicants in the company dashboard (Phase 2, C5): people who applied on Nm7 to the company's jobs.

Signed in (header X-Recruiter-Account; any team role reads, main / full / posting admins act):
  GET  /api/company/{id}/applicants?job=          ranked: a fit first, best match score first, then newest; each with
                                                  the match reasons, the knockout label ("Not a fit" + why), answers,
                                                  stage and the talent-pool mark. Opening marks new ones Viewed.
  GET  /api/company/{id}/applicants/{app_id}      one applicant with the resume they applied with
  POST /api/company/{id}/applicants/{app_id}/status {status}     viewed / shortlisted / interview / offer / rejected
  POST /api/company/{id}/applicants/{app_id}/interview {date, time, minutes, place, link, notes, round, interviewer}
                                                  the student is emailed with a calendar file (.ics); stage Interview
  PUT  /api/company/{id}/applicants/{app_id}/pool {on, note}     the talent pool (people to call for later roles)
  GET  /api/company/{id}/pool                     the talent pool
Student:
  POST /api/me/applications/{key}/withdraw        takes back consent: the company no longer sees the application

Contact details follow the recruiter portal's rule: hidden until the company shortlists the person (then email and
phone show); ID numbers never. The student sees every stage change in My applications. A company sees an applicant
for 12 months after they applied (Admin → Settings & prices → Company limits); after that the automation pass removes
the application from the company's view, with the answers and talent-pool entry. The student's own record stays.
"""

from datetime import date, datetime, time, timedelta
from html import escape
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Query
from pydantic import Field, field_validator

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import POST
from app.companies.signup import company_for
from app.core import ics
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, DB, JOBS, RESUMES, TALENT_POOL, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.jobs import fit as fitmod
from app.jobs.apply import status_change
from app.me.service import ms
from app.orgs.recruiter import recruiter_data
from app.site import get_site

router = APIRouter(prefix="/api/company", tags=["company applicants"])
me = APIRouter(prefix="/api/me", tags=["company applicants"])

CONTACT_STAGES = ("shortlisted", "interview", "offer")
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"


def _oid(app_id: str) -> ObjectId:
    try:
        return ObjectId(app_id)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That applicant isn’t here.") from None


def _visible(cid: str) -> dict[str, Any]:
    return {"company_id": cid, "channel": "nm7", "company_removed_at": None}


async def _app(db, cid: str, app_id: str) -> dict[str, Any]:
    a = await db[APPLICATIONS].find_one({"_id": _oid(app_id), **_visible(cid)})
    if not a:
        raise ApiError(404, "not_found", "That applicant isn’t here.")
    from app.seek.support import hidden_users  # Phase 6 S9

    c = await db[COMPANIES].find_one({"_id": cid}, {"details": 1, "name": 1}) or {}
    if await hidden_users(db, c, [a["user_id"]]):
        raise ApiError(404, "not_found", "That applicant isn’t here.")
    return a


async def _resume_doc(db, a: dict[str, Any]) -> dict[str, Any] | None:
    if a.get("copy_id"):  # Auto Apply: the tailored copy exactly as it was sent
        from app.core.db import AUTO_COPIES

        c = await db[AUTO_COPIES].find_one({"_id": a["copy_id"]})
        if c:
            return {"key": c["from_key"], "data": c["data"], "_id": c["_id"], "updated_at": c["created_at"]}
    q = {"user_id": a["user_id"]}
    if a.get("resume_id"):
        r = await db[RESUMES].find_one({**q, "key": a["resume_id"]})
        if r:
            return r
    return await db[RESUMES].find_one({**q, "active": True}) or await db[RESUMES].find_one(q, sort=[("updated_at", -1)])


def _match(job: dict[str, Any] | None, r: dict[str, Any] | None) -> dict[str, Any] | None:
    if not job or not r:
        return None
    p = fitmod.Person(r)
    return fitmod.fit(job, p) if p.usable() else None


def _row(a, job, user, r, pooled: bool) -> dict[str, Any]:
    contact = a.get("status") in CONTACT_STAGES
    m = _match(job, r)
    questions = {q["id"]: q["text"] for q in (job or {}).get("questions") or []}
    return {
        "id": str(a["_id"]),
        "jobId": a["job_id"],
        "job": (job or {}).get("title", a.get("role", "")),
        "name": (user or {}).get("name", "") or "Applicant",
        "status": a.get("status"),
        "appliedAt": ms(a.get("created_at")),
        "resume": a.get("resume_name", ""),
        "origin": a.get("origin") or "manual",  # Auto Apply or by hand: companies always see which
        "irrelevant": bool(a.get("irrelevant_at")),
        "match": m
        and {k: m[k] for k in ("score", "found", "missing", "experience", "level", "years", "place", "city")},
        "fit": a.get("fit") or {"ok": True, "reasons": []},
        "answers": [{"q": questions.get(k, k), "a": v} for k, v in (a.get("answers") or {}).items()],
        "contact": _contact(user, r) if contact else None,
        "pooled": pooled,
        "interview": _iv_out(a.get("interview")),
        "feedback": (a.get("feedback") or {}).get("reasons") or [],  # Phase 6 S6: reasons given after Not selected
        "timeline": [{"status": s["status"], "at": ms(s["at"])} for s in a.get("timeline") or []],
    }


def _contact(user: dict[str, Any] | None, r: dict[str, Any] | None) -> dict[str, str]:
    personal = ((r or {}).get("data") or {}).get("personal") or {}
    return {"email": (user or {}).get("email", ""), "phone": str(personal.get("phone") or "")}


def _iv_out(iv: dict[str, Any] | None) -> dict[str, Any] | None:
    if not iv:
        return None
    return {
        "at": ms(iv["starts_at"]),
        "minutes": iv["minutes"],
        "place": iv["place"],
        "link": iv["link"],
        "notes": iv["notes"],
        "round": iv.get("round", ""),
        "interviewer": iv.get("interviewer", ""),
    }


def _rank(row: dict[str, Any]) -> tuple:
    return (not row["fit"]["ok"], -((row["match"] or {}).get("score") or -1), -(row["appliedAt"] or 0))


@router.get("/{cid}/applicants")
async def applicants(
    cid: str, db: DB, job: str = Query("", max_length=40), x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    jobs = {j["_id"]: j async for j in db[JOBS].find({"company_id": cid}, {"description": 0})}
    q = _visible(cid) | ({"job_id": job} if job else {})
    apps = await db[APPLICATIONS].find(q).sort("created_at", -1).to_list(500)
    from app.seek.support import hidden_users  # Phase 6 S9: "hide me from my current employer"

    hidden = await hidden_users(db, c, list({a["user_id"] for a in apps}))
    apps = [a for a in apps if a["user_id"] not in hidden]
    fresh = [a for a in apps if a.get("status") == "applied"]
    if fresh:  # anyone on the team opening the list counts as seen
        t = now()
        for a in fresh:
            await db[APPLICATIONS].update_one({"_id": a["_id"], "status": "applied"}, status_change(a, "viewed", t))
            a["status"] = "viewed"
            a.setdefault("timeline", []).append({"status": "viewed", "at": t})
        await audit(db, None, "company.applicants_viewed", target=cid, data={"by": acc["email_lc"], "n": len(fresh)})
    uids = list({a["user_id"] for a in apps})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "email": 1})}
    pooled = {p["user_id"] async for p in db[TALENT_POOL].find({"company_id": cid, "user_id": {"$in": uids}})}
    rows = []
    for a in apps:
        r = await _resume_doc(db, a)
        rows.append(_row(a, jobs.get(a["job_id"]), users.get(a["user_id"]), r, a["user_id"] in pooled))
    rows.sort(key=_rank)
    counts: dict[str, int] = {}
    async for a in db[APPLICATIONS].find(_visible(cid), {"job_id": 1}):
        counts[a["job_id"]] = counts.get(a["job_id"], 0) + 1
    return {
        "jobs": [
            {"id": j["_id"], "title": j["title"], "status": j["status"], "count": counts.get(j["_id"], 0)}
            for j in sorted(jobs.values(), key=lambda x: x.get("created_at") or now(), reverse=True)
        ],
        "items": rows,
        "keepMonths": int((await get_site(db))["companies"].get("applicant_months", 12)),
    }


@router.get("/{cid}/applicants/{app_id}")
async def applicant(cid: str, app_id: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, _, _ = await company_for(db, cid, x_recruiter_account)
    a = await _app(db, cid, app_id)
    job = await db[JOBS].find_one({"_id": a["job_id"]})
    user = await db[USERS].find_one({"_id": a["user_id"]}, {"name": 1, "email": 1})
    r = await _resume_doc(db, a)
    pooled = bool(await db[TALENT_POOL].find_one({"company_id": cid, "user_id": a["user_id"]}))
    out = _row(a, job, user, r, pooled)
    out["data"] = recruiter_data({"_data": r["data"]}, a.get("status") in CONTACT_STAGES) if r else None
    out["template"] = (r or {}).get("template") or "classic"
    await audit(db, None, "company.applicant_open", target=cid, data={"by": acc["email_lc"], "app": app_id})
    return out


class StageIn(CamelModel):
    status: Literal["viewed", "shortlisted", "interview", "offer", "rejected"]


@router.post("/{cid}/applicants/{app_id}/status")
async def set_stage(
    cid: str, app_id: str, body: StageIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    a = await _app(db, cid, app_id)
    change = status_change(a, body.status)
    if change:
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, change)
        await audit(
            db,
            None,
            "company.applicant_stage",
            target=cid,
            data={"by": acc["email_lc"], "app": app_id, "from": a.get("status"), "to": body.status},
        )
        from app.companies.trust import refresh

        await refresh(db, cid)  # replies count towards the score and the response badge
    return {"status": body.status}


class InterviewIn(CamelModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    minutes: int = Field(30, ge=10, le=240)
    place: str = Field("", max_length=200)
    link: str = Field("", max_length=300)
    notes: str = Field("", max_length=500)
    round: str = Field("", max_length=80)  # "Technical round 1", "HR round" (fix round item 39)
    interviewer: str = Field("", max_length=80)  # who the student will meet

    @field_validator("place", "notes", "round", "interviewer")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return v.strip()

    @field_validator("link")
    @classmethod
    def _link(cls, v: str) -> str:
        v = v.strip()
        if v and not v.startswith("https://"):
            raise ValueError("The online link must start with https://")
        return v


def _when(body: InterviewIn) -> datetime:
    try:
        d = date.fromisoformat(body.date)
        h, m = (int(x) for x in body.time.split(":"))
        t = datetime.combine(d, time(h, m), IST)
    except ValueError:
        raise ApiError(400, "bad_time", "Give the date and time like 2026-11-20 and 10:30.") from None
    if t < now() + timedelta(minutes=15) or t > now() + timedelta(days=90):
        raise ApiError(400, "bad_time", "Choose a time from 15 minutes from now up to 90 days ahead.")
    if not body.place and not body.link:
        raise ApiError(400, "where", "Add a place or an online link.")
    return t


def _ist(t: datetime) -> str:
    return t.astimezone(IST).strftime("%a %-d %b %Y, %-I:%M %p IST")


def interview_email(company: str, role: str, iv: dict[str, Any], to: str, name: str, app_id: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (name or "").split(" ")[0] or "there"
    lines = [
        f"Role: {role}",
        *([f"Round: {iv['round']}"] if iv.get("round") else []),
        f"When: {_ist(iv['starts_at'])} ({iv['minutes']} minutes)",
        *([f"With: {iv['interviewer']}"] if iv.get("interviewer") else []),
        *([f"Where: {iv['place']}"] if iv["place"] else []),
        *([f"Online: {iv['link']}"] if iv["link"] else []),
        *([f"Notes: {iv['notes']}"] if iv["notes"] else []),
    ]
    head = f"{company} invited you to an interview"
    text = "\n".join(
        [
            f"Hi {first},",
            "",
            head + ".",
            "",
            *lines,
            "",
            f"See it in My applications: {site}/me/jobs",
            "The calendar file is attached (Google Calendar, Outlook, Apple Calendar).",
            "",
            "Nm7 · nm7.si",
        ]
    )
    rows = "".join(f"<li>{escape(x)}</li>" for x in lines)
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p><b>{escape(head)}.</b></p><ul>{rows}</ul>'
        f'<p><a href="{escape(site)}/me/jobs">See it in My applications</a></p></div>'
    )
    cal = ics.event(
        uid=f"{app_id}@nm7.si",
        sequence=iv["seq"],
        start=iv["starts_at"],
        minutes=iv["minutes"],
        summary=f"Interview: {company} – {role}" + (f" ({iv['round']})" if iv.get("round") else ""),
        location=" · ".join(x for x in (iv["place"], iv["link"]) if x),
        description="\n".join(x for x in (f"{company} – {role}", iv["notes"], f"{site}/me/jobs") if x),
        url=iv["link"],
    )
    when = iv["starts_at"].astimezone(IST).strftime("%-d %b, %-I:%M %p")
    return Email(
        to=to,
        to_name=name,
        subject=f"Interview: {company} – {role}, {when}",
        text=text,
        html=html,
        attachments=[("interview.ics", "text/calendar", cal)],
    )


@router.post("/{cid}/applicants/{app_id}/interview")
async def schedule(
    cid: str, app_id: str, body: InterviewIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    a = await _app(db, cid, app_id)
    if a.get("status") == "rejected":
        raise ApiError(409, "rejected", "This applicant is marked Not selected.")
    old = a.get("interview") or {}
    iv = {
        "starts_at": _when(body),
        "minutes": body.minutes,
        "place": body.place,
        "link": body.link,
        "notes": body.notes,
        "round": body.round,
        "interviewer": body.interviewer,
        "seq": int(old.get("seq", -1)) + 1,
        "by": acc["email_lc"],
    }
    upd: dict[str, Any] = {"$set": {"interview": iv, "updated_at": now()}}
    change = status_change(a, "interview")
    if change:
        upd["$set"] |= change["$set"]
        upd["$push"] = change["$push"]
    await db[APPLICATIONS].update_one({"_id": a["_id"]}, upd)
    u = await db[USERS].find_one({"_id": a["user_id"]}, {"email": 1, "name": 1, "email_bounced": 1})
    sent = False
    if u and not u.get("email_bounced"):
        mail = interview_email(c["details"]["legal_name"], a.get("role", ""), iv, u["email"], u.get("name", ""), app_id)
        sent = await send_safely(mailer, mail)
    await audit(
        db,
        None,
        "company.interview",
        target=cid,
        data={"by": acc["email_lc"], "app": app_id, "at": iv["starts_at"].isoformat()},
    )
    return {"status": "interview", "interview": _iv_out(iv), "emailed": bool(sent)}


class PoolIn(CamelModel):
    on: bool
    note: str = Field("", max_length=200)


@router.put("/{cid}/applicants/{app_id}/pool")
async def pool_mark(
    cid: str, app_id: str, body: PoolIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    a = await _app(db, cid, app_id)
    key = {"company_id": cid, "user_id": a["user_id"]}
    if body.on:
        await db[TALENT_POOL].update_one(
            key,
            {
                "$set": {
                    "note": body.note.strip(),
                    "app_id": a["_id"],
                    "job_id": a["job_id"],
                    "applied_at": a["created_at"],
                },
                "$setOnInsert": {"at": now(), "by": acc["email_lc"]},
            },
            upsert=True,
        )
    else:
        await db[TALENT_POOL].delete_one(key)
    await audit(db, None, "company.pool", target=cid, data={"by": acc["email_lc"], "app": app_id, "on": body.on})
    return {"pooled": body.on}


@router.get("/{cid}/pool")
async def pool(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    rows = await db[TALENT_POOL].find({"company_id": cid}).sort("at", -1).to_list(500)
    apps = {
        a["_id"]: a async for a in db[APPLICATIONS].find({"_id": {"$in": [p["app_id"] for p in rows]}, **_visible(cid)})
    }
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [p["user_id"] for p in rows]}}, {"name": 1})}
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": [p["job_id"] for p in rows]}}, {"title": 1})}
    return [
        {
            "appId": str(p["app_id"]),
            "name": (users.get(p["user_id"]) or {}).get("name", "") or "Applicant",
            "job": (jobs.get(p["job_id"]) or {}).get("title", ""),
            "note": p.get("note", ""),
            "at": ms(p["at"]),
            "status": apps[p["app_id"]].get("status"),
        }
        for p in rows
        if p["app_id"] in apps
    ]


@me.post("/applications/{key}/withdraw")
async def withdraw(key: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[APPLICATIONS].find_one({"user_id": auth.user.id, "key": key[:40], "company_id": {"$exists": True}})
    if not a:
        raise ApiError(404, "not_found", "That application isn’t here.")
    t = now()
    await db[APPLICATIONS].update_one(
        {"_id": a["_id"]},
        {"$set": {"company_removed_at": t, "withdrawn_at": t, "answers": {}, "updated_at": t}},
    )
    await db[TALENT_POOL].delete_many({"company_id": a["company_id"], "user_id": auth.user.id})
    await audit(db, auth.user.id, "job.withdraw", target=a["job_id"], data={"company": a["company_id"]})
    return {"withdrawn": True}


async def remove_old(db, limit: int = 1000) -> int:
    """Once a day: applications older than the company's keep time (12 months) leave the company's view."""
    months = int((await get_site(db))["companies"].get("applicant_months", 12))
    cut = now() - timedelta(days=round(months * 30.44))
    rows = (
        await db[APPLICATIONS]
        .find(
            {"company_id": {"$exists": True}, "company_removed_at": None, "created_at": {"$lt": cut}},
            {"company_id": 1, "user_id": 1},
        )
        .limit(limit)
        .to_list(None)
    )
    if not rows:
        return 0
    t = now()
    await db[APPLICATIONS].update_many(
        {"_id": {"$in": [a["_id"] for a in rows]}}, {"$set": {"company_removed_at": t, "answers": {}}}
    )
    for a in rows:
        await db[TALENT_POOL].delete_many({"company_id": a["company_id"], "user_id": a["user_id"], "app_id": a["_id"]})
    return len(rows)
