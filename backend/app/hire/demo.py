# ruff: noqa: E501  (demo records: one per block, easier to read)
"""The Hire in 60 minutes demo (Phase 5). Admin → Companies → "Reset and open as company (Hire in 60 minutes)".

  POST /api/admin/demo-company/hire/open   reset the demo company (Phase 2 demo) and add, all marked demo:
       30 made-up candidates who are ready to join, across IT and non-IT, with resumes, shared skill check results
       and reliability histories (some new, never ranked lower); a bulk hiring post (50 openings) for a customer
       support role in Hyderabad; three interview times tomorrow; one candidate who accepted an invite, attended an
       interview yesterday and has an offer waiting. One live-job slot stays free, so Post a job works. Signs this browser in as the demo company's main admin → {session}.

Vetting fix batch: eight of the 30 hold a current "Skill verified" (L2) badge, written exactly as the real flow writes
it (a vetting_verified record plus the verified_skills entry on the person): four for the Customer Support Executive
bulk post, two for Junior Data Analyst (SQL) and two for Software Engineer Trainee (Java), so Hire now shows the badges
and its "Skill verified only" filter finds people. The plain "Reset and open as company" adds the same 30 people.

Demo match fix (sales demos showed every Skill verified person at "50% match" with "hasn't agreed to matching yet"):
all 30 have agreed to "Matching you to a job's requirements" (a trust_consents row exactly as consent.grant writes it,
marked demo, channel "demo") and have Work preferences (languages, night shifts, notice period), and the people for the
three demo jobs have resumes written so the real T7 rules give Met / Not met with a quote (DEMO_CV). seed_matching
gives those jobs the demo company's own requirements (DEMO_CRITERIA) and stores what the real rules answer for each
person (the same cache rows evaluate.strips writes, so no AI is asked and the cards are the same on every reset). Top
people for each job show about 88-91%, the rest a spread below. Only the hire-demo-NN people and the demo company.

Demo people can't sign in (no password), get no email (demo addresses end in .invalid and demo accounts are skipped),
are shown only to demo companies, and are never on the job board, a company page, the supply map or a sitemap.
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Request, Response
from pymongo import UpdateOne

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
    TRUST_CONSENTS,
    TRUST_CRITERIA,
    TRUST_CRITERIA_EVALS,
    TRUST_CRITERIA_QUEUE,
    TRUST_WORK_PREFS,
    USERS,
    VETTING_VERIFIED,
)  # fmt: skip
from app.core.time import IST, now
from app.hire.skillcheck import ensure_bank
from app.hire.templates import TEMPLATES
from app.hire.vetting import engine as E
from app.hire.vetting.roles import BY_TEST
from app.jobs.apply import FOLLOW_AFTER, app_key, job_page
from app.jobs.model import JobIn, slug_for, to_doc
from app.site import get_site

router = APIRouter(prefix="/api/admin/demo-company/hire", tags=["hire in 60 minutes"])

DOMAIN = "hire-demo.nm7.invalid"
FIRST = ["Asha", "Ravi", "Meena", "Arjun", "Divya", "Kiran", "Sana", "Vikram", "Lakshmi", "Imran", "Pooja", "Suresh",
         "Neha", "Rahul", "Fatima", "Gopal", "Anjali", "Manoj", "Priya", "Sameer", "Kavya", "Naveen", "Rekha", "Ajay",
         "Swathi", "Harish", "Nisha", "Venkat", "Ayesha", "Deepak"]  # fmt: skip
LAST = ["Rao", "Kumar", "Reddy", "Sharma", "Naidu", "Khan", "Iyer", "Patel", "Das", "Varma"]
CITIES = ["Hyderabad", "Hyderabad", "Hyderabad", "Bengaluru", "Vijayawada", "Pune"]
EDU = {"10th": "SSC (10th)", "12th": "Intermediate (12th)", "iti": "ITI", "diploma": "Diploma",
       "graduate": "B.Com", "postgraduate": "MBA"}  # fmt: skip
# the demo company's own jobs (companies/demo.py) that badge holders suit: Junior Data Analyst and Software Engineer
# Trainee; people 27-30 are these (they would otherwise repeat a trade from people 11-14)
SE_TRAINEE = {"id": "software-trainee", "domain": "IT", "title": "Software Engineer Trainee", "education": "graduate",
              "skills": ["Java", "SQL", "Git"], "test": "Java"}  # fmt: skip
SWAP = {26: ("data-analyst", "Hyderabad"), 27: ("data-analyst", "Hyderabad"), 28: ("software-trainee", "Hyderabad"),
        29: ("software-trainee", "Pune")}  # fmt: skip
# person index → (MCQ score, practical task score) of their "Skill verified" badge for their template's test
VERIFIED = {1: (88, 80), 3: (82, 72), 5: (76, 68), 7: (91, 84), 26: (86, 80), 27: (78, 70), 28: (84, 76), 29: (80, 72)}

# Demo match fix: the people for the three demo jobs, written so the real requirement rules (trust/criteria/evaluate.py)
# find a quote for each answer. skills: the resume's skills (one left out where the card should show a gap); about:
# summary lines; edu: (degree, field, year); langs / night / notice: Work preferences (notice also on the hire profile).
# Shown match (Hire now: half the skills match, half the must-haves met), see DEMO_CRITERIA:
#   Customer Support Executive  02 91 · 08 91 · 01 88 · 04 88 · 06 88 · 03 82 · 05 79 · 07 79 · 09 75 · 10 64
#   Junior Data Analyst         27 90 · 28 88        Software Engineer Trainee  29 90 · 30 88
CS3 = ["Customer service", "Communication skills", "Telesales"]
CS2 = CS3[:2]
CS_ABOUT = ["Handled 60+ customer calls and chats a day on a food delivery helpline",
            "Solved order, refund and delivery questions and followed up until each ticket was closed"]  # fmt: skip
TELE = "Telesales: called interested leads and explained plans and offers"
DEMO_CV: dict[int, dict[str, Any]] = {
    0: {"skills": CS3, "about": [*CS_ABOUT, TELE], "edu": ("Intermediate (12th)", "CEC", "2024"),
        "langs": ["Telugu", "English", "Hindi"], "night": False, "notice": 0},
    1: {"skills": CS2, "about": CS_ABOUT, "edu": ("Intermediate (12th)", "MEC", "2023"),
        "langs": ["Telugu", "English"], "night": True, "notice": 0},
    2: {"skills": ["Customer service"], "about": CS_ABOUT[1:], "edu": ("B.Com", "Commerce", "2022"),
        "langs": ["English", "Hindi"], "night": True, "notice": 15},
    3: {"skills": CS3, "about": [*CS_ABOUT, TELE], "edu": ("Intermediate (12th)", "CEC", "2023"),
        "langs": ["Telugu", "English"], "night": False, "notice": 30},
    4: {"skills": CS2, "about": CS_ABOUT, "edu": ("Intermediate (12th)", "HEC", "2024"),
        "langs": ["English", "Telugu"], "night": False, "notice": 0},
    5: {"skills": CS3, "about": [*CS_ABOUT, TELE], "edu": ("B.Com", "Computers", "2023"),
        "langs": ["Telugu", "English", "Hindi"], "night": False, "notice": 15},
    6: {"skills": CS2, "about": CS_ABOUT, "edu": ("Intermediate (12th)", "MEC", "2022"),
        "langs": ["Telugu", "English"], "night": False, "notice": 15},
    7: {"skills": CS2, "about": CS_ABOUT, "edu": ("Intermediate (12th)", "CEC", "2022"),
        "langs": ["Telugu", "English", "Hindi"], "night": True, "notice": 0},
    8: {"skills": CS3, "about": [*CS_ABOUT, TELE], "edu": ("Intermediate (12th)", "CEC", "2024"),
        "langs": ["Telugu", "Hindi"], "night": False, "notice": 0},
    9: {"skills": CS2, "about": CS_ABOUT[:1], "edu": ("SSC (10th)", "", "2021"),
        "langs": ["Telugu", "English"], "night": False, "notice": 30},
    26: {"skills": ["SQL", "Excel", "Python"], "edu": ("B.Sc", "Statistics", "2024"),
         "about": ["Wrote SQL queries to pull weekly sales numbers for a retail chain",
                   "Built Excel reports with pivot tables and VLOOKUP for the store managers",
                   "Cleaned survey data in Python (pandas) for a college project"],
         "langs": ["Telugu", "English"], "night": False, "notice": 0},
    27: {"skills": ["SQL", "Excel", "Power BI"], "edu": ("Diploma", "Computer Applications", "2023"),
         "about": ["Made Power BI dashboards for daily orders and returns",
                   "Joined order and customer tables in SQL to find late deliveries"],
         "langs": ["English", "Hindi"], "night": False, "notice": 15},
    28: {"skills": ["Java", "SQL", "Spring Boot"], "edu": ("B.Tech", "Computer Science", "2025"),
         "about": ["Built a library management app in Java with Spring Boot and MySQL",
                   "Wrote SQL queries with joins and indexes for the app's reports"],
         "langs": ["Telugu", "English"], "night": False, "notice": 0},
    29: {"skills": ["Java", "SQL", "Git"], "edu": ("Diploma", "Computer Engineering", "2023"),
         "about": ["Fixed bugs in a Java billing module and raised pull requests on Git",
                   "Wrote SQL queries to check the billing data"],
         "langs": ["Marathi", "English", "Hindi"], "night": True, "notice": 30},
}  # fmt: skip
CITY_LANGS = {"Hyderabad": ["Telugu", "English"], "Vijayawada": ["Telugu", "English"], "Bengaluru": ["Kannada", "English"],
              "Pune": ["Marathi", "Hindi", "English"]}  # fmt: skip
# the demo company's own requirements for its three demo jobs (as if it edited the list: "by company"), each answerable
# by the rules from the people's resumes, skill checks and Work preferences
DEMO_CRITERIA: dict[str, list[tuple[str, str, bool]]] = {
    "Customer Support Executive": [
        ("skill", "Customer service", True), ("language", "Speaks English", True),
        ("education", "Class 12 pass or higher", True), ("shift", "Can work night shifts (rotational)", True),
        ("skill", "Telesales", False), ("language", "Speaks Telugu", False), ("other", "Can join immediately", False)],
    "Junior Data Analyst": [
        ("skill", "SQL", True), ("skill", "Excel", True), ("education", "A graduate degree or higher", True),
        ("language", "Speaks English", True), ("skill", "Power BI", False), ("skill", "Python", False),
        ("other", "Can join immediately", False)],
    "Software Engineer Trainee": [
        ("skill", "Java", True), ("skill", "SQL", True), ("education", "A graduate degree or higher", True),
        ("language", "Speaks English", True), ("skill", "Git", False), ("skill", "Spring Boot", False),
        ("other", "Can join immediately", False)],
}  # fmt: skip


async def remove(db) -> None:
    """Every record of the 30 made-up people, found by their fixed ids (hire-demo-01...30), so a reset is clean even
    if another demo's reset already deleted their user records."""
    uids = [f"hire-demo-{i:02d}" for i in range(1, 31)]
    mine = {"$regex": "^hire-demo-"}
    for coll, field in (
        (TRUST_CRITERIA_EVALS, "user_id"),
        (TRUST_CRITERIA_QUEUE, "user_id"),
        (RESUMES, "user_id"),
        (SKILL_ATTEMPTS, "user_id"),
        (HIRE_EVENTS, "user_id"),
        (APPLICATIONS, "user_id"),
        (VETTING_VERIFIED, "user_id"),
    ):
        await db[coll].delete_many({field: mine})
    await db[HIRE_PROFILES].delete_many({"_id": mine})
    await db[TRUST_CONSENTS].delete_many({"user_id": mine, "demo": True})  # only the rows this demo wrote
    await db[TRUST_WORK_PREFS].delete_many({"_id": mine, "demo": True})
    for coll in (HIRE_INVITES, HIRE_SLOTS, HIRE_OFFERS, HIRE_WALKINS):
        await db[coll].delete_many({"company_id": company_demo.COMPANY_ID})
    await db[USERS].delete_many(
        {"$or": [{"_id": {"$in": uids}}, {"email": {"$regex": r"@hire-demo\.nm7\.invalid$"}}], "demo": True}
    )


