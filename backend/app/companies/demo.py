"""The demo company (Phase 2): "Demo Tech Solutions (demo)" with 2 admins, 5 jobs and applicants from the demo
college, plus 3 sample sign-ups in Admin → Companies (clean, duplicate GSTIN, same-address burst). Everything is
marked demo, so it is never on the job board, a company page, search or a sitemap.

  POST   /api/admin/demo-company/open    reset the demo company and sign this browser in as its main admin
                                         → {session} (the page keeps it like a company sign-in, then opens /company)
  DELETE /api/admin/demo-company         remove it all

Made-up people only: the admins' addresses end in demo.nm7.invalid (no email can reach them); the applicants are the
demo college's made-up students.
"""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies import questions as qmod
from app.companies.model import trust_of
from app.core import rate_limit
from app.core.db import APPLICATIONS, COMPANIES, DB, JOB_REPORTS, JOBS, RECRUITERS, RESUMES, TALENT_POOL, USERS
from app.core.security import keyed_hash
from app.core.time import now
from app.jobs.apply import app_key
from app.jobs.model import JobIn, slug_for, to_doc

router = APIRouter(prefix="/api/admin/demo-company", tags=["companies"])

COMPANY_ID = "demo-tech-solutions"
NAME = "Demo Tech Solutions (demo)"
SITE = "https://demotech.demo.nm7.invalid"
MAIN = ("priya.admin@demo.nm7.invalid", "Priya (demo admin)")
SECOND = ("ravi.hr@demo.nm7.invalid", "Ravi (demo HR)")
GSTIN = "36AAACD1234E1ZS"  # a made-up number in the GSTIN shape, for the duplicate-registration sample
SAMPLES = ("demo-signup-clean", "demo-signup-duplicate", "demo-signup-burst")

JOBS_DEMO = [
    {
        "title": "Junior Data Analyst",
        "skills": ["SQL", "Excel", "Power BI"],
        "locations": ["Hyderabad"],
        "questions": [
            {"text": "Can you work from Hyderabad?", "kind": "yesno", "want": "yes"},
            {"text": "How many months have you used SQL?", "kind": "number", "min": 3},
        ],
    },
    {
        "title": "Software Engineer Trainee",
        "skills": ["Java", "SQL", "Git"],
        "locations": ["Hyderabad", "Pune"],
        "questions": [
            {
                "text": "Which shift suits you?",
                "kind": "choice",
                "options": ["Day", "Night", "Either"],
                "accept": ["Day", "Either"],
            }
        ],
    },
    {"title": "QA Engineer Trainee", "skills": ["Manual Testing", "SQL"], "locations": ["Bengaluru"], "questions": []},
    {
        "title": "Frontend Developer Intern",
        "skills": ["JavaScript", "React", "HTML", "CSS"],
        "locations": [],
        "work": "remote",
        "type": "internship",
        "exp": "internship",
        "questions": [],
    },
    {"title": "Support Engineer", "skills": ["Communication", "Excel"], "locations": ["Chennai"], "questions": []},
]


async def remove(db) -> int:
    ids = [COMPANY_ID, *SAMPLES]
    job_ids = [j["_id"] async for j in db[JOBS].find({"company_id": COMPANY_ID}, {"_id": 1})]
    n = (await db[COMPANIES].delete_many({"_id": {"$in": ids}, "demo": True})).deleted_count
    await db[JOBS].delete_many({"company_id": COMPANY_ID, "demo": True})
    await db[APPLICATIONS].delete_many({"company_id": COMPANY_ID, "demo": True})
    await db[TALENT_POOL].delete_many({"company_id": COMPANY_ID})
    await db[JOB_REPORTS].delete_many({"job_id": {"$in": job_ids}})
    await db[RECRUITERS].delete_many({"email_lc": {"$regex": r"@demo\.nm7\.invalid$"}})
    return n


