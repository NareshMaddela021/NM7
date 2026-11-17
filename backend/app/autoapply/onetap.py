"""Auto Apply 2.0, phase A6 ("One tap"): the jobs Nm7 can't send for the candidate ("Ready") become a kit the
candidate applies with themselves, on the company's own page.

  - The apply kit per Ready job: the tailored resume PDF (download), the cover note and the ready answers (each with a
    Copy button), the candidate's own facts one field at a time (name, email, phone, city, links, degree …) and the
    job's apply link. Nothing is invented: every value comes from the tailored resume (A1), the saved answers and the
    Nm7 profile.
  - The morning list: after the candidate's part of the morning run, "N jobs ready" (in-app; one email a day only
    through access.may_mail, so while the switch is OFF only listed testers get it, never admins or demo accounts).
  - "Apply now" opens the company's page in a new tab with the kit beside it. "I applied" moves the tracker to Applied
    (channel "one_tap"). Not confirmed: one gentle reminder the next day (in-app, once), then it simply stays Ready.
    "Not applying" hides it.
  - Never a closed job: jobs the company or Nm7 closed, or whose apply link the daily link check found dead, are left
    out of the morning list and out of the helper's kits; a job that closes after it was listed shows as Closed.
  - The Nm7 Apply helper (the Chrome extension in extension/) signs in with a short pairing code (10 minutes, one use)
    and gets a token that can only read this candidate's kits and mark a kit applied (scope SCOPE). The token is never
    a session: it is sent as "Authorization: Bearer nm7h_…", which nothing else on Nm7 reads, and it can be revoked any
    time from the page. It expires after TOKEN_TTL.

Candidate (signed in, behind the 2.0 switch):
  GET  /api/me/auto-apply/v2/onetap                    the morning list and every Ready kit card (open or Closed)
  POST /api/me/auto-apply/v2/onetap/seen               the morning list was seen
  GET  /api/me/auto-apply/v2/onetap/{id}/kit           the full kit
  GET  /api/me/auto-apply/v2/onetap/{id}/resume.pdf    the tailored resume PDF
  POST /api/me/auto-apply/v2/onetap/{id}/opened        "Apply now" was tapped (the reminder starts from here)
  POST /api/me/auto-apply/v2/onetap/{id}/applied       "I applied": Applied, channel One tap
  POST /api/me/auto-apply/v2/onetap/{id}/dismiss       "Not applying"
  GET  /api/me/auto-apply/v2/helper                    paired browsers
  POST /api/me/auto-apply/v2/helper/code               a new pairing code (10 minutes, one use)
  DELETE /api/me/auto-apply/v2/helper/{id}             sign a browser out (revoke its token)
Nm7 Apply helper (Authorization: Bearer nm7h_…):
  POST /api/helper/pair {code, device}                 → {token, expiresAt}
  GET  /api/helper/me                                  first name and when the token expires
  GET  /api/helper/kits                                open Ready kits (never a closed job)
  GET  /api/helper/kits/{id}                           one kit
  GET  /api/helper/kits/{id}/resume.pdf                its tailored resume PDF
  POST /api/helper/kits/{id}/applied                   the candidate pressed Submit on the company's page and said so
  POST /api/helper/unpair                              the helper signs itself out
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Request, Response
from pydantic import Field
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.autoapply import access, v2engine
from app.core import rate_limit
from app.core.db import (
    APPLICATIONS,
    AUTO_COPIES,
    AUTO_ITEMS,
    AUTO_MORNINGS,
    DB,
    HELPER_CODES,
    HELPER_TOKENS,
    JOBS,
    USERS,
)
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash
from app.core.time import ist_day, now
from app.me.service import ms
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

router = APIRouter(prefix="/api/me/auto-apply/v2", tags=["auto apply 2.0"])
helper = APIRouter(prefix="/api/helper", tags=["nm7 apply helper"])

MORNING_MAX = 25  # kits in one morning list
REMIND_AFTER = timedelta(days=1)  # "I applied" not tapped: one reminder the next day
REMIND_PER_PASS = 200
CODE_TTL = timedelta(minutes=10)
TOKEN_TTL = timedelta(days=30)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0 / O / 1 / I
TOKEN_PREFIX = "nm7h_"
SCOPE = ("kits:read", "applied:write")  # everything a helper token can do
MAX_DEVICES = 5
PAIR_RULES = [(10, timedelta(minutes=10)), (40, timedelta(days=1))]  # pairing tries per IP
CODE_RULES = [(10, timedelta(hours=1))]  # new codes per candidate
OPEN_STATES = ("ready",)
CLOSED_TEXT = {
    "closed": "The company closed this job.",
    "dead_link": "The apply link stopped working, so Nm7 took the job off your list.",
    "past_date": "The closing date has passed.",
}
FIELDS = (  # (key, label, the autocomplete name a form would use)
    ("full_name", "Full name", "name"),
    ("first_name", "First name", "given-name"),
    ("last_name", "Last name", "family-name"),
    ("email", "Email", "email"),
    ("phone", "Phone", "tel"),
    ("city", "City", "address-level2"),
    ("linkedin", "LinkedIn", "url"),
    ("github", "GitHub", "url"),
    ("portfolio", "Portfolio or website", "url"),
    ("current_title", "Current job title", "organization-title"),
    ("current_company", "Current company", "organization"),
    ("degree", "Degree", ""),
    ("college", "College", ""),
    ("grad_year", "Year of passing", ""),
    ("notice", "Notice period", ""),
    ("salary", "Expected salary", ""),
    ("profile", "Nm7 profile link", "url"),
)


# ---------- closed jobs ----------


def closed_reason(j: dict[str, Any] | None) -> str | None:
    """Why this job may not be offered (None = it is open): closed by the company / Nm7, a dead apply link, or past
    its closing date."""
    if not j or j.get("status") != "active":
        return "closed"
    lc = j.get("link_check") or {}
    if lc.get("ok") is False or lc.get("fails"):
        return "dead_link"
    c = j.get("closes_at")
    if isinstance(c, datetime) and c <= now():
        return "past_date"
    return None


def apply_url(it: dict[str, Any], j: dict[str, Any] | None) -> str:
    a = (j or {}).get("apply") or {}
    if a.get("method") == "email" or it.get("apply_to"):
        to = it.get("apply_to") or a.get("email") or ""
        return f"mailto:{to}" if to else ""
    url = str(a.get("url") or "")
    return url if url.startswith(("https://", "http://")) else ""


# ---------- cards and kits ----------


async def _jobs(db, items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    ids = list({i["job_id"] for i in items})
    return {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": ids}}, {"description": 0})}


async def _morning_doc(db, uid: str, day: str | None = None) -> dict[str, Any] | None:
    return await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{day or ist_day()}"})


def _card(it: dict[str, Any], j: dict[str, Any] | None, listed: set[str]) -> dict[str, Any]:
    why = closed_reason(j) if it["state"] in OPEN_STATES else "closed"
    url = apply_url(it, j)
    return {
        **v2engine.row(it, None),
        "closed": bool(why),
        "closedText": CLOSED_TEXT.get(why or "", "") if why else "",
        "applyUrl": "" if why else url,
        "applyHost": (urlparse(url).hostname or "") if url.startswith("http") else "",
        "byEmail": url.startswith("mailto:"),
        "listedToday": it["_id"] in listed,
        "openedAt": ms(it.get("opened_at")),
        "reminded": bool(it.get("reminded_at")),
    }


async def cards(db, uid: str) -> list[dict[str, Any]]:
    """Every Ready kit (open first, best match first), and the ones listed this morning that closed since (Closed)."""
    m = await _morning_doc(db, uid) or {}
    listed = set(m.get("items") or [])
    q = {"user_id": uid, "$or": [{"state": "ready"}, {"state": "expired", "_id": {"$in": list(listed)}}]}
    items = await db[AUTO_ITEMS].find(q).sort([("score", -1), ("updated_at", -1)]).to_list(100)
    jobs = await _jobs(db, items)
    out = [_card(i, jobs.get(i["job_id"]), listed) for i in items]
    out.sort(key=lambda c: c["closed"])  # stable: open kits first, each group by score
    return out


async def morning_out(db, uid: str, open_count: int) -> dict[str, Any] | None:
    m = await _morning_doc(db, uid)
    if not m:
        return None
    return {"day": m["day"], "count": open_count, "listed": int(m.get("count") or 0), "at": ms(m.get("at")),
            "seen": bool(m.get("seen_at")), "mailed": bool(m.get("mailed_at"))}  # fmt: skip


async def listing(db, uid: str) -> dict[str, Any]:
    rows = await cards(db, uid)
    n = sum(1 for c in rows if not c["closed"])
    return {"morning": await morning_out(db, uid, n), "items": rows, "open": n}


def _cover_text(copy: dict[str, Any], profile: str) -> str:
    lines = [str(x) for x in copy.get("cover_note") or []]
    if profile:
        lines += ["", f"My Nm7 profile: {profile}"]
    return "\n".join(lines).strip()


async def kit(db, u: dict[str, Any], it: dict[str, Any], j: dict[str, Any] | None) -> dict[str, Any]:
    """Everything the candidate (or the helper) needs to apply on the company's page, from their own facts only."""
    from app.autoapply import pdf
    from app.autoapply.forms import service as forms

    copy = (
        await db[AUTO_COPIES].find_one({"_id": it.get("copy_id"), "user_id": u["_id"]}) if it.get("copy_id") else None
    )
    copy = copy or {}
    data = copy.get("data") or {}
    f = await forms.facts(db, u, j or {"title": it.get("title")}, copy) if copy else None
    values: dict[str, str] = {}
    if f:
        values = {
            "full_name": " ".join(x for x in (f.first, f.last) if x),
            "first_name": f.first,
            "last_name": f.last,
            "email": f.email,
            "phone": f.phone,
            "city": f.city,
            "linkedin": f.links.get("linkedin", ""),
            "github": f.links.get("github", ""),
            "portfolio": f.links.get("portfolio") or f.links.get("website") or "",
            "current_title": f.current_title,
            "current_company": f.current_company,
            "degree": f.degree,
            "college": f.college,
            "grad_year": f.grad_year,
            "notice": f.notice,
            "salary": f.salary,
            "profile": f.profile,
        }
    fields = [
        {"key": k, "label": label, "value": str(values.get(k) or ""), "autocomplete": ac}
        for k, label, ac in FIELDS
        if str(values.get(k) or "").strip()
    ]
    card = _card(it, j, set())
    return {
        "id": it["_id"],
        "job": {**v2engine._job(it), "location": ", ".join((j or {}).get("locations") or [])[:200]},
        "closed": card["closed"],
        "closedText": card["closedText"],
        "applyUrl": card["applyUrl"],
        "applyHost": card["applyHost"],
        "byEmail": card["byEmail"],
        "state": it["state"],
        "resume": {"name": pdf.file_name(data), "ready": bool(data)} if data else None,
        "coverNote": _cover_text(copy, f.profile if f else ""),
        "answers": [
            {"question": str(x.get("question") or ""), "answer": str(x.get("answer") or "")}
            for x in copy.get("answers") or []
            if x.get("answer")
        ],
        "fields": fields,
        "subject": f"Application for {it.get('title') or 'the role'}" if card["byEmail"] else "",
    }


