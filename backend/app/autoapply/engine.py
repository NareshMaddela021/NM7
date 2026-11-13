"""The Auto Apply daily engine (Phase 3, A2) and what it does with each job.

Every morning (from 07:00 IST, in the automation pass) for each student with Auto Apply on:
1. skip the student when Auto Apply is off for everyone, paused by them or by Admin, or their resume is under the ATS
   gate;
2. find live jobs that pass their rules (roles in the title or skills, cities or remote, levels, job types, salary,
   companies to avoid) that they have never applied to (by hand or Auto) and never seen before;
3. skip what the hard rules forbid: jobs that don't fit the person's experience (round J2: never a fresher for a
   10-year job), dead links, paused / reported / scam-flagged jobs, companies under the trust threshold or paused
   by Admin, more than 2 applications to one company in 30 days;
4. rank by the job board's own match score (rules, cached); under the student's minimum → skip, within the
   borderline band → "Needs your answer";
5. for each job, best first, until the daily limit: make a tailored resume copy (only the resume's own facts; AI
   lines fact-checked, else the rules version), then apply through the job's channel. Jobs posted on Nm7 by a company
   go straight into the company dashboard with the match score, the "Auto" label and the consent; screening
   questions are answered only from the student's saved answers, else the job waits in "Needs your answer";
6. during the preview days each application waits for the student's Approve instead.

A stuck job never stops the run and never uses up the daily limit. Each (student, job) pair has one item (a unique
index), so a re-run never applies twice; each student is locked while their part runs and marked done for the day, so
an interrupted run resumes where it stopped. The run log (auto_runs) counts what happened and keeps errors.
"""

import logging
import re
from datetime import datetime, time, timedelta
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.autoapply.settings import gate, preview_left, resume_for
from app.core.db import APPLICATIONS, AUTO_COPIES, AUTO_ITEMS, AUTO_RUNS, COMPANIES, JOB_REPORTS, JOBS, USERS
from app.core.time import IST, now
from app.jobs import fit as fitmod
from app.jobs.apply import FOLLOW_AFTER, app_key, job_page
from app.jobs.model import with_older
from app.jobs.public import live_filter
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

START_AT = time(7, 0)  # IST
PAGE = 100  # students per automation pass
LOOKBACK = timedelta(days=30)  # jobs posted within this window are candidates
MAX_CANDIDATES = 200
MAX_STUCK_PER_RUN = 10
LOCK = timedelta(minutes=10)
ACTIVE = ("applied", "waiting_approval", "queued", "sent", "ready")  # states that count as "Nm7 is on it"


def today(t: datetime | None = None) -> str:
    return (t or now()).astimezone(IST).date().isoformat()


def norm(text: str) -> str:
    """A screening question as a saved-answer key: "Notice period?" and "notice period" are the same question."""
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def _yearly(sal: dict[str, Any] | None) -> int | None:
    if not sal:
        return None
    best = sal.get("max") or sal.get("min")
    if not best:
        return None
    return int(best) * (12 if sal.get("period") == "monthly" else 1)


def job_query(a: dict[str, Any], since: datetime) -> dict[str, Any]:
    roles = "|".join(re.escape(r) for r in a.get("roles") or []) or "(?!)"
    q: list[dict[str, Any]] = [
        live_filter(),
        {"posted_at": {"$gte": since}},
        {"$or": [{"title": {"$regex": roles, "$options": "i"}}, {"skills": {"$regex": roles, "$options": "i"}}]},
    ]
    cities = a.get("cities") or []
    if cities:
        where: list[dict[str, Any]] = [
            {"locations": {"$regex": "|".join(f"^{re.escape(c)}" for c in cities), "$options": "i"}}
        ]
        if a.get("remote", True):
            where.append({"remote": True})
        q.append({"$or": where})
    elif not a.get("remote", True):
        q.append({"remote": {"$ne": True}})
    if a.get("experience"):
        q.append({"experience": {"$in": with_older(a["experience"])}})
    if a.get("job_types"):
        q.append({"job_type": {"$in": a["job_types"]}})
    return {"$and": q}


