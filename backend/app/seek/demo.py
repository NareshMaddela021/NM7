# ruff: noqa: E501  (demo data on one line each)
"""Phase 6 demo: two made-up students, demo-only and never public (addresses end in demo.nm7.invalid, the demo company
and its jobs and projects are demo records, and demo students get no emails).

  "Meera (demo)": the role finder done (Data analyst), the learning path half done with "Skill verified: SQL",
                  practice history, a saved offer check with a bond warning, interview feedback received, and one live
                  project completed with its certificate.
  "Arjun (demo)": joined a job 10 days ago: the first-90-days checklist and the day 7 check-in answered.

  POST /api/admin/seek/demo {who: meera | arjun}   Admin → Auto Apply → "Reset and open as student (Phase 6 …)": resets
                                                  that student, returns a one-time link (5 minutes) like the other demos
"""

import secrets
import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.models import User
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    DB,
    JOBS,
    JOININGS,
    LEARN_PROGRESS,
    OFFER_CHECKS,
    PRACTICE_ATTEMPTS,
    PROGRAM_APPS,  # fmt: skip
    PROGRAMS,
    RESUMES,
    SKILL_ATTEMPTS,
    USERS,
)
from app.core.schemas import CamelModel
from app.core.security import hash_password, hash_token
from app.core.time import IST, now

admin = APIRouter(prefix="/api/admin/seek", tags=["job seekers"])

MEERA = str(uuid.uuid5(uuid.NAMESPACE_URL, "https://nm7.si/demo/meera"))
ARJUN = str(uuid.uuid5(uuid.NAMESPACE_URL, "https://nm7.si/demo/arjun"))
STUDENTS = {"meera": (MEERA, "Meera (demo)", "meera.student@demo.nm7.invalid", "/me/learn?role=data-analyst"),
            "arjun": (ARJUN, "Arjun (demo)", "arjun.student@demo.nm7.invalid", "/me/progress")}  # fmt: skip
COMPANY = "demo-seek-company"
JOB = "demo-seek-job"
LINK_TTL = timedelta(minutes=5)
BOND_OFFER = """Bright Future Solutions
Congratulations! You are selected as Data Analyst. Salary Rs 25,000 per month.
You must sign a service agreement to serve the company for 2 years; leaving early carries a penalty of Rs 1,50,000.
Date of joining: 1 December. Location: Hyderabad. For and on behalf of Bright Future Solutions, HR Manager."""


async def remove(db, uid: str) -> None:
    for coll in (
        APPLICATIONS,
        LEARN_PROGRESS,
        PRACTICE_ATTEMPTS,
        OFFER_CHECKS,
        PROGRAM_APPS,
        SKILL_ATTEMPTS,
        JOININGS,
        RESUMES,
    ):
        await db[coll].delete_many({"user_id": uid})
    await db[USERS].delete_one({"_id": uid, "demo": True})


async def demo_company(db) -> None:
    t = now()
    await db[COMPANIES].update_one({"_id": COMPANY}, {"$setOnInsert": {
        "slug": COMPANY, "kind": "company", "demo": True, "trust": "verified", "review": {"state": "approved"},
        "verified_until": t + timedelta(days=3650), "details": {"legal_name": "Demo Skills Pvt Ltd (demo)", "website": "demo-skills.demo.nm7.invalid", "about": ""},
        "members": [], "created_at": t}}, upsert=True)  # fmt: skip
    await db[JOBS].update_one({"_id": JOB}, {"$setOnInsert": {
        "title": "Junior Data Analyst (demo)", "slug": JOB, "dedupe_key": JOB, "status": "closed", "demo": True, "company_id": COMPANY,
        "company": {"name": "Demo Skills Pvt Ltd (demo)"}, "locations": ["Hyderabad"], "remote": False, "experience": "fresher",
        "job_type": "full_time", "work_type": "onsite", "skills": ["SQL", "Microsoft Excel"], "description": "Demo job.", "source": "company",
        "apply": {"method": "nm7"}, "created_at": t, "posted_at": t}}, upsert=True)  # fmt: skip