async def resume_pdf(db, uid: str, it: dict[str, Any]) -> Response:
    from app.autoapply import pdf

    copy = await db[AUTO_COPIES].find_one({"_id": it.get("copy_id"), "user_id": uid}) if it.get("copy_id") else None
    if not copy or not copy.get("data"):
        raise ApiError(404, "not_found", "No tailored resume for this job yet.")
    name = pdf.file_name(copy["data"])
    return Response(
        pdf.render(copy["data"]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "private, no-store"},
    )


# ---------- the candidate's actions ----------


async def _item(db, uid: str, iid: str, states: tuple[str, ...] = OPEN_STATES) -> dict[str, Any]:
    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": uid, "v2": True})
    if not it or it["state"] not in states:
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    return it


async def mark_opened(db, uid: str, iid: str) -> dict[str, Any]:
    it = await _item(db, uid, iid)
    t = now()
    sets: dict[str, Any] = {"opened_at": it.get("opened_at") or t, "updated_at": t}
    if not it.get("remind_at") and not it.get("reminded_at"):
        sets["remind_at"] = t + REMIND_AFTER
    await db[AUTO_ITEMS].update_one({"_id": iid}, {"$set": sets})
    return {"state": it["state"], "opened": True}


async def mark_applied(db, uid: str, iid: str, via: str) -> dict[str, Any]:
    """The candidate applied on the company's page themselves: the tracker moves to Applied, channel One tap. A job
    that closed after it was listed may still be confirmed (they may have applied before it closed)."""
    from app.jobs.apply import FOLLOW_AFTER, app_key, job_page

    it = await _item(db, uid, iid, ("ready", "expired"))
    j = await db[JOBS].find_one({"_id": it["job_id"]}) or {}
    copy = await db[AUTO_COPIES].find_one({"_id": it.get("copy_id")}) if it.get("copy_id") else None
    copy = copy or {}
    t = now()
    method = (j.get("apply") or {}).get("method") or it.get("channel") or "link"
    doc = {
        "key": app_key(it["job_id"]),
        "user_id": uid,
        "company": (it.get("company") or "")[:120],
        "role": (it.get("title") or "")[:120],
        "status": "applied",
        "date": int(t.timestamp() * 1000),
        "resume_id": copy.get("from_key"),
        "resume_name": (copy.get("name") or "")[:120],
        "url": job_page(j) if j else "",
        "notes": "",
        "next": int((t + FOLLOW_AFTER).timestamp() * 1000),
        "job_id": it["job_id"],
        "channel": "email" if method == "email" else "link",
        "channel_v2": "one_tap",
        "origin": "auto",
        "v2": True,
        "auto_item_id": iid,
        "copy_id": copy.get("_id"),
        "cover_note": copy.get("cover_note") or [],
        "one_tap": {"at": t, "via": via},
        "timeline": [{"status": "applied", "at": t}],
        "created_at": t,
        "updated_at": t,
        **({"demo": True} if it.get("demo") else {}),
    }
    try:
        await db[APPLICATIONS].insert_one(doc)
    except DuplicateKeyError:  # saved before (by hand on the job board): keep it, note the channel
        await db[APPLICATIONS].update_one(
            {"user_id": uid, "job_id": it["job_id"]},
            {"$set": {"v2": True, "channel_v2": "one_tap", "auto_item_id": iid, "one_tap": {"at": t, "via": via}}},
        )
    await db[AUTO_ITEMS].update_one(
        {"_id": iid},
        {
            "$set": {"state": "applied", "channel_v2": "one_tap", "applied_at": t, "one_tap": {"at": t, "via": via},
                     "updated_at": t},
            "$unset": {"remind_at": ""},
        },
    )  # fmt: skip
    await audit(db, uid, "auto_apply.v2_one_tap_applied", target=it["job_id"], data={"via": via})
    return {"state": "applied", "stage": "applied", "channel": "one_tap"}


