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

from datetime import datetime, timedelta
from typing import Any

from app.autoapply import engine, instant, learning, rules, score, tailoring
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
        if it.get("job_closed_at") and st in ("applied", "viewed"):  # A2: the company closed the job first
            return "closed", "closed"
        if it.get("replied_at") and st in ("applied", "viewed"):  # A3: the company replied to the apply address
            return "replied", "replied"
        if st == "viewed":
            return "viewed", ""
        if st in ("shortlisted", "interview"):
            return "replied", st
        if st in ("offer", "rejected"):
            return "closed", st
        if st == "no_reply":
            return "closed", "no_reply"
        return "applied", ""
    s = it.get("state")
    if s == "needs_answer":
        return "waiting", ""
    if s == "form_queued":  # A5: waiting for the background form pass
        return "ready", ""
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
    why = await instant.send_block(db, u, it, j, site)
    if why:  # the company's controls (or the launch switch) turn it away: never sent, not counted in the limit
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]},
            {"$set": {"state": "skipped", "reason": why, "updated_at": now()}, "$unset": {"counted_day": ""}},
        )
        return "skipped"
    copy = await tailoring.build(db, u["_id"], r, j, u.get("auto_apply") or {})
    got = await engine.deliver(db, it, j, u, copy, it.get("answers") or {}, mailer, site)
    sets = {**got, "copy_id": copy["_id"], "approved": True, "updated_at": now()}
    upd: dict[str, Any] = {"$set": sets}
    if got["state"] in ("queued", "skipped", "ready"):  # ready: no email channel for this one (A3), one tap
        upd["$unset"] = {"counted_day": ""}
    elif got["state"] == "form_queued":  # A5: the background form pass sends it (and keeps the proof)
        sets["counted_day"] = it.get("counted_day") or engine.today()
    else:
        sets["counted_day"] = it.get("counted_day") or engine.today()
        if j["apply"]["method"] != "email":  # the email channel stores its own copy; the others note what went out
            extra: dict[str, Any] = {
                "v2": True,
                "cover_note": copy.get("cover_note") or [],
                "channel_v2": channel_of(j["apply"]["method"]),
            }
            if instant.eligible(j):  # A2: what the company sees with a "Sent by Auto Apply" application
                extra["auto_v2"] = await instant.payload(db, u, it)
            await db[APPLICATIONS].update_one({"user_id": u["_id"], "job_id": j["_id"]}, {"$set": extra})
            if got["state"] == "applied" and instant.eligible(j) and j.get("partner_job"):
                from app.autoapply.ats import service as ats  # A4: also to the company's own hiring system

                if mark := await ats.queue(db, u, it, j, site):
                    sets |= {"channel_v2": "partner", "partner": mark}
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
        left -= state in ("applied", "sent", "form_queued")
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
    scored = [(j, score.parts(j, fits[j["_id"]], a, level, pens, t)) for j in jobs]
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
        if why := await instant.company_check(db, j, {**u, "vetting": {"level": level}}):  # A2: the company's controls
            counts[f"v2_skip_{why}"] = counts.get(f"v2_skip_{why}", 0) + 1
            continue
        extra = _item_extra(parts, j)
        if band == "suggest":
            if suggested < SUGGEST_MAX and await engine._item(db, u, j, "suggested", **extra):
                suggested += 1
                counts["v2_suggested"] = counts.get("v2_suggested", 0) + 1
            continue
        no_mail = None
        if j["apply"]["method"] == "email":  # A3: no email channel for this job / person → Ready for one tap
            from app.autoapply import emailing

            no_mail = await emailing.ready_reason(db, u, j, site)
        no_form = None
        if j["apply"]["method"] == "link":  # A5: a simple form on the company's own site, else one tap
            from app.autoapply.forms import service as forms

            no_form = await forms.route(db, u, j, site)
            if not no_form:
                extra["channel_v2"] = "form"
        if no_form or no_mail:  # Ready for one tap by the candidate
            more = {"reason": no_mail, "apply_to": j["apply"].get("email", "")} if no_mail else {}
            if no_form:
                more = {"reason": no_form, "channel_v2": "one_tap"}
            it = await engine._item(db, u, j, "ready", ready_day=day, **{**extra, **more})
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
        if state in ("applied", "sent", "waiting_approval", "form_queued"):
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
        "instant": bool(it.get("instant")),
        "notice": _notice(it.get("notice")),
        "demo": bool(it.get("demo")),
        "at": ms((app or {}).get("updated_at") or it.get("updated_at")),
        "replies": int(it.get("replies") or 0),  # A3: replies that came to the candidate's apply address
        "applyTo": it.get("apply_to") or None if it.get("state") == "ready" else None,  # A3: email it yourself
        "readyReason": it.get("reason") if it.get("state") == "ready" else None,
        "partner": _partner(it.get("partner")),  # A4: sent to the company's hiring system (name, state)
        "form": _form(it),  # A5: the company's own form (sending / sent / tried, then one tap)
        "readyText": _ready_text(it),
    }