def _company(cid: str, name: str, members: list[dict[str, Any]], **over) -> dict[str, Any]:
    t = now()
    c = {
        "_id": cid,
        "slug": f"{cid}-demo",
        "kind": "company",
        "details": {
            "legal_name": name,
            "website": SITE,
            "category": "startup",
            "structure": "private_limited",
            "industry": "Software",
            "size": "51_200",
            "about": "A made-up company for Nm7 demos. It isn’t real and isn’t on the job board.",
        },
        "reg": {"kind": "gstin", "number": GSTIN},
        "reg_key": f"gstin:{GSTIN}",
        "individual": None,
        "phone": "",
        "phone_key": None,
        "admin_email": members[0]["email_lc"],
        "company_email": "",
        "emails": {"admin": t},
        "members": members,
        "review": {"state": "approved"},
        "verified_until": t + timedelta(days=365),
        "signup": {"ip_hash": None, "at": t},
        "domain": {"name": "demo.nm7.invalid", "mx": True, "age_days": 900},
        "flags": [],
        "created_at": t,
        "updated_at": t,
        "demo": True,
    }
    c.update(over)
    c["trust"] = trust_of(c)
    return c


def _member(email: str, name: str, role: str) -> dict[str, Any]:
    return {"email_lc": email, "name": name, "role": role, "status": "active", "at": now()}


