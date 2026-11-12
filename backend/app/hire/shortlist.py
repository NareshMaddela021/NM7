"""H2 Instant shortlist (Phase 5): a Verified company opens one of its jobs and, within a minute, sees the top 10
candidates who are ready to join now and agreed to be seen, with why they fit; it invites them (one or all ten), and
each candidate answers Accept or Not interested (with a reason).

Company (header X-Recruiter-Account; any team role reads, main / full / posting admins invite):
  GET  /api/company/{cid}/hire/shortlist?job=     the top 10 for one of the company's live jobs
  POST /api/company/{cid}/hire/invite {job, people, note}    invite one or more people from the shortlist
  GET  /api/company/{cid}/hire/invites?job=       the invites and answers; accepted ones with email and phone
Candidate (signed in):
  GET  /api/me/hire/invites                        the invites I got
  POST /api/me/hire/invites/{id} {answer, reason, note}   accept / decline

Who is shown: "Ready to join" is available (H1: on, consent, not paused, confirmed within the days Admin set), the
candidate can work where the job is (a city in common, or the job is remote), takes this kind of job (when they said),
and has a resume. Demo candidates are shown only to demo companies, and real ones never to demo companies. Ranked by the
match score (the job board's rules: skills, experience, place) with a small step down when the salary they expect is
above the job's range, then the soonest join date. Each row: first name and initial, match score and reasons,
availability, salary fit, skill check (H3) and reliability (H4); never email or phone until the candidate accepts.

Only Verified companies; a Basic company sees its applicants only. Limits (Admin → Settings → Hire in 30 minutes):
`free_shortlists` roles a month (beyond that the instant shortlist is a paid company feature: Admin → Plans → Company
hiring, open to every Verified company by default), `shortlists_per_hour` and `invites_per_day` per company.

Accepting creates (or moves) the company application to Shortlisted, so the company dashboard shows the person with
their contact details and the usual tools (interview, offer, talent pool).
"""

from datetime import datetime, timedelta
from html import escape
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Query
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import POST, trust_of
from app.companies.signup import company_for
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import APPLICATIONS, COMPANIES, DB, HIRE_INVITES, HIRE_PROFILES, HIRE_USAGE, JOBS, RESUMES, USERS
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.hire.available import JOB_TYPES, available, wants_email
from app.hire.reliability import reliability_for
from app.hire.skillcheck import best_for, shared_results
from app.jobs import fit as fitmod
from app.jobs.apply import FOLLOW_AFTER, app_key, job_page, status_change
from app.me.service import ms
from app.site import get_site

company = APIRouter(prefix="/api/company", tags=["hire in 30 minutes"])
me = APIRouter(prefix="/api/me/hire", tags=["hire in 30 minutes"])

TOP = 10
BULK_TOP = 100  # a bulk hiring post (H7): bigger batches
SCAN = 3000  # available profiles looked at per shortlist (newest confirmations first)
INVITE_DAYS = 7  # an unanswered invite expires after this
STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111"
REASONS = {
    "salary": "The salary is too low",
    "place": "The place doesn't suit me",
    "role": "The role doesn't suit me",
    "timing": "I can't join that soon",
    "joined": "I already got a job",
    "other": "Another reason",
}


# --- small pieces, also used by the tests -------------------------------------------------------------------------


def monthly(salary: dict[str, Any] | None) -> float | None:
    """Rupees a month from a candidate's {amount, unit month|lpa}: 3.5 LPA is 29,167 a month."""
    if not salary:
        return None
    a = float(salary.get("amount") or 0)
    return a * 100000 / 12 if salary.get("unit") == "lpa" else a


def salary_fit(want: dict[str, Any] | None, job_salary: dict[str, Any] | None) -> dict[str, Any]:
    """{fit: within / above / below / unknown, want (₹ a month), min, max (₹ a month)}."""
    w = monthly(want)
    if not w or not job_salary or not (job_salary.get("min") or job_salary.get("max")):
        return {"fit": "unknown", "want": round(w) if w else None, "min": None, "max": None}
    k = 1 / 12 if job_salary.get("period", "yearly") == "yearly" else 1
    lo = job_salary.get("min") and job_salary["min"] * k
    hi = job_salary.get("max") and job_salary["max"] * k
    fit = "above" if hi and w > hi else "below" if lo and w < lo else "within"
    return {"fit": fit, "want": round(w), "min": round(lo) if lo else None, "max": round(hi) if hi else None}


