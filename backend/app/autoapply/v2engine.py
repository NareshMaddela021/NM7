"""The Auto Apply 2.0 engine (A1): the morning run for people who opted in to 2.0, and every way a 2.0 application
goes out. Built on today's engine (app/autoapply/engine.py: the same job query, hard-rule skips, company cap,
channels, one item per (person, job), the run log), so nothing runs twice and nothing is sent outside it.

For each job that passes the candidate's rules (app/autoapply/rules.py) and the hard rules:
  score ≥ auto threshold (70)      → the auto-apply queue: tailored once (app/autoapply/tailoring.py), then by mode
                                     full_auto: sent now · approve (DEFAULT): the morning list ("Approve all") ·
                                     digest: the weekly list
  suggest threshold (55) – 69      → "Suggested for you" (the candidate taps Apply)
  below                            → skipped
A job whose screening questions the saved answers don't cover waits in "Waiting for you"; the answer is saved to the
profile (never asked again) and that application is sent at once. Website jobs (apply on the company's site) are
"Ready" for one tap by the candidate: Nm7 never fills other sites' forms, never touches a CAPTCHA, never creates an
account or stores a password elsewhere, and never uses job boards.

The daily limit (default 10, at most 25) counts what was prepared or sent today; suggestions, waiting questions and
one-tap jobs don't use it.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any

from app.autoapply import engine, learning, rules, score, tailoring
from app.autoapply.settings import gate, resume_for
from app.core.db import APPLICATIONS, AUTO_COPIES, AUTO_ITEMS, COMPANIES, JOBS, USERS
from app.core.time import now
from app.jobs import fit as fitmod

CHANNELS = {"nm7": "internal", "email": "email", "link": "one_tap", "partner": "partner", "form": "form"}
STAGES = (
    ("ready", "Ready"),
    ("waiting", "Waiting for you"),
    ("applied", "Applied"),
    ("viewed", "Viewed"),
    ("replied", "Replied / Interview"),
    ("closed", "Offer / Rejected / Closed"),
)
SUGGEST_MAX = 15  # "Suggested for you" items a run may add
MAX_WAITING = 10


def channel_of(method: str | None) -> str:
    return CHANNELS.get(method or "", "internal")


def stage_of(it: dict[str, Any], app: dict[str, Any] | None) -> tuple[str, str]:
    """(tracker stage, outcome) for an item and its application."""
    if app:
        st = app.get("status")
        if st == "viewed":
            return "viewed", ""
        if st in ("shortlisted", "interview"):
            return "replied", st
        if st in ("offer", "rejected"):
            return "closed", st
        return "applied", ""
    s = it.get("state")
    if s == "needs_answer":
        return "waiting", ""
    if s in ("applied", "sent", "opened"):
        return "applied", ""
    if s in ("expired",):
        return "closed", "closed"
    return "ready", ""


async def week_used(db, uid: str, t: datetime) -> int:
    since = (t - timedelta(days=7)).date().isoformat()
    return await db[AUTO_ITEMS].count_documents({"user_id": uid, "v2": True, "counted_day": {"$gte": since}})


async def left_today(db, u: dict[str, Any], site: dict[str, Any], day: str) -> int:
    a = u.get("auto_apply") or {}
    left = rules.limit_of(a, site) - await engine.used_today(db, u["_id"], day)
    free = int(site["auto_apply_v2"].get("free_per_week") or 0)
    if free and not site["auto_apply_v2"].get("payments_on"):
        left = min(left, free - await week_used(db, u["_id"], now()))
    return left


async def send(db, u, it, j, site, mailer=None) -> str:
    """Send one prepared (or approved / answered) application now through its channel. → the new state."""
    r = await resume_for(db, u["_id"])
    if not r:
        return "skipped"
    copy = await tailoring.build(db, u["_id"], r, j, u.get("auto_apply") or {})
    got = await engine.deliver(db, it, j, u, copy, it.get("answers") or {}, mailer, site)
    sets = {**got, "copy_id": copy["_id"], "approved": True, "updated_at": now()}
    upd: dict[str, Any] = {"$set": sets}
    if got["state"] in ("queued", "skipped"):
        upd["$unset"] = {"counted_day": ""}
    else:
        sets["counted_day"] = it.get("counted_day") or engine.today()
        if j["apply"]["method"] != "email":  # the email channel stores its own copy; the others note what went out
            await db[APPLICATIONS].update_one(
                {"user_id": u["_id"], "job_id": j["_id"]},
                {
                    "$set": {
                        "v2": True,
                        "cover_note": copy.get("cover_note") or [],
                        "channel_v2": channel_of(j["apply"]["method"]),
                    }
                },
            )
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, upd)
    return got["state"]


async def prepare(db, u, it, j, site, day: str, mailer=None, approved: bool = False) -> str:
    """Tailor once, then by the candidate's approval mode: send now (full auto, or approved), else wait in the list."""
    r = await resume_for(db, u["_id"])
    if not r:
        return "skipped"
    copy = await tailoring.build(db, u["_id"], r, j, u.get("auto_apply") or {})
    mode = rules.mode_of(u.get("auto_apply") or {})
    if mode == "full_auto" or approved:
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"copy_id": copy["_id"], "counted_day": day}})
        return await send(db, u, {**it, "copy_id": copy["_id"], "counted_day": day}, j, site, mailer)
    await db[AUTO_ITEMS].update_one(
        {"_id": it["_id"]},
        {
            "$set": {
                "state": "waiting_approval",
                "copy_id": copy["_id"],
                "counted_day": day,
                "mode": mode,
                "updated_at": now(),
            }
        },
    )
    return "waiting_approval"


