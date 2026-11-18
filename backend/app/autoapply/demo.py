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

import httpx
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
from app.core.testusers import IDS as TEST_USERS
from app.core.time import now
from app.jobs.apply import app_key, job_page

admin = APIRouter(prefix="/api/admin/auto-apply", tags=["auto apply admin"])
public = APIRouter(prefix="/api/public/demo-student", tags=["public"])

STUDENT_ID = "d2bf50b5-0549-5733-b21c-d176dff5619e"  # a fixed id (user ids are UUIDs)
EMAIL = "kavya.student@demo.nm7.invalid"
LINK_TTL = timedelta(minutes=5)
EXTRA_JOBS = ("demo-tech-solutions-job-web", "demo-tech-solutions-job-mail")
# Auto Apply 2.0 (A1): more demo-only jobs for Kavya's tracker, approval list and "Suggested for you"
V2_JOBS = (
    ("demo-tech-solutions-job-approve", "BI Analyst", "nm7", ["SQL", "Power BI"]),
    ("demo-tech-solutions-job-approve2", "Junior Reporting Analyst", "nm7", ["SQL", "Excel"]),
    ("demo-tech-solutions-job-sug1", "Data Engineer", "nm7", ["SQL", "Spark", "Airflow", "Kafka"]),
    ("demo-tech-solutions-job-sug2", "Analytics Engineer", "nm7", ["SQL", "dbt", "Snowflake", "Python"]),
    ("demo-tech-solutions-job-offer", "Data Analyst (Retail)", "nm7", ["SQL", "Power BI"]),
    ("demo-tech-solutions-job-form", "Data Analyst (Careers page)", "link", ["SQL", "Power BI"]),  # A5
    # A6: the morning "jobs ready" list (one tap with the kit); the last one closed after it was listed
    ("demo-tech-solutions-job-ready1", "Business Analyst", "link", ["SQL", "Excel"]),
    ("demo-tech-solutions-job-ready2", "SQL Developer", "link", ["SQL", "Power BI"]),
    ("demo-tech-solutions-job-closed", "MIS Analyst", "link", ["SQL", "Excel"]),
)
READY_JOBS = ("demo-tech-solutions-job-ready1", "demo-tech-solutions-job-ready2", "demo-tech-solutions-job-closed")
DEMO_SITE = "demotech.demo.nm7.invalid"
# A5: the demo company's careers form (never fetched: the demo fills this copy, nothing goes over the network)
DEMO_FORM = """<html><head><title>Careers · Demo Tech Solutions</title></head><body>
<form method="post" action="/careers/apply" enctype="multipart/form-data">
<input type="hidden" name="job" value="data-analyst">
<label for="n">Full name *</label><input id="n" name="full_name" required>
<label for="e">Email *</label><input id="e" type="email" name="email" required>
<label for="p">Mobile number</label><input id="p" type="tel" name="mobile">
<label for="c">Why do you want to join us?</label><textarea id="c" name="message"></textarea>
<label for="r">Resume (PDF) *</label><input id="r" type="file" name="resume" required>
<button type="submit">Apply</button></form></body></html>"""
DEMO_THANKS = (
    "Thank you for applying to Demo Tech Solutions. We have received your application for Data Analyst and our "
    "team will get back to you within a week."
)

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
    for jid, title, method, skills in (
        (EXTRA_JOBS[0], "Data Engineer Intern", "link", ["SQL", "Power BI"]),
        (EXTRA_JOBS[1], "Reporting Analyst", "email", ["SQL", "Power BI"]),
        *V2_JOBS,
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
                "skills": skills,
                "applyMethod": method,
                "applyUrl": (
                    f"https://demotech.demo.nm7.invalid/careers/{jid.rsplit('-', 1)[-1]}"
                    if jid in READY_JOBS
                    else "https://demotech.demo.nm7.invalid/careers"
                )
                if method == "link"
                else "",
                "applyEmail": "hr@demotech.demo.nm7.invalid" if method == "email" else "",
            }
        )
        doc = {
            **to_doc(body),
            "_id": jid,
            "slug": f"{slug_for(title, name)}-{jid[-4:]}",
            "status": "active",
            "posted_at": t,
            # added like an admin job (no company account), so they don't fill the demo company's posting
            # allowance (fix round item 11)
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


async def remove(db) -> None:
    await db[AUTO_ITEMS].delete_many({"user_id": STUDENT_ID})
    await db[AUTO_COPIES].delete_many({"user_id": STUDENT_ID})
    await db[APPLICATIONS].delete_many({"user_id": STUDENT_ID})
    await db[RESUMES].delete_many({"user_id": STUDENT_ID})
    await db[JOBS].delete_many({"_id": {"$in": [*EXTRA_JOBS, *(x[0] for x in V2_JOBS)]}})
    await db[USERS].delete_one({"_id": STUDENT_ID, "demo": True})
    from app.core.db import AUTO_MORNINGS, FORM_SITES

    await db[AUTO_MORNINGS].delete_many({"user_id": STUDENT_ID})
    from app.core.db import AUTO_REPLIES

    await db[AUTO_REPLIES].delete_many({"user_id": STUDENT_ID})  # A7: the demo replies

    await db[FORM_SITES].delete_many({"demo": True})


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
        # Auto Apply 2.0: opted in, approve each (the default), notice period for ready answers
        "v2_consent_at": t - timedelta(days=10),
        "mode": "approve",
        "notice_period": "30_days",
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
    web, mail, *v2_jobs = await _extra_jobs(db, c)
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
    await _v2(db, u, r, c, jobs, v2_jobs, t)
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
    from app.seek import demo as seek_demo  # Meera and Arjun, the job-seeker demo students (Phase 6)
    from app.simple import demo as simple_demo  # Ravi, the Easy dashboard's demo student (Phase 4)

    doc = await db[USERS].find_one_and_update(  # one-time: cleared in the same write that accepts it
        {
            "$or": [
                {"_id": {"$in": [STUDENT_ID, simple_demo.STUDENT_ID, seek_demo.MEERA, seek_demo.ARJUN]}},
                {"_id": {"$in": list(TEST_USERS)}},  # the 100 test users (app/admin/test_users.py)
            ],
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


async def _v2(db, u, r, c, jobs, extra, t) -> None:
    """Kavya in Auto Apply 2.0: every tracker state (Ready, Waiting for you, Applied, Viewed, Replied / Interview,
    Offer / Rejected / Closed), the morning approval list, waiting questions and "Suggested for you", with the match
    score parts and a tailored version (rules version: demo never calls the AI) for each."""
    from app.autoapply import score, tailoring, v2engine
    from app.jobs import fit as fitmod

    p = fitmod.Person(r)
    a = u.get("auto_apply") or {}
    # the earlier items become 2.0 items too
    async for it in db[AUTO_ITEMS].find({"user_id": STUDENT_ID}):
        j = await db[JOBS].find_one({"_id": it["job_id"]})
        if j:
            parts = score.parts(j, fitmod.fit(j, p), a, 1, None, t)
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": v2engine._item_extra(parts, j)})
    by = {j["_id"]: j for j in extra}

    async def add(j, state, status=None, **more):
        parts = score.parts(j, fitmod.fit(j, p), a, 1, None, t)
        copy = await tailoring.build(db, STUDENT_ID, r, j, a, use_ai=False)
        doc = {"_id": str(ObjectId()), "user_id": STUDENT_ID, "job_id": j["_id"], "company_id": j.get("company_id"),
               "company": j["company"]["name"], "title": j["title"], "slug": j["slug"], "channel": j["apply"]["method"],
               "state": state, "copy_id": copy["_id"], "created_at": t, "updated_at": t, "demo": True,
               **v2engine._item_extra(parts, j), **more}  # fmt: skip
        if state == "suggested":
            doc.pop("copy_id")
        await db[AUTO_ITEMS].insert_one(doc)
        if status:
            await db[APPLICATIONS].insert_one({
                "key": app_key(j["_id"]), "user_id": STUDENT_ID, "company": j["company"]["name"], "role": j["title"],
                "status": status, "date": int(t.timestamp() * 1000), "resume_id": "r1", "resume_name": copy["name"],
                "url": job_page(j), "notes": "", "next": None, "job_id": j["_id"], "channel": "nm7",
                "origin": "auto", "auto_item_id": doc["_id"], "copy_id": copy["_id"], "v2": True, "demo": True,
                "cover_note": copy.get("cover_note") or [], "answers": {},
                "timeline": [{"status": "applied", "at": t}, *([{"status": status, "at": t}] if status != "applied"
                                                              else [])],
                "created_at": t, "updated_at": t,
            })  # fmt: skip

    # A2: her application to the demo company's first job came through Auto Apply 2.0, so the company demo shows her
    # "Sent by Auto Apply" with the score, 3 reasons, the cover note, notice period and the tailored resume
    from app.autoapply import instant

    app = await db[APPLICATIONS].find_one({"user_id": STUDENT_ID, "job_id": f"{c['_id']}-job-1"})
    j1 = jobs.get(f"{c['_id']}-job-1")
    if app and j1:
        it = await db[AUTO_ITEMS].find_one({"_id": app.get("auto_item_id")}) or {}
        copy = await tailoring.build(db, STUDENT_ID, r, j1, a, use_ai=False)
        await db[AUTO_ITEMS].update_one({"_id": it.get("_id")}, {"$set": {"instant": True, "copy_id": copy["_id"]}})
        await db[APPLICATIONS].update_one(
            {"_id": app["_id"]},
            {
                "$set": {
                    "v2": True,
                    "channel_v2": "internal",
                    "copy_id": copy["_id"],
                    "cover_note": copy.get("cover_note") or [],
                    "auto_v2": await instant.payload(db, u, it),
                }
            },
        )
    day = engine_today(t)
    for jid in ("demo-tech-solutions-job-approve", "demo-tech-solutions-job-approve2"):
        await add(by[jid], "waiting_approval", mode="approve", counted_day=day)
    for jid in ("demo-tech-solutions-job-sug1", "demo-tech-solutions-job-sug2"):
        await add(by[jid], "suggested")
    await add(by["demo-tech-solutions-job-offer"], "applied", status="offer", applied_at=t)
    await _form_demo(db, u, r, by["demo-tech-solutions-job-form"], add, t)
    await _morning_demo(db, u, r, by, add, day, t)
    for n, status in ((3, "viewed"), (4, "interview"), (5, "rejected")):
        j = jobs.get(f"{c['_id']}-job-{n}")
        if j:
            await add(j, "applied", status=status, applied_at=t)
    await _replies_demo(db, c, t)


DEMO_INVITE = (
    "Hi Kavya,\n\nThank you for your application. We would like to invite you to an interview with our analytics "
    "team on Thursday at 11:00 AM. Please reply with a time that suits you if that doesn't work.\n\n"
    "Regards,\nHiring team (demo)"
)


async def _replies_demo(db, c, t) -> None:
    """A7: the Replies inbox. The demo company's email reply to her email application, read as an interview invite
    (the rules: the demo never calls the AI), and the companies' moves on her Nm7 applications (viewed, interview,
    not selected, offer), the newest unread."""
    from app.autoapply import replies, sync
    from app.core.db import AUTO_REPLIES

    mail_it = await db[AUTO_ITEMS].find_one({"user_id": STUDENT_ID, "state": "sent"})
    if mail_it:
        subject = f"Re: Application for {mail_it.get('title') or 'the job'}"
        kind = replies.rules_kind(subject, DEMO_INVITE) or "other"
        at = t - timedelta(hours=1)
        await db[AUTO_REPLIES].insert_one({
            "_id": str(ObjectId()), "user_id": STUDENT_ID, "alias": None, "item_id": mail_it["_id"],
            "job_id": mail_it["job_id"], "mail_id": None, "company": mail_it.get("company") or "",
            "title": mail_it.get("title") or "", "from": (mail_it.get("sent") or {}).get("to") or "hr@demo.nm7.invalid",
            "from_name": "Hiring team", "subject": subject, "text": DEMO_INVITE, "provider_id": None,
            "received_at": at, "forwarded": False, "forward": "demo", "kind": kind, "kind_by": "rules", "demo": True,
        })  # fmt: skip
        notice = {"status": "replied", "text": f"{mail_it.get('company') or 'The company'} replied by email.",
                  "at": at, "seen": False}  # fmt: skip
        await db[AUTO_ITEMS].update_one(
            {"_id": mail_it["_id"]},
            {"$set": {"replied_at": at, "interview_at": at, "interview_alert_at": at, "notice": notice,
                      "channel_v2": "email", "replies": 1}},
        )  # fmt: skip
    hours = {"interview": 3, "viewed": 26, "rejected": 50, "offer": 74}
    async for app in db[APPLICATIONS].find(
        {"user_id": STUDENT_ID, "v2": True, "status": {"$in": list(hours)}}, {"status": 1, "company": 1, "role": 1,
                                                                             "auto_item_id": 1}
    ):  # fmt: skip
        st = app["status"]
        n = {"status": st, "text": sync.TEXT[st].format(company=app.get("company") or "The company",
                                                        role=app.get("role") or "the job"),
             "at": t - timedelta(hours=hours[st]), "seen": st in ("rejected", "offer")}  # fmt: skip
        await db[AUTO_ITEMS].update_one(
            {"_id": app.get("auto_item_id")}, {"$set": {"notice": n}, "$push": {"notices": n}}
        )
    await db[USERS].update_one({"_id": STUDENT_ID}, {"$set": {"auto_apply.inbox_seen_at": t - timedelta(hours=48)}})


async def _form_demo(db, u, r, j, add, t) -> None:
    """A5: an application sent through the demo company's own careers form, with its proof (no network: the form is
    filled from DEMO_FORM, the answer page is DEMO_THANKS)."""
    from app.autoapply import tailoring
    from app.autoapply.forms import page, polite
    from app.autoapply.forms import service as forms
    from app.core.db import FORM_SITES

    a = u.get("auto_apply") or {}
    copy = await tailoring.build(db, STUDENT_ID, r, j, a, use_ai=False)
    fm = page.application_form(page.parse(DEMO_FORM))
    filled = page.fill(fm, await forms.facts(db, u, j, copy), b"%PDF-demo")
    answer = polite.Answer(200, f"https://{DEMO_SITE}/careers/thank-you", httpx.Headers(), f"<p>{DEMO_THANKS}</p>")
    proof = forms._proof(j["apply"]["url"], f"https://{DEMO_SITE}/careers/apply", filled, answer, True, False)
    await add(j, "applied", status="applied", applied_at=t, channel_v2="form", form_proof=proof, form_site=DEMO_SITE)
    await db[APPLICATIONS].update_one(
        {"user_id": STUDENT_ID, "job_id": j["_id"]}, {"$set": {"channel": "form", "channel_v2": "form",
                                                               "form_proof": proof}}
    )  # fmt: skip
    await db[FORM_SITES].replace_one(
        {"_id": DEMO_SITE},
        {"_id": DEMO_SITE, "state": "allowed", "reason": "", "demo": True, "first_seen": t, "last_tried": t,
         "last_ok": t, "successes": 1, "failures": 0, "updated_at": t},
        upsert=True,
    )  # fmt: skip


async def _morning_demo(db, u, r, by, add, day: str, t) -> None:
    """A6: this morning's "jobs ready" list: the website job from Phase 3 and two more, each with its kit (the
    tailored resume, cover note, ready answers), and one that closed after it was listed (shown as Closed)."""
    from app.autoapply import tailoring
    from app.core.db import AUTO_MORNINGS

    for jid in READY_JOBS:
        await add(by[jid], "ready", ready_day=day, channel_v2="one_tap", listed_day=day)
    await db[JOBS].update_one(
        {"_id": "demo-tech-solutions-job-closed"},
        {"$set": {"status": "closed", "closed_reason": "closed by the source", "updated_at": t}},
    )
    web = await db[AUTO_ITEMS].find_one({"user_id": STUDENT_ID, "job_id": EXTRA_JOBS[0]})
    j = await db[JOBS].find_one({"_id": EXTRA_JOBS[0]})
    if web and j:  # its 2.0 kit: the tailored version with the cover note and ready answers
        copy = await tailoring.build(db, STUDENT_ID, r, j, u.get("auto_apply") or {}, use_ai=False)
        await db[AUTO_ITEMS].update_one(
            {"_id": web["_id"]}, {"$set": {"channel_v2": "one_tap", "listed_day": day, "copy_id": copy["_id"]}}
        )
    ids = [x["_id"] async for x in db[AUTO_ITEMS].find({"user_id": STUDENT_ID, "state": "ready"}, {"_id": 1})]
    await db[AUTO_MORNINGS].replace_one(
        {"_id": f"{STUDENT_ID}:{day}"},
        {"_id": f"{STUDENT_ID}:{day}", "user_id": STUDENT_ID, "day": day, "items": ids, "count": len(ids), "at": t,
         "seen_at": None, "mailed_at": None, "demo": True},
        upsert=True,
    )  # fmt: skip


def engine_today(t) -> str:
    from app.autoapply import engine

    return engine.today(t)
