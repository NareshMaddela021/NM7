"""The demo organization: "Demo Engineering College", with made-up students, for testing and sales demos.

    python -m app.cli demo-org            # create it, or reset it to the starting data
    python -m app.cli demo-org --remove   # delete it and everything in it
    Admin console (Owner): Organizations → "Demo organization" → Create / reset, Remove

Everything it makes is marked `demo: true` (the organization and every student account) and is left out of real
numbers: admin dashboard customer counts, the customers list, paid-organization counts and renewals. Demo students
can't sign in (no usable password), are never emailed (reminders skip them) and use addresses that can't receive mail
(…@demo.nm7.invalid). The groups are closed, so nobody real can join them.

Speed (27 Nov: "Reset and open as coordinator" took ~40 s on the live server, ~290 database round trips one after
another, each a network hop to the database, plus four slow password hashes): every record is built in memory first
(a few hundred small documents, well under 1 MB) and written with one insert_many per collection, a few collections at
a time; the deletes run a few at a time too, still in id batches (the 512 MB server). One unusable password hash is
shared by every demo account. About 30 round trips in all, so a reset takes a few seconds.
"""

import asyncio
import random
import re
import secrets
from collections import defaultdict
from collections.abc import Awaitable, Iterable
from datetime import datetime, timedelta
from datetime import time as dtime
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.auth.models import User
from app.billing.plans import get_plans, terms_of
from app.core.db import (
    ALUMNI,
    ALUMNI_REQUESTS,
    COLLEGE_GROUPS,
    DRIVE_CHECKINS,
    DRIVES,
    INTERVIEWS,
    LINKEDIN,
    MEMBERSHIPS,
    OFFERS,
    ORG_GROUPS,
    ORG_STAFF,
    ORGANIZATIONS,
    RECRUITER_FEEDBACK,
    RECRUITER_INVITES,
    RECRUITER_LINKS,
    RECRUITERS,
    RESUMES,
    REVIEW_COMMENTS,
    ROLL_LISTS,
    STORIES,
    USERS,
)
from app.core.security import hash_password, new_token
from app.core.time import IST, now
from app.orgs.service import consent_text

ORG_ID = "demo-engineering-college"
# The demo coordinator (Admin → Organizations → "Reset and open as coordinator"): a fixed UUID (account ids are UUIDs)
COORDINATOR_ID = "d5cb15ab-e885-59d8-8bef-4cdc74a64177"
ORG_NAME = "Demo Engineering College"
EMAIL_DOMAIN = "demo.nm7.invalid"
GROUPS = (
    ("demo-cse-2026", "B.Tech 2026 · CSE (demo)", "DEMOCSE26", "CSE", 28, 34),
    ("demo-ece-2026", "B.Tech 2026 · ECE (demo)", "DEMOECE26", "ECE", 20, 26),
)
FIRST = ("Aarav Ananya Arjun Bhavya Chaitanya Deepika Divya Farhan Gautham Harini Ishaan Jahnavi Karthik Kavya Lakshmi "
         "Manish Meera Naveen Nikhil Pooja Pranav Priya Rahul Rekha Rohit Sahana Sai Sandeep Shreya Siddharth Sneha "
         "Srinivas Swathi Tanvi Tejas Varun Vidya Vikram Yamini Zoya").split()  # fmt: skip
LAST = "Reddy Sharma Iyer Nair Rao Gupta Khan Menon Patel Das Pillai Joshi Kumar Varma Shetty Bhat".split()
SKILLS = {
    "CSE": ["Python", "Java", "C++", "SQL", "JavaScript", "React", "Node.js", "Django", "Git", "Docker", "AWS",
            "Data Structures", "Machine Learning", "MongoDB", "REST API", "Linux"],
    "ECE": ["Embedded C", "MATLAB", "Arduino", "VLSI", "Verilog", "PCB Design", "Python", "IoT", "Raspberry Pi",
            "Signal Processing", "C", "AutoCAD", "LabVIEW", "Git"],
}  # fmt: skip
PROJECTS = {
    "CSE": [("Campus Canteen App", "Built a food ordering app used by {n} students", "React, Node.js, MongoDB"),
            ("Attendance Tracker", "Automated attendance for {n} classes with face matching", "Python, OpenCV"),
            ("Library Search", "Made book search {n}% faster with an index", "Java, SQL")],
    "ECE": [("Smart Irrigation", "Cut water use by {n}% on a test farm with soil sensors", "Arduino, IoT"),
            ("Line Follower Robot", "Built a robot that won {n}nd place at the college tech fest", "Embedded C"),
            ("Home Energy Monitor", "Measured power for {n} rooms and showed it on a phone", "Raspberry Pi, Python")],
}  # fmt: skip
INTERNSHIPS = [("Demo Software Pvt Ltd", "Software Intern"), ("Sample Electronics", "Embedded Intern"),
               ("Example Analytics", "Data Intern")]  # fmt: skip