async def dismiss(db, uid: str, iid: str) -> dict[str, Any]:
    await _item(db, uid, iid, ("ready", "expired"))
    await db[AUTO_ITEMS].update_one(
        {"_id": iid},
        {"$set": {"state": "skipped", "reason": "not_applying", "updated_at": now()}, "$unset": {"remind_at": ""}},
    )
    await audit(db, uid, "auto_apply.v2_one_tap_dismiss", target=iid)
    return {"state": "skipped"}


# ---------- the morning list and the reminder ----------


async def morning(db, u: dict[str, Any], site: dict[str, Any], day: str, mailer=None) -> int:
    """After the candidate's part of the morning run: today's "N jobs ready" list (once a day), told in-app, and by
    email only through access.may_mail. Closed jobs and dead links are never listed. → how many were listed."""
    uid = u["_id"]
    items = await db[AUTO_ITEMS].find({"user_id": uid, "state": "ready", "v2": True}).sort("score", -1).to_list(200)
    jobs = await _jobs(db, items)
    ids = [i["_id"] for i in items if not closed_reason(jobs.get(i["job_id"]))][:MORNING_MAX]
    if not ids:
        return 0
    t = now()
    got = await db[AUTO_MORNINGS].update_one(
        {"_id": f"{uid}:{day}"},
        {"$setOnInsert": {"user_id": uid, "day": day, "items": ids, "count": len(ids), "at": t, "seen_at": None,
                          "mailed_at": None}},
        upsert=True,
    )  # fmt: skip
    if not got.upserted_id:
        return 0  # once a day
    await db[AUTO_ITEMS].update_many({"_id": {"$in": ids}}, {"$set": {"listed_day": day}})
    await db[AUTO_ITEMS].update_many(
        {"_id": {"$in": ids}, "remind_at": None, "reminded_at": None}, {"$set": {"remind_at": t + REMIND_AFTER}}
    )
    await _mail_morning(db, uid, site, day, len(ids), mailer)
    return len(ids)


