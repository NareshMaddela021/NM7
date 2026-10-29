"""The demo organization: "Demo Engineering College", with made-up students, for testing and sales demos.

    python -m app.cli demo-org            # create it, or reset it to the starting data
    python -m app.cli demo-org --remove   # delete it and everything in it
    Admin console (Owner): Organizations → "Demo organization" → Create / reset, Remove

Everything it makes is marked `demo: true` (the organization and every student account) and is left out of real
numbers: admin dashboard customer counts, the customers list, paid-organization counts and renewals. Demo students
can't sign in (no usable password), are never emailed (reminders skip them) and use addresses that can't receive mail
(…@demo.nm7.invalid). The groups are closed, so nobody real can join them.
"""

import random
import secrets
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
    LINKEDIN,
    MEMBERSHIPS,
    OFFERS,
    ORG_GROUPS,
    ORG_STAFF,
    ORGANIZATIONS,
    RECRUITER_INVITES,
    RECRUITER_LINKS,
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
    uids = [u["_id"] async for u in db[USERS].find({"demo": True}, {"_id": 1})]
    for coll, q in (
        (RESUMES, {"user_id": {"$in": uids}}),
        (LINKEDIN, {"_id": {"$in": uids}}),
        (MEMBERSHIPS, {"$or": [{"org_id": ORG_ID}, {"user_id": {"$in": uids}}]}),
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
        (ORG_STAFF, {"org_id": ORG_ID}),
        (ORG_GROUPS, {"org_id": ORG_ID}),
        (ORGANIZATIONS, {"_id": ORG_ID}),
        (USERS, {"demo": True}),
    ):
        await db[coll].delete_many(q)
    return len(uids)


async def create_demo(db: AsyncDatabase, actor_id: str | None = None, seed: int = 2026) -> dict[str, Any]:
    """Creates (or resets) the demo organization. Same data every time (fixed random seed)."""
    await remove_demo(db)
    rng = random.Random(seed)
    marks = random.Random(seed + 1)  # its own sequence, so adding marks doesn't change the names and data above
    t = now()
    today = t.astimezone(IST).date()
    plans = await get_plans(db)
    sub = {**terms_of(plans["campus"]), "starts_on": today.isoformat(),
           "ends_on": (today + timedelta(days=365)).isoformat(),
           "grace_until": (today + timedelta(days=372)).isoformat(), "price_paid": 0, "discount": 0,
           "source": "demo"}  # fmt: skip
    await db[ORGANIZATIONS].insert_one(
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
    pw = await hash_password(new_token())  # nobody knows it: demo students can't sign in
    students = 0
    names_used: set[str] = set()
    for gid, gname, code, branch, joined, on_roll in GROUPS:
        await db[ORG_GROUPS].insert_one(
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
            await db[USERS].insert_one({**user.to_mongo(), "demo": True})
            has_resume = rng.random() > 0.12
            rid = f"demo-r-{uid}"
            updated = t - timedelta(days=rng.randint(0, 40), hours=rng.randint(0, 20))
            if has_resume:
                await db[RESUMES].insert_one(
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
                await db[LINKEDIN].insert_one(
                    {"_id": uid, "url": "", "result": {"score": rng.choice([55, 72, 81])}, "updated_at": t}
                )
            approval = "pending" if rng.random() < 0.1 else "approved"
            review = rng.choices(["none", "needs_changes", "ready"], weights=[4, 2, 4])[0] if has_resume else "none"
            joined_at = t - timedelta(days=rng.randint(1, 50))
            await db[MEMBERSHIPS].insert_one(
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
        await db[ROLL_LISTS].insert_one(
            {
                "_id": gid,
                "org_id": ORG_ID,
                "rows": roll_rows,
                "uploaded_at": t - timedelta(days=55),
                "uploaded_by": actor_id,
            }  # fmt: skip
        )
    recruiter_path = await _demo_invite(db, rng, actor_id)
    await _demo_drive(db, rng)
    await _demo_offers(db, rng)
    await _demo_alumni(db, rng)
    await _demo_reviewer(db)
    await _demo_coordinator(db)
    await _demo_stories(db)
    await db[COLLEGE_GROUPS].insert_one(
        {
            "_id": "demo-college-group",
            "name": "Demo College Group (demo)",
            "org_ids": [ORG_ID],
            "owner_ids": [COORDINATOR_ID],  # the demo coordinator sees the roll-up
            "created_at": now(),
        }  # fmt: skip
    )  # Admin → College groups: add your own email as owner to see the roll-up
    if actor_id:
        await audit(db, actor_id, "demo_org_reset", target=ORG_ID, data={"orgs": [ORG_ID], "students": students})
    return {
        "orgId": ORG_ID,
        "name": ORG_NAME,
        "students": students,
        "groups": len(GROUPS),
        "recruiterPath": recruiter_path,
    }


async def _demo_invite(db: AsyncDatabase, rng: random.Random, actor_id: str | None) -> str:
    """A recruiter invite from a made-up company, with a few students on its board. Its sign-in code would go to a
    made-up address, so the path returned carries a ready session (after #, never sent to a server log): only the
    admin who reset the demo gets it, and only for this demo invite."""
    from app.orgs.recruiter_portal import SESSION_HOURS, _hash

    t = now()
    token, session = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    iid = "demo-recruiter-invite"
    mids = [
        m["_id"]
        async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID, "recruiter_opt_in": True, "approval": "approved"})
    ]
    picks = rng.sample(sorted(mids), min(6, len(mids)))
    stages = ["shortlisted", "shortlisted", "interview", "interview", "selected", "rejected"]
    board = {mid: {"stage": stages[i], "note": "Demo note", "at": t} for i, mid in enumerate(picks)}
    await db[RECRUITER_INVITES].insert_one(
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
    return f"/recruiter/{token}#s={session}"


async def _demo_drive(db: AsyncDatabase, rng: random.Random) -> None:
    """Drive day (today): two companies, test rooms and interview slots, students assigned, some checked in."""
    t = now()
    day = t.astimezone(IST).date().isoformat()
    mids = sorted([m["_id"] async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID, "approval": "approved"})])
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
    await db[DRIVES].insert_one(
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
        await db[DRIVE_CHECKINS].insert_many(rows)


async def _demo_offers(db: AsyncDatabase, rng: random.Random) -> None:
    """About a third of the demo students placed; a few with two offers; one declined; a few internships."""
    t = now()
    ms_ = [m async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID}).sort("_id", 1)]
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
        await db[OFFERS].insert_many(rows)