def _resume(rng: random.Random, name: str, branch: str, email: str, quality: int) -> dict[str, Any]:
    """A made-up resume: quality 0 (thin) … 3 (strong)."""
    skills = rng.sample(SKILLS[branch], k=min(len(SKILLS[branch]), [3, 6, 9, 11][quality]))
    projects = []
    for title, line, tech in rng.sample(PROJECTS[branch], k=[0, 1, 2, 2][quality]):
        desc = line.format(n=rng.choice([2, 12, 30, 40, 250])) if quality >= 2 else line.split(" {")[0].split(" by")[0]
        projects.append({"title": title, "tagline": "", "description": desc, "tech": tech, "links": []})
    exp = []
    if quality >= 2 and rng.random() < 0.7:
        company, role = rng.choice(INTERNSHIPS)
        exp.append({"company": company, "role": role, "from": "2025-05", "to": "2025-07", "current": False,
                    "description": "Wrote tests for 3 services\nFixed 15 bugs reported by users"})  # fmt: skip
    d: dict[str, Any] = {
        "personal": {
            "name": name,
            "email": email,
            "phone": "+91 90000 00000" if quality else "",
            "headline": f"B.Tech {branch} 2026" if quality else "",
            "location": "Demo City",
        },  # fmt: skip
        "summary": (
            f"Final-year {branch} student who likes building things that work. "
            + ("Built projects used by real students and finished an internship. " if quality >= 2 else "")
            + "Looking for a first role where I can learn fast and deliver."
            if quality >= 1
            else ""
        ),
        "edu": [
            {
                "institution": ORG_NAME,
                "degree": "B.Tech",
                "field": "Computer Science" if branch == "CSE" else "Electronics and Communication",
                "from": "2022-08",
                "to": "2026-05",
                "grade": f"{rng.choice([6.8, 7.4, 7.9, 8.3, 8.8, 9.1])} CGPA" if quality >= 1 else "",
            }
        ],  # fmt: skip
        "skillGroups": [{"id": "core", "label": "Skills", "value": ", ".join(skills)}],
        "proj": projects,
        "exp": exp,
        "certs": [{"name": "NPTEL Programming in Python", "issuer": "NPTEL"}] if quality >= 2 else [],
        "langs": [{"name": "English", "level": "Fluent"}],
        "links": {"linkedin": f"linkedin.com/in/{name.lower().replace(' ', '-')}-demo"} if quality == 3 else {},
        "design": {"preset": "fresher"},
        # the rest of what the builder saves, empty, so every screen gets a complete resume
        "ach": [],
        "custom": [],
        "linkExtras": [],
        "hobbies": "",
        "strengths": "",
        "pinfo": {},
        "hidden": {},
        "titles": {},
        "offLines": {},
        "showPhoto": False,
    }
    return d


