"""Job alerts (Phase 2, C6): new jobs that match what a student asked for, by email, daily or weekly.

  GET /api/me/job-alerts                      the person's alert (off until they turn it on)
  PUT /api/me/job-alerts {on, roles, cities, remote, experience, frequency, lang}
  POST /api/public/jobs/stop-alerts {token}   the "Stop these emails" link (no sign-in)

What matches: open jobs posted since the last alert (a day or a week), where a role the person typed appears in the
title or the skills; in one of their cities, or remote if they allow it (no cities = anywhere); at one of their
experience levels (none = any). The best 5 by the job board's own match score (newest first without a resume) go in
the email, each with its link and a WhatsApp share link. No matches, no email.

Email rules: English, Telugu or Hindi (their choice; Telugu and Hindi need native review); at most one alert a day;
never to an unconfirmed or bounced address; never after "Stop these emails" or the switch in Profile & settings.
Run by the automation pass.
"""

import logging
import re
from datetime import timedelta
from html import escape
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, JOBS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.jobs import fit as fitmod
from app.jobs.model import EXPERIENCE, with_older
from app.jobs.public import live_filter

log = logging.getLogger("nm7.jobs")

me = APIRouter(prefix="/api/me", tags=["job alerts"])
public = APIRouter(prefix="/api/public/jobs", tags=["job alerts"])

TOP = 5
BATCH = 500
PERIOD = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}
UNSUB_RULES = [(30, timedelta(hours=1))]
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
DEFAULT = {
    "on": False,
    "roles": [],
    "cities": [],
    "remote": True,
    "experience": [],
    "frequency": "weekly",
    "lang": "en",
}

# The email in three languages. Telugu and Hindi are drafts: they need a native speaker's review.
TEXT = {
    "en": {
        "subject": "{n} new jobs for you on Nm7",
        "subject1": "1 new job for you on Nm7",
        "hi": "Hi {name},",
        "intro": "New jobs that match your alert:",
        "match": "Match {n}%",
        "share": "Share on WhatsApp",
        "all": "See all matching jobs",
        "why_daily": "You get this at most once a day, only when there are new matches.",
        "why_weekly": "You get this once a week, only when there are new matches.",
        "change": "Change your alert",
        "stop": "Stop these emails",
        "wa": "{title} at {company} on Nm7: {link}",
    },
    "te": {
        "subject": "Nm7లో మీకోసం {n} కొత్త ఉద్యోగాలు",
        "subject1": "Nm7లో మీకోసం 1 కొత్త ఉద్యోగం",
        "hi": "హాయ్ {name},",
        "intro": "మీ అలర్ట్‌కు సరిపోయే కొత్త ఉద్యోగాలు:",
        "match": "మ్యాచ్ {n}%",
        "share": "WhatsAppలో షేర్ చేయండి",
        "all": "సరిపోయే అన్ని ఉద్యోగాలు చూడండి",
        "why_daily": "కొత్త మ్యాచ్‌లు ఉన్నప్పుడు మాత్రమే, రోజుకు ఒక్కసారి కంటే ఎక్కువ రాదు.",
        "why_weekly": "కొత్త మ్యాచ్‌లు ఉన్నప్పుడు మాత్రమే, వారానికి ఒకసారి వస్తుంది.",
        "change": "మీ అలర్ట్ మార్చండి",
        "stop": "ఈ ఈమెయిల్స్ ఆపండి",
        "wa": "Nm7లో {company}లో {title}: {link}",
    },
    "hi": {
        "subject": "Nm7 पर आपके लिए {n} नई नौकरियाँ",
        "subject1": "Nm7 पर आपके लिए 1 नई नौकरी",
        "hi": "नमस्ते {name},",
        "intro": "आपके अलर्ट से मेल खाती नई नौकरियाँ:",
        "match": "मेल {n}%",
        "share": "WhatsApp पर शेयर करें",
        "all": "मेल खाती सभी नौकरियाँ देखें",
        "why_daily": "यह दिन में एक बार से ज़्यादा नहीं आता, सिर्फ़ नई नौकरियाँ मिलने पर।",
        "why_weekly": "यह हफ़्ते में एक बार आता है, सिर्फ़ नई नौकरियाँ मिलने पर।",
        "change": "अपना अलर्ट बदलें",
        "stop": "ये ईमेल बंद करें",
        "wa": "Nm7 पर {company} में {title}: {link}",
    },
}


