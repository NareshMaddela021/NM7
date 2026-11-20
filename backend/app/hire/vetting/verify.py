# ruff: noqa: E501  (dense response shapes)
"""Vetting V4: human verification and references. L4 "Nm7 verified" = a real reviewer confirms the candidate in a
15-minute check AND a past manager / teacher vouches for them. Valid for a year.

Reviewers: Nm7 staff and vetted experts (expert accounts) apply by role (profile, roles, weekly slots); new reviewers
pass calibration first — they grade 5 sample interviews and must land within 1 point of the gold scores on 80% of
the lines. A quality score comes from senior re-reviews and from companies' ratings of the candidates they checked.

  Reviewer (expert account):  GET/PUT /api/reviewer/me · GET /api/reviewer/calibration · POST /api/reviewer/calibration
                              GET /api/reviewer/checks
                              POST /api/reviewer/checks/{id}/result {score 1–5, passed, note (3 lines), checklist}
  Company:                    POST /api/company/{cid}/hire/l4/{uid}   request L4 for a candidate it can see
                              POST /api/company/{cid}/hire/l4/{uid}/rating {stars}   after interviewing them
  Candidate:                  GET /api/me/verification · POST /api/me/verification/slot {at}
                              POST /api/me/verification/referees [{name, relation, company, email, phone}]
  Referee (no account):       GET/POST /api/public/reference/{token}   5 short questions
  Admin (permission "jobs"):  GET /api/admin/vetting/l4 (requests, SLA, overdue in red), reviewers (approve, pause),
                              PUT /api/admin/vetting/l4/settings (price and payout: FREE and OFF by default)

The human check (a fixed checklist, never ID numbers): the person matches their profile (name, photo if any,
experience they claim), 2 skills probed from their V2 / V3 weak spots, communication and seriousness. Output: a 1–5
score, pass / fail and a 3-line note. A reference flags itself when the referee's email or phone is the candidate's
own, or the same referee appears for unrelated candidates. 10% of checks go to a senior reviewer; reviewers who often
disagree are paused. SLA: 24 hours from the request.
"""

import hashlib
import random
import re
from datetime import datetime, timedelta
from html import escape
from typing import Annotated, Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Header
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import Auth, CustomerAuth, require_role
from app.core.config import get_settings
from app.core.db import (
    DB,
    HIRE_PROFILES,
    RESUMES,
    SKILL_ATTEMPTS,
    USERS,
    VETTING_DEMAND,
    VETTING_INTERVIEWS,
    VETTING_L4,
    VETTING_REVIEWERS,
    VETTING_VERIFIED,
)
from app.core.email import Email, Mailer, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.hire.vetting.roles import BY_TEST
from app.me.service import ms

ReviewerAuth = Annotated[Auth, Depends(require_role("expert"))]


async def _on(auth: CustomerAuth, db: DB) -> None:
    """404 while the vetting engine is hidden from this person (Admin → Skill checks → Launch)."""
    from app.hire.vetting import access

    if not await access.for_user(db, auth.user.id):
        raise ApiError(404, "not_found", "Not found.")


async def _reviewer_on(auth: ReviewerAuth, db: DB) -> None:
    """Reviewers too: while hidden only testers (and admins) can use the reviewer workspace."""
    from app.hire.vetting import access

    if not await access.for_user(db, auth.user.id):
        raise ApiError(404, "not_found", "Not found.")


async def _company_on(db, c: dict[str, Any], acc: dict[str, Any]) -> None:
    from app.hire.vetting import access

    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")


reviewer = APIRouter(prefix="/api/reviewer", tags=["vetting"], dependencies=[Depends(_reviewer_on)])
reviewer_access = APIRouter(prefix="/api/reviewer", tags=["vetting"])
company = APIRouter(prefix="/api/company", tags=["vetting"])
me = APIRouter(prefix="/api/me/verification", tags=["vetting"], dependencies=[Depends(_on)])