def place_ok(p: dict[str, Any], job: dict[str, Any]) -> str | None:
    """The place they share with the job ('remote' or a city), or None when it doesn't suit."""
    if job.get("remote") or job.get("work_type") == "remote":
        return "remote"
    mine = {c.lower() for c in p.get("cities") or []}
    for c in job.get("locations") or []:
        if c.lower() in mine:
            return c
    return None


def short_name(name: str) -> str:
    """ "Asha R." – the first name and the initial: enough to tell people apart, no more."""
    parts = [x for x in str(name or "").split() if x]
    if not parts:
        return "Candidate"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0].upper()}."


def rank_key(row: dict[str, Any]) -> tuple:
    over = 8 if row["salary"]["fit"] == "above" else 0
    join = row["availability"]["joinDate"] or "9999-12-31"
    return (-(row["match"]["score"] - over), join, row["key"])


def month_id(cid: str, t: datetime | None = None) -> str:
    return f"{cid}:{(t or now()).astimezone(IST):%Y-%m}"


async def gate(db, c: dict[str, Any], feature: str) -> bool:
    """A paid company feature (instant, tests, bulk): open to every Verified company, or turned on for this one."""
    s = (await get_site(db))["hire"]
    return bool(s["open"].get(feature, True)) or feature in (c.get("hire_features") or [])


def test_covers() -> dict[str, set[str]]:
    """Skill check → the job skills it speaks for, from the job templates (H8)."""
    from app.hire.templates import TEMPLATES

    out: dict[str, set[str]] = {}
    for t in TEMPLATES:
        if t["test"]:
            out.setdefault(t["test"], set()).update(t["skills"])
    return out


def is_bulk(job: dict[str, Any]) -> bool:
    return bool((job.get("hire_bulk") or {}).get("on"))


def _verified(c: dict[str, Any]) -> None:
    if trust_of(c) != "verified":
        raise ApiError(
            403, "verified_only", "Instant shortlist is for Verified companies. Basic accounts see their applicants."
        )


async def _job(db, cid: str, job_id: str) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": job_id, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "That job isn’t one of yours.")
    if j.get("status") != "active":
        raise ApiError(409, "closed", "This job isn’t live. Open a live job to see who can join now.")
    return j


# --- the shortlist ------------------------------------------------------------------------------------------------


async def candidates(db, c: dict[str, Any], job: dict[str, Any], t: datetime | None = None) -> list[dict[str, Any]]:
    """Every available, consenting candidate who suits the place and kind of job, ranked (best first)."""
    t = t or now()
    site = await get_site(db)
    days = int(site["hire"]["confirm_days"])
    q = {"on": True, "consent_at": {"$ne": None}, "paused_at": None, "confirmed_at": {"$gt": t - timedelta(days=days)}}
    profiles = await db[HIRE_PROFILES].find(q).sort("confirmed_at", -1).limit(SCAN).to_list(SCAN)
    profiles = [p for p in profiles if available(p, site, t)]
    want_demo = bool(c.get("demo"))
    uids = [p["_id"] for p in profiles]
    users = {
        u["_id"]: u
        async for u in db[USERS].find(
            {"_id": {"$in": uids}, "deleted_at": None, "disabled_at": None}, {"name": 1, "demo": 1}
        )
    }
    invites = {i["user_id"]: i async for i in db[HIRE_INVITES].find({"company_id": c["_id"], "job_id": job["_id"]})}
    applied = {
        a["user_id"]
        async for a in db[APPLICATIONS].find(
            {"job_id": job["_id"], "user_id": {"$in": uids}, "company_removed_at": None}, {"user_id": 1}
        )
    }
    tests_on = await gate(db, c, "tests")  # skill check results: a paid company feature (open by default)
    results = await shared_results(db, uids) if tests_on else {}
    reliable = await reliability_for(db, uids, t)
    wanted = fitmod.job_skills(job)
    rows = []
    for p in profiles:
        u = users.get(p["_id"])
        if not u or bool(u.get("demo")) != want_demo:
            continue
        where = place_ok(p, job)
        if not where:
            continue
        if p.get("job_types") and job.get("job_type") in JOB_TYPES and job["job_type"] not in p["job_types"]:
            continue
        person = await fitmod.person_for(db, p["_id"])
        if not person:
            continue  # nothing to judge the match on
        if where != "remote":
            person.place = where.lower()  # they said they can work there
        m = fitmod.fit(job, person)
        inv = invites.get(p["_id"])
        rows.append(
            {
                "key": p["_id"],
                "name": short_name(u.get("name", "")),
                "match": {k: m[k] for k in ("score", "found", "missing", "experience", "level", "years", "place")},
                "where": where,
                "availability": {
                    "joinDate": p.get("join_date") or "",
                    "noticeDays": int(p.get("notice_days") or 0),
                    "cities": p.get("cities") or [],
                    "remote": bool(p.get("remote")),
                    "confirmedAt": ms(p.get("confirmed_at")),
                },
                "salary": salary_fit(p.get("salary"), job.get("salary")),
                "skillCheck": best_for(
                    results.get(p["_id"], []), wanted, test_covers()
                ),  # shared by the candidate (H3)
                "reliability": {k: v for k, v in reliable[p["_id"]].items() if k != "tips"},  # H4, real events only
                "applied": p["_id"] in applied,
                "invite": invite_state(inv, t) if inv else None,
            }
        )
    rows.sort(key=rank_key)
    return rows


