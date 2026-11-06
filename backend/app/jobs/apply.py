"""Manual Apply and My applications (job board J5).

  POST /api/jobs/{job_id}/apply {resumeId?}       a signed-in person applies (free). By the job's apply method:
      nm7    one tap: the application is saved and the company / admin sees it (Admin → Jobs → Applications)
      link   saved as "Applied (outside Nm7)" with the resume used; the page then opens the company's link
      email  saved, and the answer carries the address, a subject and a short letter for a mailto draft
  PUT /api/me/job-followups {on}                  follow-up reminder emails on / off
  POST /api/public/jobs/stop-followups {token}    the "Stop these emails" link (no sign-in)

An application is the person's tracker entry (applications collection, key "j<job id>"), with a timeline:
Applied → Viewed (Nm7 jobs: when the admin opens the list) → Shortlisted → Interview → Offer / Rejected. Nm7
applications move only by the admin; the person moves their outside ones (PATCH /api/me/applications/{key}).

Seven days after applying, while still Applied or Viewed, the person gets one reminder to follow up: in the app (the
"Follow up?" mark on My applications) and by email, at most one email a day listing every one that is due, never to
an unconfirmed or bounced address, and never after "Stop these emails" or the switch in settings.
"""

import logging
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import APPLICATIONS, DB, JOBS, LOCKS, RESUMES, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now

log = logging.getLogger("nm7.jobs")

router = APIRouter(prefix="/api/jobs", tags=["job board"])
me_router = APIRouter(prefix="/api/me", tags=["job board"])
public = APIRouter(prefix="/api/public/jobs", tags=["job board"])

STATUSES = ("applied", "viewed", "shortlisted", "interview", "offer", "rejected")  # the job-board timeline
FOLLOW_AFTER = timedelta(days=7)
BATCH = 500
UNSUB_RULES = [(30, timedelta(hours=1))]
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"


def app_key(job_id: str) -> str:
    return "j" + job_id.replace("-", "")[:39]


def job_page(j: dict[str, Any]) -> str:
    return f"{get_settings().site_url.rstrip('/')}/jobs/{j['slug']}"


class ApplyIn(CamelModel):
    resume_id: str | None = Field(None, max_length=40)


async def _resume(db, user_id: str, key: str | None) -> dict[str, Any] | None:
    if key:
        r = await db[RESUMES].find_one({"user_id": user_id, "key": key}, {"key": 1, "name": 1})
        if not r:
            raise ApiError(404, "resume_not_found", "Pick one of your resumes.")
        return r
    return await db[RESUMES].find_one({"user_id": user_id, "active": True}, {"key": 1, "name": 1}) or await db[
        RESUMES
    ].find_one({"user_id": user_id}, {"key": 1, "name": 1}, sort=[("updated_at", -1)])


def _letter(j: dict[str, Any], name: str) -> dict[str, str]:
    title, company = j["title"], j["company"]["name"]
    body = (
        f"Dear Hiring Team,\n\nI would like to apply for the {title} role at {company} that I found on Nm7 "
        f"({job_page(j)}).\n\nI have attached my resume. I would be glad to talk about how I can help your team.\n\n"
        f"Thank you for your time.\n\n{name}"
    )
    return {"to": j["apply"].get("email") or "", "subject": f"Application for {title}", "body": body}


@router.post("/{job_id}/apply", status_code=201)
async def apply(job_id: str, body: ApplyIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": job_id, "demo": {"$ne": True}})
    if not j:
        raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
    if j["status"] != "active" or (j.get("closes_at") and j["closes_at"] <= now()):
        raise ApiError(409, "closed", "This job is closed and no longer takes applications.")
    uid = auth.user.id
    resume = await _resume(db, uid, body.resume_id)
    method = j["apply"]["method"]
    t = now()
    key = app_key(job_id)
    doc = {
        "key": key,
        "user_id": uid,
        "company": j["company"]["name"][:120],
        "role": j["title"][:120],
        "status": "applied",
        "date": int(t.timestamp() * 1000),
        "resume_id": resume["key"] if resume else None,
        "resume_name": resume.get("name", "") if resume else "",
        "url": job_page(j),
        "notes": "",
        "next": int((t + FOLLOW_AFTER).timestamp() * 1000),
        "job_id": job_id,
        "channel": method,
        "timeline": [{"status": "applied", "at": t}],
        "created_at": t,
        "updated_at": t,
    }
    try:
        await db[APPLICATIONS].insert_one(doc)
        created = True
    except DuplicateKeyError:
        doc = await db[APPLICATIONS].find_one({"user_id": uid, "key": key})
        created = False
    out: dict[str, Any] = {"application": {"id": key, "status": doc["status"], "channel": doc.get("channel", method)},
                           "created": created, "method": method}  # fmt: skip
    if method == "link":
        out["url"] = j["apply"].get("url") or ""
    elif method == "email":
        out["email"] = _letter(j, auth.user.name or "")
    if created:
        await audit(db, uid, "job.apply", target=job_id, data={"method": method, "title": j["title"]})
    return out


# ---------- the timeline ----------


def status_change(old: dict[str, Any], status: str, t=None) -> dict[str, Any]:
    """The $set / $push for moving one application to a new status (nothing when it is already there)."""
    if old.get("status") == status:
        return {}
    t = t or now()
    return {"$set": {"status": status, "updated_at": t}, "$push": {"timeline": {"status": status, "at": t}}}


# ---------- follow-up reminders ----------


def followups_on(user: dict[str, Any]) -> bool:
    return ((user.get("notify") or {}).get("email") or {}).get("followups", True) is not False


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('followup-unsub', user_id)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("followup-unsub", uid)[:32]) else None