def skip_reason(j: dict[str, Any], a: dict[str, Any], companies: dict[str, dict], site: dict[str, Any]) -> str | None:
    """Why a job may not be applied to (None = it may), by the hard rules and the student's own rules."""
    d = site["auto_apply"]
    if j.get("status") != "active":
        return "closed"
    lc = j.get("link_check") or {}
    if lc.get("fails") or lc.get("ok") is False:
        return "dead_link"
    if j.get("reports_hold"):
        return "reported"
    if (j.get("review") or {}).get("reasons"):
        return "scam_flag"
    name = (j.get("company") or {}).get("name", "").lower()
    if any(x.lower() in name for x in a.get("avoid") or []):
        return "avoided"
    if a.get("min_salary"):
        y = _yearly(j.get("salary"))
        if y is not None and y < a["min_salary"]:
            return "salary"
    cid = j.get("company_id")
    if cid:
        c = companies.get(cid)
        if not c or c.get("auto_paused") or (c.get("review") or {}).get("state") == "blocked":
            return "company_paused"
        score = (c.get("score") or {}).get("value")
        if score is not None and score < d["trust_min"]:
            return "low_trust"
    return None


def level_ok(f: dict[str, Any], a: dict[str, Any]) -> bool:
    """Only jobs that fit the person's own experience (round J2): never one asking for clearly more years than the
    resume shows. One clearly below their experience (a fresher job for someone with 8 years) only when they picked
    that level in their Auto Apply rules themselves."""
    if fitmod.level_fits(f):
        return True
    return f.get("experience") == "over" and f.get("level") in (a.get("experience") or [])


async def _reported(db, job_ids: list[str]) -> set[str]:
    rows = await db[JOB_REPORTS].aggregate(
        [{"$match": {"job_id": {"$in": job_ids}, "state": "open"}}, {"$group": {"_id": "$job_id"}}]
    )
    return {r["_id"] async for r in rows}


async def company_count(db, uid: str, j: dict[str, Any], t: datetime) -> int:
    """Applications this student sent to the job's company in the last 30 days (by hand or Auto)."""
    q: dict[str, Any] = {"user_id": uid, "created_at": {"$gte": t - timedelta(days=30)}}
    if j.get("company_id"):
        q["company_id"] = j["company_id"]
    else:
        q["company"] = {"$regex": f"^{re.escape((j.get('company') or {}).get('name', ''))}$", "$options": "i"}
    return await db[APPLICATIONS].count_documents(q)


async def used_today(db, uid: str, day: str) -> int:
    return await db[AUTO_ITEMS].count_documents({"user_id": uid, "counted_day": day})


# ---------- the tailored copy ----------


def parsed_for(j: dict[str, Any]):
    from app.jobsearch import skills as dictionary
    from app.jobsearch.parse import parse

    p = parse(j.get("description") or "")
    p.title = j["title"]
    p.company = (j.get("company") or {}).get("name", "")
    p.location = ", ".join(j.get("locations") or []) or ("Remote" if j.get("remote") else "")
    must = [dictionary.canonical(s) or s for s in j.get("skills") or []]
    p.must = list(dict.fromkeys([*must, *p.must]))
    return p


async def tailored_copy(db, uid: str, r: dict[str, Any], j: dict[str, Any], use_ai: bool = True) -> dict[str, Any]:
    """A tailored copy of the resume for this job, saved as its own version (AUTO_COPIES). Only the resume's own
    facts: every AI line is fact-checked (else the rules line), and the result is checked once more as a whole."""
    from app.jobsearch import facts, tailor

    data = r.get("data") or {}
    p = parsed_for(j)
    answer = None
    if use_ai:
        answer = await _ai(db, uid, lambda stats: tailor.call_model(p, data, stats))
    suggestions, stats = tailor.build(p, data, answer)
    out = data
    for s in suggestions:
        out = tailor.apply(out, s)
    original = facts.resume_text(data)
    allowed = " ".join([p.title, p.company, p.location])
    if out.get("summary") and not facts.ok(out["summary"], original, allowed):
        out = {**out, "summary": data.get("summary", "")}  # never send a summary with a fact the resume lacks
        stats["summary_reverted"] = 1
    t = now()
    doc = {
        "_id": str(ObjectId()),
        "user_id": uid,
        "job_id": j["_id"],
        "name": tailor.copy_name(p),
        "data": out,
        "from_key": r["key"],
        "from_updated_at": r.get("updated_at"),
        "changes": [{"kind": s["kind"], "label": s["label"], "source": s["source"]} for s in suggestions],
        "stats": stats,
        "created_at": t,
    }
    await db[AUTO_COPIES].insert_one(doc)
    return doc


