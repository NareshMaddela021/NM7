# ruff: noqa: E501  (dense response lines and plain-language texts)
"""Report fraud (candidates) and the Admin fraud-reports queue. Reuses the job reports collection (app/jobs/reports.py):
a report about a job is the same row as "Report this job" (one per person per job), so both count toward pausing it.

A report (job_reports row): _id = user:job (a job) or user:<context>:<id> (a company, an interview invite, an offer),
job_id (when there is a job), company_id, context (job / company / invite / offer), reason, note, ip_hash (a keyed hash
of the network, to tell independent reports apart), at, state (open / done), fraud: True, resolution, resolved_at/_by.

  - The company is never told who reported, and no company endpoint returns these rows.
  - A job is paused only after N independent reports (Admin setting, default 3: different people from different
    networks), pending review. A company is never suspended or banned automatically.
  - Rate-limited per person; the reporter is told what happens next.
Admin actions (each audited): dismiss (a job paused by reports goes live again), warn the company (an email without the
reporter's identity), pause the job, suspend the company (the existing block: jobs paused, the company emailed).
"""

from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.core import rate_limit
from app.core.db import COMPANIES, HIRE_INVITES, HIRE_OFFERS, JOB_REPORTS, JOBS, USERS
from app.core.errors import ApiError
from app.core.security import keyed_hash
from app.core.time import now
from app.me.service import ms
from app.trust import retention as R

REASONS = {
    "money": "Asked me for money (a fee, deposit, training, kit or “registration” charge)",
    "fake_company": "The company seems fake",
    "impersonation": "Pretending to be another company or person",
    "misleading": "The job is misleading (pay, place or work not as described)",
    "harassment": "Harassment or abuse",
    "other": "Something else",
}
OLD_REASONS = {"scam": "Looks like a scam", "fake": "Fake job", "unfair": "Unfair or discriminatory", "wrong_info": "Wrong details",
               "expired": "Job has expired"}  # "Report this job" (C4)  # fmt: skip
CONTEXTS = ("job", "company", "invite", "offer")
RULES = [(5, timedelta(hours=1)), (15, timedelta(days=1))]
PROMISE = "Never pay for a job on Nm7. No real employer asks you for money to apply, for an interview, training, a uniform, a laptop or an offer letter."
HELP = [
    "Don’t pay, and don’t share OTPs, bank or UPI details, or photos of your Aadhaar or PAN in a chat.",
    "Stop replying and press “Report fraud” on the job, the company, the invite or the offer. It takes a minute.",
    "A person at Nm7 checks every report, usually within 2 working days. The company never learns who reported it.",
    "If you already paid: call 1930 (the National Cyber Crime Helpline) or report it at cybercrime.gov.in straight away, and tell your bank.",
]
NEXT = ("Thank you. A person at Nm7 checks every report, usually within 2 working days. The company is never told who reported it. "
        "Please don’t pay anyone or share OTPs or bank details. If you already paid, call 1930 or report it at cybercrime.gov.in now.")  # fmt: skip


def safety_out() -> dict[str, Any]:
    """The promise, what to do, and the report reasons (job page, company page, apply flow, invites, offers)."""
    return {"promise": PROMISE, "help": HELP, "reasons": [{"key": k, "title": v} for k, v in REASONS.items()]}


async def pause_at(db) -> int:
    from app.site import get_site
    from app.trust.employer.service import employer_settings

    return max(2, int(employer_settings(await get_site(db))["pause_at"]))


async def independent(db, job_id: str) -> int:
    """Open reports on this job from different people AND different networks (several accounts from one network count
    as one). Reports from before T4 carry no network: each person counts once."""
    people: set[str] = set()
    nets: set[str] = set()
    async for r in db[JOB_REPORTS].find({"job_id": job_id, "state": "open"}, {"user_id": 1, "ip_hash": 1}):
        uid = r.get("user_id") or ""
        if uid in people:
            continue
        net = r.get("ip_hash") or f"u:{uid}"
        if net in nets:
            continue
        people.add(uid)
        nets.add(net)
    return len(people)


