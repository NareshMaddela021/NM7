# ruff: noqa: E501  (demo records: one per block, easier to read)
"""The Hire in 30 minutes demo (Phase 5). Admin → Companies → "Reset and open as company (Hire in 30 minutes)".

  POST /api/admin/demo-company/hire/open   reset the demo company (Phase 2 demo) and add, all marked demo:
       30 made-up candidates who are ready to join, across IT and non-IT, with resumes, shared skill check results
       and reliability histories (some new, never ranked lower); a bulk hiring post (50 openings) for a customer
       support role in Hyderabad; three interview times tomorrow; one candidate who accepted an invite, attended an
       interview yesterday and has an offer waiting. One live-job slot stays free, so Post a job works. Signs this browser in as the demo company's main admin → {session}.

Demo people can't sign in (no password), get no email (demo addresses end in .invalid and demo accounts are skipped),
are shown only to demo companies, and are never on the job board, a company page, the supply map or a sitemap.
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.companies import demo as company_demo
from app.core import rate_limit
from app.core.db import (
    APPLICATIONS,
    COMPANIES,
    DB,
    HIRE_EVENTS,
    HIRE_INVITES,
    HIRE_OFFERS,
    HIRE_PROFILES,
    HIRE_SLOTS,
    HIRE_WALKINS,
    JOBS,
    RESUMES,
    SKILL_ATTEMPTS,
    SKILL_QUESTIONS,
    USERS,
)  # fmt: skip
from app.core.time import IST, now
from app.hire.skillcheck import ensure_bank
from app.hire.templates import TEMPLATES
from app.jobs.apply import FOLLOW_AFTER, app_key, job_page
from app.jobs.model import JobIn, slug_for, to_doc
from app.site import get_site

router = APIRouter(prefix="/api/admin/demo-company/hire", tags=["hire in 30 minutes"])

DOMAIN = "hire-demo.nm7.invalid"
FIRST = ["Asha", "Ravi", "Meena", "Arjun", "Divya", "Kiran", "Sana", "Vikram", "Lakshmi", "Imran", "Pooja", "Suresh",
         "Neha", "Rahul", "Fatima", "Gopal", "Anjali", "Manoj", "Priya", "Sameer", "Kavya", "Naveen", "Rekha", "Ajay",
         "Swathi", "Harish", "Nisha", "Venkat", "Ayesha", "Deepak"]  # fmt: skip
LAST = ["Rao", "Kumar", "Reddy", "Sharma", "Naidu", "Khan", "Iyer", "Patel", "Das", "Varma"]
CITIES = ["Hyderabad", "Hyderabad", "Hyderabad", "Bengaluru", "Vijayawada", "Pune"]
EDU = {"10th": "SSC (10th)", "12th": "Intermediate (12th)", "iti": "ITI", "diploma": "Diploma",
       "graduate": "B.Com", "postgraduate": "MBA"}  # fmt: skip


async def remove(db) -> None:
    uids = [
        u["_id"] async for u in db[USERS].find({"email": {"$regex": rf"@{DOMAIN.replace('.', r'\.')}$"}}, {"_id": 1})
    ]
    for coll, field in (
        (RESUMES, "user_id"),
        (SKILL_ATTEMPTS, "user_id"),
        (HIRE_EVENTS, "user_id"),
        (APPLICATIONS, "user_id"),
    ):
        await db[coll].delete_many({field: {"$in": uids}})
    await db[HIRE_PROFILES].delete_many({"_id": {"$in": uids}})
    for coll in (HIRE_INVITES, HIRE_SLOTS, HIRE_OFFERS, HIRE_WALKINS):
        await db[coll].delete_many({"company_id": company_demo.COMPANY_ID})
    await db[USERS].delete_many({"_id": {"$in": uids}, "demo": True})


def _resume(name: str, city: str, tpl: dict[str, Any], years: int) -> dict[str, Any]:
    exp = []
    if years:
        exp = [{"company": "A local firm", "role": tpl["title"], "from": f"{2026 - years}-01", "to": "", "current": True,
                "description": f"Worked as {tpl['title'].lower()}: " + ", ".join(tpl["skills"]).lower() + "."}]  # fmt: skip
    return {
        "personal": {"name": name, "headline": tpl["title"], "location": f"{city}, India"},
        "summary": f"{tpl['title']} ready to join now. Skills: {', '.join(tpl['skills'])}.",
        "skillGroups": [{"id": "core", "label": "Skills", "value": ", ".join(tpl["skills"])}],
        "exp": exp,
        "edu": [{"institution": "Govt institute (demo)", "degree": EDU.get(tpl["education"], "B.Com"), "field": ""}],
    }


async def create(db) -> dict[str, Any]:
    out = await company_demo.create(db)  # a fresh demo company first
    await remove(db)
    await ensure_bank(db)
    t = now()
    cid = company_demo.COMPANY_ID
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"review.state": "approved",
                                                          "verified_until": t + timedelta(days=365)}})  # fmt: skip
    tpls = TEMPLATES
    cs = next(x for x in tpls if x["id"] == "customer-support")
    people = []
    for i in range(30):
        tpl = cs if i < 10 else tpls[i % len(tpls)]  # 10 suit the bulk post; 20 across every domain
        name = f"{FIRST[i]} {LAST[i % len(LAST)]}"
        uid = f"hire-demo-{i + 1:02d}"
        city = CITIES[i % len(CITIES)] if i >= 10 else "Hyderabad"
        await db[USERS].insert_one({"_id": uid, "email": f"{uid}@{DOMAIN}", "email_lc": f"{uid}@{DOMAIN}", "name": name, "role": "customer",
                                    "password_hash": "", "demo": True, "created_at": t - timedelta(days=20 + i)})  # fmt: skip
        await db[RESUMES].insert_one({"_id": f"r-{uid}", "user_id": uid, "key": "r1", "name": "Main", "active": True,
                                      "data": _resume(name, city, tpl, i % 3), "template": "classic",
                                      "created_at": t, "updated_at": t})  # fmt: skip
        salary = (
            {"amount": 15000 + 1000 * (i % 8), "unit": "month"}
            if tpl["domain"] != "IT"
            else {"amount": 3 + (i % 3) * 0.5, "unit": "lpa"}
        )
        await db[HIRE_PROFILES].insert_one({"_id": uid, "on": True, "consent_at": t - timedelta(days=2),
                                            "confirmed_at": t - timedelta(hours=i), "join_date": (t + timedelta(days=7 + i % 20)).astimezone(IST).date().isoformat(),
                                            "cities": [city], "remote": i % 7 == 0, "salary": salary, "notice_days": [0, 0, 15, 30][i % 4],
                                            "job_types": ["full_time"], "paused_at": None, "updated_at": t})  # fmt: skip
        if tpl["test"] and i % 2 == 0:  # a shared skill check for half of those with a test
            qs = await db[SKILL_QUESTIONS].find({"skill": tpl["test"], "active": True}).limit(10).to_list(10)
            right = 6 + i % 5
            await db[SKILL_ATTEMPTS].insert_one({"_id": ObjectId(), "user_id": uid, "skill": tpl["test"],
                                                 "question_ids": [q["_id"] for q in qs], "order": {}, "total": 10,
                                                 "started_at": t - timedelta(days=3), "ends_at": t - timedelta(days=3) + timedelta(minutes=10),
                                                 "submitted_at": t - timedelta(days=3) + timedelta(minutes=8), "right": right,
                                                 "score": right * 10, "late": False, "tab_switches": i % 2, "spoken": [], "share": True})  # fmt: skip
        if i % 3 == 1:  # a reliability history from earlier (made-up) companies; the rest are new
            kinds = ["attended", "attended", "joined"] if i % 6 == 1 else ["attended", "no_show"]
            for k, kind in enumerate(kinds):
                await db[HIRE_EVENTS].insert_one({"user_id": uid, "kind": kind, "ref": f"demo-{uid}-{k}",
                                                  "company_id": "demo-earlier", "at": t - timedelta(days=30 + k)})  # fmt: skip
        people.append(uid)
    # the bulk post: customer support, 50 openings, Hyderabad
    body = JobIn.model_validate({
        "title": cs["title"], "company": {"name": company_demo.NAME, "website": company_demo.SITE},
        "locations": ["Hyderabad"], "jobType": "full_time", "experience": "fresher", "education": cs["education"],
        "skills": cs["skills"], "description": cs["description"], "applyMethod": "nm7",
        "salary": {"min": 180000, "max": 264000, "period": "yearly"},
    })  # fmt: skip
    jid = f"demo-hire-{ObjectId()}"
    # keep a free live-job slot so "Post a job" and the job templates can be tried (13 Nov live test): with the bulk
    # post added, close the newest other live demo jobs until one slot is left under the Verified limit
    limit = int((await get_site(db))["companies"]["verified_live_jobs"])
    others = await db[JOBS].find({"company_id": cid, "status": "active"}, {"_id": 1}).sort("posted_at", 1).to_list(50)
    for extra in others[max(0, limit - 2) :]:
        await db[JOBS].update_one({"_id": extra["_id"]}, {"$set": {"status": "closed", "closed_reason": "filled"}})
    await db[JOBS].insert_one({"_id": jid, **to_doc(body), "slug": slug_for(cs["title"], company_demo.NAME),
                               "status": "active", "source": "company", "company_id": cid, "demo": True,
                               "posted_at": t, "created_at": t, "updated_at": t, "questions": [],
                               "hire_bulk": {"on": True, "openings": 50, "updated_at": t}})  # fmt: skip
    j = await db[JOBS].find_one({"_id": jid})
    # three interview times tomorrow at 10:00, 10:30, 11:00 India time
    day = (t + timedelta(days=1)).astimezone(IST).replace(hour=10, minute=0, second=0, microsecond=0)
    await db[HIRE_SLOTS].insert_many([{
        "_id": ObjectId(), "company_id": cid, "job_id": jid, "starts_at": day + timedelta(minutes=30 * k), "minutes": 20,
        "place": "Demo office, Hitech City (made-up)", "link": "", "interviewer": "Ravi (demo HR)", "round": "HR",
        "status": "open", "user_id": None, "seq": 0, "by": company_demo.MAIN[0], "created_at": t, "updated_at": t,
    } for k in range(3)])  # fmt: skip
    # one candidate accepted the invite, booked an interview yesterday (10:00 India time: `day` is tomorrow, so two days
    # back; one day back was today, still ahead before 10:00 IST), attended it, and has an offer waiting
    # (invite → accepted → interview booked → attended → offer sent, so the bulk board's funnel reads in order)
    uid = people[0]
    await db[HIRE_SLOTS].insert_one({
        "_id": ObjectId(), "company_id": cid, "job_id": jid, "starts_at": day - timedelta(days=2), "minutes": 20,
        "place": "Demo office, Hitech City (made-up)", "link": "", "interviewer": "Ravi (demo HR)", "round": "HR",
        "status": "booked", "user_id": uid, "seq": 1, "mark": "attended", "by": company_demo.MAIN[0],
        "created_at": t - timedelta(days=2), "updated_at": t,
    })  # fmt: skip
    await db[HIRE_INVITES].insert_one({"_id": ObjectId(), "company_id": cid, "job_id": jid, "user_id": uid,
                                       "status": "accepted", "note": "", "by": company_demo.MAIN[0],
                                       "created_at": t - timedelta(days=2, minutes=12), "answered_at": t - timedelta(days=2),
                                       "updated_at": t})  # fmt: skip
    await db[APPLICATIONS].insert_one({
        "key": app_key(jid), "user_id": uid, "company": company_demo.NAME, "role": cs["title"], "status": "offer",
        "date": int(t.timestamp() * 1000), "resume_id": "r1", "resume_name": "Main", "url": job_page(j), "notes": "",
        "next": int((t + FOLLOW_AFTER).timestamp() * 1000), "job_id": jid, "channel": "nm7", "origin": "invite",
        "company_id": cid, "consent_at": t, "answers": {}, "fit": {"ok": True, "reasons": []}, "demo": True,
        "timeline": [{"status": "shortlisted", "at": t - timedelta(days=2)}, {"status": "interview", "at": t - timedelta(days=1)},
                     {"status": "offer", "at": t}],
        "created_at": t, "updated_at": t,
    })  # fmt: skip
    await db[HIRE_OFFERS].insert_one({
        "_id": ObjectId(), "company_id": cid, "job_id": jid, "user_id": uid, "company_name": company_demo.NAME,
        "title": cs["title"], "candidate_name": f"{FIRST[0]} {LAST[0]}", "salary": {"amount": 18000, "unit": "month"},
        "join_date": (t + timedelta(days=10)).astimezone(IST).date().isoformat(), "place": "Hyderabad",
        "notes": "", "job_type": "full_time", "respond_by": t + timedelta(days=3), "status": "sent",
        "by": company_demo.MAIN[0], "by_name": company_demo.MAIN[1], "created_at": t, "updated_at": t,
    })  # fmt: skip
    return {**out, "candidates": len(people), "bulkJob": jid}


@router.post("/open")
async def open_hire_demo(request: Request, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    from app.orgs.recruiter_account import issue_session

    await rate_limit.check(db, f"demo-company:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-company:{auth.user.id}")
    out = await create(db)
    session = await issue_session(db, company_demo.MAIN[0], company_demo.MAIN[1], request=request)
    await audit(
        db, auth.user.id, "demo_company_hire_open", target=company_demo.COMPANY_ID, data=out, ip=client_ip(request)
    )
    return {"session": session, **out}
