"""The Auto Apply demo (Phase 3): a made-up student with Auto Apply on and one of each item against the demo company's
jobs: applied on Nm7 (labelled Auto for the company), sent by email (a recorded copy; nothing is really sent), needs
your answer (a screening question) and ready to apply (a website job). Three demo-college students get Auto Apply
switched on too. Demo-only: the jobs are demo jobs (never on the board), the addresses end in demo.nm7.invalid, and
demo students are left out of the real morning run, so no email ever goes to them.

  POST /api/admin/auto-apply/demo        Admin → Auto Apply → "Reset and open as student (Auto Apply)": resets the
                                         demo, returns a one-time link (5 minutes; only a hash is stored)
  POST /api/public/demo-student {token}  signs this browser in as the demo student → then /me/auto-apply (the Easy
                                         dashboard's demo student, app/simple/demo.py, → /me/simple)
"""

import secrets
from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request, Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.models import User
from app.auth.sessions import client_ip, start_session
from app.core import rate_limit
from app.core.db import APPLICATIONS, AUTO_COPIES, AUTO_ITEMS, COMPANIES, DB, JOBS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import hash_password, hash_token
from app.core.time import now
from app.jobs.apply import app_key, job_page

admin = APIRouter(prefix="/api/admin/auto-apply", tags=["auto apply admin"])
public = APIRouter(prefix="/api/public/demo-student", tags=["public"])

STUDENT_ID = "d2bf50b5-0549-5733-b21c-d176dff5619e"  # a fixed id (user ids are UUIDs)
EMAIL = "kavya.student@demo.nm7.invalid"
LINK_TTL = timedelta(minutes=5)
EXTRA_JOBS = ("demo-tech-solutions-job-web", "demo-tech-solutions-job-mail")

RESUME = {
    "personal": {
        "name": "Kavya Reddy (demo)",
        "headline": "Data Analyst · SQL · Power BI",
        "email": EMAIL,
        "phone": "+91 90000 00000",
        "location": "Hyderabad",
    },
    "links": {"linkedin": "linkedin.com/in/demo-kavya"},
    "summary": "Computer Science graduate who builds Power BI dashboards and SQL reports. Built 3 college projects "
    "with 2 teams and cut a weekly report from 2 hours to 20 minutes.",
    "exp": [
        {
            "company": "Demo Retail (demo)",
            "role": "Data Analyst Intern",
            "employmentType": "Internship",
            "from": "2025-01",
            "to": "2025-06",
            "current": False,
            "description": "Built 4 Power BI dashboards for 6 store managers\nAutomated a weekly Excel report in "
            "Python, saving 3 hours a week\nAnalyzed 1 year of sales data in SQL to find 2 slow "
            "product lines",
        }
    ],
    "edu": [
        {
            "institution": "Demo Engineering College",
            "degree": "B.Tech",
            "field": "Computer Science",
            "from": "2021-08",
            "to": "2025-05",
            "grade": "8.4 CGPA",
        }
    ],
    "skillGroups": [
        {"id": "core", "label": "Core", "value": "SQL, Python, Statistics, Excel, Data Cleaning"},
        {"id": "tools", "label": "Tools", "value": "Power BI, Tableau, Git, Jupyter, Java"},
    ],
    "proj": [
        {
            "title": "College fest dashboard",
            "tagline": "Power BI dashboard for 1,200 ticket sales",
            "description": "",
            "tech": "Power BI, SQL",
        }
    ],
}


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)