async def maybe_pause(db, job_id: str, at: int) -> bool:
    j = await db[JOBS].find_one({"_id": job_id}, {"status": 1, "title": 1})
    if not j or j["status"] != "active":
        return False
    n = await independent(db, job_id)
    if n < at:
        return False
    await db[JOBS].update_one(
        {"_id": job_id, "status": "active"}, {"$set": {"status": "paused", "reports_hold": True, "updated_at": now()}}
    )
    await audit(
        db, None, "job.reports_paused", target=job_id, data={"reports": n, "title": j["title"], "by": "trust_fraud"}
    )
    return True


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "We couldn’t find that.") from None


async def _target(db, uid: str, context: str, ident: str) -> tuple[str | None, str | None, str]:
    """(job id, company id, what) for what is reported; only things this person can see."""
    if context == "job":
        j = await db[JOBS].find_one(
            {"$or": [{"_id": ident}, {"slug": ident}], "demo": {"$ne": True}}, {"company_id": 1, "title": 1}
        )
        if not j:
            raise ApiError(404, "not_found", "This job isn’t on Nm7 any more.")
        return j["_id"], j.get("company_id"), j["title"]
    if context == "company":
        c = await db[COMPANIES].find_one({"$or": [{"_id": ident}, {"slug": ident}]}, {"details.legal_name": 1})
        if not c:
            raise ApiError(404, "not_found", "This company isn’t on Nm7.")
        return None, c["_id"], c["details"]["legal_name"]
    coll = HIRE_INVITES if context == "invite" else HIRE_OFFERS
    row = await db[coll].find_one({"_id": _oid(ident), "user_id": uid}, {"job_id": 1, "company_id": 1, "title": 1})
    if not row:
        raise ApiError(404, "not_found", "We couldn’t find that.")
    return row.get("job_id"), row.get("company_id"), row.get("title", "")


async def report(db, uid: str, *, context: str, ident: str, reason: str, note: str, ip: str) -> dict[str, Any]:
    key = f"trust-fraud:{uid}"
    await rate_limit.check(
        db, key, RULES, "You’ve sent many reports in a short time. Please wait a little, or write to us from Help."
    )
    job_id, cid, what = await _target(db, uid, context, ident)
    rid = f"{uid}:{job_id}" if context == "job" else f"{uid}:{context}:{ident}"
    net = ".".join((ip or "").split(".")[:3]) if "." in (ip or "") else (ip or "")[:19]
    doc = {"_id": rid, "job_id": job_id, "company_id": cid, "user_id": uid, "context": context, "reason": reason,
           "note": " ".join(note.split())[:1000], "at": now(), "state": "open", "fraud": True,
           "ip_hash": keyed_hash("trust-fraud-net", net)[:24] if net else None}  # fmt: skip
    try:
        await db[JOB_REPORTS].insert_one(doc)
    except DuplicateKeyError:
        raise ApiError(409, "already", "You’ve already reported this. A person at Nm7 is checking it.") from None
    await rate_limit.record(db, key)
    await audit(
        db, uid, "trust.fraud_report", target=cid or job_id, data={"context": context, "reason": reason, "job": job_id}
    )
    paused = await maybe_pause(db, job_id, await pause_at(db)) if job_id else False
    if cid:
        from app.companies.trust import refresh

        await refresh(db, cid)
    return {"reported": True, "next": NEXT, "what": what, "paused": paused}


# --- Admin ---------------------------------------------------------------------------------------------------------------


def _case_key(r: dict[str, Any]) -> str:
    return f"job:{r['job_id']}" if r.get("job_id") else f"company:{r.get('company_id')}"