def _item_extra(parts: dict[str, Any], j: dict[str, Any]) -> dict[str, Any]:
    return {
        "v2": True,
        "score": parts["score"],
        "parts": parts["parts"],
        "reasons": parts["reasons"],
        "concerns": parts["concerns"],
        "channel_v2": channel_of(j["apply"]["method"]),
    }


async def run_user(db, u: dict[str, Any], site: dict[str, Any], day: str, counts: dict[str, Any], mailer=None) -> None:
    uid = u["_id"]
    a = u.get("auto_apply") or {}
    d = site["auto_apply"]
    t = now()
    if not (await gate(db, uid, site))["ok"]:
        counts["skipped_gate"] += 1
        return
    left = await left_today(db, u, site, day)
    # answered or approved after yesterday's limit: first
    async for it in db[AUTO_ITEMS].find({"user_id": uid, "state": "queued"}).sort("updated_at", 1):
        if left <= 0:
            break
        j = await db[JOBS].find_one({"_id": it["job_id"]})
        if not j or j.get("status") != "active":
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "expired", "updated_at": t}})
            continue
        state = await send(db, u, {**it, "counted_day": day}, j, site, mailer)
        counts[f"v2_{state}"] = counts.get(f"v2_{state}", 0) + 1
        left -= state in ("applied", "sent")
    seen = {x["job_id"] async for x in db[AUTO_ITEMS].find({"user_id": uid}, {"job_id": 1})}
    seen |= {
        x["job_id"] async for x in db[APPLICATIONS].find({"user_id": uid, "job_id": {"$exists": True}}, {"job_id": 1})
    }
    jobs = [
        j
        async for j in db[JOBS]
        .find(engine.job_query(a, t - engine.LOOKBACK))
        .sort("posted_at", -1)
        .limit(engine.MAX_CANDIDATES)
        if j["_id"] not in seen
    ]
    if not jobs:
        return
    r = await resume_for(db, uid)
    p = fitmod.Person(r) if r else None
    if not p or not p.usable():
        counts["skipped_gate"] += 1
        return
    reported = await engine._reported(db, [j["_id"] for j in jobs])
    cids = list({j["company_id"] for j in jobs if j.get("company_id")})
    companies = {
        c["_id"]: c
        async for c in db[COMPANIES].find({"_id": {"$in": cids}}, {"score": 1, "auto_paused": 1, "review": 1})
    }
    fits = await fitmod.fits(db, uid, p, jobs)
    level = int(((await db[USERS].find_one({"_id": uid}, {"vetting": 1}) or {}).get("vetting") or {}).get("level") or 0)
    pens = await learning.penalties(db, uid)
    scored = []
    for n, j in enumerate(jobs):
        scored.append((j, score.parts(j, fits[j["_id"]], a, level, pens, t)))
        if n % 50 == 49:
            await asyncio.sleep(0)  # a long list: let the server answer requests
    scored.sort(key=lambda x: -x[1]["score"])
    blocked = set(a.get("blocked_companies") or [])
    waiting = suggested = 0
    for j, parts in scored:
        why = rules.check(j, a) or engine.skip_reason(j, a, companies, site)
        if not why and j["_id"] in reported:
            why = "reported"
        if not why and j.get("company_id") in blocked:
            why = "company_marks"
        if not why and not engine.level_ok(fits[j["_id"]], a):
            why = "experience"
        if why:
            counts[f"v2_skip_{why}"] = counts.get(f"v2_skip_{why}", 0) + 1
            continue
        band = score.band(parts["score"], site, a)
        if band == "skip":
            counts["v2_skip_score"] = counts.get("v2_skip_score", 0) + 1
            continue
        if await engine.company_count(db, uid, j, t) >= int(d["company_cap"]):
            counts["v2_skip_company_cap"] = counts.get("v2_skip_company_cap", 0) + 1
            continue
        extra = _item_extra(parts, j)
        if band == "suggest":
            if suggested < SUGGEST_MAX and await engine._item(db, u, j, "suggested", **extra):
                suggested += 1
                counts["v2_suggested"] = counts.get("v2_suggested", 0) + 1
            continue
        if j["apply"]["method"] == "link":  # the company's own website: Ready for one tap by the candidate
            it = await engine._item(db, u, j, "ready", ready_day=day, **extra)
            if it:
                copy = await tailoring.build(db, uid, r, j, a)
                await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"copy_id": copy["_id"]}})
                counts["v2_ready"] = counts.get("v2_ready", 0) + 1
            continue
        answers, missing = await engine.saved_answers(u, j)
        if missing:
            if waiting < MAX_WAITING and await engine._item(
                db, u, j, "needs_answer", kind="questions", missing=[q["id"] for q in missing], **extra
            ):
                waiting += 1
                counts["v2_waiting"] = counts.get("v2_waiting", 0) + 1
            continue
        from app.companies import questions as qmod

        if qmod.knockout(j.get("questions") or [], answers):
            counts["v2_skip_not_a_fit"] = counts.get("v2_skip_not_a_fit", 0) + 1
            continue
        if left <= 0:
            continue  # today's limit is used: only questions and suggestions are still collected
        it = await engine._item(db, u, j, "applying", answers=answers, found=fits[j["_id"]].get("found") or [], **extra)
        if not it:
            continue
        state = await prepare(db, u, it, j, site, day, mailer)
        counts[f"v2_{state}"] = counts.get(f"v2_{state}", 0) + 1
        if state in ("applied", "sent", "waiting_approval"):
            left -= 1