async def _extra_jobs(db, company: dict[str, Any]) -> list[dict[str, Any]]:
    """Two demo jobs the demo company doesn't have: one on its own website, one that takes email."""
    from app.jobs.model import JobIn, slug_for, to_doc

    t = now()
    name = company["details"]["legal_name"]
    out = []
    for jid, title, method in (
        (EXTRA_JOBS[0], "Data Engineer Intern", "link"),
        (EXTRA_JOBS[1], "Reporting Analyst", "email"),
    ):
        body = JobIn.model_validate(
            {
                "title": title,
                "company": {"name": name, "website": company["details"]["website"]},
                "description": f"{title} at a made-up company for Nm7 demos. "
                "Work with SQL and Power BI in a small team. "
                "Freshers welcome.",
                "locations": ["Hyderabad"],
                "workType": "onsite",
                "jobType": "internship" if "Intern" in title else "full_time",
                "experience": "fresher",
                "skills": ["SQL", "Power BI"],
                "applyMethod": method,
                "applyUrl": "https://demotech.demo.nm7.invalid/careers" if method == "link" else "",
                "applyEmail": "hr@demotech.demo.nm7.invalid" if method == "email" else "",
            }
        )
        doc = {
            **to_doc(body),
            "_id": jid,
            "slug": f"{slug_for(title, name)}-{jid[-4:]}",
            "status": "active",
            "posted_at": t,
            "source": "company",
            "company_id": company["_id"],
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


async def remove(db) -> None:
    await db[AUTO_ITEMS].delete_many({"user_id": STUDENT_ID})
    await db[AUTO_COPIES].delete_many({"user_id": STUDENT_ID})
    await db[APPLICATIONS].delete_many({"user_id": STUDENT_ID})
    await db[RESUMES].delete_many({"user_id": STUDENT_ID})
    await db[JOBS].delete_many({"_id": {"$in": list(EXTRA_JOBS)}})
    await db[USERS].delete_one({"_id": STUDENT_ID, "demo": True})


async def create(db) -> dict[str, Any]:
    from app.autoapply import engine
    from app.companies import demo as company_demo

    await remove(db)
    c = await db[COMPANIES].find_one({"_id": company_demo.COMPANY_ID})
    if not c or not await db[JOBS].count_documents({"company_id": company_demo.COMPANY_ID}):
        await company_demo.create(db)
        c = await db[COMPANIES].find_one({"_id": company_demo.COMPANY_ID})
    t = now()
    user = User(
        id=STUDENT_ID,
        email=EMAIL,
        name="Kavya Reddy (demo)",
        role="customer",
        password_hash=await hash_password(secrets.token_urlsafe(24)),
    )
    a = {
        "consent_at": t - timedelta(days=10),
        "on": True,
        "started_at": t - timedelta(days=10),
        "paused_at": None,
        "roles": ["Analyst", "Engineer", "Developer"],
        "cities": ["Hyderabad", "Pune"],
        "remote": True,
        "experience": [],
        "min_salary": None,
        "min_score": 60,
        "daily_limit": 5,
        "avoid": [],
        "job_types": [],
        "run_day": engine.today(t),
    }
    await db[USERS].insert_one({**user.to_mongo(), "demo": True, "email_verified_at": t, "auto_apply": a})
    await db[RESUMES].insert_one(
        {
            "key": "r1",
            "user_id": STUDENT_ID,
            "name": "Main resume",
            "data": RESUME,
            "active": True,
            "versions": [],
            "created_at": t,
            "updated_at": t,
        }
    )
    u = await db[USERS].find_one({"_id": STUDENT_ID})
    r = await db[RESUMES].find_one({"user_id": STUDENT_ID})
    jobs = {j["_id"]: j async for j in db[JOBS].find({"company_id": company_demo.COMPANY_ID})}
    web, mail = await _extra_jobs(db, c)
    j_apply = jobs.get(f"{company_demo.COMPANY_ID}-job-1")
    j_question = jobs.get(f"{company_demo.COMPANY_ID}-job-2")

    async def item(j, state, **extra):
        doc = {
            "_id": str(ObjectId()),
            "user_id": STUDENT_ID,
            "job_id": j["_id"],
            "company_id": j.get("company_id"),
            "company": j["company"]["name"],
            "title": j["title"],
            "slug": j["slug"],
            "channel": j["apply"]["method"],
            "state": state,
            "created_at": t,
            "updated_at": t,
            "demo": True,
            **extra,
        }
        await db[AUTO_ITEMS].insert_one(doc)
        return doc

    from app.jobs import fit as fitmod

    p = fitmod.Person(r)
    if j_apply:
        it = await item(j_apply, "applying", score=fitmod.fit(j_apply, p)["score"], counted_day=engine.today(t))
        copy = await engine.tailored_copy(db, STUDENT_ID, r, j_apply, use_ai=False)
        app = await engine.apply_nm7(db, it, j_apply, u, copy, {})
        await db[APPLICATIONS].update_one({"_id": app["_id"]}, {"$set": {"demo": True}})
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]}, {"$set": {"state": "applied", "applied_at": t, "copy_id": copy["_id"]}}
        )
    if j_question:
        await item(
            j_question,
            "needs_answer",
            kind="questions",
            score=fitmod.fit(j_question, p)["score"],
            missing=[q["id"] for q in j_question.get("questions") or []],
        )
    copy = await engine.tailored_copy(db, STUDENT_ID, r, web, use_ai=False)
    await item(web, "ready", score=fitmod.fit(web, p)["score"], ready_day=engine.today(t), copy_id=copy["_id"])
    # an email application, recorded as if sent (demo: nothing is really sent)
    from app.autoapply import emailing, pdf

    copy = await engine.tailored_copy(db, STUDENT_ID, r, mail, use_ai=False)
    subject, text, _ = emailing.letter(
        RESUME["personal"]["name"], copy["data"], mail, ["SQL", "Power BI"], job_page(mail)
    )
    sent = {
        "to": mail["apply"]["email"],
        "subject": subject,
        "text": text,
        "at": t,
        "provider_id": None,
        "attachment": pdf.file_name(copy["data"]),
    }
    it = await item(
        mail,
        "sent",
        sent=sent,
        sent_day=engine.today(t),
        applied_at=t,
        copy_id=copy["_id"],
        counted_day=engine.today(t),
        score=fitmod.fit(mail, p)["score"],
    )
    await db[APPLICATIONS].insert_one(
        {
            "key": app_key(mail["_id"]),
            "user_id": STUDENT_ID,
            "company": mail["company"]["name"],
            "role": mail["title"],
            "status": "applied",
            "date": int(t.timestamp() * 1000),
            "resume_id": "r1",
            "resume_name": copy["name"],
            "url": job_page(mail),
            "notes": "",
            "next": None,
            "job_id": mail["_id"],
            "channel": "email",
            "origin": "auto",
            "auto_item_id": it["_id"],
            "copy_id": copy["_id"],
            "sent_email": sent,
            "demo": True,
            "timeline": [{"status": "applied", "at": t}],
            "created_at": t,
            "updated_at": t,
        }
    )
    # three demo-college students with Auto Apply on (for the admin numbers)
    n = 0
    async for s in db[USERS].find({"demo": True, "role": "customer", "_id": {"$ne": STUDENT_ID}}, {"_id": 1}).limit(3):
        await db[USERS].update_one({"_id": s["_id"]}, {"$set": {"auto_apply": {**a, "roles": ["Analyst"]}}})
        n += 1
    return {
        "student": STUDENT_ID,
        "items": await db[AUTO_ITEMS].count_documents({"user_id": STUDENT_ID}),
        "collegeStudents": n,
    }