async def queue(db, state: str = "open", limit: int = 500) -> list[dict[str, Any]]:
    """Open (or done) reports grouped by job, or by company when there is no job. The reporter is shown to Admin only."""
    rows = await db[JOB_REPORTS].find({"state": state}).sort("at", -1).limit(limit).to_list(None)
    cases: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        if r.get("job_id") or r.get("company_id"):
            cases.setdefault(_case_key(r), []).append(r)
    job_ids = [k[4:] for k in cases if k.startswith("job:")]
    jobs = {
        j["_id"]: j
        async for j in db[JOBS].find(
            {"_id": {"$in": job_ids}},
            {"title": 1, "slug": 1, "status": 1, "reports_hold": 1, "company_id": 1, "company": 1},
        )
    }
    cids = {r.get("company_id") for rs in cases.values() for r in rs} | {j.get("company_id") for j in jobs.values()}
    comps = {
        c["_id"]: c
        async for c in db[COMPANIES].find(
            {"_id": {"$in": [c for c in cids if c]}}, {"details.legal_name": 1, "slug": 1, "review": 1}
        )
    }
    uids = list({r["user_id"] for rs in cases.values() for r in rs if r.get("user_id")})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "email": 1})}
    at = await pause_at(db)
    out = []
    for key, rs in cases.items():
        j = jobs.get(rs[0].get("job_id")) if rs[0].get("job_id") else None
        if key.startswith("job:") and not j:
            continue
        cid = rs[0].get("company_id") or (j or {}).get("company_id")
        c = comps.get(cid) or {}
        out.append({
            "key": key,
            "job": {"id": j["_id"], "title": j["title"], "slug": j.get("slug", ""), "status": j["status"], "held": bool(j.get("reports_hold"))} if j else None,
            "company": {"id": cid, "name": (c.get("details") or {}).get("legal_name") or ((j or {}).get("company") or {}).get("name", ""),
                        "slug": c.get("slug", ""), "state": (c.get("review") or {}).get("state", "")} if (cid or j) else None,
            "count": len(rs), "independent": await independent(db, j["_id"]) if j else len({r.get("user_id") for r in rs}), "pauseAt": at,
            "money": sum(1 for r in rs if r.get("reason") in ("money", "scam")),
            "reports": [{"id": r["_id"], "context": r.get("context") or "job", "reason": r.get("reason"),
                         "reasonText": REASONS.get(r.get("reason")) or OLD_REASONS.get(r.get("reason"), r.get("reason")),
                         "note": r.get("note", ""), "at": ms(r.get("at")), "fraud": bool(r.get("fraud")), "resolution": r.get("resolution"),
                         "reporter": {"name": (users.get(r.get("user_id")) or {}).get("name", ""), "email": (users.get(r.get("user_id")) or {}).get("email", "")}}
                        for r in rs],
        })  # fmt: skip
    return sorted(out, key=lambda x: (-x["money"], -x["count"]))


def _warn_mail(c: dict[str, Any], to: str, name: str, what: str, reasons: list[str], note: str):
    from html import escape

    from app.core.config import get_settings
    from app.core.email import Email

    lines = [f"Hi {name or 'there'},",
             f"Candidates reported {what} on Nm7 ({', '.join(sorted(set(reasons))).lower()}). We don’t share who reported it.",
             *( [f"Our team’s note: {note}"] if note else [] ),
             "Nm7 never allows asking candidates for money: no fees, deposits, training or kit charges, at any step. Please check your job posts "
             "and anyone who contacts candidates for you. If this happens again, your jobs may be paused or your account suspended.",
             "Reply to this email if you think this is a mistake.", "Nm7 · nm7.si"]  # fmt: skip
    text = "\n\n".join(lines)
    _ = get_settings()
    return Email(
        to,
        name,
        f"A warning about {c['details']['legal_name']} on Nm7",
        text,
        "".join(f"<p>{escape(x)}</p>" for x in lines),
    )