async def _mail_morning(db, uid: str, site: dict[str, Any], day: str, n: int, mailer=None) -> bool:
    from app.autoapply.summary import _can_email, _mail
    from app.core.email import send_safely

    fresh = await db[USERS].find_one({"_id": uid}) or {}
    if mailer is None or not access.may_mail(fresh, site["auto_apply_v2"]) or not _can_email(fresh):
        return False
    from app.autoapply.summary import today_counts

    lines = [
        f"{n} job{'s are' if n != 1 else ' is'} ready for you to apply to yourself today. Each one has your tailored "
        "resume, a cover note and ready answers to copy.",
        "Open the list, tap Apply now, and paste from your kit on the company's page. Then tap I applied.",
    ]
    c = await today_counts(db, uid, day)  # A7: today's summary rides along (one routine email a day)
    if c["applied"] or c["needsAnswer"] or c["waiting"]:
        lines.append(f"Today Auto Apply sent {c['applied']} · {c['needsAnswer']} question(s) wait for your answer"
                     + (f" · {c['waiting']} wait for your Approve" if c["waiting"] else "") + ".")  # fmt: skip
    mail = _mail(fresh, f"{n} job{'s' if n != 1 else ''} ready to apply", lines,
                 [("Open my jobs ready list", "/me/auto-apply/v2?tab=ready")])  # fmt: skip
    if await send_safely(mailer, mail):
        await db[AUTO_MORNINGS].update_one({"_id": f"{uid}:{day}"}, {"$set": {"mailed_at": now()}})
        await db[USERS].update_one({"_id": uid}, {"$set": {"auto_summary_day": day}})  # no second summary today
        return True
    return False