@admin.post("/demo")
async def open_demo(request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    await rate_limit.check(db, f"demo-student:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-student:{auth.user.id}")
    out = await create(db)
    token = secrets.token_urlsafe(32)
    await db[USERS].update_one(
        {"_id": STUDENT_ID}, {"$set": {"demo_login_hash": hash_token(token), "demo_login_exp": now() + LINK_TTL}}
    )
    await audit(db, auth.user.id, "demo_student_open", target=STUDENT_ID, data=out, ip=client_ip(request))
    return {"path": f"/demo-student#t={token}", **out}


@public.post("")
async def sign_in(body: TokenIn, request: Request, response: Response, db: DB) -> dict[str, str]:
    from app.simple import demo as simple_demo  # Ravi, the Easy dashboard's demo student (Phase 4)

    doc = await db[USERS].find_one_and_update(  # one-time: cleared in the same write that accepts it
        {
            "_id": {"$in": [STUDENT_ID, simple_demo.STUDENT_ID]},
            "demo": True,
            "demo_login_hash": hash_token(body.token),
            "demo_login_exp": {"$gt": now()},
        },
        {"$set": {"demo_login_hash": None, "demo_login_exp": None}},
    )
    if not doc:
        raise ApiError(400, "link_used", "This demo link has been used or has expired. Open it again from Admin.")
    await start_session(db, request, response, User.model_validate(doc))
    return {"path": doc.get("demo_path") or "/me/auto-apply"}
