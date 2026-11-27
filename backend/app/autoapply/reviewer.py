"""The Chrome Web Store reviewer's demo account, so Google's reviewer can test the Nm7 Apply helper.

One made-up person, Priya Sharma (demo), who signs in at nm7.si/login with email (chrome-review@nm7.si) and a
password (no two-step login, no Google). Her Auto Apply 2.0 "Jobs ready" list always holds the same three demo jobs,
each with its apply kit (the same kit the helper reads through /api/helper), whose apply links are the practice pages on
nm7.si (frontend/src/pages/demo/PracticeApply.jsx: a made-up company form that sends nothing).

What keeps it safe is in app/core/reviewer.py: marked demo (left out of every number, report, morning run and company
search), nothing is ever sent for it on any channel, no email ever goes to its address, and it can't change its
password or email, delete the account, pay, upload ID documents or join Ready to join.

Every sign-in resets her data (fast: a few writes and two rules-only tailored versions, never the AI): the two jobs
ready, nothing applied, no paired browser, no saved helper answers left over.

The password: a strong random one made here (or CWS_REVIEWER_PASSWORD from the server's settings, when set). The
account keeps the usual hash for sign-in; a copy encrypted with the app's key (app/core/security.encrypt) sits in the
cws_reviewer collection so the owner can copy it in Admin. It is never logged, never in an audit entry and never in
any answer but the owner's GET …/password below.

Admin → Auto Apply → "Chrome Web Store reviewer" (the "settings" permission: the Owner):
  GET  /api/admin/auto-apply/cws-reviewer            the account (exists, email, practice links); no password
  GET  /api/admin/auto-apply/cws-reviewer/password   the password (audited: "shown")
  POST /api/admin/auto-apply/cws-reviewer/password   create the account when missing, else a new password (the old one
                                                     stops working, its sessions and paired browsers are signed out)
"""

import secrets
from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.models import User
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    AUTO_COPIES,
    AUTO_ITEMS,
    AUTO_MAIL,
    AUTO_MORNINGS,
    AUTO_REPLIES,
    CWS_REVIEWER,
    DB,
    HELPER_ANSWERS,
    HELPER_CODES,
    HELPER_TOKENS,
    HIRE_PROFILES,
    JOBS,
    RESUMES,
    SESSIONS,
    TRUST_CONSENTS,
    TRUST_PROFILES,
    USERS,
)
from app.core.errors import ApiError
from app.core.reviewer import EMAIL, ID, NAME, PRACTICE, practice_company
from app.core.security import decrypt, encrypt, hash_password, password_issue
from app.core.time import now

router = APIRouter(prefix="/api/admin/auto-apply/cws-reviewer", tags=["auto apply admin"])

DOC = "account"
JOB_PREFIX = "cws-review-"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"  # no 0 / O / 1 / l / I

RESUME = {
    "personal": {
        "name": NAME,
        "headline": "Data Analyst · SQL · Excel · Power BI",
        "email": EMAIL,
        "phone": "+91 90000 12345",
        "location": "Pune",
    },
    "links": {"linkedin": "linkedin.com/in/priya-sharma-demo"},
    "summary": "Made-up person for the Chrome Web Store review. Commerce graduate who builds Excel and Power BI "
    "reports and answers customer emails. Cut a weekly sales report from 3 hours to 30 minutes.",
    "exp": [
        {
            "company": "Demo Retail (demo)",
            "role": "Customer Support and Reporting Intern",
            "employmentType": "Internship",
            "from": "2025-01",
            "to": "2025-06",
            "current": False,
            "description": "Answered 40 customer emails a day with a 95% happy rating\nBuilt 3 Power BI dashboards "
            "for 5 store managers\nWrote SQL queries to find the 2 slowest product lines",
        }
    ],
    "edu": [
        {
            "institution": "Demo College of Commerce (demo)",
            "degree": "B.Com",
            "field": "Computer Applications",
            "from": "2021-07",
            "to": "2024-05",
            "grade": "8.1 CGPA",
        }
    ],
    "skillGroups": [
        {"id": "core", "label": "Core", "value": "SQL, Excel, Data Cleaning, Customer service, Email writing"},
        {"id": "tools", "label": "Tools", "value": "Power BI, Google Sheets, CRM, Jupyter"},
    ],
    "proj": [
        {
            "title": "Sales dashboard",
            "tagline": "Power BI dashboard for 1 year of sales",
            "description": "",
            "tech": "Power BI, SQL, Excel",
        }
    ],
}