class OnIn(CamelModel):
    on: bool


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@me_router.get("/job-followups")
async def get_followups(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": auth.user.id}, {"notify": 1}) or {}
    return {"on": followups_on(u)}


@me_router.put("/job-followups")
async def set_followups(body: OnIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"notify.email.followups": body.on}})
    return {"on": body.on}


@public.post("/stop-followups")
async def stop_followups(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"followup-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, UNSUB_RULES)
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn’t work. You can turn these emails off in your settings.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"notify.email.followups": False}})
    return {"ok": True}


def followup_email(to: str, name: str, user_id: str, apps: list[dict[str, Any]]) -> Email:
    site = get_settings().site_url.rstrip("/")
    stop = f"{site}/stop-alerts#t={unsub_token(user_id)}&k=followups"
    first = (name or "").split(" ")[0] or "there"
    shown = apps[:5]
    lines = [f"- {a['role']} at {a['company']}" for a in shown]
    text = "\n".join(
        [f"Hi {first},", "", "It has been a week since you applied for:", "", *lines, "",
         "A short, polite follow-up can help. Update each one on My applications:", f"{site}/me/jobs", "",
         "You get at most one of these a day, only when a follow-up is due.", f"Stop these emails: {stop}", "",
         "Nm7 · nm7.si"]
    )  # fmt: skip
    rows = "".join(f"<li>{escape(a['role'])} at {escape(a['company'])}</li>" for a in shown)
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>It has been a week since you applied for:</p>'
        f'<ul style="padding-left:18px">{rows}</ul><p>A short, polite follow-up can help. '
        f'<a href="{escape(site)}/me/jobs">Update each one on My applications</a>.</p>'
        '<p style="color:#666;font-size:13px">You get at most one of these a day, only when a follow-up is due. '
        f'<a href="{escape(stop)}" style="color:#666">Stop these emails</a></p></div>'
    )
    subject = "Time to follow up on your application" + ("s" if len(apps) > 1 else "")
    return Email(to=to, to_name=name, subject=subject, text=text, html=html)


async def followups(db: AsyncDatabase, mailer: Mailer, limit: int = BATCH) -> int:
    """Job-board applications still Applied / Viewed 7 days on: marked due (in the app) and, once a day at most per
    person, one email listing them. Run by the automation pass."""
    t = now()
    due = await db[APPLICATIONS].find(
        {"job_id": {"$exists": True}, "status": {"$in": ["applied", "viewed"]}, "reminded_at": None,
         "created_at": {"$lte": t - FOLLOW_AFTER}},
        {"user_id": 1, "role": 1, "company": 1, "key": 1},
    ).limit(limit).to_list(None)  # fmt: skip
    if not due:
        return 0
    by_user: dict[str, list[dict[str, Any]]] = {}
    for a in due:
        by_user.setdefault(a["user_id"], []).append(a)
    day = t.astimezone(IST).date().isoformat()
    sent = 0
    for uid, apps in by_user.items():
        u = await db[USERS].find_one({"_id": uid}, {"email": 1, "name": 1, "notify": 1, "email_verified_at": 1,
                                                    "email_bounced": 1, "followup_email_day": 1})  # fmt: skip
        ids = [a["_id"] for a in apps]
        if u and u.get("followup_email_day") == day:
            continue  # one email a day; the rest wait for tomorrow
        await db[APPLICATIONS].update_many({"_id": {"$in": ids}}, {"$set": {"reminded_at": t, "follow_up": True}})
        if not u or not followups_on(u) or not u.get("email_verified_at") or u.get("email_bounced"):
            continue  # in the app only
        if await send_safely(mailer, followup_email(u["email"], u.get("name", ""), uid, apps)):
            sent += 1
            await db[USERS].update_one({"_id": uid}, {"$set": {"followup_email_day": day}})
    if sent:
        log.info("job follow-ups: %d email(s) sent", sent)
    await db[LOCKS].update_one({"_id": "job-followups"}, {"$set": {"at": t}}, upsert=True)
    return sent
