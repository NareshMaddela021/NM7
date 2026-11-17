"""100 test users for checking the live site (Admin → Settings → "Test users").

Made-up people for trying every customer page with many different accounts: a mix of students, freshers, experienced
and senior people, IT and non-IT, with no resume, a started resume or a full one.

  GET    /api/admin/test-users             how many exist, and the list (number, name, kind, resume, opened)
  POST   /api/admin/test-users             remove the old ones and create 100 fresh ones
  DELETE /api/admin/test-users             remove them and everything they made
  POST   /api/admin/test-users/{n}/open    a one-time link (5 minutes; only a hash is stored) that signs this browser
                                           in as test user n (the same /demo-student page the demo students use)

Safe on the live site:
- they are marked demo, so they are left out of the admin numbers, the customers list, the morning runs, the fraud
  scan and every company's candidate search, like the other made-up people;
- their names end in "(test)" and their addresses in @test.nm7.invalid: no inbox exists, and app/core/email.py never
  sends to that domain;
- they have no password: the only way in is the one-time link from Admin;
- they can't apply to a real company's job on Nm7 (app/jobs/apply.py), so no company ever sees a made-up applicant.
  Jobs that apply on another website or by email only add a row to the test user's own tracker.
"""

import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Request

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, EMAIL_CODES, RESUMES, SESSIONS, USERS
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.security import hash_token
from app.core.testusers import DOMAIN, PREFIX
from app.core.time import now
from app.hire.templates import TEMPLATES

router = APIRouter(prefix="/api/admin/test-users", tags=["test users"])

COUNT = 100
LINK_TTL = timedelta(minutes=5)
PATH = "/me"

FIRST = ["Asha", "Ravi", "Meena", "Arjun", "Divya", "Kiran", "Sana", "Vikram", "Lakshmi", "Imran", "Pooja", "Suresh",
         "Neha", "Rahul", "Fatima", "Gopal", "Anjali", "Manoj", "Priya", "Sameer", "Kavya", "Naveen", "Rekha", "Ajay",
         "Swathi", "Harish", "Nisha", "Venkat", "Ayesha", "Deepak"]  # fmt: skip
LAST = ["Rao", "Kumar", "Reddy", "Sharma", "Naidu", "Khan", "Iyer", "Patel", "Das", "Varma"]
CITIES = ["Hyderabad", "Bengaluru", "Vijayawada", "Pune", "Chennai", "Anantapur", "Visakhapatnam", "Mumbai"]
KINDS = ("student", "fresher", "experienced", "senior")
STAGES = ("none", "started", "full", "full", "full")  # 20 without a resume, 20 just started, 60 complete
EDU = {"10th": "SSC (10th)", "12th": "Intermediate (12th)", "iti": "ITI", "diploma": "Diploma",
       "graduate": "B.Tech", "postgraduate": "MBA"}  # fmt: skip


def uid_of(n: int) -> str:
    return f"{PREFIX}{n:03d}"