def new_password() -> str:
    """24 letters and digits in 4 groups (about 140 bits), always with a letter and a digit (the site's rule)."""
    while True:
        raw = "".join(secrets.choice(ALPHABET) for _ in range(24))
        pw = "-".join(raw[i : i + 6] for i in range(0, 24, 6))
        if not password_issue(pw):
            return pw


def practice_url(slug: str) -> str:
    return f"{get_settings().site_url.rstrip('/')}/demo/apply/{slug}"


def _auto_apply(t) -> dict[str, Any]:
    from app.autoapply import engine

    return {
        "consent_at": t - timedelta(days=3),
        "on": True,
        "started_at": t - timedelta(days=3),
        "paused_at": None,
        "roles": ["Data Analyst", "Customer Support"],
        "cities": ["Pune", "Hyderabad"],
        "remote": True,
        "experience": [],
        "min_salary": None,
        "min_score": 60,
        "daily_limit": 5,
        "avoid": [],
        "job_types": [],
        "run_day": engine.today(t),
        "v2_consent_at": t - timedelta(days=3),
        "mode": "approve",
        "notice_period": "30_days",
        "email_on": False,  # no email channel, ever (and every send point refuses this account anyway)
    }


async def exists(db) -> bool:
    return bool(await db[USERS].find_one({"_id": ID}, {"_id": 1}))


async def _ensure_user(db, password_hash: str) -> bool:
    """The account (created once). → True when it was created now."""
    t = now()
    user = User(id=ID, email=EMAIL, name=NAME, role="customer", password_hash=password_hash)
    doc = {
        **user.to_mongo(),
        "demo": True,  # every demo exclusion (numbers, reports, runs, company searches, Google sign-in) covers it
        "cws_reviewer": True,
        "email_verified_at": t,
        "terms_accepted_at": t,
        "roles": ["jobseeker"],
        "active_role": "jobseeker",
        "roles_pending": False,
        "target_role": "Data Analyst",
        "cities": "Pune",
        "notify": {"email": {}},
        "auto_apply": _auto_apply(t),
    }
    for k in ("password_hash", "password_changed_at", "updated_at"):  # set on every call below
        doc.pop(k, None)
    got = await db[USERS].update_one(
        {"_id": ID},
        {"$setOnInsert": doc, "$set": {"password_hash": password_hash, "password_changed_at": t, "updated_at": t}},
        upsert=True,
    )
    return bool(got.upserted_id)


async def _jobs(db, t) -> list[dict[str, Any]]:
    """The practice jobs: demo (never on the board, no company), applied for on the practice pages."""
    from app.jobs.model import JobIn, slug_for, to_doc

    out = []
    for slug, title, skills in PRACTICE:
        jid = f"{JOB_PREFIX}{slug}"
        body = JobIn.model_validate(
            {
                "title": title,
                "company": {"name": practice_company(slug), "website": ""},
                "description": f"{title} at a made-up company, for the Chrome Web Store review of the Nm7 Apply "
                f"helper. Work with {', '.join(skills)} in a small team. Freshers welcome.",
                "locations": ["Pune"],
                "workType": "onsite",
                "jobType": "full_time",
                "experience": "fresher",
                "skills": skills,
                "applyMethod": "link",
                "applyUrl": practice_url(slug),
            }
        )
        doc = {
            **to_doc(body),
            "_id": jid,
            "slug": f"{slug_for(title, practice_company(slug))[:-7]}-cws",
            "status": "active",
            "posted_at": t,
            "source": "admin",
            "created_at": t,
            "updated_at": t,
            "edit_count": 0,
            "demo": True,
            "questions": [],
            "closed_reason": "",
            "dedupe_key": f"demo:{jid}",
            "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""},
            "review": {"reasons": [], "ai": None, "warnings": []},
        }
        await db[JOBS].replace_one({"_id": jid}, doc, upsert=True)
        out.append(doc)
    return out