def _resume(name: str, city: str, tpl: dict[str, Any], years: int, cv: dict[str, Any] | None = None) -> dict[str, Any]:
    cv = cv or {}
    skills = cv.get("skills") or tpl["skills"]
    exp = []
    if years:
        exp = [{"company": "A local firm", "role": tpl["title"], "from": f"{2026 - years}-01", "to": "", "current": True,
                "description": f"Worked as {tpl['title'].lower()}: " + ", ".join(skills).lower() + "."}]  # fmt: skip
    degree, fld, year = cv.get("edu") or (EDU.get(tpl["education"], "B.Com"), "", "")
    return {
        "personal": {"name": name, "headline": tpl["title"], "location": f"{city}, India"},
        # with DEMO_CV the summary's own lines are the evidence a requirement quotes (the skills are in the Skills line)
        "summary": "\n".join([f"{tpl['title']} ready to join now.", *cv["about"]])
        if cv.get("about")
        else f"{tpl['title']} ready to join now. Skills: {', '.join(skills)}.",
        "skillGroups": [{"id": "core", "label": "Skills", "value": ", ".join(skills)}],
        "exp": exp,
        "edu": [{"institution": "Govt institute (demo)", "degree": degree, "field": fld, "to": year}],
    }


def _badge(uid: str, test: str, years: int, scores: tuple[int, int], at) -> tuple[dict[str, Any], dict[str, Any]]:
    """A "Skill verified" (L2) badge as router.award writes it: the vetting_verified record and the person's
    verified_skills entry."""
    role = BY_TEST[test]
    band = E.band_for_years(years)
    rec = {"user_id": uid, "test": test, "slug": role["slug"], "role": role["role"], "band": band, "score": scores[0],
           "task_score": scores[1], "at": at, "expires_at": at + E.VALID, "attempt_id": None, "demo": True}  # fmt: skip
    entry = {"skill": test, "role": role["slug"], "at": at, "band": band, "score": scores[0], "task": scores[1],
             "expires_at": rec["expires_at"], "source": "v2"}  # fmt: skip
    return rec, entry