def _words(v: list[str], n: int) -> list[str]:
    out: list[str] = []
    for x in v:
        x = " ".join(str(x).split())[:60]
        if x and x.lower() not in (o.lower() for o in out):
            out.append(x)
    return out[:n]


class AlertIn(CamelModel):
    on: bool
    roles: list[str] = Field(default_factory=list, max_length=10)
    cities: list[str] = Field(default_factory=list, max_length=10)
    remote: bool = True
    experience: list[Literal[tuple(EXPERIENCE)]] = Field(default_factory=list, max_length=11)  # type: ignore[valid-type]
    frequency: Literal["daily", "weekly"] = "weekly"
    lang: Literal["en", "te", "hi"] = "en"

    @field_validator("roles")
    @classmethod
    def _roles(cls, v: list[str]) -> list[str]:
        return _words(v, 5)

    @field_validator("cities")
    @classmethod
    def _cities(cls, v: list[str]) -> list[str]:
        return _words(v, 5)


def alert_of(u: dict[str, Any] | None) -> dict[str, Any]:
    a = (u or {}).get("job_alert") or {}
    return {k: a.get(k, d) for k, d in DEFAULT.items()}


def _out(a: dict[str, Any]) -> dict[str, Any]:
    return {k: a[k] for k in DEFAULT}


@me.get("/job-alerts")
async def get_alert(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return _out(alert_of(await db[USERS].find_one({"_id": auth.user.id}, {"job_alert": 1})))


@me.put("/job-alerts")
async def put_alert(body: AlertIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if body.on and not body.roles:
        raise ApiError(400, "roles", "Add at least one role, like “data analyst” or “Java”.")
    sets = {f"job_alert.{k}": v for k, v in body.model_dump().items()}
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": sets})
    return _out(alert_of(await db[USERS].find_one({"_id": auth.user.id}, {"job_alert": 1})))


# ---------- the "Stop these emails" link ----------


def unsub_token(user_id: str) -> str:
    return f"{user_id}.{keyed_hash('job-alerts-unsub', user_id)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("job-alerts-unsub", uid)[:32]) else None


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/stop-alerts")
async def stop_alerts(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    key = f"alerts-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, UNSUB_RULES)
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn’t work. You can turn job alerts off in your settings.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"job_alert.on": False}})
    return {"ok": True}


# ---------- matching and sending ----------


def job_query(a: dict[str, Any], since) -> dict[str, Any]:
    rx = "|".join(re.escape(r) for r in a["roles"])
    q: dict[str, Any] = {
        "$and": [
            live_filter(),
            {"posted_at": {"$gt": since}},
            {"$or": [{"title": {"$regex": rx, "$options": "i"}}, {"skills": {"$regex": rx, "$options": "i"}}]},
        ]
    }
    if a["cities"]:
        where: list[dict[str, Any]] = [
            {"locations": {"$regex": "|".join(f"^{re.escape(c)}" for c in a["cities"]), "$options": "i"}}
        ]
        if a["remote"]:
            where.append({"remote": True})
        q["$and"].append({"$or": where})
    elif not a["remote"]:
        q["$and"].append({"remote": {"$ne": True}})
    if a["experience"]:
        q["$and"].append({"experience": {"$in": with_older(a["experience"])}})
    return q


async def matches(db, user_id: str, a: dict[str, Any], since) -> list[dict[str, Any]]:
    jobs = await db[JOBS].find(job_query(a, since), {"description": 0}).sort("posted_at", -1).to_list(100)
    if not jobs:
        return []
    p = await fitmod.person_for(db, user_id)
    scored = [(fitmod.fit(j, p)["score"] if p else None, j) for j in jobs]
    if p:
        scored.sort(key=lambda x: -(x[0] or 0))
    return [{**j, "_score": s} for s, j in scored[:TOP]]