async def remove_demo(db: AsyncDatabase) -> int:
    """Deletes the demo organization and every demo student (and what they own). Returns how many students."""
    from app.jobs import demo_jobs

    # only this demo's own people (the college's students, coordinator, reviewer, alumni: ...@demo.nm7.invalid); the
    # other demos' made-up people (Hire in 60 minutes, the student demos) are theirs to reset. Ids are read in small
    # batches and deleted chunk by chunk, so a reset never holds a big list in memory (the server has 512 MB).
    # The student demos (Meera / Arjun, the Auto Apply student, the Easy dashboard student) share the address domain
    # but are named <first>.student@...; the college's own people never are (full site test, 19 Nov: a college reset
    # signed those demos out and deleted their resumes).
    mine = {
        "demo": True,
        "$or": [{"email": {"$regex": r"@demo\.nm7\.invalid$"}}, {"_id": COORDINATOR_ID}],
        "email": {"$not": re.compile(r"\.student@demo\.nm7\.invalid$")},
    }
    n = 0
    batch: list = []
    async for u in db[USERS].find(mine, {"_id": 1}, batch_size=CHUNK):
        batch.append(u["_id"])
        if len(batch) >= CHUNK:
            await _remove_people(db, batch)
            n += len(batch)
            batch = []
    if batch:
        await _remove_people(db, batch)
        n += len(batch)
    rest = (
        (MEMBERSHIPS, {"org_id": ORG_ID}),
        (ROLL_LISTS, {"org_id": ORG_ID}),
        (DRIVES, {"org_id": ORG_ID}),
        (DRIVE_CHECKINS, {"org_id": ORG_ID}),
        (OFFERS, {"org_id": ORG_ID}),
        (ALUMNI, {"org_id": ORG_ID}),
        (ALUMNI_REQUESTS, {"org_id": ORG_ID}),
        (REVIEW_COMMENTS, {"org_id": ORG_ID}),
        (STORIES, {"demo": True}),
        (COLLEGE_GROUPS, {"_id": "demo-college-group"}),
        (RECRUITER_LINKS, {"org_id": ORG_ID}),
        (RECRUITER_INVITES, {"org_id": ORG_ID}),
        (RECRUITERS, {"email_lc": f"recruiter@{EMAIL_DOMAIN}"}),
        (INTERVIEWS, {"org_id": ORG_ID}),
        (RECRUITER_FEEDBACK, {"org_id": ORG_ID}),
        (ORG_STAFF, {"org_id": ORG_ID}),
        (ORG_GROUPS, {"org_id": ORG_ID}),
        (ORGANIZATIONS, {"_id": ORG_ID}),
    )
    await _few_at_a_time([demo_jobs.remove(db), *(db[coll].delete_many(q) for coll, q in rest)])
    return n


CHUNK = 200
Docs = defaultdict[str, list[dict[str, Any]]]  # collection → the records a reset writes to it
AT_ONCE = 6  # database calls in flight at once during a reset (each holds one pooled connection)


async def _few_at_a_time(calls: Iterable[Awaitable[Any]]) -> list[Any]:
    """Runs independent database calls a few at a time: the reset waits for a few network hops, not one per call."""
    gate = asyncio.Semaphore(AT_ONCE)

    async def one(call: Awaitable[Any]) -> Any:
        async with gate:
            return await call

    return list(await asyncio.gather(*(one(c) for c in calls)))


async def _remove_people(db: AsyncDatabase, uids: list) -> None:
    await _few_at_a_time(
        db[coll].delete_many(q)
        for coll, q in (
            (RESUMES, {"user_id": {"$in": uids}}),
            (LINKEDIN, {"_id": {"$in": uids}}),
            (MEMBERSHIPS, {"user_id": {"$in": uids}}),
            (USERS, {"_id": {"$in": uids}, "demo": True}),
        )
    )


