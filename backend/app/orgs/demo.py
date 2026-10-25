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
from datetime import timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.audit import audit
from app.auth.models import User
from app.billing.plans import get_plans, terms_of
from app.core.db import (
    LINKEDIN,
    MEMBERSHIPS,
    ORG_GROUPS,
    ORG_STAFF,
    ORGANIZATIONS,
    RECRUITER_INVITES,
    RECRUITER_LINKS,
    RESUMES,
    ROLL_LISTS,
    USERS,
)
from app.core.security import hash_password, new_token
from app.core.time import IST, now
from app.orgs.service import consent_text

ORG_ID = "demo-engineering-college"
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
