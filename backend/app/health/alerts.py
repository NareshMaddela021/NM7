"""Resume health alerts: small, fixable things about a person's resume, shown on the dashboard and, at most once every
two weeks, in one email (opt-out: Profile settings, or the unsubscribe link in the email).

Rules (each alert names the exact place to fix it; a dismissed alert stays dismissed until it changes):
- stale          the resume hasn't been updated in 90 days
- ats_low        the latest ATS check scored below 60
- no_linkedin    no LinkedIn link on the resume
- untailored     a saved job match that has no tailored copy yet
- profile_new    an internship / job in the Job Profile that isn't on the resume
- no_certs       the Certifications section is empty
- graduated      the graduation year has passed but the course is still marked "currently studying"
"""

import re
from datetime import datetime, timedelta
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import ATS_CHECKS, HEALTH, JOB_MATCHES, JOB_PROFILES, RESUMES
from app.core.time import IST, now

STALE_DAYS = 90
ATS_MIN = 60
EMAIL_EVERY = timedelta(days=14)
KINDS = ("stale", "ats_low", "no_linkedin", "untailored", "profile_new", "no_certs", "graduated")


def _t(s: Any) -> str:
    return " ".join(str(s or "").split())


def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _t(s).lower()).strip()


def _year(s: Any) -> int | None:
    m = re.search(r"(19|20)\d{2}", str(s or ""))
    return int(m.group(0)) if m else None


def _on(entry: Any) -> bool:
    return isinstance(entry, dict) and entry.get("off") is not True


async def active_resume(db: AsyncDatabase, user_id: str) -> dict[str, Any] | None:
    q = {"user_id": user_id}
    return await db[RESUMES].find_one({**q, "active": True}) or await db[RESUMES].find_one(q, sort=[("updated_at", -1)])


def alert(kind: str, fingerprint: str, title: str, text: str, fix: dict[str, str]) -> dict[str, Any]:
    """fix: {label, path} — the one button that opens the place to fix it."""
    return {"id": f"{kind}:{fingerprint}"[:200], "kind": kind, "title": title, "text": text, "fix": fix}


def _builder(sec: str) -> str:
    return f"/builder?start=section&sec={sec}"


async def compute(db: AsyncDatabase, user_id: str, at: datetime | None = None) -> list[dict[str, Any]]:
    """Every alert for this person right now (dismissed ones included; `visible` filters them)."""
    at = at or now()
    r = await active_resume(db, user_id)
    if not r:
        return []
    d = r.get("data") or {}
    rk = r["key"]
    out: list[dict[str, Any]] = []
    upd = r.get("updated_at")
    if upd and upd.tzinfo is None:
        upd = upd.replace(tzinfo=IST)
    if upd and at - upd > timedelta(days=STALE_DAYS):
        days = (at - upd).days
        out.append(
            alert(
                "stale",
                f"{rk}:{upd.date().isoformat()}",
                "Your resume hasn’t been updated in a while",
                f"Last edited {days} days ago. Add your latest project, course or internship.",
                {"label": "Update my resume", "path": _builder("personal")},
            )
        )
    chk = await db[ATS_CHECKS].find_one({"user_id": user_id}, sort=[("at", DESCENDING)])
    if chk and int(chk.get("score") or 0) < ATS_MIN:
        out.append(
            alert(
                "ats_low",
                f"{chk.get('at')}",
                f"ATS score {int(chk['score'])} - aim for 60+",
                "Company systems may skip resumes that score low. The ATS check shows what to fix.",
                {"label": "Fix my ATS score", "path": "/me/ats?tab=ats"},
            )
        )
    if not _t((d.get("links") or {}).get("linkedin")):
        out.append(
            alert(
                "no_linkedin",
                rk,
                "Add your LinkedIn link",
                "Recruiters check LinkedIn. A link on your resume makes that one tap.",
                {"label": "Add LinkedIn", "path": _builder("personal")},
            )
        )
    async for m in (
        db[JOB_MATCHES]
        .find({"user_id": user_id, "tailored_key": None}, {"title": 1, "company": 1})
        .sort("created_at", DESCENDING)
        .limit(3)
    ):
        name = " at ".join(x for x in (_t(m.get("title")), _t(m.get("company"))) if x) or "a saved job"
        out.append(
            alert(
                "untailored",
                m["_id"],
                f"Tailor your resume for {name}",
                "You saved this job match but haven’t made a tailored copy yet.",
                {"label": "Tailor it", "path": f"/me/ats?match={m['_id']}"},
            )
        )
    prof = await db[JOB_PROFILES].find_one({"_id": user_id}, {"data.exp": 1})
    on_resume = {_norm(e.get("company")) for e in d.get("exp") or [] if _on(e) and _t(e.get("company"))}
    for e in ((prof or {}).get("data") or {}).get("exp") or []:
        c = _norm(e.get("company")) if isinstance(e, dict) else ""
        if c and c not in on_resume:
            out.append(
                alert(
                    "profile_new",
                    f"{rk}:{c}",
                    f"Add {_t(e.get('company'))} to your resume",
                    f"{_t(e.get('role')) or 'This role'} at {_t(e.get('company'))} is in your Job Profile "
                    "but not on your resume.",
                    {"label": "Add it to my resume", "path": _builder("exp")},
                )
            )
    if not any(_on(c) and _t(c.get("name")) for c in d.get("certs") or []):
        out.append(
            alert(
                "no_certs",
                rk,
                "Your Certifications section is empty",
                "A free course certificate (NPTEL, freeCodeCamp, Google…) helps a fresher’s resume.",
                {"label": "Add a certificate", "path": _builder("certs")},
            )
        )
    this_year = at.astimezone(IST).year
    for e in d.get("edu") or []:
        if not _on(e) or not e.get("current"):
            continue
        y = _year(e.get("to"))
        if y and y < this_year:
            out.append(
                alert(
                    "graduated",
                    f"{rk}:{_norm(e.get('institution'))}:{y}",
                    "Did you finish your course?",
                    f"{_t(e.get('degree')) or 'Your course'} ends in {y} but is still marked “currently studying”.",
                    {"label": "Update education", "path": _builder("edu")},
                )
            )
            break
    return out


async def state(db: AsyncDatabase, user_id: str) -> dict[str, Any]:
    return await db[HEALTH].find_one({"_id": user_id}) or {"_id": user_id, "dismissed": {}}


async def visible(db: AsyncDatabase, user_id: str, at: datetime | None = None) -> list[dict[str, Any]]:
    gone = (await state(db, user_id)).get("dismissed") or {}
    return [a for a in await compute(db, user_id, at) if _key(a["id"]) not in gone]


async def dismiss(db: AsyncDatabase, user_id: str, alert_id: str) -> None:
    await db[HEALTH].update_one({"_id": user_id}, {"$set": {f"dismissed.{_key(alert_id)}": now()}}, upsert=True)


def _key(alert_id: str) -> str:
    """Mongo field names can't hold dots or start with $."""
    return alert_id.replace(".", "．").replace("$", "＄")