def alert_email(u: dict[str, Any], a: dict[str, Any], jobs: list[dict[str, Any]]) -> Email:
    site = get_settings().site_url.rstrip("/")
    tx = TEXT.get(a["lang"], TEXT["en"])
    first = (u.get("name") or "").split(" ")[0] or "there"
    stop = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=alerts"
    change = f"{site}/me/settings#job-alerts"
    lines, rows = [], []
    for j in jobs:
        link = f"{site}/jobs/{j['slug']}"
        place = ", ".join(j.get("locations") or []) or ("Remote" if j.get("remote") else "")
        wa = "https://wa.me/?text=" + quote(tx["wa"].format(title=j["title"], company=j["company"]["name"], link=link))
        score = f" · {tx['match'].format(n=j['_score'])}" if j.get("_score") is not None else ""
        head = f"{j['title']} – {j['company']['name']}{f' ({place})' if place else ''}{score}"
        lines += [f"- {head}", f"  {link}", f"  {tx['share']}: {wa}"]
        rows.append(
            f'<li style="margin-bottom:10px"><a href="{escape(link)}"><b>{escape(j["title"])}</b></a> – '
            f"{escape(j['company']['name'])}{escape(f' ({place})' if place else '')}{escape(score)}<br>"
            f'<a href="{escape(wa)}" style="font-size:13px">{escape(tx["share"])}</a></li>'
        )
    why = tx["why_daily"] if a["frequency"] == "daily" else tx["why_weekly"]
    text = "\n".join(
        [tx["hi"].format(name=first), "", tx["intro"], "", *lines, "", f"{tx['all']}: {site}/jobs?sort=match", "",
         why, f"{tx['change']}: {change}", f"{tx['stop']}: {stop}", "", "Nm7 · nm7.si"]
    )  # fmt: skip
    html = (
        f'<div style="{STYLE}"><p>{escape(tx["hi"].format(name=first))}</p><p>{escape(tx["intro"])}</p>'
        f'<ul style="padding-left:18px">{"".join(rows)}</ul>'
        f'<p><a href="{escape(site)}/jobs?sort=match">{escape(tx["all"])}</a></p>'
        f'<p style="color:#666;font-size:13px">{escape(why)} <a href="{escape(change)}" style="color:#666">'
        f'{escape(tx["change"])}</a> · <a href="{escape(stop)}" style="color:#666">{escape(tx["stop"])}</a></p></div>'
    )
    subject = tx["subject1"] if len(jobs) == 1 else tx["subject"].format(n=len(jobs))
    return Email(to=u["email"], to_name=u.get("name", ""), subject=subject, text=text, html=html)


def _due(a: dict[str, Any], ran_at, t) -> bool:
    if not ran_at:
        return True
    if a["frequency"] == "daily":
        return ran_at.astimezone(IST).date() < t.astimezone(IST).date()
    return t - ran_at >= PERIOD["weekly"] - timedelta(hours=1)


async def send_alerts(db, mailer: Mailer, limit: int = BATCH) -> int:
    """Everyone whose alert is due: the new matches by email (none, no email). Once a day at most per person."""
    t = now()
    sent = 0
    users = (
        db[USERS]
        .find(
            {"job_alert.on": True, "email_verified_at": {"$ne": None}, "email_bounced": {"$ne": True}},
            {"email": 1, "name": 1, "job_alert": 1, "job_alert_ran_at": 1, "job_alert_sent_day": 1},
        )
        .limit(limit)
    )
    day = t.astimezone(IST).date().isoformat()
    from app.site import get_site, lang_for

    site = await get_site(db)
    async for u in users:
        a = alert_of(u)
        a = {**a, "lang": lang_for(site, a.get("lang"))}  # English while Telugu and Hindi are hidden
        if not a["roles"] or not _due(a, u.get("job_alert_ran_at"), t) or u.get("job_alert_sent_day") == day:
            continue
        since = u.get("job_alert_ran_at") or t - PERIOD[a["frequency"]]
        found = await matches(db, u["_id"], a, since)
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"job_alert_ran_at": t}})
        if found and await send_safely(mailer, alert_email(u, a, found)):
            sent += 1
            await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"job_alert_sent_day": day}})
    if sent:
        log.info("job alerts: %d email(s) sent", sent)
    return sent