def invite_state(i: dict[str, Any], t: datetime | None = None) -> dict[str, Any]:
    st = i["status"]
    if st == "sent" and i["created_at"] < (t or now()) - timedelta(days=INVITE_DAYS):
        st = "expired"
    return {"id": str(i["_id"]), "status": st, "reason": i.get("reason") or "", "at": ms(i["created_at"])}


@company.get("/{cid}/hire/shortlist")
async def shortlist(
    cid: str,
    db: DB,
    job: str = Query(..., min_length=1, max_length=40),
    size: int = Query(TOP, ge=1, le=BULK_TOP),
    x_recruiter_account: str | None = Header(None),
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    s = (await get_site(db))["hire"]
    if not s["on"]:
        raise ApiError(409, "hire_off", "Hiring now is switched off for the moment.")
    _verified(c)
    j = await _job(db, cid, job)
    # the free roles this month; beyond them the instant shortlist is a paid company feature
    used = await db[HIRE_USAGE].find_one({"_id": month_id(cid)}) or {}
    roles = used.get("jobs") or []
    free = int(s["free_shortlists"])
    if job not in roles and len(roles) >= free and not await gate(db, c, "instant"):
        raise ApiError(
            402,
            "plan",
            f"You used this month’s {free} instant shortlists. Ask Nm7 to turn on more for your company.",
            extra={"used": len(roles), "free": free},
        )
    key = f"hire-shortlist:{cid}"
    await rate_limit.check(
        db,
        key,
        [(int(s["shortlists_per_hour"]), timedelta(hours=1))],
        "Too many shortlists in an hour. Try again soon.",
    )
    await rate_limit.record(db, key)
    started = now()
    rows = await candidates(db, c, j, started)
    if rows:  # H9: when the first candidate was shown for this role
        await db[JOBS].update_one({"_id": j["_id"]}, {"$min": {"hire_speed.first_shown_at": started}})
    await db[HIRE_USAGE].update_one(
        {"_id": month_id(cid)}, {"$addToSet": {"jobs": job}, "$set": {"updated_at": started}}, upsert=True
    )
    await audit(db, None, "hire.shortlist", target=cid, data={"by": acc["email_lc"], "job": job, "n": len(rows)})
    roles = sorted(set(roles) | {job})
    return {
        "job": {
            "id": j["_id"],
            "title": j["title"],
            "locations": j.get("locations") or [],
            "remote": bool(j.get("remote")),
        },
        "items": rows[: min(size, BULK_TOP if is_bulk(j) else TOP)],
        "available": len(rows),
        "usage": {"used": len(roles), "free": free},
        "ms": int((now() - started).total_seconds() * 1000),
    }


# --- invites ------------------------------------------------------------------------------------------------------


class InviteIn(CamelModel):
    job: str = Field(min_length=1, max_length=40)
    people: list[str] = Field(min_length=1, max_length=BULK_TOP)  # more than 10 only on a bulk hiring post
    note: str = Field("", max_length=500)


def invite_email(u: dict[str, Any], c: dict[str, Any], j: dict[str, Any], note: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    link = f"{site}/me/hire#invites"
    name = (c.get("details") or {}).get("legal_name") or "A company"
    where = "Remote" if j.get("remote") else ", ".join(j.get("locations") or [])
    lines = [
        f"Hi {first},",
        "",
        f"{name} is hiring now and invited you for {j['title']}{f' ({where})' if where else ''}.",
        *([f"Their note: {note}", ""] if note else [""]),
        f"Accept or say Not interested here: {link}",
        "Your phone number and email are shared with the company only if you accept.",
        "",
        "Nm7 · nm7.si",
    ]
    html = (
        f'<div style="{STYLE}"><p>Hi {escape(first)},</p><p><strong>{escape(name)}</strong> is hiring now and invited '
        f"you for <strong>{escape(j['title'])}</strong>{escape(f' ({where})') if where else ''}.</p>"
        + (f"<p>Their note: {escape(note)}</p>" if note else "")
        + f'<p><a href="{escape(link)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;'
        'border-radius:8px;text-decoration:none">See the invite</a></p><p style="color:#666;font-size:13px">Your '
        "phone number and email are shared with the company only if you accept.</p></div>"
    )
    return Email(
        to=u["email"], to_name=u.get("name", ""), subject=f"{name} invited you: {j['title']}", text="\n".join(lines),
        html=html,
    )  # fmt: skip


@company.post("/{cid}/hire/invite")
async def invite(
    cid: str, body: InviteIn, db: DB, mailer: MailerDep, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    s = (await get_site(db))["hire"]
    if not s["on"]:
        raise ApiError(409, "hire_off", "Hiring now is switched off for the moment.")
    _verified(c)
    j = await _job(db, cid, body.job)
    if len(set(body.people)) > TOP and not is_bulk(j):
        raise ApiError(400, "too_many", f"Invite at most {TOP} at once. Bulk hiring mode allows more.")
    t = now()
    today = await db[HIRE_INVITES].count_documents({"company_id": cid, "created_at": {"$gte": t - timedelta(days=1)}})
    room = int(s["invites_per_day"]) - today
    people = list(dict.fromkeys(body.people))
    if room < len(people):
        raise ApiError(
            429,
            "invites_limit",
            f"You can send {max(0, room)} more invites today (at most {s['invites_per_day']} a day).",
        )
    ok = {r["key"]: r for r in await candidates(db, c, j, t)}  # only people who are still on the shortlist
    sent, skipped = [], []
    for uid in people:
        if uid not in ok:
            skipped.append({"key": uid, "why": "not_available"})
            continue
        doc = {"_id": ObjectId(), "company_id": cid, "job_id": j["_id"], "user_id": uid, "status": "sent",
               "note": body.note, "by": acc["email_lc"], "created_at": t, "updated_at": t}  # fmt: skip
        old = await db[HIRE_INVITES].find_one({"company_id": cid, "job_id": j["_id"], "user_id": uid})
        if old and invite_state(old, t)["status"] in ("sent", "accepted", "declined"):
            skipped.append({"key": uid, "why": "invited"})
            continue
        if old:  # expired: invite again
            await db[HIRE_INVITES].update_one(
                {"_id": old["_id"]}, {"$set": {**{k: v for k, v in doc.items() if k != "_id"}, "reason": ""}}
            )
            doc["_id"] = old["_id"]
        else:
            await db[HIRE_INVITES].insert_one(doc)
        sent.append(uid)
        u = await db[USERS].find_one({"_id": uid})
        if wants_email(u):
            await send_safely(mailer, invite_email(u, c, j, body.note))
    if sent:  # H9: an invite means a candidate was shown for this role
        await db[JOBS].update_one({"_id": j["_id"]}, {"$min": {"hire_speed.first_shown_at": t}})
    await audit(db, None, "hire.invite", target=cid, data={"by": acc["email_lc"], "job": j["_id"], "n": len(sent)})
    return {"sent": len(sent), "skipped": skipped}


def _contact(u: dict[str, Any] | None, r: dict[str, Any] | None) -> dict[str, str]:
    personal = ((r or {}).get("data") or {}).get("personal") or {}
    return {"email": (u or {}).get("email", ""), "phone": str(personal.get("phone") or "")}


@company.get("/{cid}/hire/invites")
async def company_invites(
    cid: str, db: DB, job: str = Query("", max_length=40), x_recruiter_account: str | None = Header(None)
) -> list[dict[str, Any]]:
    await company_for(db, cid, x_recruiter_account)
    q: dict[str, Any] = {"company_id": cid} | ({"job_id": job} if job else {})
    out = []
    t = now()
    async for i in db[HIRE_INVITES].find(q).sort("created_at", -1).limit(500):
        u = await db[USERS].find_one({"_id": i["user_id"]}, {"name": 1, "email": 1})
        st = invite_state(i, t)
        row = {**st, "jobId": i["job_id"], "key": i["user_id"], "name": short_name((u or {}).get("name", ""))}
        if st["status"] == "accepted":  # contact details only after the candidate accepted
            r = await db[RESUMES].find_one({"user_id": i["user_id"], "active": True}) or await db[RESUMES].find_one(
                {"user_id": i["user_id"]}, sort=[("updated_at", -1)]
            )
            row["name"] = (u or {}).get("name") or row["name"]
            row["contact"] = _contact(u, r)
            row["applicationId"] = str(i["application_id"]) if i.get("application_id") else None
        row["reasonText"] = REASONS.get(st["reason"], "") if st["status"] == "declined" else ""
        out.append(row)
    return out


# --- the candidate's side -----------------------------------------------------------------------------------------


@me.get("/invites")
async def my_invites(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    t = now()
    out = []
    async for i in db[HIRE_INVITES].find({"user_id": auth.user.id}).sort("created_at", -1).limit(100):
        c = await db[COMPANIES].find_one({"_id": i["company_id"]}, {"details.legal_name": 1})
        j = await db[JOBS].find_one(
            {"_id": i["job_id"]}, {"title": 1, "locations": 1, "remote": 1, "salary": 1, "slug": 1, "status": 1}
        )
        if not c or not j:
            continue
        out.append(
            {
                **invite_state(i, t),
                "company": (c.get("details") or {}).get("legal_name", ""),
                "role": j.get("title", ""),
                "where": "Remote" if j.get("remote") else ", ".join(j.get("locations") or []),
                "salary": j.get("salary"),
                "note": i.get("note") or "",
                "jobUrl": job_page(j) if j.get("slug") else "",
                "live": j.get("status") == "active",
            }
        )
    return out


class AnswerIn(CamelModel):
    answer: Literal["accept", "decline"]
    reason: Literal[tuple(REASONS)] | None = None  # type: ignore[valid-type]


def _iid(iid: str) -> ObjectId:
    try:
        return ObjectId(iid)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That invite isn’t here.") from None


async def _apply_from_invite(db, i: dict[str, Any], uid: str, t: datetime) -> ObjectId:
    """Accepting an invite: the company application, at Shortlisted (contact details show to the company)."""
    j = await db[JOBS].find_one({"_id": i["job_id"]})
    key = app_key(j["_id"])
    a = await db[APPLICATIONS].find_one({"user_id": uid, "key": key})
    if a:
        upd = status_change(a, "shortlisted", t) if a.get("status") in ("applied", "viewed") else {"$set": {}}
        upd.setdefault("$set", {}).update({"company_removed_at": None, "consent_at": a.get("consent_at") or t})
        await db[APPLICATIONS].update_one({"_id": a["_id"]}, upd)
        return a["_id"]
    r = await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
        {"user_id": uid}, sort=[("updated_at", -1)]
    )
    doc = {
        "key": key, "user_id": uid, "company": j["company"]["name"][:120], "role": j["title"][:120],
        "status": "shortlisted", "date": int(t.timestamp() * 1000), "resume_id": (r or {}).get("key"),
        "resume_name": (r or {}).get("name", ""), "url": job_page(j), "notes": "",
        "next": int((t + FOLLOW_AFTER).timestamp() * 1000), "job_id": j["_id"], "channel": "nm7",
        "origin": "invite", "company_id": i["company_id"], "consent_at": t, "answers": {},
        "fit": {"ok": True, "reasons": []}, "timeline": [{"status": "shortlisted", "at": t}],
        "created_at": t, "updated_at": t,
    }  # fmt: skip
    res = await db[APPLICATIONS].insert_one(doc)
    return res.inserted_id


@me.post("/invites/{iid}")
async def answer(iid: str, body: AnswerIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    i = await db[HIRE_INVITES].find_one({"_id": _iid(iid), "user_id": uid})
    if not i:
        raise ApiError(404, "not_found", "That invite isn’t here.")
    t = now()
    st = invite_state(i, t)["status"]
    if st != "sent":
        raise ApiError(
            409, "answered", "You answered this invite already." if st != "expired" else "This invite expired."
        )
    if body.answer == "decline" and not body.reason:
        raise ApiError(400, "reason", "Pick a reason, so the company knows.")
    sets: dict[str, Any] = {
        "status": "accepted" if body.answer == "accept" else "declined",
        "answered_at": t,
        "updated_at": t,
    }
    if body.answer == "accept":
        j = await db[JOBS].find_one({"_id": i["job_id"]}, {"status": 1})
        if not j or j.get("status") != "active":
            raise ApiError(409, "closed", "This job is closed now.")
        sets["application_id"] = await _apply_from_invite(db, i, uid, t)
        sets["contact_shared_at"] = t
    else:
        sets["reason"] = body.reason
    done = await db[HIRE_INVITES].update_one({"_id": i["_id"], "status": "sent"}, {"$set": sets})
    if not done.modified_count:
        raise ApiError(409, "answered", "You answered this invite already.")
    await audit(db, uid, f"hire.invite_{sets['status']}", target=i["company_id"], data={"job": i["job_id"]})
    return {**invite_state({**i, **sets}, t)}
