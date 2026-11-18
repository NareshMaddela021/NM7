"""Auto Apply 2.0, phase A2: the company's moves reach the candidate's 2.0 tracker.

When a company on Nm7 moves an auto application (opens it: Viewed; Shortlisted; Interview; Offer; Not selected) or
closes the job, or Nm7 closes it after no reply, the candidate's 2.0 item gets a notice (in-app, on the tracker's
"Updates") and the tracker stage follows the application. Email goes only through access.may_mail: while the 2.0
switch is OFF only listed testers get one (admins and demo accounts never), never for "Viewed", and never when the
company's own action already emailed them (the interview invitation). A rejection counts in learning
(app/autoapply/learning.py reads the application's status), so repeated rejections for one kind of role lower it.
"""

import logging
from html import escape
from typing import Any

from app.autoapply import access
from app.core.config import get_settings
from app.core.db import APPLICATIONS, AUTO_ITEMS, USERS
from app.core.email import Email, send_safely
from app.core.time import now
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

TEXT = {
    "viewed": "{company} opened your application for {role}.",
    "shortlisted": "{company} shortlisted you for {role}.",
    "interview": "{company} invited you to an interview for {role}.",
    "offer": "{company} made you an offer for {role}.",
    "rejected": "{company} chose other applicants for {role}. This counts in what Auto Apply learns.",
    "closed": "{company} closed the job {role}.",
    "no_reply": "{company} did not reply about {role} in time, so it is marked closed.",
}
MAIL = ("shortlisted", "interview", "offer", "rejected", "closed")
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"


def _text(status: str, app: dict[str, Any]) -> str:
    return TEXT[status].format(company=app.get("company") or "The company", role=app.get("role") or "the job")


async def _item(db, app: dict[str, Any]) -> dict[str, Any] | None:
    if app.get("origin") != "auto":
        return None
    q: dict[str, Any] = {"v2": True}
    if app.get("auto_item_id"):
        q["_id"] = app["auto_item_id"]
    else:
        q |= {"user_id": app["user_id"], "job_id": app["job_id"]}
    return await db[AUTO_ITEMS].find_one(q, {"_id": 1, "user_id": 1})


async def on_status(db, app: dict[str, Any], status: str, mailer=None, emailed: bool = False) -> bool:
    """One application moved by the company (or closed). → whether the candidate's 2.0 tracker was told."""
    if status not in TEXT:
        return False
    it = await _item(db, app)
    if not it:
        return False
    t = now()
    text = _text(status, app)
    notice = {"status": status, "text": text, "at": t, "seen": False}
    sets: dict[str, Any] = {"notice": notice, "updated_at": t}
    if status == "closed":
        sets["job_closed_at"] = t
    await db[AUTO_ITEMS].update_one(
        {"_id": it["_id"]}, {"$set": sets, "$push": {"notices": {"$each": [notice], "$slice": -20}}}
    )
    if status in MAIL and not emailed:
        await _mail(db, app, status, text, mailer)
    return True


async def _mail(db, app: dict[str, Any], status: str, text: str, mailer=None) -> bool:
    from app.core.email import get_mailer
    from app.jobs.apply import followups_on

    v2 = (await get_site(db))["auto_apply_v2"]
    u = await db[USERS].find_one(
        {"_id": app["user_id"]},
        {"email": 1, "email_lc": 1, "name": 1, "demo": 1, "role": 1, "notify": 1, "email_verified_at": 1,
         "email_bounced": 1},
    )  # fmt: skip
    if not u or not access.may_mail(u, v2) or not followups_on(u) or u.get("email_bounced"):
        return False
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/auto-apply/v2"
    body = "\n".join([f"Hi {first},", "", text, "", f"See it in Auto Apply 2.0: {link}", "", "Nm7 · nm7.si"])
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p>{escape(text)}</p>'
        f'<p><a href="{escape(link)}">See it in Auto Apply 2.0</a></p></div>'
    )
    subject = {
        "shortlisted": "You were shortlisted",
        "interview": "Interview invitation",
        "offer": "You have an offer",
        "rejected": "An update on your application",
        "closed": "A job you applied to closed",
    }[status]
    return await send_safely(
        mailer or get_mailer(),
        Email(to=u["email"], to_name=u.get("name", ""), subject=f"{subject}: {app.get('role', '')}"[:150], text=body,
              html=html),
    )  # fmt: skip


async def on_job_closed(db, job_id: str, mailer=None) -> int:
    """The company closed a job: every auto application still open on it is told (at most 200)."""
    n = 0
    q = {"job_id": job_id, "origin": "auto", "status": {"$in": ["applied", "viewed", "shortlisted", "interview"]}}
    async for app in db[APPLICATIONS].find(q, {"user_id": 1, "job_id": 1, "auto_item_id": 1, "origin": 1,
                                                "company": 1, "role": 1}).limit(200):  # fmt: skip
        n += await on_status(db, app, "closed", mailer)
    return n


async def mark_seen(db, uid: str) -> int:
    return (
        await db[AUTO_ITEMS].update_many({"user_id": uid, "notice.seen": False}, {"$set": {"notice.seen": True}})
    ).modified_count