async def run(db, limit: int = REMIND_PER_PASS) -> dict[str, Any]:
    """One background pass (inside heavy_or_skip, at most `limit` items): the one reminder, the day after, for kits
    listed or opened and never confirmed. In-app only; the kit then stays in Ready."""
    from app.core.heavy import heavy_or_skip

    site = await get_site(db)
    if not site["auto_apply"]["on"]:
        return {"off": True}
    v2 = site["auto_apply_v2"]
    counts = {"reminded": 0, "skipped": 0}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {"waiting_heavy": True}
        t = now()
        q = {"state": "ready", "v2": True, "remind_at": {"$lte": t}, "reminded_at": None}
        items = await db[AUTO_ITEMS].find(q).sort("remind_at", 1).limit(limit).to_list(limit)
        users = {
            x["_id"]: x
            async for x in db[USERS].find({"_id": {"$in": list({i["user_id"] for i in items})}}, access.PROJECTION)
        }
        jobs = await _jobs(db, items)
        for it in items:
            u = users.get(it["user_id"])
            if not access.allowed(u, v2) or closed_reason(jobs.get(it["job_id"])):
                await db[AUTO_ITEMS].update_one(
                    {"_id": it["_id"]}, {"$set": {"reminded_at": t, "remind_skipped": True}}
                )
                counts["skipped"] += 1
                continue
            role, company = it.get("title") or "this job", it.get("company") or "the company"
            text = f"Did you apply to {role} at {company}? Tap “I applied” so your tracker is right, or “Not applying”."
            notice = {"status": "remind", "at": t, "seen": False, "text": text}
            await db[AUTO_ITEMS].update_one(
                {"_id": it["_id"], "reminded_at": None},
                {
                    "$set": {"reminded_at": t, "notice": notice},
                    "$push": {"notices": {"$each": [notice], "$slice": -20}},
                },
            )
            counts["reminded"] += 1
    return counts


