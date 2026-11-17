"""The demo company (Phase 2): "Demo Tech Solutions (demo)" with 2 admins, 5 jobs and applicants from the demo
college, plus 3 sample sign-ups in Admin → Companies (clean, duplicate GSTIN, same-address burst). Everything is
marked demo, so it is never on the job board, a company page, search or a sitemap.

  POST   /api/admin/demo-company/open    reset the demo company and sign this browser in as its main admin
                                         → {session} (the page keeps it like a company sign-in, then opens /company)
  DELETE /api/admin/demo-company         remove it all

Made-up people only: the admins' addresses end in demo.nm7.invalid (no email can reach them); the applicants are the
demo college's made-up students. Auto Apply 2.0 (A2): three of them arrive "Sent by Auto Apply" (match score with 3
reasons, a cover note, notice period, expected salary and the tailored resume), and the two live jobs show the
per-job Auto Apply controls.
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
from app.core.db import (
    APPLICATIONS,
    AUTO_COPIES,
    AUTO_ITEMS,
    COMPANIES,
    DB,
    JOB_REPORTS,
    JOBS,
    RECRUITERS,
    RESUMES,
    TALENT_POOL,
    USERS,
)
from app.core.security import keyed_hash
from app.core.time import now
from app.jobs.apply import app_key
from app.jobs.model import JobIn, slug_for, to_doc
from app.site import get_site

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
    await db[AUTO_ITEMS].delete_many({"company_id": COMPANY_ID, "demo": True})
    await db[AUTO_COPIES].delete_many({"job_id": {"$in": job_ids}})
    await db[RECRUITERS].delete_many({"email_lc": {"$regex": r"@demo\.nm7\.invalid$"}})
    return n


def _company(cid: str, name: str, members: list[dict[str, Any]], website: str = SITE, **over) -> dict[str, Any]:
    t = now()
    c = {
        "_id": cid,
        "slug": f"{cid}-demo",
        "kind": "company",
        "details": {
            "legal_name": name,
            "website": website,
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
    # each sample has its own website; the clean one has both emails confirmed, so Approve works (fix round item 10);
    # the duplicate one still waits for its company email; the burst one's emails aren't on its website (item 22)
    pending = {"review": {"state": "pending", "submitted_at": t}, "verified_until": None}

    ip = keyed_hash("demo-company-ip", "203.0.113.7")[:32]
    samples = [
        _company(
            SAMPLES[0],
            "Clean Sample Software Pvt Ltd (demo)",
            [_member("founder@clean.demo.nm7.invalid", "Clean sample founder (demo)", "main")],
            reg={"kind": "cin", "number": "U72200TG2019PTC123456"},
            reg_key="cin:U72200TG2019PTC123456",
            company_email="hr@clean.demo.nm7.invalid",
            emails={"admin": t, "company": t},
            domain={"name": "clean.demo.nm7.invalid", "mx": True, "age_days": 1400},
            website="https://clean.demo.nm7.invalid",
            **pending,
        ),
        _company(
            SAMPLES[1],
            "Duplicate GSTIN Sample (demo)",
            [_member("owner@dupe.demo.nm7.invalid", "Duplicate sample owner (demo)", "main")],
            flags=[{"code": "duplicate_registration", "text": "The same registration number is on another account."}],
            emails={"admin": t},
            domain={"name": "dupe.demo.nm7.invalid", "mx": True, "age_days": 700},
            website="https://dupe.demo.nm7.invalid",
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
            company_email="jobs@burst-careers.invalid",
            emails={"admin": t, "company": t},
            domain={"name": "burst-careers.invalid", "mx": True, "age_days": 12},
            website="https://burst-careers.invalid",
            **pending,
        ),
    ]
    await db[COMPANIES].insert_many(samples)
    # 5 jobs (marked demo: never public). Only as many live as the posting limit allows, less one, so "Post a job"
    # can be tried straight away (fix round item 11); the rest are closed (filled) and keep their applicants.
    live = max(1, int((await get_site(db))["companies"]["verified_live_jobs"]) - 1)
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
            "status": "active" if i < live else "closed",
            "posted_at": t - timedelta(days=i * 2 + 1),
            "source": "company",
            "company_id": COMPANY_ID,
            "created_at": t - timedelta(days=i * 2 + 1),
            "updated_at": t,
            "created_by": MAIN[0],
            "edit_count": 0,
            "demo": True,
            "questions": qs,
            "closed_reason": "" if i < live else "filled",
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
    rest = [u for u in students if u["_id"] in with_resume][len(pool) : len(pool) + len(AUTO_PLAN)]
    auto = await _auto_applicants(db, jobs, rest, t)
    await refresh(db, COMPANY_ID)
    return {
        "company": COMPANY_ID,
        "jobs": len(jobs),
        "live": live,
        "applicants": len(apps) + auto,
        "auto": auto,
        "samples": len(samples),
    }


# Auto Apply 2.0 (A2): (job index, status, notice, expected salary a year) for the demo's auto applicants
AUTO_PLAN = [
    (0, "applied", "30_days", 400000),
    (0, "shortlisted", "immediate", 350000),
    (1, "applied", "15_days", None),
]
AUTO_CONTROLS = [{"accept": True, "max": 50, "min_level": 0}, {"accept": True, "max": 20, "min_level": 0}]


async def _auto_applicants(db, jobs: list[dict[str, Any]], people: list[dict[str, Any]], t) -> int:
    """Demo students whose applications came through Auto Apply 2.0, exactly as a real one is stored: the item, the
    tailored version (rules version: the demo never calls the AI), and the application with what the company sees."""
    from bson import ObjectId

    from app.autoapply import instant, score, tailoring, v2engine
    from app.jobs import fit as fitmod

    for j, ctl in zip(jobs, AUTO_CONTROLS, strict=False):
        await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"auto_controls": ctl}})
    n = 0
    for k, (u, (ji, status, notice, salary)) in enumerate(zip(people, AUTO_PLAN, strict=False)):
        j = jobs[ji]
        r = await db[RESUMES].find_one({"user_id": u["_id"]})
        p = fitmod.Person(r) if r else None
        if not p or not p.usable():
            continue
        a = {"notice_period": notice, "min_salary": salary, "cities": j.get("locations") or [], "remote": True}
        parts = score.parts(j, fitmod.fit(j, p), a, 1, None, t)
        copy = await tailoring.build(db, u["_id"], r, j, a, use_ai=False)
        at = t - timedelta(hours=3 + k)
        it = {"_id": str(ObjectId()), "user_id": u["_id"], "job_id": j["_id"], "company_id": COMPANY_ID,
              "company": NAME, "title": j["title"], "slug": j["slug"], "channel": "nm7", "state": "applied",
              "copy_id": copy["_id"], "applied_at": at, "created_at": at, "updated_at": at, "demo": True,
              "instant": True, **v2engine._item_extra(parts, j)}  # fmt: skip
        await db[AUTO_ITEMS].insert_one(it)
        answers = {"q1": "yes", "q2": 8} if ji == 0 else {"q1": "Either"}
        answers, _ = qmod.answers_for(j["questions"], answers) if j["questions"] else ({}, [])
        why = qmod.knockout(j["questions"], answers)
        tl = [{"status": "applied", "at": at}] + ([{"status": status, "at": at + timedelta(hours=1)}]
                                                  if status != "applied" else [])  # fmt: skip
        await db[APPLICATIONS].insert_one({
            "key": app_key(j["_id"]), "user_id": u["_id"], "company": NAME[:120], "role": j["title"],
            "status": status, "date": int(at.timestamp() * 1000), "resume_id": r["key"],
            "resume_name": f"{copy['name']} (Auto Apply)"[:120], "url": "", "notes": "", "next": None,
            "job_id": j["_id"], "channel": "nm7", "origin": "auto", "auto_item_id": it["_id"], "copy_id": copy["_id"],
            "score": parts["score"], "v2": True, "channel_v2": "internal", "cover_note": copy.get("cover_note") or [],
            "auto_v2": {"label": instant.LABEL, "score": parts["score"], "parts": parts["parts"],
                        **(await instant.facts(db, {"_id": u["_id"], "auto_apply": a})), "at": at},
            "timeline": tl, "created_at": at, "updated_at": at, "consent_at": at, "answers": answers,
            "company_id": COMPANY_ID, "fit": {"ok": not why, "reasons": why}, "demo": True,
        })  # fmt: skip
        n += 1
    return n


@router.post("/open")
async def open_demo(request: Request, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    from app.orgs.recruiter_account import issue_session

    await rate_limit.check(db, f"demo-company:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-company:{auth.user.id}")
    from app.core.heavy import heavy_or_busy

    async with heavy_or_busy(db):  # one heavy job at a time (app/core/heavy.py)
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