ALUMNI_PEOPLE = (
    ("Ravi Teja", "Infosys", "Senior Systems Engineer", "Pune", 2021, True, True),
    ("Lakshmi Prasanna", "Zoho", "Member Technical Staff", "Chennai", 2022, True, False),
    ("Harsha Vardhan", "Bosch", "Embedded Engineer", "Bengaluru", 2020, False, True),
    ("Sneha Reddy", "TCS", "Data Analyst", "Hyderabad", 2023, True, True),
)


async def _demo_alumni(db: AsyncDatabase, rng: random.Random) -> None:
    """Four made-up alumni (demo accounts that can't sign in) and two requests from demo students, one replied."""
    t = now()
    ids = []
    pw = await hash_password(new_token())  # nobody knows it: demo alumni can't sign in
    for i, (name, co, role, city, batch, ref, men) in enumerate(ALUMNI_PEOPLE):
        uid = f"demo-alum-{i}"
        user = User(id=uid, email=f"alumni{i}@{EMAIL_DOMAIN}", name=name, role="customer", password_hash=pw,
                    email_verified_at=t, created_at=t)  # fmt: skip
        await db[USERS].insert_one({**user.to_mongo(), "demo": True})
        await db[ALUMNI].insert_one(
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
    students = [m["user_id"] async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID}).limit(2)]
    for j, s in enumerate(students):
        aid, to = ids[j]
        r = {"_id": f"demo-alumni-req-{j}", "org_id": ORG_ID, "alumni_id": aid, "from_user": s, "to_user": to,
             "kind": "referral", "note": "Could you refer me for the graduate role? I have two SQL projects.",
             "replies": [], "created_at": t - timedelta(days=j + 1)}  # fmt: skip
        if j == 0:
            r["replies"] = [{"by": to, "text": "Happy to — apply on the careers page and tell me the job id.", "at": t}]
            r["replied_at"] = t
        await db[ALUMNI_REQUESTS].insert_one(r)


async def _demo_reviewer(db: AsyncDatabase) -> None:
    """A made-up faculty reviewer (a demo account that can't sign in) with six students and a few comments."""
    t = now()
    uid = "demo-reviewer"
    user = User(id=uid, email=f"reviewer@{EMAIL_DOMAIN}", name="Dr. Anitha Rao (demo)", role="customer",
                password_hash=await hash_password(new_token()), email_verified_at=t, created_at=t)  # fmt: skip
    await db[USERS].insert_one({**user.to_mongo(), "demo": True})
    mids = [m["_id"] async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID}).sort("_id", 1).limit(6)]
    await db[ORG_STAFF].insert_one(
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
        m = await db[MEMBERSHIPS].find_one({"_id": mids[i % len(mids)]})
        await db[REVIEW_COMMENTS].insert_one(
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


async def _demo_coordinator(db: AsyncDatabase) -> None:
    """A made-up coordinator of the demo college (all groups). It has no password anyone knows: an admin opens it
    with "Reset and open as coordinator" (app/orgs/demo_login.py), and that session reaches only the demo college."""
    t = now()
    user = User(id=COORDINATOR_ID, email=f"coordinator@{EMAIL_DOMAIN}", name="Demo Coordinator (demo)", role="customer",
                password_hash=await hash_password(new_token()), email_verified_at=t, created_at=t)  # fmt: skip
    await db[USERS].insert_one({**user.to_mongo(), "demo": True})
    await db[ORG_STAFF].insert_one(
        {"_id": "demo-staff-coordinator", "org_id": ORG_ID, "email": user.email, "email_lc": user.email,
         "user_id": COORDINATOR_ID, "role": "coordinator", "group_ids": None, "status": "active",
         "created_at": t, "accepted_at": t}
    )  # fmt: skip


async def _demo_stories(db: AsyncDatabase) -> None:
    """Two made-up placement stories for trying Admin > Stories. Marked demo: never shown on the public site."""
    t = now()
    uids = [m["user_id"] async for m in db[MEMBERSHIPS].find({"org_id": ORG_ID}).sort("_id", 1).limit(2)]
    texts = [
        ("Demo student A (demo)", "Infosys (demo)", "Systems Engineer",
         "Demo story: the placement cell asked us to finish our resumes on Nm7 before the drive. The ATS check showed "
         "what was missing and I was shortlisted in the first round."),
        ("Demo student B (demo)", "TCS (demo)", "Assistant System Engineer",
         "Demo story: I had never made a resume before. The builder asked simple questions and my faculty reviewer "
         "left comments right next to my projects."),
    ]  # fmt: skip
    for i, (name, company, role, story) in enumerate(texts):
        await db[STORIES].insert_one(
            {"_id": f"demo-story-{i}", "user_id": uids[i % len(uids)] if uids else None, "story": story,
             "display_name": name, "company": company, "role": role, "photo": None, "consent_at": t,
             "status": "approved", "decided_at": t, "created_at": t, "demo": True}
        )  # fmt: skip