# ---------- the tracker ----------


def _job(it: dict[str, Any]) -> dict[str, Any]:
    return {"id": it["job_id"], "title": it.get("title"), "company": it.get("company"), "slug": it.get("slug")}


def row(it: dict[str, Any], app: dict[str, Any] | None) -> dict[str, Any]:
    from app.me.service import ms

    stage, outcome = stage_of(it, app)
    return {
        "id": it["_id"],
        "stage": stage,
        "outcome": outcome,
        "state": it["state"],
        "channel": it.get("channel_v2") or channel_of(it.get("channel")),
        "job": _job(it),
        "score": it.get("score"),
        "parts": it.get("parts") or {},
        "reasons": it.get("reasons") or [],
        "concerns": it.get("concerns") or [],
        "mode": it.get("mode"),
        "hasVersion": bool(it.get("copy_id")),
        "demo": bool(it.get("demo")),
        "at": ms((app or {}).get("updated_at") or it.get("updated_at")),
    }


TRACKED = ("needs_answer", "waiting_approval", "queued", "ready", "applying", "applied", "sent", "opened", "expired")


async def tracker(db, uid: str) -> dict[str, Any]:
    items = (
        await db[AUTO_ITEMS].find({"user_id": uid, "state": {"$in": list(TRACKED)}}).sort("updated_at", -1).to_list(300)
    )
    apps = {
        a["job_id"]: a
        async for a in db[APPLICATIONS].find(
            {"user_id": uid, "job_id": {"$in": [i["job_id"] for i in items]}},
            {"job_id": 1, "status": 1, "updated_at": 1},
        )
    }
    rows = [row(i, apps.get(i["job_id"])) for i in items]
    counts = {k: 0 for k, _ in STAGES}
    for x in rows:
        counts[x["stage"]] += 1
    return {"stages": [{"key": k, "label": lbl, "count": counts[k]} for k, lbl in STAGES], "items": rows}


async def what_was_sent(db, uid: str, iid: str) -> dict[str, Any] | None:
    from app.me.service import ms

    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": uid})
    if not it:
        return None
    copy = await db[AUTO_COPIES].find_one({"_id": it.get("copy_id"), "user_id": uid}) if it.get("copy_id") else None
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": it["job_id"]})
    sent = it.get("sent") or (app or {}).get("sent_email")
    stage, outcome = stage_of(it, app)
    return {
        "id": it["_id"],
        "job": _job(it),
        "stage": stage,
        "outcome": outcome,
        "channel": it.get("channel_v2") or channel_of(it.get("channel")),
        "sentAt": ms(it.get("applied_at") or (app or {}).get("created_at")),
        "wentOut": bool(app),
        "version": tailoring.public(copy),
        "screening": {str(k): v for k, v in (it.get("answers") or (app or {}).get("answers") or {}).items()},
        "email": {"to": sent["to"], "subject": sent["subject"], "text": sent["text"]} if sent else None,
    }