async def seed_people(db) -> list[str]:
    """The 30 made-up people who are ready to join (a clean copy each time), one insert per collection."""
    await remove(db)
    await ensure_bank(db)
    t = now()
    tpls = TEMPLATES
    cs = next(x for x in tpls if x["id"] == "customer-support")
    by_id = {x["id"]: x for x in [*tpls, SE_TRAINEE]}
    # Batch A (20 Nov live test: this timed out on the live server while the plain reset worked): the 30 people were
    # ~150 one-by-one writes; now one insert per collection, and each test's questions are read once
    people, users, resumes, profiles, attempts, events, badges = [], [], [], [], [], [], []
    consents, prefs = [], []
    from app.trust.consent import PURPOSES
    from app.trust.criteria import router as _criteria  # noqa: F401  (registers the Matching purpose)
    from app.trust.criteria.evaluate import PURPOSE as MATCHING

    version = PURPOSES[MATCHING].version
    tests = sorted({tp["test"] for tp in [*tpls, SE_TRAINEE] if tp["test"]})
    qids = {k: [q["_id"] for q in await db[SKILL_QUESTIONS].find({"skill": k, "active": True}, {"_id": 1}).limit(10).to_list(10)]
            for k in tests}  # fmt: skip
    for i in range(30):
        tpl = cs if i < 10 else tpls[i % len(tpls)]  # 10 suit the bulk post; 20 across every domain
        name = f"{FIRST[i]} {LAST[i % len(LAST)]}"
        uid = f"hire-demo-{i + 1:02d}"
        city = CITIES[i % len(CITIES)] if i >= 10 else "Hyderabad"
        if i in SWAP:
            tpl, city = by_id[SWAP[i][0]], SWAP[i][1]
        user = {"_id": uid, "email": f"{uid}@{DOMAIN}", "email_lc": f"{uid}@{DOMAIN}", "name": name, "role": "customer",
                "password_hash": "", "demo": True, "created_at": t - timedelta(days=20 + i)}  # fmt: skip
        confirmed = t - timedelta(hours=i)
        if i in VERIFIED:
            rec, entry = _badge(uid, tpl["test"], i % 3, VERIFIED[i], t - timedelta(days=5 + i))
            badges.append(rec)
            # the level the ladder would store (V1): L2 "Skill verified", ready now; confirmed in the last hour, so a
            # cached ready shortlist for the role and city never leaves them out (shortlist.candidates)
            user |= {"verified_skills": [entry], "vetting": {"level": 2, "ready_now": True, "visible": True,
                     "next": ["Pass the AI screening interview"], "skill_verified": [tpl["test"]], "at": t}}  # fmt: skip
            confirmed = t - timedelta(minutes=5 + i)
        users.append(user)
        cv = DEMO_CV.get(i) or {}
        notice = cv.get("notice", [0, 0, 15, 30][i % 4])
        resumes.append({"_id": f"r-{uid}", "user_id": uid, "key": "r1", "name": "Main", "active": True,
                        "data": _resume(name, city, tpl, i % 3, cv), "template": "classic",
                        "created_at": t, "updated_at": t})  # fmt: skip
        salary = (
            {"amount": 15000 + 1000 * (i % 8), "unit": "month"}
            if tpl["domain"] != "IT"
            else {"amount": 3 + (i % 3) * 0.5, "unit": "lpa"}
        )
        profiles.append({"_id": uid, "on": True, "consent_at": t - timedelta(days=2),
                         "confirmed_at": confirmed, "join_date": (t + timedelta(days=7 + i % 20)).astimezone(IST).date().isoformat(),
                         "cities": [city], "remote": i % 7 == 0, "salary": salary, "notice_days": notice,
                         "job_types": ["full_time"], "paused_at": None, "updated_at": t})  # fmt: skip
        # agreed to matching (DPDP: the same row consent.grant writes, marked demo) and Work preferences (self-declared)
        consents.append({"user_id": uid, "purpose": MATCHING, "version": version, "granted_at": t - timedelta(days=2),
                         "withdrawn_at": None, "channel": "demo", "demo": True})  # fmt: skip
        night = cv.get("night", i % 2 == 0)
        prefs.append({"_id": uid, "shifts": ["day", "rotational"] if night else ["day"], "night_shift": night,
                      "languages": cv.get("langs") or CITY_LANGS.get(city, ["English"]), "notice_days": notice,
                      "available_now": notice == 0, "created_at": t, "updated_at": t, "demo": True})  # fmt: skip
        if tpl["test"] and i % 2 == 0:  # a shared skill check for half of those with a test
            right = 6 + i % 5
            attempts.append({"_id": ObjectId(), "user_id": uid, "skill": tpl["test"],
                             "question_ids": qids.get(tpl["test"], []), "order": {}, "total": 10,
                             "started_at": t - timedelta(days=3), "ends_at": t - timedelta(days=3) + timedelta(minutes=10),
                             "submitted_at": t - timedelta(days=3) + timedelta(minutes=8), "right": right,
                             "score": right * 10, "late": False, "tab_switches": i % 2, "spoken": [], "share": True})  # fmt: skip
        if i % 3 == 1:  # a reliability history from earlier (made-up) companies; the rest are new
            kinds = ["attended", "attended", "joined"] if i % 6 == 1 else ["attended", "no_show"]
            events += [{"user_id": uid, "kind": kind, "ref": f"demo-{uid}-{k}", "company_id": "demo-earlier",
                        "at": t - timedelta(days=30 + k)} for k, kind in enumerate(kinds)]  # fmt: skip
        people.append(uid)
    for coll, docs in ((USERS, users), (RESUMES, resumes), (HIRE_PROFILES, profiles), (SKILL_ATTEMPTS, attempts),
                       (HIRE_EVENTS, events), (VETTING_VERIFIED, badges), (TRUST_CONSENTS, consents),
                       (TRUST_WORK_PREFS, prefs)):  # fmt: skip
        if docs:
            await db[coll].insert_many(docs, ordered=False)
    return people


