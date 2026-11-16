"""Vetting V2 background work, run by the automation pass (app/automation.py):

- nightly: badges past their 90 days are marked expired (they already rank as unverified from that moment; this keeps
  the user's badge list and the stats tidy), device / network hashes older than 30 days are removed from attempts,
  and orphaned photos are left to the TTL index (30 days).
- invites: at most one email a week per person, to people whose profile matches a role in high demand (most live
  jobs) and who have no current badge for it. Respects the hire email setting, bounces, demo accounts and the
  "Stop these emails" link (users.vetting_invites_off). (WhatsApp sending needs an approved WhatsApp Business
  template; until then the email carries a WhatsApp share link.)
"""

import logging
from datetime import timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Request

from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, SKILL_ATTEMPTS, USERS, VETTING_VERIFIED
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.time import now
from app.hire.available import wants_email
from app.jobs.alerts import TokenIn, unsub_token, unsub_user

log = logging.getLogger(__name__)
public = APIRouter(prefix="/api/public/vetting", tags=["vetting"])
INVITE_EVERY = timedelta(days=7)
FP_KEEP = timedelta(days=30)


async def nightly(db) -> int:
    t = now()
    n = 0
    async for v in db[VETTING_VERIFIED].find({"expires_at": {"$lte": t}, "expired": {"$ne": True}}).limit(2000):
        await db[VETTING_VERIFIED].update_one({"_id": v["_id"]}, {"$set": {"expired": True}})
        await db[USERS].update_one(
            {"_id": v["user_id"], "verified_skills.skill": v["test"], "verified_skills.source": "v2"},
            {"$set": {"verified_skills.$.expired": True}},
        )
        n += 1
    await db[SKILL_ATTEMPTS].update_many(
        {"fp": {"$exists": True}, "started_at": {"$lt": t - FP_KEEP}}, {"$unset": {"fp": ""}}
    )
    return n


def invite_email(u: dict[str, Any], role: dict[str, Any], jobs: int) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/skill-checks?role={role['slug']}"
    stop = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=vetting"
    lines = [f"Hi {first},", "", f"Companies on Nm7 are hiring for {role['role']} right now ({jobs} live jobs).",
             "Get “Skill verified”: a 15-minute test and a short practical task. Verified people are shown first "
             "in Hire now.", "", f"Start: {link}", "", "No camera. Free.", "",
             "You get this at most once a week.", f"Stop these emails: {stop}"]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            f"<p>Companies on Nm7 are hiring for {escape(role['role'])} right now ({jobs} live jobs).</p>"
            "<p>Get <strong>“Skill verified”</strong>: a 15-minute test and a short practical task. Verified people "
            "are shown first in Hire now. No camera. Free.</p>"
            f'<p><a href="{escape(link)}">Get skill verified</a></p>'
            f'<p style="color:#666;font-size:13px">You get this at most once a week. '
            f'<a href="{escape(stop)}" style="color:#666">Stop these emails</a></p></div>')  # fmt: skip
    return Email(to=u["email"], to_name=u.get("name", ""), subject=f"Get skill verified for {role['role']}",
                 text="\n".join(lines), html=html)  # fmt: skip


async def send_invites(db, mailer: Mailer, limit: int = 200) -> int:
    from app.hire.vetting import access
    from app.hire.vetting.roles import BY_TEST
    from app.hire.vetting.router import demand, suggested_for

    only = await access.mail_filter(db)  # hidden (Admin → Skill checks → Launch): only the testers get invites
    if only is None:
        return 0
    t = now()
    want = await demand(db)
    hot = {k for k, v in sorted(want.items(), key=lambda kv: -kv[1])[:10] if v > 0}
    if not hot:
        return 0
    sent = 0
    q = {"email_verified_at": {"$ne": None}, "email_bounced": {"$ne": True}, "vetting_invites_off": {"$ne": True},
         "deleted_at": None, "disabled_at": None, "demo": {"$ne": True}, "vetting_consent_at": None,
         "$or": [{"vetting_invited_at": None}, {"vetting_invited_at": {"$lt": t - INVITE_EVERY}}], **only}  # fmt: skip
    async for u in db[USERS].find(q, {"email": 1, "name": 1, "notify": 1, "email_verified_at": 1}).limit(limit * 5):
        if sent >= limit or not wants_email(u):
            continue
        fits = [x for x in await suggested_for(db, u["_id"]) if x in hot]
        if not fits:
            continue
        have = {v["test"] async for v in db[VETTING_VERIFIED].find({"user_id": u["_id"], "expires_at": {"$gt": t}})}
        test = next((x for x in fits if x not in have), None)
        if not test:
            continue
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"vetting_invited_at": t}})
        if await send_safely(mailer, invite_email(u, BY_TEST[test], want[test])):
            sent += 1
    if sent:
        log.info("vetting invites: %d email(s) sent", sent)
    return sent


@public.post("/stop-invites")
async def stop_invites(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"vetting-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(20, timedelta(hours=1))])
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn't work.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"vetting_invites_off": True}})
    return {"ok": True}