def person(i: int) -> dict[str, Any]:
    """Test user number i + 1: always the same person, so a bug report can say "test user 37"."""
    kind = KINDS[i % len(KINDS)]
    years = {"student": 0, "fresher": 0, "experienced": 1 + (i // 4) % 5, "senior": 6 + (i // 4) % 11}[kind]
    return {
        "n": i + 1,
        "id": uid_of(i + 1),
        "name": f"{FIRST[i % len(FIRST)]} {LAST[(i // len(FIRST) + i) % len(LAST)]} (test)",
        "email": f"user{i + 1:03d}@{DOMAIN}",
        "kind": kind,
        "years": years,
        "stage": STAGES[i % len(STAGES)],
        "city": CITIES[i % len(CITIES)],
        "tpl": TEMPLATES[i % len(TEMPLATES)],
    }


def resume_data(p: dict[str, Any]) -> dict[str, Any]:
    tpl, year = p["tpl"], now().year
    skills = ", ".join(tpl["skills"])
    personal = {
        "name": p["name"],
        "email": p["email"],
        "phone": f"+91 90000 1{p['n']:04d}",  # each different (a shared phone is a fraud signal)
        "location": p["city"],
    }
    studying = p["kind"] == "student"
    done = year + 1 if studying else year - p["years"] - (0 if p["years"] else 1)
    edu = [
        {
            "institution": "Test Engineering College (made-up)",
            "degree": EDU.get(tpl["education"], "B.Tech"),
            "field": "",
            "from": f"{done - 4}-08",
            "to": str(done),
        }
    ]
    if p["stage"] == "started":  # opened the builder, typed their name and studies, then stopped
        return {"personal": personal, "edu": edu, "exp": [], "proj": [], "skillGroups": []}
    exp: list[dict[str, Any]] = []
    if p["kind"] == "fresher":
        exp = [{"company": "Test Firm (made-up)", "role": f"{tpl['title']} Intern", "employmentType": "Internship",
                "from": f"{year - 1}-01", "to": f"{year - 1}-06", "current": False,
                "description": f"Helped the team with {skills.lower()} for 6 months."}]  # fmt: skip
    elif p["years"]:
        first = max(1, p["years"] // 2)
        exp = [{"company": "Test Firm (made-up)", "role": tpl["title"], "from": f"{year - first}-01", "to": "",
                "current": True, "description": f"Works as {tpl['title'].lower()}: {skills.lower()}."}]  # fmt: skip
        if p["years"] > first:
            exp.append({"company": "Earlier Test Firm (made-up)", "role": f"Junior {tpl['title']}",
                        "from": f"{year - p['years']}-01", "to": f"{year - first - 1}-12", "current": False,
                        "description": f"Started with {tpl['skills'][0].lower()} and grew into the full role."})  # fmt: skip
    what = "Final-year student" if studying else "Fresher" if not p["years"] else f"{p['years']} years of experience"
    return {
        "personal": {**personal, "headline": tpl["title"]},
        "summary": f"{what} from {p['city']}, looking for work as {tpl['title'].lower()}. Skills: {skills}. "
        f"Made-up test person number {p['n']}.",
        "exp": exp,
        "edu": edu,
        "skillGroups": [{"id": "core", "label": "Skills", "value": skills}],
        "proj": [
            {
                "title": f"{tpl['skills'][0]} practice project",
                "tagline": f"A small {tpl['domain']} project",
                "description": "",
                "tech": skills,
            }
        ]
        if p["years"] < 6
        else [],  # fmt: skip
    }


async def remove(db) -> int:
    """Every test user and everything they made. Those who were opened (signed in) may have made anything a customer
    can, so they go through the same erase as a deleted account; the rest only have what `create` gave them."""
    from app.me.erase import erase_user_data

    mine = {"$regex": f"^{PREFIX}"}
    opened = [u["_id"] async for u in db[USERS].find({"_id": mine, "test_opened_at": {"$ne": None}}, {"_id": 1})]
    for uid in opened:
        await erase_user_data(db, uid)
    await db[RESUMES].delete_many({"user_id": mine})
    await db[SESSIONS].delete_many({"user_id": mine})
    await db[EMAIL_CODES].delete_many({"user_id": mine})
    return (await db[USERS].delete_many({"_id": mine, "demo": True})).deleted_count


async def create(db) -> dict[str, Any]:
    await remove(db)
    t = now()
    users, resumes = [], []
    for i in range(COUNT):
        p = person(i)
        users.append(
            {
                "_id": p["id"],
                "email": p["email"],
                "email_lc": p["email"],
                "name": p["name"],
                "role": "customer",
                "password_hash": "",  # no password: only the one-time link from Admin signs them in
                "demo": True,
                "test_user": True,
                "test_opened_at": None,
                "email_verified_at": t,
                "terms_accepted_at": t,
                "target_role": p["tpl"]["title"],
                "cities": p["city"],
                "notify": {},
                "ui": {},
                "created_at": t - timedelta(days=i % 30, minutes=i),
                "updated_at": t,
            }
        )
        if p["stage"] != "none":
            resumes.append(
                {
                    "key": "r1",
                    "user_id": p["id"],
                    "name": "My resume",
                    "data": resume_data(p),
                    "active": True,
                    "versions": [],
                    "created_at": t,
                    "updated_at": t,
                }
            )
    await db[USERS].insert_many(users)
    await db[RESUMES].insert_many(resumes)
    return {"created": len(users), "resumes": len(resumes)}


def _row(p: dict[str, Any], u: dict[str, Any]) -> dict[str, Any]:
    return {"n": p["n"], "id": p["id"], "name": p["name"], "kind": p["kind"], "years": p["years"],
            "resume": p["stage"], "role": p["tpl"]["title"], "city": p["city"],
            "opened": bool(u.get("test_opened_at"))}  # fmt: skip


@router.get("")
async def test_users(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    have = {
        u["_id"]: u
        async for u in db[USERS].find({"_id": {"$regex": f"^{PREFIX}"}, "demo": True}, {"test_opened_at": 1})
    }
    people = [person(i) for i in range(COUNT)]
    return {"count": len(have), "total": COUNT, "users": [_row(p, have[p["id"]]) for p in people if p["id"] in have]}


@router.post("")
async def create_test_users(request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    await rate_limit.check(db, f"test-users:{auth.user.id}", [(10, timedelta(hours=1))])
    await rate_limit.record(db, f"test-users:{auth.user.id}")
    async with heavy_or_busy(db):  # one heavy job at a time (app/core/heavy.py)
        out = await create(db)
    await audit(db, auth.user.id, "test_users_create", data=out, ip=client_ip(request))
    return out


@router.delete("")
async def remove_test_users(request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        out = {"removed": await remove(db)}
    await audit(db, auth.user.id, "test_users_remove", data=out, ip=client_ip(request))
    return out


@router.post("/{n}/open")
async def open_test_user(n: int, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    await rate_limit.check(db, f"test-user-open:{auth.user.id}", [(120, timedelta(hours=1))])
    await rate_limit.record(db, f"test-user-open:{auth.user.id}")
    if not 1 <= n <= COUNT:
        raise ApiError(404, "not_found", "No such test user.")
    token = secrets.token_urlsafe(32)
    t = now()
    done = await db[USERS].update_one(
        {"_id": uid_of(n), "demo": True},
        {
            "$set": {
                "demo_login_hash": hash_token(token),
                "demo_login_exp": t + LINK_TTL,
                "demo_path": PATH,
                "test_opened_at": t,
            }
        },  # fmt: skip
    )
    if not done.matched_count:
        raise ApiError(404, "not_found", "No such test user. Create the test users first.")
    await audit(db, auth.user.id, "test_user_open", target=uid_of(n), ip=client_ip(request))
    return {"path": f"/demo-student#t={token}", "user": uid_of(n)}