async def seed_matching(db) -> int:
    """The demo company's requirements for its three demo jobs (DEMO_CRITERIA) and each demo person's Met / Not met /
    Unknown for them: what the real rules answer from the person's evidence, stored in the cache evaluate.strips reads
    (same ids and `rev`), so Hire now shows them at once and nothing is queued for the AI. A few reads (one per evidence
    source) and two writes, never one per person. Only the demo company's jobs and the hire-demo-NN people (demo)."""
    from app.trust.criteria import evaluate as EV
    from app.trust.criteria import evidence as EVI
    from app.trust.criteria import extract as X

    t = now()
    cid = company_demo.COMPANY_ID
    jobs = await db[JOBS].find({"company_id": cid, "demo": True, "title": {"$in": list(DEMO_CRITERIA)}}).to_list(50)
    await db[TRUST_CRITERIA].delete_many({"company_id": cid})  # the demo company's own (old bulk posts' rows too)
    rows = []
    for j in jobs:
        items = [{"id": f"c{k}", "kind": kind, "text": text, "must": must, "by": "company"}
                 for k, (kind, text, must) in enumerate(DEMO_CRITERIA[j["title"]], 1)]  # fmt: skip
        rows.append({"_id": j["_id"], "company_id": cid, "jd_hash": X.job_hash(j), "items": items, "by": "company",
                     "edited": True, "edited_by": company_demo.MAIN[0], "extracted_at": t, "updated_at": t, "demo": True})  # fmt: skip
    if rows:
        await db[TRUST_CRITERIA].insert_many(rows)
    uids = [u["_id"] async for u in db[USERS].find({"_id": {"$regex": "^hire-demo-"}, "demo": True}, {"_id": 1})]
    if not rows or not uids:
        return 0
    resumes = {r["user_id"]: r async for r in db[RESUMES].find({"user_id": {"$in": uids}, "active": True})}
    bs = await EVI.bundles(db, uids, resumes, show_test=True, t=t)
    crit = {X.chash(c["kind"], c["text"]): c for r in rows for c in r["items"]}
    writes = []
    for uid, b in bs.items():
        for h, c in crit.items():
            a = EV.verify(EV.rules(c, b), b)
            writes.append(UpdateOne({"_id": EV.eval_id(uid, h)}, {"$set": {"user_id": uid, "chash": h, "kind": c["kind"], "text": c["text"],
                                                                           **a, "rev": b.rev, "at": t, "demo": True}}, upsert=True))  # fmt: skip
    if writes:
        await db[TRUST_CRITERIA_EVALS].bulk_write(writes, ordered=False)
    return len(writes)


async def create(db) -> dict[str, Any]:
    out = await company_demo.create(db)  # a fresh demo company first
    people = await seed_people(db)
    t = now()
    cid = company_demo.COMPANY_ID
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"review.state": "approved",
                                                          "verified_until": t + timedelta(days=365)}})  # fmt: skip
    cs = next(x for x in TEMPLATES if x["id"] == "customer-support")
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
    await seed_matching(db)  # the requirements and each person's Met / Not met for the bulk post and the demo jobs
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
async def open_hire_demo(request: Request, response: Response, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    from app.orgs.recruiter_account import issue_session

    await rate_limit.check(db, f"demo-company:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"demo-company:{auth.user.id}")
    from app.core.heavy import heavy_or_busy

    async with heavy_or_busy(db):  # one heavy job at a time (app/core/heavy.py)
        out = await create(db)
    session = await issue_session(db, company_demo.MAIN[0], company_demo.MAIN[1], request=request)
    await audit(
        db, auth.user.id, "demo_company_hire_open", target=company_demo.COMPANY_ID, data=out, ip=client_ip(request)
    )
    from app.admin.views import company_view

    await company_view(db, request, response, auth, session, "/company#hire")  # the admin stays signed in; banner on
    return {"session": session, **out}