async def _ai(db, uid: str, run) -> dict[str, Any] | None:
    """The AI reading, when there is a key and today's allowance (else None: the rules version is used)."""
    from app.core import ai_quota, claude
    from app.core.config import get_settings

    if not get_settings().anthropic_api_key:
        return None
    try:
        await ai_quota.take(db, "jobs", uid)
    except Exception:  # noqa: BLE001 — over the person's or the site's daily AI limit: rules
        return None
    try:
        return await run({})
    except (claude.Unusable, Exception):  # noqa: BLE001
        log.warning("auto apply: AI tailoring failed; rules used")
        return None


# ---------- applying ----------


async def apply_nm7(
    db,
    item: dict[str, Any],
    j: dict[str, Any],
    u: dict[str, Any],
    copy: dict[str, Any],
    answers: dict[str, Any],
    channel: str = "nm7",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """The application record, labelled Auto: in the company dashboard for an Nm7 job (or Admin → Jobs without a
    company), or "Sent by email" with a copy of the email for an email job."""
    from app.companies import questions as qmod

    t = now()
    a = u.get("auto_apply") or {}
    key = app_key(j["_id"])
    doc: dict[str, Any] = {
        "key": key,
        "user_id": u["_id"],
        "company": (j.get("company") or {}).get("name", "")[:120],
        "role": j["title"][:120],
        "status": "applied",
        "date": int(t.timestamp() * 1000),
        "resume_id": copy["from_key"],
        "resume_name": f"{copy['name']} (Auto Apply)"[:120],
        "url": job_page(j),
        "notes": "",
        "next": int((t + FOLLOW_AFTER).timestamp() * 1000),
        "job_id": j["_id"],
        "channel": channel,
        "origin": "auto",
        "auto_item_id": item["_id"],
        "copy_id": copy["_id"],
        "resume_version": {"key": copy["from_key"], "updated_at": copy.get("from_updated_at")},
        "score": item.get("score"),
        "timeline": [{"status": "applied", "at": t}],
        "created_at": t,
        "updated_at": t,
    }
    doc |= extra or {}
    if j.get("company_id") and channel == "nm7":
        why = qmod.knockout(j.get("questions") or [], answers)
        doc |= {
            "company_id": j["company_id"],
            "consent_at": a.get("consent_at") or t,
            "answers": answers,
            "fit": {"ok": not why, "reasons": why},
        }
    try:
        await db[APPLICATIONS].insert_one(doc)
    except DuplicateKeyError:
        return None  # already applied (by hand): never twice
    await audit(
        db,
        u["_id"],
        "auto_apply.applied",
        target=j["_id"],
        data={
            "channel": channel,
            "copy": copy["_id"],
            "resume": copy["from_key"],
            "score": item.get("score"),
            "origin": "auto",
        },
    )
    return doc


async def saved_answers(u: dict[str, Any], j: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(answers from the student's saved ones, the questions still without an answer)."""
    from app.companies import questions as qmod

    qs = j.get("questions") or []
    saved = (u.get("auto_apply") or {}).get("answers") or {}
    given = {q["id"]: saved[norm(q["text"])] for q in qs if norm(q["text"]) in saved}
    ok, _ = qmod.answers_for([q for q in qs if q["id"] in given], given)
    missing = [q for q in qs if q["id"] not in ok]
    return ok, missing


async def deliver(
    db,
    item: dict[str, Any],
    j: dict[str, Any],
    u: dict[str, Any],
    copy: dict[str, Any],
    answers: dict[str, Any],
    mailer=None,
    site: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Send one application through its channel. → the item's new fields (state applied / sent / queued / skipped).
    Every way an auto application goes out passes here (the morning run, an answered question, "Apply anyway",
    Approve, Approve all, a queued email), so the company cap is checked here too (fix round item 9)."""
    t = now()
    site = site or await get_site(db)
    if await company_count(db, u["_id"], j, t) >= int(site["auto_apply"]["company_cap"]):
        return {"state": "skipped", "reason": "company_cap"}
    if j["apply"]["method"] == "email":
        from app.autoapply import emailing
        from app.core.email import get_mailer

        day = today(t)
        if await emailing.sent_today(db, day) >= int(site["auto_apply"]["email_daily_cap"]):
            return {"state": "queued", "reason": "email_cap"}  # the site's daily email cap: the next run sends it
        sent = await emailing.send(db, mailer or get_mailer(), item, j, u, copy, item.get("found") or [])
        if not sent:
            return {"state": "skipped", "reason": "email_blocked_or_failed"}
        app = await apply_nm7(db, item, j, u, copy, answers, channel="email", extra={"sent_email": sent})
        return (
            {"state": "sent", "sent": sent, "sent_day": day, "applied_at": t}
            if app
            else {"state": "skipped", "reason": "already"}
        )
    app = await apply_nm7(db, item, j, u, copy, answers)
    return {"state": "applied", "applied_at": t} if app else {"state": "skipped", "reason": "already"}


async def finish(
    db,
    item: dict[str, Any],
    j: dict[str, Any],
    u: dict[str, Any],
    answers: dict[str, Any],
    day: str,
    site: dict[str, Any],
    mailer=None,
) -> str:
    """Apply one ready item now (or hold it for Approve in the preview days). Returns the new state."""
    r = await resume_for(db, u["_id"])
    if not r:
        return "skipped"
    copy = await tailored_copy(db, u["_id"], r, j)
    sets: dict[str, Any] = {"copy_id": copy["_id"], "answers": answers, "updated_at": now()}
    if preview_left(u.get("auto_apply") or {}, site) > 0 and not item.get("approved"):
        sets["state"] = "waiting_approval"
    else:
        sets |= await deliver(db, item, j, u, copy, answers, mailer, site)
    upd: dict[str, Any] = {"$set": sets}
    if sets["state"] in ("skipped", "queued"):
        upd["$unset"] = {"counted_day": ""}  # not sent today: it doesn't use up today's limit
    else:
        sets["counted_day"] = item.get("counted_day") or day
    await db[AUTO_ITEMS].update_one({"_id": item["_id"]}, upd)
    return sets["state"]


# ---------- the daily run ----------


async def _item(db, u: dict[str, Any], j: dict[str, Any], state: str, **extra) -> dict[str, Any] | None:
    t = now()
    doc = {
        "_id": str(ObjectId()),
        "user_id": u["_id"],
        "job_id": j["_id"],
        "company_id": j.get("company_id"),
        "company": (j.get("company") or {}).get("name", ""),
        "title": j["title"],
        "slug": j["slug"],
        "channel": j["apply"]["method"],
        "state": state,
        "created_at": t,
        "updated_at": t,
        **extra,
    }
    try:
        await db[AUTO_ITEMS].insert_one(doc)
    except DuplicateKeyError:
        return None
    return doc


async def run_user(db, u: dict[str, Any], site: dict[str, Any], day: str, counts: dict[str, Any], mailer=None) -> None:
    uid = u["_id"]
    a = u.get("auto_apply") or {}
    d = site["auto_apply"]
    t = now()
    g = await gate(db, uid, site)
    if not g["ok"]:
        counts["skipped_gate"] += 1
        return
    limit = min(int(a.get("daily_limit", d["daily_limit"])), int(d["max_daily_limit"]))
    left = limit - await used_today(db, uid, day)
    # queued answers go first (answered after yesterday's limit was reached)
    async for it in db[AUTO_ITEMS].find({"user_id": uid, "state": "queued"}).sort("updated_at", 1):
        if left <= 0:
            break
        j = await db[JOBS].find_one({"_id": it["job_id"]})
        if not j or j.get("status") != "active":
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "expired", "updated_at": t}})
            continue
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"counted_day": day}})
        state = await finish(db, {**it, "counted_day": day}, j, u, it.get("answers") or {}, day, site, mailer)
        counts[state] = counts.get(state, 0) + 1
        left -= state in ("applied", "waiting_approval")
    # stuck jobs whose questions are now all answered (saved for another job) go next
    async for it in db[AUTO_ITEMS].find({"user_id": uid, "state": "needs_answer", "kind": "questions"}):
        if left <= 0:
            break
        j = await db[JOBS].find_one({"_id": it["job_id"]})
        if not j or j.get("status") != "active":
            continue
        answers, missing = await saved_answers(u, j)
        if missing:
            continue
        from app.companies import questions as qmod

        if qmod.knockout(j.get("questions") or [], answers):
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "skipped", "reason": "not_a_fit"}})
            continue
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"counted_day": day}})
        state = await finish(db, {**it, "counted_day": day}, j, u, answers, day, site, mailer)
        counts[state] = counts.get(state, 0) + 1
        left -= state in ("applied", "waiting_approval")
    seen = {x["job_id"] async for x in db[AUTO_ITEMS].find({"user_id": uid}, {"job_id": 1})}
    seen |= {
        x["job_id"] async for x in db[APPLICATIONS].find({"user_id": uid, "job_id": {"$exists": True}}, {"job_id": 1})
    }
    jobs = [
        j
        async for j in db[JOBS]
        .find(job_query(a, t - LOOKBACK), {"description": 0})
        .sort("posted_at", -1)
        .limit(MAX_CANDIDATES)
        if j["_id"] not in seen
    ]
    if not jobs:
        return
    reported = await _reported(db, [j["_id"] for j in jobs])
    cids = list({j["company_id"] for j in jobs if j.get("company_id")})
    companies = {
        c["_id"]: c
        async for c in db[COMPANIES].find({"_id": {"$in": cids}}, {"score": 1, "auto_paused": 1, "review": 1})
    }
    blocked = set(a.get("blocked_companies") or [])
    r = await resume_for(db, uid)
    p = fitmod.Person(r) if r else None
    if not p or not p.usable():
        counts["skipped_gate"] += 1
        return
    fits = await fitmod.fits(db, uid, p, jobs)
    ranked = sorted(jobs, key=lambda j: -fits[j["_id"]]["score"])
    stuck = 0
    ready_left = limit - await db[AUTO_ITEMS].count_documents({"user_id": uid, "ready_day": day})
    for j in ranked:
        score = fits[j["_id"]]["score"]
        why = skip_reason(j, a, companies, site)
        if not why and j["_id"] in reported:
            why = "reported"
        if not why and j.get("company_id") in blocked:
            why = "company_marks"
        if not why and not level_ok(fits[j["_id"]], a):
            why = "experience"
        if why:
            counts[f"skip_{why}"] = counts.get(f"skip_{why}", 0) + 1
            continue
        mins = int(a.get("min_score", d["min_score"]))
        if j["apply"]["method"] == "link":  # other websites: never a bot; "Ready to apply" for one tap (A5)
            if score >= mins and ready_left > 0 and await company_count(db, uid, j, t) < int(d["company_cap"]):
                it = await _item(db, u, j, "ready", score=score, ready_day=day)
                if it:
                    copy = await tailored_copy(db, uid, r, j)
                    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"copy_id": copy["_id"]}})
                    ready_left -= 1
                    counts["ready"] = counts.get("ready", 0) + 1
            continue
        if score < mins - int(d["borderline"]):
            counts["skip_score"] = counts.get("skip_score", 0) + 1
            continue
        if await company_count(db, uid, j, t) >= int(d["company_cap"]):
            counts["skip_company_cap"] = counts.get("skip_company_cap", 0) + 1
            continue
        if score < mins:
            if stuck < MAX_STUCK_PER_RUN and await _item(db, u, j, "needs_answer", kind="borderline", score=score):
                stuck += 1
                counts["needs_answer"] += 1
            continue
        answers, missing = await saved_answers(u, j)
        if missing:
            if stuck < MAX_STUCK_PER_RUN and await _item(
                db, u, j, "needs_answer", kind="questions", score=score, missing=[q["id"] for q in missing]
            ):
                stuck += 1
                counts["needs_answer"] += 1
            continue
        from app.companies import questions as qmod

        if qmod.knockout(j.get("questions") or [], answers):
            counts["skip_not_a_fit"] = counts.get("skip_not_a_fit", 0) + 1
            continue  # the saved answers break the company's rules: not worth their time
        if left <= 0:
            continue  # today's limit is used; keep looking only for jobs that need an answer
        it = await _item(db, u, j, "applying", score=score, counted_day=day, found=fits[j["_id"]].get("found") or [])
        if not it:
            continue
        state = await finish(db, it, j, u, answers, day, site, mailer)
        counts[state] = counts.get(state, 0) + 1
        if state in ("applied", "waiting_approval"):
            left -= 1


async def expire_stale(db) -> int:
    """Stuck and waiting items whose job closed are no longer offered."""
    n = 0
    open_items = db[AUTO_ITEMS].find(
        {"state": {"$in": ["needs_answer", "waiting_approval", "queued", "ready"]}}, {"job_id": 1}
    )
    ids = [x async for x in open_items]
    if not ids:
        return 0
    live = {
        j["_id"]
        async for j in db[JOBS].find(
            {"$and": [live_filter(), {"_id": {"$in": [x["job_id"] for x in ids]}}]}, {"_id": 1}
        )
    }
    gone = [x["_id"] for x in ids if x["job_id"] not in live]
    if gone:
        n = (
            await db[AUTO_ITEMS].update_many(
                {"_id": {"$in": gone}}, {"$set": {"state": "expired", "updated_at": now()}}
            )
        ).modified_count
    return n


async def run(db, mailer=None, force: bool = False, limit: int = PAGE) -> dict[str, Any]:
    """One automation pass of the daily run: the next page of students not yet done today."""
    site = await get_site(db)
    t = now()
    day = today(t)
    if not site["auto_apply"]["on"]:
        return {"off": True}
    if not force and t.astimezone(IST).time() < START_AT:
        return {"waiting": True}
    await db[AUTO_RUNS].update_one(
        {"_id": day}, {"$setOnInsert": {"started_at": t, "counts": {}, "errors": [], "users": 0}}, upsert=True
    )
    expired = await expire_stale(db)
    from app.autoapply.emailing import check_deliveries

    deliveries = await check_deliveries(db)
    counts: dict[str, Any] = {"applied": 0, "waiting_approval": 0, "needs_answer": 0, "skipped_gate": 0}
    done = 0
    users = (
        db[USERS]
        .find(
            {
                "auto_apply.on": True,
                "auto_apply.admin_paused": {"$ne": True},
                "auto_apply.run_day": {"$ne": day},
                "disabled_at": None,
                "demo": {"$ne": True},  # demo students never run (their jobs are demo-only; no email to them)
            },
            {"auto_apply": 1, "email": 1, "name": 1},
        )
        .limit(limit)
    )
    async for u in users:
        got = await db[USERS].find_one_and_update(  # the per-student lock
            {
                "_id": u["_id"],
                "auto_apply.run_day": {"$ne": day},
                "$or": [{"auto_apply.lock_until": None}, {"auto_apply.lock_until": {"$lt": now()}}],
            },
            {"$set": {"auto_apply.lock_until": now() + LOCK}},
        )
        if not got:
            continue
        try:
            await run_user(db, got, site, day, counts, mailer)
            from app.autoapply.summary import after_run

            sent = await after_run(db, mailer, got, day)  # the daily summary / weekly report, when there is news
            counts["summary_emails"] = counts.get("summary_emails", 0) + sent["daily"] + sent["weekly"]
        except Exception as e:  # noqa: BLE001 — one student's problem never stops the others
            log.exception("auto apply: run failed for one student")
            await db[AUTO_RUNS].update_one(
                {"_id": day},
                {
                    "$push": {
                        "errors": {"$each": [{"user": u["_id"], "error": str(e)[:200], "at": now()}], "$slice": -50}
                    }
                },
            )
        await db[USERS].update_one(
            {"_id": u["_id"]}, {"$set": {"auto_apply.run_day": day, "auto_apply.lock_until": None}}
        )
        done += 1
    inc = {f"counts.{k}": v for k, v in counts.items() if v}
    await db[AUTO_RUNS].update_one(
        {"_id": day},
        {
            "$inc": {
                "users": done,
                "counts.expired": expired,
                "counts.bounced": deliveries["bounced"],
                "counts.complained": deliveries["complained"],
                **inc,
            },
            "$set": {"updated_at": now()},
        },
    )
    return {"users": done, **counts, "expired": expired}