FORM_STATE = {"form_queued": "Sending to the company’s form", "applied": "Sent through the company’s own form",
              "needs_answer": "The company’s form asks something Nm7 doesn’t know"}  # fmt: skip


def _form(it: dict[str, Any]) -> dict[str, Any] | None:
    proof = it.get("form_proof") or {}
    if it.get("channel_v2") != "form" and not proof:
        return None
    state = it.get("state") or ""
    if proof and not proof.get("ok"):
        text = "Nm7 tried the company’s form, but it didn’t go through"
    else:
        text = FORM_STATE.get(state, "")
    return {"state": state, "text": text, "confirmed": bool(proof.get("confirmed")), "ok": proof.get("ok"),
            "test": bool(proof.get("test"))}  # fmt: skip


def _ready_text(it: dict[str, Any]) -> str | None:
    if it.get("state") != "ready" or not it.get("reason"):
        return None
    from app.autoapply.forms.service import REASONS

    return REASONS.get(it["reason"])


PARTNER_STATE = {"pending": "Sending", "retrying": "Sending (trying again)", "delivered": "Delivered",
                 "kept": "Kept on Nm7"}  # fmt: skip


def _partner(p: dict[str, Any] | None) -> dict[str, Any] | None:
    if not p:
        return None
    return {"name": p.get("name") or "", "state": p.get("state") or "pending",
            "stateText": PARTNER_STATE.get(p.get("state") or "pending", "")}  # fmt: skip


def _notice(n: dict[str, Any] | None) -> dict[str, Any] | None:
    from app.me.service import ms

    if not n:
        return None
    return {"status": n.get("status"), "text": n.get("text"), "at": ms(n.get("at")), "seen": bool(n.get("seen"))}


TRACKED = ("needs_answer", "waiting_approval", "queued", "ready", "applying", "applied", "sent", "opened", "expired",
           "form_queued")  # fmt: skip


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
    updates = [
        {"id": x["id"], "job": x["job"], **x["notice"]}
        for x in sorted(rows, key=lambda r: -((r["notice"] or {}).get("at") or 0))
        if x["notice"] and not x["notice"]["seen"]
    ]
    return {
        "stages": [{"key": k, "label": lbl, "count": counts[k]} for k, lbl in STAGES],
        "items": rows,
        "updates": updates[:20],
    }


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
        "email": _email_out(sent, it) if sent else None,
        "followUp": _email_out(it["follow_up"], it) if it.get("follow_up") else None,
        "replies": await replies_of(db, uid, it["_id"]),
        "partner": _partner(it.get("partner")),
        "form": _form_proof(it.get("form_proof")),  # A5: the fields sent, the answer and a snapshot of it
    }


def _form_proof(p: dict[str, Any] | None) -> dict[str, Any] | None:
    from app.me.service import ms

    if not p:
        return None
    return {
        "page": p.get("page") or "",
        "action": p.get("action") or "",
        "fields": [{"label": f["label"], "value": f["value"], "kind": f["kind"]} for f in p.get("fields") or []],
        "file": p.get("file"),
        "status": p.get("status"),
        "finalUrl": p.get("final_url") or "",
        "snapshot": p.get("snapshot") or "",
        "confirmed": bool(p.get("confirmed")),
        "ok": bool(p.get("ok")),
        "test": bool(p.get("test")),
        "at": ms(p.get("at")),
    }


def _email_out(sent: dict[str, Any], it: dict[str, Any]) -> dict[str, Any]:
    """Exactly what went out (A3: from the candidate's apply address, the attachment, where the address came from and,
    while the switch is OFF, the test inbox that really got it)."""
    from app.me.service import ms

    return {
        "to": sent["to"],
        "subject": sent["subject"],
        "text": sent["text"],
        "from": sent.get("from"),
        "sentTo": sent.get("sent_to") or sent["to"],
        "test": bool(sent.get("test")),
        "attachment": sent.get("attachment"),
        "source": sent.get("source"),
        "at": ms(sent.get("at")),
    }


async def replies_of(db, uid: str, iid: str | None = None) -> list[dict[str, Any]]:
    from app.core.db import AUTO_REPLIES
    from app.me.service import ms

    q: dict[str, Any] = {"user_id": uid, **({"item_id": iid} if iid else {})}
    rows = await db[AUTO_REPLIES].find(q).sort("received_at", -1).to_list(50)
    return [
        {
            "id": r["_id"],
            "itemId": r.get("item_id"),
            "from": r.get("from"),
            "fromName": r.get("from_name") or "",
            "subject": r.get("subject") or "",
            "text": r.get("text") or "",
            "at": ms(r.get("received_at")),
            "forwarded": bool(r.get("forwarded")),
            "company": r.get("company") or "",
            "title": r.get("title") or "",
        }
        for r in rows
    ]