async def user(db, uid: str, name: str, email: str, extra: dict[str, Any]) -> None:
    t = now()
    u = User(
        id=uid, email=email, name=name, role="customer", password_hash=await hash_password(secrets.token_urlsafe(24))
    )
    await db[USERS].insert_one({**u.to_mongo(), "demo": True, "email_verified_at": t, **extra})
    await db[RESUMES].insert_one({"key": "r1", "user_id": uid, "name": "My resume", "active": True, "versions": [], "created_at": t, "updated_at": t,
                                  "data": {"personal": {"name": name.replace(" (demo)", ""), "location": "Hyderabad"}, "summary": "Fresher keen on data work.",
                                           "skillGroups": [{"id": "c", "label": "Core", "value": "Excel, SQL"}], "intern": [], "exp": [], "proj": []}})  # fmt: skip


async def meera(db) -> dict[str, Any]:
    from app.courses.router import courses_for
    from app.seek.offers import rule_check
    from app.seek.paths import ensure_paths
    from app.seek.roles import pick

    t = now()
    answers = {"studies": "graduate", "branch": "B.Com", "likes": ["maths", "reports"], "strengths": ["numbers"], "style": "numbers", "second_style": "computers",
               "city": "Hyderabad", "salary_need": 20000, "languages": ["English", "Telugu"], "laptop": True, "hours_week": 8}  # fmt: skip
    picks = [r["role"]["id"] for r in pick(answers)]
    await user(db, MEERA, "Meera (demo)", STUDENTS["meera"][2], {
        "role_finder": {"answers": answers, "picks": picks, "why": None, "at": t - timedelta(days=12)}, "target_role": "Data analyst",
        "verified_skills": [{"skill": "SQL", "role": "data-analyst", "at": t - timedelta(days=2)}]})  # fmt: skip
    await ensure_paths(db)
    courses = [
        c["id"] for g in await courses_for(db, ["Microsoft Excel", "SQL", "Power BI"], per=2) for c in g["courses"]
    ]
    await db[LEARN_PROGRESS].insert_one({"_id": f"{MEERA}:data-analyst", "user_id": MEERA, "role": "data-analyst", "courses": courses[: max(1, len(courses) // 2)],
                                         "project": {"link": "https://docs.google.com/spreadsheets/d/demo", "text": "", "at": t - timedelta(days=3)},
                                         "started_at": t - timedelta(days=10), "updated_at": t - timedelta(days=2), "verified_at": t - timedelta(days=2), "nudged_at": None})  # fmt: skip
    await db[SKILL_ATTEMPTS].insert_one({"user_id": MEERA, "skill": "SQL", "started_at": t - timedelta(days=2), "ends_at": t - timedelta(days=2), "submitted_at": t - timedelta(days=2),
                                         "score": 80, "right": 8, "total": 10, "late": False, "tab_switches": 0, "share": True, "spoken": []})  # fmt: skip
    results = {f"aptitude-numbers:{i}": {"choice": 0, "right": i % 3 != 0} for i in range(10)}
    await db[PRACTICE_ATTEMPTS].insert_one({"user_id": MEERA, "set": "aptitude-numbers", "questions": list(results), "results": results,
                                            "started_at": t - timedelta(days=4), "finished_at": t - timedelta(days=4)})  # fmt: skip
    await db[OFFER_CHECKS].insert_one({"user_id": MEERA, "label": "Bright Future offer (demo)", "at": t - timedelta(days=1), "result": await rule_check(db, BOND_OFFER),
                                       "explanation": None, "text": BOND_OFFER})  # fmt: skip
    await demo_company(db)
    from app.jobs.apply import app_key

    await db[APPLICATIONS].insert_one({"key": app_key(JOB), "user_id": MEERA, "job_id": JOB, "company_id": COMPANY, "company": "Demo Skills Pvt Ltd (demo)",
                                       "role": "Junior Data Analyst (demo)", "date": int((t - timedelta(days=9)).timestamp() * 1000), "resume_id": "r1", "resume_name": "My resume",
                                       "url": f"/jobs/{JOB}", "notes": "", "next": None, "channel": "nm7", "origin": "manual", "demo": True, "company_removed_at": None,
                                       "status": "rejected", "updated_at": t - timedelta(days=5),
                                       "created_at": t - timedelta(days=9), "timeline": [{"status": "applied", "at": t - timedelta(days=9)}, {"status": "rejected", "at": t - timedelta(days=5)}],
                                       "feedback": {"reasons": ["communication", "skills"], "skill": "Power BI",
                                       "note": "Good SQL. Practise explaining your project in two minutes.", "at": t - timedelta(days=5)}})  # fmt: skip
    p = await db[PROGRAMS].find_one({"_id": "demo-seek-project"})
    if not p:
        await db[PROGRAMS].insert_one({"_id": "demo-seek-project", "company_id": COMPANY, "kind": "project", "title": "Sales dashboard (demo project)",
                                       "brief": "Build a one-page dashboard from sample sales data, with three charts and short notes.", "deliverable": "A link to your dashboard",
                                       "deadline": (t + timedelta(days=10)).astimezone(IST).date().isoformat(), "weeks": 2, "stipend": 0, "remote": True, "city": "",
                                       "seats": 5, "accepted": 1, "status": "closed", "flags": [], "demo": True, "created_at": t - timedelta(days=30)})  # fmt: skip
    await db[PROGRAM_APPS].insert_one({"program_id": "demo-seek-project", "company_id": COMPANY, "user_id": MEERA, "status": "completed", "note": "",
                                       "created_at": t - timedelta(days=28), "accepted_at": t - timedelta(days=27), "completed_at": t - timedelta(days=14),
                                       "submission": {"link": "https://example.com/demo-dashboard", "text": "", "at": t - timedelta(days=15)},
                                       "review": {"ok": True, "note": "Clear and tidy.", "at": t - timedelta(days=14)}, "cert": "demo" + secrets.token_urlsafe(6)})  # fmt: skip
    return {"student": MEERA, "picks": picks}


async def arjun(db) -> dict[str, Any]:
    t = now()
    await user(db, ARJUN, "Arjun (demo)", STUDENTS["arjun"][2], {})
    join = (t.astimezone(IST).date() - timedelta(days=9)).isoformat()  # today is day 10
    await db[JOININGS].insert_one({"user_id": ARJUN, "company_id": None, "company": "Demo Retail Pvt Ltd (demo)", "role": "Store associate", "join_date": join,
                                   "source": "self", "checklist": ["w1-docs", "w1-pay"], "checkins": {"7": {"ok": True, "at": t - timedelta(days=3)}},
                                   "checkin_mailed": [7], "created_at": t - timedelta(days=9)})  # fmt: skip
    return {"student": ARJUN}


class DemoIn(CamelModel):
    who: Literal["meera", "arjun"]


@admin.post("/demo")
async def open_demo(body: DemoIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    await rate_limit.check(db, f"demo-seek:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-seek:{auth.user.id}")
    uid, _, _, path = STUDENTS[body.who]
    await remove(db, uid)
    out = await (meera(db) if body.who == "meera" else arjun(db))
    token = secrets.token_urlsafe(32)
    await db[USERS].update_one(
        {"_id": uid},
        {"$set": {"demo_login_hash": hash_token(token), "demo_login_exp": now() + LINK_TTL, "demo_path": path}},
    )
    await audit(db, auth.user.id, "demo_seek_open", target=uid, data={"who": body.who}, ip=client_ip(request))
    return {"path": f"/demo-student#t={token}", **out}