async def create_demo(db: AsyncDatabase, actor_id: str | None = None, seed: int = 2026) -> dict[str, Any]:
    """Creates (or resets) the demo organization. Same data every time (fixed random seed). Everything is built in
    memory (`docs`: collection → records) and written at the end, one insert_many per collection (see the top)."""
    # the old data goes while the one shared password hash is worked out (argon2, in a thread). Nobody knows the
    # password: demo students, alumni, the reviewer and the coordinator can't sign in with one.
    _, plans, pw = await asyncio.gather(remove_demo(db), get_plans(db), hash_password(new_token()))
    docs: Docs = defaultdict(list)
    rng = random.Random(seed)
    marks = random.Random(seed + 1)  # its own sequence, so adding marks doesn't change the names and data above
    t = now()
    today = t.astimezone(IST).date()
    sub = {**terms_of(plans["campus"]), "starts_on": today.isoformat(),
           "ends_on": (today + timedelta(days=365)).isoformat(),
           "grace_until": (today + timedelta(days=372)).isoformat(), "price_paid": 0, "discount": 0,
           "source": "demo"}  # fmt: skip
    docs[ORGANIZATIONS].append(
        {
            "_id": ORG_ID,
            "name": ORG_NAME,
            "type": "college",
            "city": "Demo City",
            "status": "active",
            "demo": True,
            "recruiter_settings": {"show_shortlist": True},
            "subscription": sub,
            "created_at": t,
            "updated_at": t,
            "created_by": actor_id,
        }  # fmt: skip
    )
    fields = [
        {"key": "roll_number", "label": "Roll number", "type": "text", "options": [], "required": True},
        {"key": "branch", "label": "Branch", "type": "select", "options": ["CSE", "ECE"], "required": True},
    ]
    students = 0
    names_used: set[str] = set()
    for gid, gname, code, branch, joined, on_roll in GROUPS:
        docs[ORG_GROUPS].append(
            {
                "_id": gid,
                "org_id": ORG_ID,
                "name": gname,
                "code": code,
                "starts_on": None,
                "ends_on": None,
                "member_limit": None,
                "custom_fields": fields,
                "settings": {
                    "members_download_free": True,
                    "active": False,
                    "require_approval": True,
                    "print_branded": True,
                    "share_with_recruiters": True,
                },
                "created_by": actor_id,
                "created_at": t - timedelta(days=60),
                "updated_at": t,
            }  # fmt: skip
        )
        roll_rows = []
        for i in range(on_roll):
            while True:
                name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
                if name not in names_used:
                    names_used.add(name)
                    break
            roll = f"26{branch}{i + 1:03d}"
            email = f"{name.lower().replace(' ', '.')}@{EMAIL_DOMAIN}"
            roll_rows.append({"name": name, "roll": roll, "branch": branch, "email": email})
            if i >= joined:
                continue  # on the roll list, hasn't joined yet
            quality = rng.choices([0, 1, 2, 3], weights=[2, 3, 3, 2])[0]
            uid = f"demo-u-{branch.lower()}-{i + 1:03d}"
            user = User(id=uid, email=email, name=name, role="customer", password_hash=pw,
                        email_verified_at=t, created_at=t - timedelta(days=rng.randint(10, 55)))  # fmt: skip
            docs[USERS].append({**user.to_mongo(), "demo": True})
            has_resume = rng.random() > 0.12
            rid = f"demo-r-{uid}"
            updated = t - timedelta(days=rng.randint(0, 40), hours=rng.randint(0, 20))
            if has_resume:
                docs[RESUMES].append(
                    {
                        "key": rid,
                        "user_id": uid,
                        "name": "Placement resume",
                        "active": True,
                        "pages": 1,
                        "data": _resume(rng, name, branch, email, quality),
                        "created_at": updated - timedelta(days=5),
                        "updated_at": updated,
                    }  # fmt: skip
                )
            if quality >= 2 and rng.random() < 0.6:
                docs[LINKEDIN].append(
                    {"_id": uid, "url": "", "result": {"score": rng.choice([55, 72, 81])}, "updated_at": t}
                )
            approval = "pending" if rng.random() < 0.1 else "approved"
            review = rng.choices(["none", "needs_changes", "ready"], weights=[4, 2, 4])[0] if has_resume else "none"
            joined_at = t - timedelta(days=rng.randint(1, 50))
            docs[MEMBERSHIPS].append(
                {
                    "_id": f"demo-m-{uid}",
                    "user_id": uid,
                    "group_id": gid,
                    "org_id": ORG_ID,
                    "resume_id": rid if has_resume else f"demo-deleted-{uid}",
                    "field_values": {"roll_number": roll, "branch": branch},
                    "consent": {"given": True, "text": consent_text(ORG_NAME), "at": joined_at},
                    "recruiter_opt_in": rng.random() < 0.75,
                    "left_at": None,
                    "updated_at": joined_at,
                    "joined_at": joined_at,
                    "approval": approval,
                    "review_status": review,
                    "review_note": "Add a project with a result (a number)." if review == "needs_changes" else "",
                    "reviewed_at": t - timedelta(days=rng.randint(0, 20)) if review != "none" else None,
                    "printed_at": t - timedelta(days=2) if review == "ready" and rng.random() < 0.5 else None,
                    "printed_count": 0,
                    "reminders_opt_out": False,
                    "last_reminded_at": None,
                    "academic": {
                        "cgpa": round(marks.uniform(5.6, 9.6), 2),
                        "backlogs": marks.choices([0, 0, 0, 0, 1, 2])[0],
                        "year": 2026,
                        "tenth": round(marks.uniform(62, 97), 1),
                        "twelfth": round(marks.uniform(58, 96), 1),
                        "verified_at": t - timedelta(days=3) if marks.random() < 0.5 else None,
                        "verified_by": None,
                    },
                }  # fmt: skip
            )
            students += 1
        docs[ROLL_LISTS].append(
            {
                "_id": gid,
                "org_id": ORG_ID,
                "rows": roll_rows,
                "uploaded_at": t - timedelta(days=55),
                "uploaded_by": actor_id,
            }  # fmt: skip
        )
    members = docs[MEMBERSHIPS]  # in the order written, as the database would list them
    token, session = _demo_invite(docs, members, rng, actor_id)
    _demo_drive(docs, members, rng)
    _demo_offers(docs, members, rng)
    _demo_alumni(docs, members, pw)
    _demo_reviewer(docs, members, pw)
    _demo_coordinator(docs, pw)
    _demo_stories(docs, members)
    docs[COLLEGE_GROUPS].append(
        {
            "_id": "demo-college-group",
            "name": "Demo College Group (demo)",
            "org_ids": [ORG_ID],
            "owner_ids": [COORDINATOR_ID],  # the demo coordinator sees the roll-up
            "created_at": now(),
        }  # fmt: skip
    )  # Admin → College groups: add your own email as owner to see the roll-up
    from app.jobs import demo_jobs
    from app.orgs.recruiter_account import issue_session

    written = await _few_at_a_time(
        [
            # the demo recruiter's account (no code: the address is made up), so My drives opens from the shortcut
            issue_session(db, f"recruiter@{EMAIL_DOMAIN}", "Demo Recruiter"),
            demo_jobs.seed(db),  # 30 demo jobs: admin and tests only, never on the public job pages
            *(db[coll].insert_many(rows) for coll, rows in docs.items() if rows),
        ]
    )
    recruiter_path = f"/recruiter/{token}#s={session}&a={written[0]}"
    if actor_id:
        await audit(db, actor_id, "demo_org_reset", target=ORG_ID, data={"orgs": [ORG_ID], "students": students})
    return {
        "orgId": ORG_ID,
        "name": ORG_NAME,
        "students": students,
        "groups": len(GROUPS),
        "recruiterPath": recruiter_path,
    }