# ---------- the Nm7 Apply helper: pairing ----------


def _code_hash(code: str) -> str:
    return keyed_hash("helper_code", code)


def _token_hash(token: str) -> str:
    return keyed_hash("helper_token", token)


def norm_code(code: str) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch in CODE_ALPHABET)


async def new_code(db, uid: str) -> dict[str, Any]:
    await rate_limit.check(db, f"helper_code:{uid}", CODE_RULES)
    await rate_limit.record(db, f"helper_code:{uid}")
    await db[HELPER_CODES].delete_many({"user_id": uid})  # one live code at a time
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    t = now()
    await db[HELPER_CODES].insert_one(
        {"_id": _code_hash(code), "user_id": uid, "created_at": t, "expires_at": t + CODE_TTL, "used_at": None}
    )
    await audit(db, uid, "auto_apply.v2_helper_code")
    return {"code": f"{code[:4]}-{code[4:]}", "expiresAt": ms(t + CODE_TTL), "minutes": int(CODE_TTL.seconds // 60)}


async def pair(db, code: str, device: str, ip: str | None) -> dict[str, Any]:
    key = f"helper_pair:{ip or '-'}"
    await rate_limit.check(db, key, PAIR_RULES, "Too many tries. Wait a few minutes, then make a new code on Nm7.")
    await rate_limit.record(db, key)
    c = norm_code(code)
    t = now()
    got = await db[HELPER_CODES].find_one_and_update(
        {"_id": _code_hash(c), "used_at": None, "expires_at": {"$gt": t}}, {"$set": {"used_at": t}}
    )
    if len(c) != 8 or not got:
        raise ApiError(
            400, "bad_code", "That code doesn’t work. A code works once, for 10 minutes. Make a new one on Nm7."
        )
    uid = got["user_id"]
    await db[HELPER_CODES].delete_one({"_id": got["_id"]})
    if not await access.for_user(db, uid) or not await db[USERS].find_one(
        {"_id": uid, "disabled_at": None}, {"_id": 1}
    ):
        raise ApiError(404, "not_found", "Not found.")
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    doc = {
        "_id": secrets.token_hex(12),
        "user_id": uid,
        "token_hash": _token_hash(token),
        "scope": list(SCOPE),
        "device": (device or "Chrome").strip()[:60] or "Chrome",
        "created_at": t,
        "expires_at": t + TOKEN_TTL,
        "last_used_at": t,
        "revoked_at": None,
    }
    await db[HELPER_TOKENS].insert_one(doc)
    live = await db[HELPER_TOKENS].find({"user_id": uid, "revoked_at": None}).sort("created_at", -1).to_list(50)
    for old in live[MAX_DEVICES:]:  # at most MAX_DEVICES browsers: the oldest is signed out
        await db[HELPER_TOKENS].update_one({"_id": old["_id"]}, {"$set": {"revoked_at": t, "revoked_by": "limit"}})
    await audit(db, uid, "auto_apply.v2_helper_paired", target=doc["_id"], data={"device": doc["device"]}, ip=ip)
    return {"token": token, "expiresAt": ms(doc["expires_at"]), "scope": list(SCOPE)}


async def devices(db, uid: str) -> list[dict[str, Any]]:
    rows = (
        await db[HELPER_TOKENS]
        .find({"user_id": uid, "revoked_at": None, "expires_at": {"$gt": now()}})
        .sort("created_at", -1)
        .to_list(MAX_DEVICES * 2)
    )
    return [{"id": r["_id"], "device": r.get("device") or "Chrome", "at": ms(r.get("created_at")),
             "lastUsed": ms(r.get("last_used_at")), "expiresAt": ms(r.get("expires_at"))} for r in rows]  # fmt: skip


async def revoke(db, uid: str, tid: str, by: str = "candidate") -> bool:
    r = await db[HELPER_TOKENS].update_one(
        {"_id": tid, "user_id": uid, "revoked_at": None}, {"$set": {"revoked_at": now(), "revoked_by": by}}
    )
    if r.modified_count:
        await audit(db, uid, "auto_apply.v2_helper_revoked", target=tid, data={"by": by})
    return bool(r.modified_count)


async def helper_token(request: Request, db, need: str) -> dict[str, Any]:
    """The helper's token from "Authorization: Bearer nm7h_…" (never a cookie), alive, not revoked, with `need` in
    its scope, for someone the 2.0 switch lets in."""
    h = request.headers.get("authorization") or ""
    token = h[7:].strip() if h[:7].lower() == "bearer " else ""
    if not token.startswith(TOKEN_PREFIX):
        raise ApiError(401, "not_paired", "Pair the Nm7 Apply helper first: make a code on Nm7 and paste it.")
    t = now()
    tok = await db[HELPER_TOKENS].find_one(
        {"token_hash": _token_hash(token), "revoked_at": None, "expires_at": {"$gt": t}}
    )
    if not tok:
        raise ApiError(401, "not_paired", "This browser was signed out of Nm7. Make a new code on Nm7 and paste it.")
    if need not in (tok.get("scope") or []):
        raise ApiError(403, "scope", "The helper can’t do that.")
    if not await access.for_user(db, tok["user_id"]) or not await db[USERS].find_one(
        {"_id": tok["user_id"], "disabled_at": None}, {"_id": 1}
    ):
        raise ApiError(404, "not_found", "Not found.")
    if not tok.get("last_used_at") or t - tok["last_used_at"] > timedelta(minutes=5):
        await db[HELPER_TOKENS].update_one({"_id": tok["_id"]}, {"$set": {"last_used_at": t}})
    return tok


# ---------- endpoints: the candidate ----------


async def _allowed(db, uid: str) -> dict[str, Any]:
    site = await get_site(db)
    if not await access.for_user(db, uid, site):
        raise ApiError(404, "not_found", "Not found.")
    return site


async def _user(db, uid: str) -> dict[str, Any]:
    return await db[USERS].find_one({"_id": uid}, {"auto_apply": 1, "email": 1, "name": 1, "demo": 1}) or {"_id": uid}


@router.get("/onetap")
async def get_list(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await listing(db, auth.user.id)


@router.post("/onetap/seen")
async def seen(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    r = await db[AUTO_MORNINGS].update_one(
        {"_id": f"{auth.user.id}:{ist_day()}", "seen_at": None}, {"$set": {"seen_at": now()}}
    )
    return {"seen": bool(r.modified_count)}


@router.get("/onetap/{iid}/kit")
async def get_kit(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    it = await _item(db, auth.user.id, iid, ("ready", "expired"))
    return await kit(db, await _user(db, auth.user.id), it, await db[JOBS].find_one({"_id": it["job_id"]}))


@router.get("/onetap/{iid}/resume.pdf")
async def get_pdf(iid: str, auth: CustomerAuth, db: DB) -> Response:
    await _allowed(db, auth.user.id)
    return await resume_pdf(db, auth.user.id, await _item(db, auth.user.id, iid, ("ready", "expired", "applied")))


@router.post("/onetap/{iid}/opened")
async def opened(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await mark_opened(db, auth.user.id, iid)


@router.post("/onetap/{iid}/applied")
async def applied(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await mark_applied(db, auth.user.id, iid, "page")


@router.post("/onetap/{iid}/dismiss")
async def not_applying(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await dismiss(db, auth.user.id, iid)


@router.get("/helper")
async def helper_status(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return {"devices": await devices(db, auth.user.id), "codeMinutes": int(CODE_TTL.seconds // 60),
            "tokenDays": TOKEN_TTL.days, "scope": list(SCOPE)}  # fmt: skip


@router.post("/helper/code")
async def helper_code(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await new_code(db, auth.user.id)


@router.delete("/helper/{tid}")
async def helper_revoke(tid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    if not await revoke(db, auth.user.id, tid):
        raise ApiError(404, "not_found", "That browser isn’t signed in.")
    return {"revoked": tid}


# ---------- endpoints: the helper ----------


class PairIn(CamelModel):
    code: str = Field(min_length=4, max_length=20)
    device: str = Field("Chrome", max_length=60)


@helper.post("/pair")
async def helper_pair(body: PairIn, request: Request, db: DB) -> dict[str, Any]:
    return await pair(db, body.code, body.device, client_ip(request))


@helper.get("/me")
async def helper_me(request: Request, db: DB) -> dict[str, Any]:
    tok = await helper_token(request, db, "kits:read")
    u = await _user(db, tok["user_id"])
    return {"firstName": (u.get("name") or "").split(" ")[0], "expiresAt": ms(tok["expires_at"]),
            "scope": tok.get("scope") or []}  # fmt: skip


@helper.get("/kits")
async def helper_kits(request: Request, db: DB) -> dict[str, Any]:
    tok = await helper_token(request, db, "kits:read")
    rows = [c for c in await cards(db, tok["user_id"]) if not c["closed"]]  # never a closed job
    keep = ("id", "job", "applyUrl", "applyHost", "byEmail", "score", "listedToday", "openedAt")
    return {"items": [{k: c[k] for k in keep} for c in rows]}


async def _helper_item(db, tok: dict[str, Any], iid: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    it = await _item(db, tok["user_id"], iid)
    j = await db[JOBS].find_one({"_id": it["job_id"]})
    if closed_reason(j):
        raise ApiError(409, "closed", "This job has closed. Nm7 took it off your list.")
    return it, j


@helper.get("/kits/{iid}")
async def helper_kit(iid: str, request: Request, db: DB) -> dict[str, Any]:
    tok = await helper_token(request, db, "kits:read")
    it, j = await _helper_item(db, tok, iid)
    return await kit(db, await _user(db, tok["user_id"]), it, j)


@helper.get("/kits/{iid}/resume.pdf")
async def helper_pdf(iid: str, request: Request, db: DB) -> Response:
    tok = await helper_token(request, db, "kits:read")
    it, _ = await _helper_item(db, tok, iid)
    return await resume_pdf(db, tok["user_id"], it)


@helper.post("/kits/{iid}/applied")
async def helper_applied(iid: str, request: Request, db: DB) -> dict[str, Any]:
    tok = await helper_token(request, db, "applied:write")
    return await mark_applied(db, tok["user_id"], iid, "helper")


@helper.post("/unpair")
async def helper_unpair(request: Request, db: DB) -> dict[str, Any]:
    tok = await helper_token(request, db, "kits:read")
    await revoke(db, tok["user_id"], tok["_id"], "helper")
    return {"revoked": True}