@reviewer_access.get("/access")
async def reviewer_access_state(auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    """{on}: whether this expert sees the reviewer workspace (the header link)."""
    from app.hire.vetting import access

    return {"on": await access.for_user(db, auth.user.id)}


public = APIRouter(prefix="/api/public/reference", tags=["vetting"])
admin = APIRouter(prefix="/api/admin/vetting/l4", tags=["vetting"])

VALID = timedelta(days=365)
SLA = timedelta(hours=24)
SENIOR_SHARE = 0.10
PAUSE_AFTER = 3  # disagreements with a senior in the reviewer's last 10 checks
CALIBRATION_PASS = 0.8
CHECKLIST = [
    (
        "matches_profile",
        "The person matches the profile (name, experience they claim; photo if there is one). No ID numbers.",
    ),
    ("skill_one", "Probed the first weak spot from their skill check or interview"),
    ("skill_two", "Probed the second weak spot"),
    ("communication", "Communicates clearly enough for the job"),
    ("serious", "Serious about the job (availability, notice, salary make sense)"),
]
DEFAULT_SETTINGS = {"price_inr": 0, "payout_inr": 0, "payments_on": False}  # Naresh: no prices now; free and off
REF_QUESTIONS = [
    ("role", "What was their role when you worked with them?"),
    ("dates", "Roughly when did you work together (from – to)?"),
    ("rehire", "Would you hire or work with them again?"),
    ("strengths", "What are they best at?"),
    ("notes", "Anything a new employer should know? (optional)"),
]

# 5 sample interviews (original, generic) with gold scores on the V3 rubric, for reviewer calibration
CALIBRATION = [
    {
        "id": "c1",
        "role": "Customer support (chat / email)",
        "transcript": "Q: Tell me about a difficult customer.\nA: A man was angry his refund was late. I said sorry, checked the order, saw the bank had rejected it, and told him the new date in writing. I followed up the next day and it was done.\nQ: Notice and salary?\nA: 15 days notice, I expect ₹22,000 a month.",
        "gold": {"communication": 4, "knowledge": 4, "problem_solving": 4, "ownership": 5, "clarity": 5},
    },
    {
        "id": "c2",
        "role": "Electrician (ITI)",
        "transcript": "Q: How do you work on a live board?\nA: I don't. I switch off the main, lock it, check with a tester, then start.\nQ: A customer wants a quick fix without the earth wire.\nA: I say no, it is not safe. I explain the shock risk.\nQ: Notice and salary?\nA: I can join now. Salary, whatever you give.",
        "gold": {"communication": 3, "knowledge": 4, "problem_solving": 4, "ownership": 4, "clarity": 2},
    },
    {
        "id": "c3",
        "role": "Data analyst (SQL)",
        "transcript": "Q: A report you built?\nA: I made dashboards.\nQ: How do you find duplicate customers?\nA: Using SQL.\nQ: Your numbers don't match finance's. What do you do?\nA: I tell my manager.\nQ: Notice and salary?\nA: 60 days, ₹6 lakh a year.",
        "gold": {"communication": 2, "knowledge": 1, "problem_solving": 1, "ownership": 2, "clarity": 5},
    },
    {
        "id": "c4",
        "role": "Cook / kitchen helper",
        "transcript": "Q: How do you keep food safe in summer?\nA: Cooked food in the fridge within two hours, raw and cooked kept apart, I label the date.\nQ: The gas smells during service.\nA: I turn off the cylinder, open windows, no switches, tell the manager, keep people out.\nQ: Notice and salary?\nA: One week. ₹18,000.",
        "gold": {"communication": 4, "knowledge": 5, "problem_solving": 5, "ownership": 4, "clarity": 5},
    },
    {
        "id": "c5",
        "role": "Java developer",
        "transcript": "Q: A bug you fixed that you're proud of?\nA: A payment job ran twice on restarts. I added an idempotency key and a test. Duplicates stopped.\nQ: HashMap vs ConcurrentHashMap?\nA: The second is for many threads, it locks parts not the whole map.\nQ: Notice and salary?\nA: 30 days; looking for 9 LPA but open.",
        "gold": {"communication": 4, "knowledge": 4, "problem_solving": 4, "ownership": 4, "clarity": 4},
    },
]


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That item isn’t here.") from None


def calibration_score(answers: dict[str, dict[str, int]]) -> float:
    """Share of rubric lines within 1 point of gold across the 5 samples."""
    lines = ok = 0
    for s in CALIBRATION:
        got = answers.get(s["id"]) or {}
        for k, g in s["gold"].items():
            lines += 1
            ok += isinstance(got.get(k), int) and abs(got[k] - g) <= 1
    return ok / lines if lines else 0.0


def ref_token(rid: str) -> str:
    return f"{rid}.{keyed_hash('vetting-reference', rid)[:32]}"


def ref_id(token: str) -> str | None:
    rid, _, sig = (token or "").rpartition(".")
    return rid if rid and sig and same(sig, keyed_hash("vetting-reference", rid)[:32]) else None


def contact_key(email: str, phone: str) -> list[str]:
    out = []
    if email.strip():
        out.append("e:" + hashlib.sha256(email.strip().lower().encode()).hexdigest()[:20])
    d = re.sub(r"\D", "", phone or "")[-10:]
    if len(d) == 10:
        out.append("p:" + hashlib.sha256(d.encode()).hexdigest()[:20])
    return out


async def settings(db) -> dict[str, Any]:
    d = await db[VETTING_DEMAND].find_one({"_id": "l4_settings"}) or {}
    return {**DEFAULT_SETTINGS, **{k: d[k] for k in DEFAULT_SETTINGS if k in d}}


def l4_ready(req: dict[str, Any]) -> bool:
    """Passed human check AND at least one confirmed, unflagged reference."""
    check = req.get("check") or {}
    refs = req.get("referees") or []
    return bool(check.get("passed")) and any(
        r.get("answered_at") and r.get("rehire") in ("yes", "maybe") and not r.get("flags") for r in refs
    )


async def grant_if_ready(db, req: dict[str, Any]) -> bool:
    if req.get("granted_at") or not l4_ready(req):
        return False
    t = now()
    ref = next(
        r
        for r in req["referees"]
        if r.get("answered_at") and r.get("rehire") in ("yes", "maybe") and not r.get("flags")
    )
    line = (
        f"Confirmed by a {ref['relation']} at {ref['company']}"
        if ref.get("company")
        else f"Confirmed by a {ref['relation']}"
    )
    await db[VETTING_L4].update_one(
        {"_id": req["_id"]}, {"$set": {"granted_at": t, "status": "verified", "reference_line": line}}
    )
    await db[USERS].update_one(
        {"_id": req["user_id"]}, {"$set": {"vetting_l4_until": t + VALID, "vetting_l4_line": line}}
    )
    from app.hire.vetting.ladder import refresh

    await refresh(db, req["user_id"], "Nm7 verified")
    await audit(db, req["user_id"], "vetting.l4_verified", data={"request": str(req["_id"])})
    return True


def req_out(r: dict[str, Any], t: datetime | None = None, *, for_company: bool = False) -> dict[str, Any]:
    t = t or now()
    check = r.get("check") or {}
    out = {"id": str(r["_id"]), "status": r["status"], "requestedAt": ms(r["requested_at"]), "dueAt": ms(r["due_at"]),
           "overdue": r["status"] not in ("verified", "failed") and r["due_at"] < t, "slotAt": ms(r.get("slot_at")),
           "callLink": r.get("call_link", ""), "check": {"score": check.get("score"), "passed": check.get("passed"), "note": check.get("note", "")} if check else None,
           "referees": [{"name": x["name"], "relation": x["relation"], "company": x.get("company", ""), "answered": bool(x.get("answered_at")),
                         **({} if for_company else {"flags": x.get("flags") or []})} for x in r.get("referees") or []],
           "referenceLine": r.get("reference_line", ""), "grantedAt": ms(r.get("granted_at"))}  # fmt: skip
    return out


# --- company ------------------------------------------------------------------------------------------------------


@company.post("/{cid}/hire/l4/{uid}")
async def request_l4(
    cid: str, uid: str, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    from app.companies.signup import company_for

    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    await _company_on(db, c, acc)
    seen = await db[HIRE_PROFILES].find_one({"_id": uid, "on": True, "consent_at": {"$ne": None}})
    if not seen:
        raise ApiError(404, "not_found", "That candidate isn’t visible to your company.")
    u = await db[USERS].find_one({"_id": uid}) or {}
    if int((u.get("vetting") or {}).get("level") or 0) < 3:
        raise ApiError(409, "level", "The Nm7 human check is for Interview-ready (L3) candidates.")
    t = now()
    open_ = await db[VETTING_L4].find_one(
        {"user_id": uid, "status": {"$nin": ["failed"]}, "requested_at": {"$gt": t - VALID}}
    )
    if open_:
        return req_out(open_, t, for_company=True)
    s = await settings(db)
    r = {"_id": ObjectId(), "user_id": uid, "company_id": cid, "by": acc["email_lc"], "status": "requested", "requested_at": t,
         "due_at": t + SLA, "price_inr": s["price_inr"] if s["payments_on"] else 0, "referees": []}  # fmt: skip
    await db[VETTING_L4].insert_one(r)
    if u.get("email"):
        site = get_settings().site_url.rstrip("/")
        await send_safely(mailer, Email(to=u["email"], to_name=u.get("name", ""), subject="A company asked for your Nm7 human check",
                                        text=f"Hi {(u.get('name') or 'there').split(' ')[0]},\n\nA company hiring on Nm7 wants you Nm7 verified. Pick a 15-minute call time and name a past manager or teacher: {site}/me/verification\n\nIt's free.",
                                        html=f"<p>A company hiring on Nm7 wants you Nm7 verified. <a href=\"{escape(site)}/me/verification\">Pick a 15-minute call time and name a past manager or teacher</a>. It's free.</p>"))  # fmt: skip
    await audit(db, None, "vetting.l4_requested", target=cid, data={"user": uid})
    return req_out(r, t, for_company=True)


class RatingIn(CamelModel):
    stars: int = Field(ge=1, le=5)


@company.post("/{cid}/hire/l4/{uid}/rating")
async def rate(
    cid: str, uid: str, body: RatingIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    """After interviewing an L4 candidate: how well did the check predict them? Feeds the reviewer's quality score."""
    from app.companies.signup import company_for

    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    await _company_on(db, c, acc)
    r = await db[VETTING_L4].find_one({"user_id": uid, "status": "verified"}, sort=[("granted_at", -1)])
    if not r:
        raise ApiError(404, "not_found", "No Nm7 human check for this candidate.")
    await db[VETTING_L4].update_one({"_id": r["_id"]}, {"$set": {f"ratings.{cid}": body.stars}})
    if (r.get("check") or {}).get("reviewer"):
        await refresh_quality(db, r["check"]["reviewer"])
    return {"ok": True}


# --- candidate ----------------------------------------------------------------------------------------------------


async def free_slots(db, test: str | None, t: datetime) -> list[dict[str, Any]]:
    """The next 7 days of reviewer slots (weekly hours), minus booked ones, for reviewers of this role."""
    q: dict[str, Any] = {"status": "active", "demo": {"$ne": True}}  # an admin's expert persona never gets a booking
    if test:
        q["roles"] = test
    booked = {r["slot_at"] async for r in db[VETTING_L4].find({"slot_at": {"$gt": t}}, {"slot_at": 1})}
    out = []
    async for rv in db[VETTING_REVIEWERS].find(q):
        for s in rv.get("slots") or []:  # {"day": 0-6 (Mon=0), "hour": 9-20}
            for d in range(1, 8):
                day = (t + timedelta(days=d)).astimezone(IST)  # reviewers set their hours in India time
                if day.weekday() == s["day"]:
                    at = day.replace(hour=s["hour"], minute=0, second=0, microsecond=0)
                    if at not in booked:
                        out.append({"at": ms(at), "reviewer": rv["_id"]})
    return sorted(out, key=lambda x: x["at"])[:20]


@me.get("")
async def my_verification(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    t = now()
    r = await db[VETTING_L4].find_one({"user_id": auth.user.id}, sort=[("requested_at", -1)])
    badge = await db[VETTING_VERIFIED].find_one({"user_id": auth.user.id, "expires_at": {"$gt": t}})
    return {"request": req_out(r, t) if r else None, "slots": await free_slots(db, badge["test"] if badge else None, t) if r and not r.get("slot_at") else [],
            "checklist": [label for _, label in CHECKLIST], "free": not (await settings(db))["payments_on"]}  # fmt: skip


class SlotIn(CamelModel):
    at: int  # ms


@me.post("/slot")
async def pick_slot(body: SlotIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    t = now()
    r = await db[VETTING_L4].find_one({"user_id": auth.user.id, "status": {"$in": ["requested", "booked"]}})
    if not r:
        raise ApiError(404, "not_found", "No human check was requested for you.")
    at = datetime.fromtimestamp(body.at / 1000, tz=t.tzinfo)
    slot = next((s for s in await free_slots(db, None, t) if s["at"] == body.at), None)
    if not slot:
        raise ApiError(409, "taken", "That time was just taken. Please pick another.")
    await db[VETTING_L4].update_one(
        {"_id": r["_id"]}, {"$set": {"slot_at": at, "status": "booked", "reviewer": slot["reviewer"]}}
    )
    return req_out(await db[VETTING_L4].find_one({"_id": r["_id"]}), t)


class RefereeIn(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    relation: Literal["past manager", "HR contact", "college teacher", "senior colleague"]
    company: str = Field("", max_length=100)
    email: str = Field("", max_length=120)
    phone: str = Field("", max_length=20)


class RefereesIn(CamelModel):
    referees: list[RefereeIn] = Field(min_length=1, max_length=2)


@me.post("/referees")
async def referees(body: RefereesIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> dict[str, Any]:
    t = now()
    uid = auth.user.id
    r = await db[VETTING_L4].find_one({"user_id": uid, "status": {"$nin": ["verified", "failed"]}})
    if not r:
        raise ApiError(404, "not_found", "No human check was requested for you.")
    u = await db[USERS].find_one({"_id": uid}) or {}
    res = await db[RESUMES].find_one({"user_id": uid, "active": True}) or {}
    mine = set(contact_key(u.get("email", ""), str(((res.get("data") or {}).get("personal") or {}).get("phone") or "")))
    out = []
    for x in body.referees:
        if not x.email.strip() and not x.phone.strip():
            raise ApiError(400, "contact", "Give an email or a phone number for each referee.")
        keys = contact_key(x.email, x.phone)
        flags = []
        if set(keys) & mine:
            flags.append("Referee's email or phone is the candidate's own")
        others = await db[VETTING_L4].count_documents({"user_id": {"$ne": uid}, "referees.keys": {"$in": keys}})
        if others >= 2:
            flags.append(f"The same referee was named by {others} other candidates")
        rid = str(ObjectId())
        out.append({"rid": rid, **x.model_dump(), "keys": keys, "flags": flags, "sent_at": t})
        if x.email.strip():
            site = get_settings().site_url.rstrip("/")
            link = f"{site}/reference#t={ref_token(rid)}"
            who = u.get("name") or "A candidate"
            await send_safely(mailer, Email(to=x.email.strip(), to_name=x.name, subject=f"{who} named you as a reference on Nm7",
                                            text=f"Hi {x.name},\n\n{who} named you as their {x.relation}. Five short questions, about 2 minutes: {link}\n\nYour answers are shared only as a short confirmation line.",
                                            html=f"<p>Hi {escape(x.name)},</p><p>{escape(who)} named you as their {escape(x.relation)}. <a href=\"{escape(link)}\">Five short questions, about 2 minutes</a>.</p>"))  # fmt: skip
    await db[VETTING_L4].update_one({"_id": r["_id"]}, {"$set": {"referees": out}})
    return req_out(await db[VETTING_L4].find_one({"_id": r["_id"]}), t)


# --- referee (public, token) ----------------------------------------------------------------------------------------


async def _by_token(db, token: str) -> tuple[dict[str, Any], dict[str, Any]]:
    rid = ref_id(token)
    r = await db[VETTING_L4].find_one({"referees.rid": rid}) if rid else None
    if not r:
        raise ApiError(404, "invalid_link", "This link doesn't work.")
    return r, next(x for x in r["referees"] if x["rid"] == rid)


@public.get("/{token}")
async def ref_form(token: str, db: DB) -> dict[str, Any]:
    r, x = await _by_token(db, token)
    u = await db[USERS].find_one({"_id": r["user_id"]}, {"name": 1}) or {}
    return {"candidate": (u.get("name") or "").split(" ")[0], "relation": x["relation"], "answered": bool(x.get("answered_at")),
            "questions": [{"key": k, "q": q} for k, q in REF_QUESTIONS]}  # fmt: skip


class RefAnswerIn(CamelModel):
    role: str = Field(min_length=2, max_length=120)
    dates: str = Field(min_length=2, max_length=60)
    rehire: Literal["yes", "maybe", "no"]
    strengths: str = Field(min_length=2, max_length=300)
    notes: str = Field("", max_length=500)


@public.post("/{token}")
async def ref_answer(token: str, body: RefAnswerIn, db: DB) -> dict[str, Any]:
    r, x = await _by_token(db, token)
    if x.get("answered_at"):
        raise ApiError(409, "done", "Thank you — your answers are in already.")
    t = now()
    await db[VETTING_L4].update_one({"_id": r["_id"], "referees.rid": x["rid"]},
                                    {"$set": {**{f"referees.$.{k}": v for k, v in body.model_dump().items()}, "referees.$.answered_at": t}})  # fmt: skip
    await grant_if_ready(db, await db[VETTING_L4].find_one({"_id": r["_id"]}))
    return {"ok": True}


# --- reviewer -------------------------------------------------------------------------------------------------------


class ReviewerIn(CamelModel):
    roles: list[str] = Field(min_length=1, max_length=10)
    about: str = Field("", max_length=600)
    slots: list[dict[str, int]] = Field(default_factory=list, max_length=40)  # [{day 0-6, hour 8-20}]


@reviewer.get("/me")
async def reviewer_me(auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    rv = await db[VETTING_REVIEWERS].find_one({"_id": auth.user.id}) or {}
    return {"status": rv.get("status", "none"), "roles": rv.get("roles", []), "about": rv.get("about", ""), "slots": rv.get("slots", []),
            "quality": rv.get("quality"), "calibration": rv.get("calibration"), "completed": rv.get("completed", 0), "free": not (await settings(db))["payments_on"]}  # fmt: skip


@reviewer.put("/me")
async def reviewer_apply(body: ReviewerIn, auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    roles = [x for x in body.roles if x in BY_TEST]
    slots = [
        {"day": int(s["day"]), "hour": int(s["hour"])}
        for s in body.slots
        if 0 <= int(s.get("day", -1)) <= 6 and 8 <= int(s.get("hour", -1)) <= 20
    ]
    t = now()
    await db[VETTING_REVIEWERS].update_one({"_id": auth.user.id}, {"$set": {"roles": roles, "about": body.about, "slots": slots, "updated_at": t, "demo": auth.user.demo},
                                                                   "$setOnInsert": {"status": "calibrating", "created_at": t, "completed": 0}}, upsert=True)  # fmt: skip
    return await reviewer_me(auth, db)


@reviewer.get("/calibration")
async def calibration(auth: ReviewerAuth) -> dict[str, Any]:
    from app.hire.vetting.interview import CRITERIA

    return {"samples": [{k: s[k] for k in ("id", "role", "transcript")} for s in CALIBRATION],
            "criteria": [{"key": k, "label": label, "guide": g} for k, label, g in CRITERIA], "pass": CALIBRATION_PASS}  # fmt: skip


class CalibrationIn(CamelModel):
    answers: dict[str, dict[str, int]]


@reviewer.post("/calibration")
async def calibrate(body: CalibrationIn, auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    share = calibration_score(body.answers)
    ok = share >= CALIBRATION_PASS
    rv = await db[VETTING_REVIEWERS].find_one({"_id": auth.user.id})
    if not rv:
        raise ApiError(409, "apply", "Fill in your reviewer profile first.")
    status = rv["status"] if rv["status"] in ("active", "paused") else ("approval" if ok else "calibrating")
    await db[VETTING_REVIEWERS].update_one(
        {"_id": auth.user.id},
        {"$set": {"calibration": {"share": round(share, 2), "passed": ok, "at": now()}, "status": status}},
    )
    return {"share": round(share, 2), "passed": ok, "status": status}


async def _my_check(db, cid: str, uid: str) -> dict[str, Any]:
    r = await db[VETTING_L4].find_one({"_id": _oid(cid)})
    if not r or r.get("reviewer") not in (uid, None):
        raise ApiError(404, "not_found", "That check isn’t yours.")
    return r


@reviewer.get("/checks")
async def my_checks(auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    rv = await db[VETTING_REVIEWERS].find_one({"_id": auth.user.id, "status": "active"})
    if not rv:
        return {"items": [], "active": False}
    t = now()
    rows = (
        await db[VETTING_L4]
        .find(
            {
                "$or": [{"reviewer": auth.user.id}, {"senior_for": auth.user.id}],
                "status": {"$in": ["booked", "checked"]},
            }
        )
        .sort("slot_at", 1)
        .to_list(50)
    )
    items = []
    for r in rows:
        u = await db[USERS].find_one({"_id": r["user_id"]}, {"name": 1, "verified_skills": 1}) or {}
        weak = []
        async for a in (
            db[SKILL_ATTEMPTS]
            .find({"user_id": r["user_id"], "topics": {"$exists": True}})
            .sort("submitted_at", -1)
            .limit(2)
        ):
            weak += [k for k, v in sorted((a.get("topics") or {}).items(), key=lambda kv: kv[1])[:2]]
        iv = await db[VETTING_INTERVIEWS].find_one(
            {"user_id": r["user_id"], "status": "graded"}, sort=[("graded_at", -1)]
        )
        items.append({**req_out(r, t), "person": u.get("name", ""), "weakSpots": weak[:4], "interviewConcern": ((iv or {}).get("grade") or {}).get("concern", ""),
                      "senior": r.get("senior_for") == auth.user.id})  # fmt: skip
    return {"items": items, "active": True, "checklist": [{"key": k, "label": label} for k, label in CHECKLIST]}


class ResultIn(CamelModel):
    score: int = Field(ge=1, le=5)
    passed: bool
    note: str = Field(min_length=10, max_length=400)  # 3 short lines
    checklist: dict[str, bool] = Field(default_factory=dict)
    call_link: str = Field("", max_length=300)


@reviewer.post("/checks/{cid}/result")
async def result(cid: str, body: ResultIn, auth: ReviewerAuth, db: DB) -> dict[str, Any]:
    r = await db[VETTING_L4].find_one({"_id": _oid(cid)})
    if not r:
        raise ApiError(404, "not_found", "That check isn’t here.")
    t = now()
    if r.get("senior_for") == auth.user.id:  # the senior re-review: compare, count a disagreement
        first = r.get("check") or {}
        disagree = first.get("passed") != body.passed or abs(int(first.get("score") or 0) - body.score) > 1
        await db[VETTING_L4].update_one({"_id": r["_id"]}, {"$set": {"senior": {"score": body.score, "passed": body.passed, "note": body.note, "at": t, "disagree": disagree}},
                                                            "$unset": {"senior_for": ""}})  # fmt: skip
        if first.get("reviewer"):
            await refresh_quality(db, first["reviewer"])
        return {"ok": True, "disagree": disagree}
    if r.get("reviewer") != auth.user.id or r["status"] != "booked":
        raise ApiError(409, "not_yours", "This check isn’t booked with you.")
    lines = [x for x in body.note.splitlines() if x.strip()][:3]
    check = {"score": body.score, "passed": body.passed and all(body.checklist.get(k) for k, _ in CHECKLIST[:1]), "note": "\n".join(lines),
             "checklist": body.checklist, "reviewer": auth.user.id, "at": t}  # fmt: skip
    sets: dict[str, Any] = {
        "check": check,
        "status": "checked" if check["passed"] else "failed",
        "call_link": body.call_link,
    }
    if random.random() < SENIOR_SHARE:
        senior = await db[VETTING_REVIEWERS].find_one(
            {"status": "active", "senior": True, "_id": {"$ne": auth.user.id}, "demo": {"$ne": True}}
        )
        if senior:
            sets["senior_for"] = senior["_id"]
    await db[VETTING_L4].update_one({"_id": r["_id"]}, {"$set": sets})
    await db[VETTING_REVIEWERS].update_one({"_id": auth.user.id}, {"$inc": {"completed": 1}})
    await grant_if_ready(db, await db[VETTING_L4].find_one({"_id": r["_id"]}))
    await audit(db, auth.user.id, "vetting.l4_checked", target=str(r["_id"]), data={"passed": check["passed"]})
    return req_out(await db[VETTING_L4].find_one({"_id": r["_id"]}))


async def refresh_quality(db, rid: str) -> None:
    """Quality 0–100: agreement with seniors and companies' star ratings of the candidates checked; paused after
    PAUSE_AFTER disagreements in the last 10 re-reviewed checks."""
    rows = await db[VETTING_L4].find({"check.reviewer": rid}).sort("check.at", -1).limit(30).to_list(30)
    seniors = [r["senior"]["disagree"] for r in rows if r.get("senior")]
    stars = [s for r in rows for s in (r.get("ratings") or {}).values()]
    parts = []
    if seniors:
        parts.append(100 * (1 - sum(seniors) / len(seniors)))
    if stars:
        parts.append(20 * sum(stars) / len(stars))
    sets: dict[str, Any] = {"quality": round(sum(parts) / len(parts)) if parts else None}
    if sum(seniors[:10]) >= PAUSE_AFTER:
        sets["status"] = "paused"
    await db[VETTING_REVIEWERS].update_one({"_id": rid}, {"$set": sets})


# --- admin --------------------------------------------------------------------------------------------------------


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    t = now()
    rows = await db[VETTING_L4].find({}).sort("requested_at", -1).limit(200).to_list(200)
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r["user_id"] for r in rows]}}, {"name": 1})}
    revs = await db[VETTING_REVIEWERS].find({}).to_list(500)
    rnames = {
        u["_id"]: u.get("name", "")
        async for u in db[USERS].find({"_id": {"$in": [r["_id"] for r in revs]}}, {"name": 1})
    }
    return {
        "requests": [{**req_out(r, t), "person": (users.get(r["user_id"]) or {}).get("name", ""), "company": r["company_id"]} for r in rows],
        "reviewers": [{"id": r["_id"], "name": rnames.get(r["_id"], ""), "status": r["status"], "roles": r.get("roles", []), "quality": r.get("quality"),
                       "completed": r.get("completed", 0), "calibration": (r.get("calibration") or {}).get("share"), "senior": bool(r.get("senior")),
                       "slots": len(r.get("slots") or [])} for r in revs],
        "settings": await settings(db), "sla": {"hours": SLA.total_seconds() / 3600, "overdue": sum(1 for r in rows if req_out(r, t)["overdue"])},
    }  # fmt: skip


class ReviewerAdminIn(CamelModel):
    status: Literal["active", "paused", "calibrating"]
    senior: bool = False


@admin.put("/reviewers/{rid}")
async def set_reviewer(rid: str, body: ReviewerAdminIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    rv = await db[VETTING_REVIEWERS].find_one({"_id": rid})
    if not rv:
        raise ApiError(404, "not_found", "No such reviewer.")
    if body.status == "active" and not (rv.get("calibration") or {}).get("passed"):
        raise ApiError(409, "calibration", "This reviewer hasn't passed calibration yet.")
    await db[VETTING_REVIEWERS].update_one({"_id": rid}, {"$set": {"status": body.status, "senior": body.senior}})
    await audit(
        db, auth.user.id, "vetting.reviewer_set", target=rid, data={"status": body.status, "senior": body.senior}
    )
    return {"ok": True}


class SettingsIn(CamelModel):
    price_inr: int = Field(0, ge=0, le=100000)
    payout_inr: int = Field(0, ge=0, le=100000)
    payments_on: bool = False


@admin.put("/settings")
async def set_settings(body: SettingsIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    """Prices are a later decision: while payments are off nothing is ever charged or paid (test mode only)."""
    await db[VETTING_DEMAND].update_one({"_id": "l4_settings"}, {"$set": body.model_dump()}, upsert=True)
    await audit(db, auth.user.id, "vetting.l4_settings", data=body.model_dump())
    return await settings(db)


async def overdue_report(db, mailer: Mailer) -> int:
    """For the daily summary: requests past their 24-hour SLA."""
    return await db[VETTING_L4].count_documents({"status": {"$in": ["requested", "booked"]}, "due_at": {"$lt": now()}})