async def create(db) -> dict[str, Any]:
    from app.companies.trust import refresh
    from app.orgs.demo import create_demo

    await remove(db)
    t = now()
    # applicants come from the demo college's made-up students (made first: resetting it clears demo jobs)
    students = [u async for u in db[USERS].find({"demo": True, "role": "customer"}, {"name": 1}).limit(60)]
    with_resume = {r["user_id"] async for r in db[RESUMES].find({"user_id": {"$in": [u["_id"] for u in students]}})}
    if not with_resume:
        await create_demo(db)
        students = [u async for u in db[USERS].find({"demo": True, "role": "customer"}, {"name": 1}).limit(60)]
        with_resume = {r["user_id"] async for r in db[RESUMES].find({"user_id": {"$in": [u["_id"] for u in students]}})}
    company = _company(
        COMPANY_ID,
        NAME,
        [_member(*MAIN, "main"), _member(*SECOND, "full")],
        company_email=f"jobs@{SITE.removeprefix('https://')}",
        emails={"admin": t, "company": t},
    )
    await db[COMPANIES].insert_one(company)
    # the 3 sample sign-ups waiting in Admin → Companies
    pending = {"review": {"state": "pending", "submitted_at": t}, "verified_until": None, "emails": {"admin": t}}
    ip = keyed_hash("demo-company-ip", "203.0.113.7")[:32]
    samples = [
        _company(
            SAMPLES[0],
            "Clean Sample Software Pvt Ltd (demo)",
            [_member("founder@clean.demo.nm7.invalid", "Clean sample founder (demo)", "main")],
            reg={"kind": "cin", "number": "U72200TG2019PTC123456"},
            reg_key="cin:U72200TG2019PTC123456",
            **pending,
        ),
        _company(
            SAMPLES[1],
            "Duplicate GSTIN Sample (demo)",
            [_member("owner@dupe.demo.nm7.invalid", "Duplicate sample owner (demo)", "main")],
            flags=[{"code": "duplicate_registration", "text": "The same registration number is on another account."}],
            **pending,
        ),
        _company(
            SAMPLES[2],
            "Same Address Burst Sample (demo)",
            [_member("hr@burst.demo.nm7.invalid", "Burst sample HR (demo)", "main")],
            reg={"kind": "llpin", "number": "AAB-9876"},
            reg_key="llpin:AAB-9876",
            signup={"ip_hash": ip, "at": t},
            flags=[
                {"code": "ip_burst", "text": "3 sign-ups from the same address within 2 hours."},
                {"code": "new_domain", "text": "The website domain was registered 12 days ago."},
            ],
            domain={"name": "burst.demo.nm7.invalid", "mx": True, "age_days": 12},
            **pending,
        ),
    ]
    await db[COMPANIES].insert_many(samples)
    # 5 jobs (marked demo: never public)
    jobs = []
    for i, spec in enumerate(JOBS_DEMO):
        body = JobIn.model_validate(
            {
                "title": spec["title"],
                "company": {"name": NAME, "website": SITE},
                "description": f"{spec['title']} at a made-up company for Nm7 demos. "
                f"Work with {', '.join(spec['skills'])} "
                "in a small, friendly team. Freshers welcome; training given.",
                "locations": spec["locations"],
                "workType": spec.get("work", "onsite"),
                "jobType": spec.get("type", "full_time"),
                "experience": spec.get("exp", "fresher"),
                "skills": spec["skills"],
                "applyMethod": "nm7",
            }
        )
        qs, _ = qmod.parse(spec["questions"])
        doc = {
            **to_doc(body),
            "_id": f"{COMPANY_ID}-job-{i + 1}",
            "slug": f"{slug_for(body.title, NAME)}-demo{i + 1}",
            "status": "active",
            "posted_at": t - timedelta(days=i * 2 + 1),
            "source": "company",
            "company_id": COMPANY_ID,
            "created_at": t - timedelta(days=i * 2 + 1),
            "updated_at": t,
            "created_by": MAIN[0],
            "edit_count": 0,
            "demo": True,
            "questions": qs,
            "closed_reason": "",
            "link_check": {"at": None, "ok": None, "status": None, "fails": 0, "error": ""},
            "review": {"reasons": [], "ai": None, "warnings": []},
            "dedupe_key": f"company:{COMPANY_ID}:{i}",
        }
        jobs.append(doc)
    await db[JOBS].insert_many(jobs)
    pool = [u for u in students if u["_id"] in with_resume][:14]
    plan = [
        (0, "viewed"),
        (0, "shortlisted"),
        (0, "applied"),
        (0, "interview"),
        (0, "rejected"),
        (0, "applied"),
        (1, "applied"),
        (1, "shortlisted"),
        (1, "viewed"),
        (1, "offer"),
        (2, "applied"),
        (2, "viewed"),
        (3, "applied"),
        (3, "shortlisted"),
    ]
    answers = [
        {"q1": "yes", "q2": 12},
        {"q1": "yes", "q2": 6},
        {"q1": "no", "q2": 2},
        {"q1": "yes", "q2": 9},
        {"q1": "yes", "q2": 1},
        {"q1": "yes", "q2": 4},
        {"q1": "Day"},
        {"q1": "Either"},
        {"q1": "Night"},
        {"q1": "Day"},
    ]
    apps = []
    for k, (u, (ji, status)) in enumerate(zip(pool, plan, strict=False)):
        j = jobs[ji]
        at = t - timedelta(days=ji + 1, hours=k)
        ans = answers[k] if ji in (0, 1) and k < len(answers) else {}
        ans, _ = qmod.answers_for(j["questions"], ans) if j["questions"] else ({}, [])
        why = qmod.knockout(j["questions"], ans)
        tl = [{"status": "applied", "at": at}] + (
            [{"status": status, "at": at + timedelta(hours=20)}] if status != "applied" else []
        )
        apps.append(
            {
                "key": app_key(j["_id"]),
                "user_id": u["_id"],
                "company": NAME[:120],
                "role": j["title"],
                "status": status,
                "date": int(at.timestamp() * 1000),
                "resume_id": None,
                "resume_name": "Main",
                "url": "",
                "notes": "",
                "next": None,
                "job_id": j["_id"],
                "channel": "nm7",
                "timeline": tl,
                "created_at": at,
                "updated_at": at,
                "consent_at": at,
                "answers": ans,
                "company_id": COMPANY_ID,
                "fit": {"ok": not why, "reasons": why},
                "demo": True,
            }
        )
    if apps:
        await db[APPLICATIONS].insert_many(apps)
    await refresh(db, COMPANY_ID)
    return {"company": COMPANY_ID, "jobs": len(jobs), "applicants": len(apps), "samples": len(samples)}


@router.post("/open")
async def open_demo(request: Request, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    from app.orgs.recruiter_account import issue_session

    await rate_limit.check(db, f"demo-company:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-company:{auth.user.id}")
    out = await create(db)
    session = await issue_session(db, MAIN[0], MAIN[1], request=request)
    await audit(db, auth.user.id, "demo_company_open", target=COMPANY_ID, data=out, ip=client_ip(request))
    return {"session": session, **out}


@router.delete("")
async def delete_demo(request: Request, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    n = await remove(db)
    await audit(
        db, auth.user.id, "demo_company_remove", target=COMPANY_ID, data={"companies": n}, ip=client_ip(request)
    )
    return {"removed": n}