def _demo_invite(docs: Docs, members: list[dict], rng: random.Random, actor_id: str | None) -> tuple[str, str]:
    """A recruiter invite from a made-up company, with a few students on its board. Its sign-in code would go to a
    made-up address, so the path returned carries a ready session (after #, never sent to a server log): only the
    admin who reset the demo gets it, and only for this demo invite. Returns the invite's token and session (the
    recruiter's account session is issued with the writes, in create_demo)."""
    from app.orgs.recruiter_portal import SESSION_HOURS, _hash

    t = now()
    token, session = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    iid = "demo-recruiter-invite"
    mids = [m["_id"] for m in members if m["recruiter_opt_in"] and m["approval"] == "approved"]
    picks = rng.sample(sorted(mids), min(6, len(mids)))
    stages = ["shortlisted", "shortlisted", "interview", "interview", "selected", "rejected"]
    board = {mid: {"stage": stages[i], "note": "Demo note", "at": t} for i, mid in enumerate(picks)}
    docs[RECRUITER_INVITES].append(
        {
            "_id": iid,
            "org_id": ORG_ID,
            "demo": True,
            "company": "Demo Tech Pvt Ltd (demo)",
            "recruiter_name": "Demo Recruiter",
            "email": f"recruiter@{EMAIL_DOMAIN}",
            "email_lc": f"recruiter@{EMAIL_DOMAIN}",
            "group_ids": sorted(g[0] for g in GROUPS),
            "branches": [],
            "expires_at": t + timedelta(days=60),
            "revoked_at": None,
            "allow_pdf": True,
            "contact": "after_shortlist",
            "token_hash": _hash("token", token),
            "board": board,
            "views": 0,
            "downloads": 0,
            "sessions": [{"hash": _hash("session", iid, session), "exp": t + timedelta(hours=SESSION_HOURS)}],
            "created_by": actor_id,
            "created_at": t,
        }
    )
    # an interview round tomorrow for the two students in "Interview": one confirmed, one asked for another time
    two = [mid for mid in picks if board[mid]["stage"] == "interview"]
    by_id = {m["_id"]: m for m in members if m["_id"] in two}
    start = datetime.combine(t.astimezone(IST).date() + timedelta(days=1), dtime(10, 30), IST)
    docs[INTERVIEWS].append(
        {
            "_id": "demo-interview",
            "org_id": ORG_ID,
            "invite_id": iid,
            "company": "Demo Tech Pvt Ltd (demo)",
            "recruiter_email": f"recruiter@{EMAIL_DOMAIN}",
            "group_ids": sorted({by_id[m]["group_id"] for m in two if m in by_id}),
            "round": "Technical round 1 (demo)",
            "minutes": 45,
            "place": "Placement cell, Block A (demo)",
            "link": "",
            "interviewer": "Demo Interviewer",
            "notes": "Bring your college ID.",
            "starts_at": start,
            "seq": 0,
            "students": [
                {"membership_id": m, "user_id": by_id[m]["user_id"], "group_id": by_id[m]["group_id"],
                 "status": st, "reason": why, "at": t, "reminded_seq": 0}
                for m, (st, why) in zip(two, [("confirmed", ""), ("reschedule", "University exam that morning (demo)")],
                                        strict=False)
                if m in by_id
            ],
            "demo": True,
            "created_at": t,
            "updated_at": t,
            "cancelled_at": None,
        }
    )  # fmt: skip
    # a past drive (another made-up company, ended months ago): My drives shows its counts and notes, not students
    old = sorted(mids)[-3:]
    docs[RECRUITER_INVITES].append(
        {
            "_id": "demo-recruiter-invite-past",
            "org_id": ORG_ID,
            "demo": True,
            "company": "Demo Analytics LLP (demo)",
            "recruiter_name": "Demo Recruiter",
            "email": f"recruiter@{EMAIL_DOMAIN}",
            "email_lc": f"recruiter@{EMAIL_DOMAIN}",
            "group_ids": sorted(g[0] for g in GROUPS),
            "branches": [],
            "expires_at": t - timedelta(days=140),
            "revoked_at": None,
            "allow_pdf": False,
            "contact": "hidden",
            "token_hash": _hash("token", secrets.token_urlsafe(32)),
            "board": {
                mid: {"stage": st, "note": note, "at": t - timedelta(days=150 + i)}
                for i, (mid, st, note) in enumerate(
                    zip(
                        old,
                        ["selected", "interview", "rejected"],
                        ["Strong SQL (demo)", "Good projects (demo)", ""],
                        strict=False,
                    )  # fmt: skip
                )
            },
            "views": 4,
            "downloads": 0,
            "sessions": [],
            "created_by": actor_id,
            "created_at": t - timedelta(days=200),
        }
    )
    # the past drive's feedback: what "What recruiters said" shows on the demo college's dashboard
    docs[RECRUITER_FEEDBACK].append(
        {"_id": "demo-recruiter-invite-past", "org_id": ORG_ID, "company": "Demo Analytics LLP (demo)",
         "group_ids": sorted(g[0] for g in GROUPS), "rating": 4, "skills": ["SQL", "Power BI"], "basics": ["Python"],
         "projects_no_results": True, "communication": False, "other": "", "went_well": "Punctual, well-prepared "
         "students (demo).", "visit_again": "yes", "demo": True, "created_at": t - timedelta(days=139),
         "updated_at": t - timedelta(days=139)}
    )  # fmt: skip
    return token, session