async def reset(db) -> dict[str, Any]:
    """Her data back to the start: the resume, her Auto Apply 2.0 rules, the two jobs ready with their kits, nothing
    applied, no paired browser, no pairing code. The account itself and its password stay."""
    from app.autoapply import engine, score, tailoring, v2engine
    from app.jobs import fit as fitmod

    if not await exists(db):
        return {"items": 0}
    t = now()
    mine = {"user_id": ID}
    for coll in (AUTO_ITEMS, AUTO_COPIES, APPLICATIONS, AUTO_MORNINGS, AUTO_REPLIES, AUTO_MAIL, HELPER_CODES,
                 HELPER_TOKENS, HELPER_ANSWERS, TRUST_CONSENTS, RESUMES):  # fmt: skip
        await db[coll].delete_many(mine)
    await db[HIRE_PROFILES].delete_many({"_id": ID})
    await db[TRUST_PROFILES].delete_many({"_id": ID})  # an age check she may have typed in
    a = _auto_apply(t)
    await db[USERS].update_one(
        {"_id": ID},
        {"$set": {"name": NAME, "demo": True, "cws_reviewer": True, "disabled_at": None, "auto_apply": a,
                  "updated_at": t}},
    )  # fmt: skip
    r = {"key": "r1", "user_id": ID, "name": "Main resume", "data": RESUME, "active": True, "versions": [],
         "created_at": t, "updated_at": t}  # fmt: skip
    await db[RESUMES].insert_one(r)
    p = fitmod.Person(r)
    day = engine.today(t)
    ids = []
    for n, j in enumerate(await _jobs(db, t)):
        parts = score.parts(j, fitmod.fit(j, p), a, 1, None, t)
        copy = await tailoring.build(db, ID, r, j, a, use_ai=False)  # the rules version: never the AI
        doc = {"_id": str(ObjectId()), "user_id": ID, "job_id": j["_id"], "company_id": None,
               "company": (j.get("company") or {}).get("name") or "", "title": j["title"], "slug": j["slug"],
               "channel": "link",
               "state": "ready", "copy_id": copy["_id"], "created_at": t, "updated_at": t, "demo": True,
               **v2engine._item_extra(parts, j), "channel_v2": "one_tap", "ready_day": day, "listed_day": day,
               "reason": "demo"}  # fmt: skip
        doc["score"] = 90 - 3 * n  # always in PRACTICE order: the first one is the kit the test instructions open
        await db[AUTO_ITEMS].insert_one(doc)
        ids.append(doc["_id"])
    await db[AUTO_MORNINGS].replace_one(
        {"_id": f"{ID}:{day}"},
        {"_id": f"{ID}:{day}", "user_id": ID, "day": day, "items": ids, "count": len(ids), "at": t,
         "seen_at": None, "mailed_at": None, "demo": True},
        upsert=True,
    )  # fmt: skip
    return {"items": len(ids)}


async def set_password(db) -> bool:
    """A new password (or the server's CWS_REVIEWER_PASSWORD), the account made first when missing; every session and
    paired browser of the account is signed out. → True when the account was created now."""
    pw = get_settings().cws_reviewer_password or new_password()
    if password_issue(pw):
        raise ApiError(
            500, "bad_setting", "CWS_REVIEWER_PASSWORD on the server is too weak. Use 12+ letters and digits."
        )
    created = await _ensure_user(db, await hash_password(pw))
    t = now()
    await db[CWS_REVIEWER].replace_one(
        {"_id": DOC}, {"_id": DOC, "password_enc": encrypt(pw), "set_at": t}, upsert=True
    )
    await db[SESSIONS].update_many({"user_id": ID, "revoked_at": None}, {"$set": {"revoked_at": t}})
    await reset(db)
    return created


# ---------- Admin ----------


async def _out(db) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": ID}, {"created_at": 1})
    k = await db[CWS_REVIEWER].find_one({"_id": DOC}, {"set_at": 1})
    from app.me.service import ms

    site = get_settings().site_url.rstrip("/")
    return {
        "exists": bool(u),
        "email": EMAIL,
        "loginUrl": f"{site}/login",
        "practice": [{"title": title, "url": practice_url(slug)} for slug, title, _ in PRACTICE],
        "passwordSetAt": ms(k.get("set_at")) if k else None,
        "fromServer": bool(get_settings().cws_reviewer_password),
    }


@router.get("")
async def account(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _out(db)


@router.get("/password")
async def show_password(request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    k = await db[CWS_REVIEWER].find_one({"_id": DOC})
    if not k or not await exists(db):
        raise ApiError(404, "not_found", "Create the reviewer account first.")
    try:
        pw = decrypt(k["password_enc"])
    except Exception:  # noqa: BLE001 — the app's key changed: a new password is the way out
        raise ApiError(409, "unreadable", "This password can’t be read any more. Press Reset password.") from None
    await audit(db, auth.user.id, "auto_apply.cws_reviewer_password_shown", target=ID, ip=client_ip(request))
    return {"password": pw}


@router.post("/password")
async def reset_password(request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    await rate_limit.check(db, f"cws-reviewer:{auth.user.id}", [(20, timedelta(hours=1))])
    await rate_limit.record(db, f"cws-reviewer:{auth.user.id}")
    created = await set_password(db)
    await audit(
        db,
        auth.user.id,
        "auto_apply.cws_reviewer_created" if created else "auto_apply.cws_reviewer_password",
        target=ID,
        ip=client_ip(request),
    )  # fmt: skip  (never the password itself)
    return await _out(db)
