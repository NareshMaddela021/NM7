"""The Easy dashboard demo (Phase 4): "Ravi Kumar (demo)", a made-up student who uses the simple dashboard in Telugu,
with a half-done resume (no project yet), a job readiness score near 60%, the demo company's jobs as his top jobs and
one "Needs your answer" question. Demo-only, never public: the jobs are demo jobs (never on the board), the address
ends in demo.nm7.invalid, and demo students are left out of the real morning run.

  POST /api/admin/simple/demo   Admin → Auto Apply → "Reset and open as student (Easy dashboard, Telugu)": resets
                                Ravi, returns a one-time link (5 minutes; only a hash is stored). The link opens
                                /demo-student, which signs this browser in as Ravi and goes to /me/simple.
"""

import secrets
import uuid
from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.models import User
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import APPLICATIONS, AUTO_ITEMS, COMPANIES, DB, JOBS, RESUMES, USERS
from app.core.security import hash_password, hash_token
from app.core.time import now

admin = APIRouter(prefix="/api/admin/simple", tags=["easy dashboard"])

STUDENT_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "https://nm7.si/demo/ravi-kumar"))  # user ids are UUIDs
EMAIL = "ravi.student@demo.nm7.invalid"
NAME = "Ravi Kumar (demo)"
LINK_TTL = timedelta(minutes=5)
PATH = "/me/simple"

# half-done: contact, studies, skills, a certificate and a LinkedIn link; no project or internship yet
RESUME = {
    "personal": {"name": NAME, "email": EMAIL, "phone": "+91 90000 00001", "location": "Anantapur"},
    "links": {"linkedin": "linkedin.com/in/demo-ravi"},
    "summary": "Mechanical engineering graduate from Anantapur who knows AutoCAD, Excel and SQL, and keeps "
    "simple reports in Power BI. Looking for a first job as a trainee engineer or analyst.",
    "exp": [],
    "edu": [
        {
            "institution": "Demo Engineering College",
            "degree": "B.Tech",
            "field": "Mechanical",
            "from": "2021-08",
            "to": "2025",
            "grade": "7.6 CGPA",
        }
    ],
    "skillGroups": [
        {"id": "core", "label": "Skills", "value": "AutoCAD, Excel, SQL, Power BI, Communication, Manual Testing"}
    ],
    "proj": [],
    "certs": [{"name": "AutoCAD basics (demo)", "issuer": "Demo Skill Centre", "issueDate": "2025-02"}],
    "langs": [{"name": "Telugu", "level": "Native"}, {"name": "English", "level": ""}],
}


async def remove(db) -> None:
    await db[AUTO_ITEMS].delete_many({"user_id": STUDENT_ID})
    await db[APPLICATIONS].delete_many({"user_id": STUDENT_ID})
    await db[RESUMES].delete_many({"user_id": STUDENT_ID})
    await db[USERS].delete_one({"_id": STUDENT_ID, "demo": True})


async def create(db) -> dict[str, Any]:
    from app.autoapply import engine
    from app.companies import demo as company_demo
    from app.jobs import fit as fitmod

    await remove(db)
    if not await db[COMPANIES].find_one({"_id": company_demo.COMPANY_ID}) or not await db[JOBS].count_documents(
        {"company_id": company_demo.COMPANY_ID}
    ):
        await company_demo.create(db)
    t = now()
    user = User(
        id=STUDENT_ID,
        email=EMAIL,
        name=NAME,
        role="customer",
        password_hash=await hash_password(secrets.token_urlsafe(24)),
    )
    a = {
        "consent_at": t - timedelta(days=5),
        "on": True,
        "started_at": t - timedelta(days=5),
        "paused_at": None,
        "roles": ["Engineer", "Analyst"],
        "cities": ["Hyderabad"],
        "remote": True,
        "experience": [],
        "min_salary": None,
        "min_score": 50,
        "daily_limit": 3,
        "avoid": [],
        "job_types": [],
        "run_day": engine.today(t),
    }
    simple = {"lang": "te", "mode": "simple", "auto_read": False, "updated_at": t}
    await db[USERS].insert_one(
        {**user.to_mongo(), "demo": True, "email_verified_at": t, "auto_apply": a, "simple": simple}
    )
    await db[RESUMES].insert_one(
        {
            "key": "r1",
            "user_id": STUDENT_ID,
            "name": "My resume",
            "data": RESUME,
            "active": True,
            "versions": [],
            "created_at": t,
            "updated_at": t,
        }
    )
    r = await db[RESUMES].find_one({"user_id": STUDENT_ID})
    q = await db[JOBS].find_one({"company_id": company_demo.COMPANY_ID, "questions.0": {"$exists": True}})
    if q:
        await db[AUTO_ITEMS].insert_one(
            {
                "_id": str(ObjectId()),
                "user_id": STUDENT_ID,
                "job_id": q["_id"],
                "company_id": q.get("company_id"),
                "company": q["company"]["name"],
                "title": q["title"],
                "slug": q["slug"],
                "channel": q["apply"]["method"],
                "state": "needs_answer",
                "kind": "questions",
                "score": fitmod.fit(q, fitmod.Person(r))["score"],
                "missing": [x["id"] for x in q.get("questions") or []],
                "created_at": t,
                "updated_at": t,
                "demo": True,
            }
        )
    return {"student": STUDENT_ID, "items": await db[AUTO_ITEMS].count_documents({"user_id": STUDENT_ID})}


@admin.post("/demo")
async def open_demo(request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    await rate_limit.check(db, f"demo-simple:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-simple:{auth.user.id}")
    out = await create(db)
    token = secrets.token_urlsafe(32)
    await db[USERS].update_one(
        {"_id": STUDENT_ID},
        {"$set": {"demo_login_hash": hash_token(token), "demo_login_exp": now() + LINK_TTL, "demo_path": PATH}},
    )
    await audit(db, auth.user.id, "demo_simple_open", target=STUDENT_ID, data=out, ip=client_ip(request))
    return {"path": f"/demo-student#t={token}", **out}