def _demo_drive(docs: Docs, members: list[dict], rng: random.Random) -> None:
    """Drive day (today): two companies, test rooms and interview slots, students assigned, some checked in."""
    t = now()
    day = t.astimezone(IST).date().isoformat()
    mids = sorted(m["_id"] for m in members if m["approval"] == "approved")
    companies = [
        {"id": "demo-co-infosys", "name": "Infosys (demo)", "rules": {"cgpa_min": 7.0, "backlogs_max": 0}},
        {"id": "demo-co-tcs", "name": "TCS (demo)", "rules": {"cgpa_min": 6.0, "tenth_min": 60}},
    ]
    slots = []
    half = len(mids) // 2
    for i, (room, start, end, part) in enumerate(
        (("Lab 1", "09:30", "10:30", mids[:half]), ("Lab 2", "09:30", "10:30", mids[half:]))
    ):
        slots.append({"id": f"demo-slot-test-{i}", "company_id": "demo-co-infosys", "round": "test", "room": room,
                      "start": start, "end": end, "members": part})  # fmt: skip
    picks = rng.sample(mids, min(8, len(mids)))
    slots.append({"id": "demo-slot-int-0", "company_id": "demo-co-infosys", "round": "interview",
                  "room": "Seminar hall", "start": "14:00", "end": "16:00", "members": picks})  # fmt: skip
    slots.append({"id": "demo-slot-gd-0", "company_id": "demo-co-tcs", "round": "gd", "room": "Room 204",
                  "start": "11:00", "end": "12:00", "members": mids[:10]})  # fmt: skip
    docs[DRIVES].append(
        {
            "_id": "demo-drive",
            "org_id": ORG_ID,
            "name": "Campus drive (demo)",
            "date": day,
            "group_ids": [g[0] for g in GROUPS],
            "companies": companies,
            "slots": slots,
            "created_by": None,
            "created_at": t,
        }  # fmt: skip
    )
    start = datetime.combine(t.astimezone(IST).date(), dtime(9, 30), tzinfo=IST)
    rows = []
    for s in slots[:2]:
        for mid in s["members"]:
            if rng.random() < 0.75:
                late = rng.random() < 0.15
                at = start + timedelta(minutes=rng.randint(12, 30) if late else rng.randint(-20, 8))
                rows.append({"_id": f"{s['id']}:{mid}", "drive_id": "demo-drive", "slot_id": s["id"],
                             "membership_id": mid, "org_id": ORG_ID, "at": at,
                             "by": "self" if rng.random() < 0.85 else "staff", "actor_id": None})  # fmt: skip
    if rows:
        docs[DRIVE_CHECKINS].extend(rows)