async def act(db, mailer, request, auth, *, key: str, action: str, note: str) -> dict[str, Any]:
    """dismiss / warn / pause_job / suspend_company on one case; every open report of the case is closed with it."""
    from app.core.email import send_safely

    kind, _, ident = key.partition(":")
    if kind not in ("job", "company") or not ident:
        raise ApiError(400, "key", "Pick a case.")
    q = {"job_id": ident, "state": "open"} if kind == "job" else {"company_id": ident, "job_id": None, "state": "open"}
    rows = await db[JOB_REPORTS].find(q).to_list(500)
    if not rows:
        raise ApiError(404, "not_found", "There are no open reports for this.")
    j = await db[JOBS].find_one({"_id": ident}) if kind == "job" else None
    cid = (j or {}).get("company_id") if j else ident
    c = await db[COMPANIES].find_one({"_id": cid}) if cid else None
    t = now()
    note = note.strip()[:500]
    if action == "dismiss":
        if j and j.get("reports_hold") and j["status"] == "paused":
            await db[JOBS].update_one(
                {"_id": j["_id"]}, {"$set": {"status": "active", "reports_hold": False, "updated_at": t}}
            )
        elif j:
            await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"reports_hold": False}})
    elif action == "warn":
        if not c:
            raise ApiError(409, "no_company", "This job has no company account to warn.")
        m = next((m for m in c.get("members") or [] if m.get("role") == "main"), None) or {}
        to = m.get("email_lc") or c.get("admin_email") or ""
        what = f"your job “{j['title']}”" if j else "your company"
        if to and not c.get("demo"):
            await send_safely(
                mailer,
                _warn_mail(
                    c,
                    to,
                    m.get("name", ""),
                    what,
                    [REASONS.get(r.get("reason")) or OLD_REASONS.get(r.get("reason"), "other") for r in rows],
                    note,
                ),
            )
        await db[COMPANIES].update_one(
            {"_id": c["_id"]}, {"$push": {"warnings": {"at": t, "by": auth.user.id, "note": note, "key": key}}}
        )
    elif action == "pause_job":
        if not j:
            raise ApiError(409, "no_job", "This case has no job to pause.")
        await db[JOBS].update_one(
            {"_id": j["_id"]},
            {"$set": {"status": "paused", "reports_hold": False, "admin_paused": True, "updated_at": t}},
        )
    elif action == "suspend_company":
        if not c:
            raise ApiError(409, "no_company", "This case has no company account to suspend.")
        if len(note) < 5:
            raise ApiError(400, "note", "Say why the company is suspended (the company is emailed this reason).")
        from app.companies.admin import ReasonIn, block

        if (c.get("review") or {}).get("state") != "blocked":
            await block(c["_id"], ReasonIn(reason=note), request, db, mailer, auth)
    else:
        raise ApiError(400, "action", "Pick dismiss, warn, pause the job or suspend the company.")
    await db[JOB_REPORTS].update_many({"_id": {"$in": [r["_id"] for r in rows]}},
                                      {"$set": {"state": "done", "resolution": action, "resolved_at": t, "resolved_by": auth.user.id}})  # fmt: skip
    from app.auth.sessions import client_ip

    await audit(
        db,
        auth.user.id,
        f"trust.fraud_{action}",
        target=cid or ident,
        data={"key": key, "reports": len(rows), "note": note},
        ip=client_ip(request),
    )
    if cid:
        from app.companies.trust import refresh

        await refresh(db, cid)
    return {"done": len(rows), "action": action}


# --- retention (T1 framework) --------------------------------------------------------------------------------------------


async def _clean(db, cutoff: datetime, cap: int) -> int:
    ids = [
        d["_id"]
        async for d in db[JOB_REPORTS]
        .find({"fraud": True, "state": "done", "resolved_at": {"$lt": cutoff}}, {"_id": 1})
        .limit(cap)
    ]
    return (await db[JOB_REPORTS].delete_many({"_id": {"$in": ids}})).deleted_count if ids else 0


async def _erase(db, uid: str) -> int:
    return (await db[JOB_REPORTS].delete_many({"user_id": uid, "fraud": True})).deleted_count


R.register(R.DataType("fraud_reports", "Fraud reports from candidates: reason, note and a network hash (the company never sees who reported)",
                      365, 90, 730, clean=_clean, erase=_erase,
                      note="Deleted by the daily job this many days after a person closed the report; open reports stay until they are checked"))  # fmt: skip