def _demo_offers(docs: Docs, members: list[dict], rng: random.Random) -> None:
    """About a third of the demo students placed; a few with two offers; one declined; a few internships."""
    t = now()
    ms_ = sorted(members, key=lambda m: m["_id"])
    picks = rng.sample(ms_, max(1, len(ms_) // 3))
    companies = [("Infosys (demo)", "Systems Engineer", 3.6), ("TCS (demo)", "Assistant System Engineer", 3.36),
                 ("Wipro (demo)", "Project Engineer", 3.5), ("Zoho (demo)", "Member Technical Staff", 7.2),
                 ("Bosch (demo)", "Graduate Engineer Trainee", 6.0)]  # fmt: skip
    rows = []
    for i, m in enumerate(picks):
        for j in range(2 if i % 6 == 0 else 1):
            co, role, ctc = companies[(i + j * 2) % len(companies)]
            kind = "internship" if i % 9 == 4 else "full_time"
            status = "declined" if i == 3 and j == 0 else rng.choice(["offered", "accepted", "accepted", "joined"])
            rows.append({"_id": f"demo-offer-{i}-{j}", "org_id": ORG_ID, "membership_id": m["_id"],
                         "user_id": m["user_id"], "group_id": m["group_id"], "company": co, "role": role,
                         "ctc_lpa": None if kind == "internship" else ctc, "type": kind,
                         "offer_date": (t - timedelta(days=rng.randint(1, 40))).date().isoformat(), "status": status,
                         "created_by": None, "created_at": t, "updated_at": t})  # fmt: skip
    if rows:
        docs[OFFERS].extend(rows)


ALUMNI_PEOPLE = (
    ("Ravi Teja", "Infosys", "Senior Systems Engineer", "Pune", 2021, True, True),
    ("Lakshmi Prasanna", "Zoho", "Member Technical Staff", "Chennai", 2022, True, False),
    ("Harsha Vardhan", "Bosch", "Embedded Engineer", "Bengaluru", 2020, False, True),
    ("Sneha Reddy", "TCS", "Data Analyst", "Hyderabad", 2023, True, True),
)


def _demo_alumni(docs: Docs, members: list[dict], pw: str) -> None:
    """Four made-up alumni (demo accounts that can't sign in) and two requests from demo students, one replied."""
    t = now()
    ids = []
    for i, (name, co, role, city, batch, ref, men) in enumerate(ALUMNI_PEOPLE):
        uid = f"demo-alum-{i}"
        user = User(id=uid, email=f"alumni{i}@{EMAIL_DOMAIN}", name=name, role="customer", password_hash=pw,
                    email_verified_at=t, created_at=t)  # fmt: skip
        docs[USERS].append({**user.to_mongo(), "demo": True})
        docs[ALUMNI].append(
            {
                "_id": f"demo-alumni-{i}",
                "org_id": ORG_ID,
                "user_id": uid,
                "company": co,
                "role": role,
                "city": city,
                "batch": batch,
                "referrals": ref,
                "mentoring": men,
                "paused": False,
                "left_at": None,
                "created_at": t,
                "updated_at": t,
            }  # fmt: skip
        )
        ids.append((f"demo-alumni-{i}", uid))
    students = [m["user_id"] for m in members[:2]]
    for j, s in enumerate(students):
        aid, to = ids[j]
        r = {"_id": f"demo-alumni-req-{j}", "org_id": ORG_ID, "alumni_id": aid, "from_user": s, "to_user": to,
             "kind": "referral", "note": "Could you refer me for the graduate role? I have two SQL projects.",
             "replies": [], "created_at": t - timedelta(days=j + 1)}  # fmt: skip
        if j == 0:
            r["replies"] = [{"by": to, "text": "Happy to — apply on the careers page and tell me the job id.", "at": t}]
            r["replied_at"] = t
        docs[ALUMNI_REQUESTS].append(r)


def _demo_reviewer(docs: Docs, members: list[dict], pw: str) -> None:
    """A made-up faculty reviewer (a demo account that can't sign in) with six students and a few comments."""
    t = now()
    uid = "demo-reviewer"
    user = User(id=uid, email=f"reviewer@{EMAIL_DOMAIN}", name="Dr. Anitha Rao (demo)", role="customer",
                password_hash=pw, email_verified_at=t, created_at=t)  # fmt: skip
    docs[USERS].append({**user.to_mongo(), "demo": True})
    by_id = {m["_id"]: m for m in members}
    mids = sorted(by_id)[:6]
    docs[ORG_STAFF].append(
        {
            "_id": "demo-staff-reviewer",
            "org_id": ORG_ID,
            "email": user.email,
            "email_lc": user.email,
            "user_id": uid,
            "role": "reviewer",
            "group_ids": None,
            "status": "active",
            "member_ids": mids,
            "created_at": t,
            "accepted_at": t,
        }  # fmt: skip
    )
    notes = [("proj", "Built a food ordering app", "Add what changed because of it — users, time saved, a number."),
             ("summary", "", "Two lines are enough: role you want + your strongest skill."),
             ("skills", "", "Group these: languages, tools, cloud.")]  # fmt: skip
    for i, (sec, line, text) in enumerate(notes):
        m = by_id[mids[i % len(mids)]]
        docs[REVIEW_COMMENTS].append(
            {
                "_id": f"demo-review-{i}",
                "org_id": ORG_ID,
                "membership_id": m["_id"],
                "user_id": m["user_id"],
                "reviewer_id": uid,
                "section": sec,
                "line": line,
                "text": text,
                "resolved_at": t if i == 2 else None,
                "created_at": t - timedelta(days=i),
            }  # fmt: skip
        )


def _demo_coordinator(docs: Docs, pw: str) -> None:
    """A made-up coordinator of the demo college (all groups). It has no password anyone knows: an admin opens it
    with "Reset and open as coordinator" (app/orgs/demo_login.py), and that session reaches only the demo college."""
    t = now()
    user = User(id=COORDINATOR_ID, email=f"coordinator@{EMAIL_DOMAIN}", name="Demo Coordinator (demo)", role="customer",
                password_hash=pw, email_verified_at=t, created_at=t)  # fmt: skip
    docs[USERS].append({**user.to_mongo(), "demo": True})
    docs[ORG_STAFF].append(
        {"_id": "demo-staff-coordinator", "org_id": ORG_ID, "email": user.email, "email_lc": user.email,
         "user_id": COORDINATOR_ID, "role": "coordinator", "group_ids": None, "status": "active",
         "created_at": t, "accepted_at": t}
    )  # fmt: skip


def _demo_stories(docs: Docs, members: list[dict]) -> None:
    """Two made-up placement stories for trying Admin > Stories. Marked demo: never shown on the public site."""
    t = now()
    uids = [m["user_id"] for m in sorted(members, key=lambda m: m["_id"])[:2]]
    texts = [
        ("Demo student A (demo)", "Infosys (demo)", "Systems Engineer",
         "Demo story: the placement cell asked us to finish our resumes on Nm7 before the drive. The ATS check showed "
         "what was missing and I was shortlisted in the first round."),
        ("Demo student B (demo)", "TCS (demo)", "Assistant System Engineer",
         "Demo story: I had never made a resume before. The builder asked simple questions and my faculty reviewer "
         "left comments right next to my projects."),
    ]  # fmt: skip
    for i, (name, company, role, story) in enumerate(texts):
        docs[STORIES].append(
            {"_id": f"demo-story-{i}", "user_id": uids[i % len(uids)] if uids else None, "story": story,
             "display_name": name, "company": company, "role": role, "photo": None, "consent_at": t,
             "status": "approved", "decided_at": t, "created_at": t, "demo": True}
        )  # fmt: skip
