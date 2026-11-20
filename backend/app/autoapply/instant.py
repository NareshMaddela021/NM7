"""Auto Apply 2.0, phase A2: instant apply to jobs companies post on Nm7.

When a company posts a job that takes applications on Nm7, the job is marked for a scan (`jobs.auto_scan`, additive).
Right after the post answer is sent (a background task, never inside the company's request) and on every automation
pass, the scan scores the people who opted in to 2.0 against it:

  score ≥ auto threshold (70)  → applied by the candidate's approval mode (app/autoapply/v2engine.prepare):
                                  approve (default): their morning approval list · full_auto: sent now ·
                                  digest: the weekly list
  suggest threshold – 69       → "Suggested for you"
  screening questions the saved answers don't cover → "Waiting for you", sent the moment they answer
The candidate's rules, blocked companies, "hide me from" list, daily limit, pause / stop and consent all count, and
so do the company's own per-job controls (`jobs.auto_controls`, additive): accept auto applications on / off, the
most auto applications the job takes (default 50) and the lowest vetting level (default none).

Memory-safe: inside heavy_or_skip (another heavy job running → the next pass), at most JOBS_PER_PASS jobs,
SCAN_PER_PASS people looked at and SEND_PER_PASS applications prepared per pass; people are read in small batches
by id with a small projection, and the scan remembers where it stopped (`auto_scan.after`).

While the 2.0 switch is OFF only demo accounts, admins and testers are scanned, a real person only reaches a company
with a tester on its team (access.pair_ok), demo accounts only the demo company, and nobody but listed testers gets
2.0 email.
"""

import logging
from typing import Any

from pydantic import Field

from app.autoapply import access, engine, learning, rules, score, v2engine
from app.autoapply.settings import gate, resume_for
from app.core.db import APPLICATIONS, AUTO_ITEMS, COMPANIES, HIRE_PROFILES, JOBS, USERS
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs import fit as fitmod
from app.site import get_site

log = logging.getLogger("nm7.autoapply")

JOBS_PER_PASS = 5
SCAN_PER_PASS = 300
SEND_PER_PASS = 25
BATCH = 50
LABEL = "Sent by Auto Apply"
DEFAULT_CONTROLS = {"accept": True, "max": 50, "min_level": 0}
MAX_CAP = 500
USER_FIELDS = {"auto_apply": 1, "email": 1, "email_lc": 1, "name": 1, "role": 1, "demo": 1, "vetting": 1}
COMPANY_FIELDS = {"members": 1, "demo": 1, "details": 1, "name": 1, "auto_paused": 1, "review": 1, "score": 1}


class ControlsIn(CamelModel):
    accept: bool = True
    max: int = Field(DEFAULT_CONTROLS["max"], ge=1, le=MAX_CAP)
    min_level: int = Field(0, ge=0, le=4)


def eligible(j: dict[str, Any]) -> bool:
    """Only jobs a company runs on Nm7 (applications land in its dashboard)."""
    return bool(j.get("company_id")) and (j.get("apply") or {}).get("method") == "nm7"


def controls_of(j: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULT_CONTROLS, **(j.get("auto_controls") or {})}


def controls_out(j: dict[str, Any], received: int | None = None) -> dict[str, Any]:
    c = controls_of(j)
    out = {"accept": bool(c["accept"]), "max": int(c["max"]), "minLevel": int(c["min_level"])}
    if received is not None:
        out["received"] = received
    return out


async def received(db, job_id: str) -> int:
    """Auto applications this job's company has received (still in its view)."""
    return await db[APPLICATIONS].count_documents({"job_id": job_id, "origin": "auto", "company_removed_at": None})


def _level(u: dict[str, Any]) -> int:
    return int(((u.get("vetting") or {}).get("level")) or 0)


async def company_check(db, j: dict[str, Any], u: dict[str, Any]) -> str | None:
    """Why the company's own controls on this job turn an auto application away (None = they take it)."""
    if not eligible(j):
        return None
    c = controls_of(j)
    if not c["accept"]:
        return "company_off"
    if int(c["min_level"]) and _level(u) < int(c["min_level"]):
        return "company_level"
    if await received(db, j["_id"]) >= int(c["max"]):
        return "company_max"
    return None


async def send_block(db, u: dict[str, Any], it: dict[str, Any], j: dict[str, Any], site: dict[str, Any]) -> str | None:
    """Checked again the moment a 2.0 application goes out (Approve, an answered question, full auto): the company's
    controls, and for instant items the switch's pairing rule (it may have changed since the scan)."""
    if not eligible(j):
        return None
    if it.get("instant") or u.get("demo"):
        c = await db[COMPANIES].find_one({"_id": j["company_id"]}, COMPANY_FIELDS)
        if not access.pair_ok(u, c, site["auto_apply_v2"]):
            return "switch_off"
    if "vetting" not in u:
        u = {**u, **(await db[USERS].find_one({"_id": u["_id"]}, {"vetting": 1}) or {})}
    return await company_check(db, j, u)


# ---------- what the company receives ----------

NOTICE_SHORT = {"immediate": "Can join immediately", "15_days": "15 days", "30_days": "30 days", "60_days": "60 days",
                "90_days": "90 days"}  # fmt: skip


def _lakh(rupees_a_year: float) -> str:
    v = rupees_a_year / 100000
    return f"₹{v:.1f} lakh a year".replace(".0 lakh", " lakh")


async def facts(db, u: dict[str, Any]) -> dict[str, str]:
    """Notice period and expected salary, only from what the candidate saved (Ready to join, else their 2.0 rules)."""
    a = u.get("auto_apply") or {}
    hp = await db[HIRE_PROFILES].find_one({"_id": u["_id"]}, {"notice_days": 1, "salary": 1, "join_date": 1}) or {}
    notice = ""
    if hp.get("notice_days"):
        notice = f"{int(hp['notice_days'])} days"
    elif a.get("notice_period") in NOTICE_SHORT:
        notice = NOTICE_SHORT[a["notice_period"]]
    salary = ""
    s = hp.get("salary") or None
    if s and s.get("amount"):
        salary = f"₹{int(s['amount']):,} a month" if s.get("unit") == "month" else _lakh(float(s["amount"]) * 100000)
    elif a.get("min_salary"):
        salary = f"{_lakh(float(a['min_salary']))} or more"
    return {"notice": notice, "salary": salary}


async def payload(db, u: dict[str, Any], it: dict[str, Any]) -> dict[str, Any]:
    """Stored on the application (`auto_v2`, additive) when a 2.0 application reaches a company on Nm7."""
    return {
        "label": LABEL,
        "score": it.get("score"),
        "parts": it.get("parts") or {},
        **(await facts(db, u)),
        "at": now(),
    }


def _company_note(key: str, p: dict[str, Any]) -> str | None:
    """A score part in the company's words (the candidate's page says "your")."""
    share = p["points"] / p["max"] if p.get("max") else 0
    note = str(p.get("note") or "")
    if key == "skills":
        return note
    if key == "experience":
        return {"Your experience fits": "Experience fits the job", "Your experience is close": "Experience is close",
                "You have more experience than it asks": "More experience than the job asks"}.get(note)  # fmt: skip
    if key == "city":
        if note.startswith("Remote"):
            return "Happy to work remote"
        if note.startswith("In "):
            return "Wants to work in " + note[3:].split(",")[0]
        return None
    if key == "salary":
        return "Pay fits what they expect" if share >= 1 else None
    if key == "vetting":
        return note if share >= 0.8 else None
    return None  # freshness is about the job, not the person


def reasons(parts: dict[str, Any], vetting_visible: bool) -> list[str]:
    """The 3 plain reasons a company sees with the match score (no vetting line where vetting is hidden from it)."""
    ranked = sorted(parts.items(), key=lambda kv: -(kv[1]["points"] / kv[1]["max"] if kv[1].get("max") else 0))
    out: list[str] = []
    for k, p in ranked:
        if k == "vetting" and not vetting_visible:
            continue
        line = _company_note(k, p)
        if line and line not in out:
            out.append(line)
    return out[:3]


def badges(level: dict[str, Any] | None, l4: dict[str, Any] | None) -> list[str]:
    """Vetting badges in words (the caller passes None for both where vetting is hidden from the company)."""
    out: list[str] = []
    if level:
        out.append(f"L{level['level']} · {level['label']}")
        if level.get("readyNow"):
            out.append("Ready now")
        out += [f"Skill verified: {x.get('role') or x}" if isinstance(x, dict) else f"Skill verified: {x}"
                for x in (level.get("skillVerified") or [])[:2]]  # fmt: skip
    if l4:
        out.append("Nm7 verified")
    return out


def company_view(a: dict[str, Any], level, l4, vetting_visible: bool) -> dict[str, Any] | None:
    """The "Sent by Auto Apply" block on an applicant card (only 2.0 applications have one)."""
    x = a.get("auto_v2")
    if not x:
        return None
    return {
        "label": x.get("label") or LABEL,
        "score": x.get("score"),
        "reasons": reasons(x.get("parts") or {}, vetting_visible),
        "coverNote": a.get("cover_note") or [],
        "notice": x.get("notice") or "",
        "salary": x.get("salary") or "",
        "badges": badges(level, l4) if vetting_visible else [],
        "tailored": bool(a.get("copy_id")),
    }


# ---------- the scan ----------


async def queue(db, j: dict[str, Any]) -> bool:
    """Mark a newly posted (or newly live) job for the scan."""
    if not eligible(j):
        return False
    r = await db[JOBS].update_one(
        {"_id": j["_id"], "auto_scan.state": {"$ne": "done"}},
        {"$set": {"auto_scan": {"state": "pending", "queued_at": now(), "after": None, "scanned": 0, "prepared": 0}}},
    )
    return bool(r.modified_count)


async def kick(db, mailer=None) -> dict[str, Any]:
    """The background task after a post: one pass now (or the next automation pass when the server is busy)."""
    try:
        out = await run(db, mailer)
    except Exception:  # noqa: BLE001 — never surfaces to the company
        log.exception("auto apply 2.0: instant pass failed")
        return {"error": True}
    from app.autoapply.ats import service as ats

    await ats.kick(db)  # A4: full-auto applications to a job linked to the company's hiring system go out now
    return out


def _bump(counts: dict[str, Any], key: str) -> None:
    counts[key] = counts.get(key, 0) + 1


async def run(
    db,
    mailer=None,
    jobs_cap: int = JOBS_PER_PASS,
    scan_cap: int = SCAN_PER_PASS,
    send_cap: int = SEND_PER_PASS,
) -> dict[str, Any]:
    """One pass over the jobs waiting for a scan."""
    from app.core.heavy import heavy_or_skip

    site = await get_site(db)
    if not site["auto_apply"]["on"]:
        return {"off": True}
    await db[JOBS].update_many(  # closed before their scan finished: nothing to do
        {"auto_scan.state": "pending", "status": "closed"},
        {"$set": {"auto_scan.state": "done", "auto_scan.done_at": now()}},
    )
    counts: dict[str, Any] = {"jobs": 0}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {"waiting_heavy": True}
        budget = {"scan": scan_cap, "send": send_cap}
        ids = [
            x["_id"]
            async for x in db[JOBS]
            .find({"auto_scan.state": "pending", "status": "active"}, {"_id": 1})
            .sort("auto_scan.queued_at", 1)
            .limit(jobs_cap)
        ]
        for jid in ids:
            if budget["scan"] <= 0 or budget["send"] <= 0:
                break
            j = await db[JOBS].find_one({"_id": jid})
            if j:
                counts["jobs"] += 1
                await scan_job(db, j, site, counts, budget, mailer)
    return counts


def _people_query(j: dict[str, Any], c: dict[str, Any] | None, v2: dict[str, Any], after: str | None) -> dict:
    q: dict[str, Any] = {
        "auto_apply.v2_consent_at": {"$ne": None},
        "auto_apply.on": True,
        "auto_apply.admin_paused": {"$ne": True},
        "disabled_at": None,
        "demo": True if (c or {}).get("demo") else {"$ne": True},
    }
    if after:
        q["_id"] = {"$gt": after}
    if not v2.get("public") and not (c or {}).get("demo"):
        testers = sorted({str(e).lower() for e in v2.get("testers") or []})
        q["$or"] = [{"role": "admin"}, {"email_lc": {"$in": testers}}]
    return q


async def scan_job(db, j, site, counts, budget, mailer=None) -> None:
    c = await db[COMPANIES].find_one({"_id": j["company_id"]}, COMPANY_FIELDS)
    scan = j.get("auto_scan") or {}
    ctl = controls_of(j)
    finished = False
    last = scan.get("after")
    seen = prepared = 0
    if not c or not ctl["accept"] or await received(db, j["_id"]) >= int(ctl["max"]):
        finished = True  # nobody to apply to now (a later change of the controls re-queues the job)
    else:
        limit = budget["scan"]
        cursor = (
            db[USERS]
            .find(_people_query(j, c, site["auto_apply_v2"], last), USER_FIELDS)
            .sort("_id", 1)
            .limit(limit)
            .batch_size(BATCH)
        )
        stopped = False
        async for u in cursor:
            seen += 1
            budget["scan"] -= 1
            last = u["_id"]
            try:
                state = await consider(db, u, j, c, site, mailer)
            except Exception:  # noqa: BLE001 — one person's problem never stops the scan
                log.exception("auto apply 2.0: instant apply failed for one person")
                state = "error"
            _bump(counts, f"instant_{state}")
            if state in ("applied", "sent", "waiting_approval", "queued"):
                prepared += 1
                budget["send"] -= 1
            if budget["send"] <= 0:
                stopped = True
                break
        finished = not stopped and seen < limit
    sets: dict[str, Any] = {"auto_scan.after": last, "auto_scan.at": now()}
    if finished:
        sets |= {"auto_scan.state": "done", "auto_scan.done_at": now()}
    await db[JOBS].update_one(
        {"_id": j["_id"]}, {"$set": sets, "$inc": {"auto_scan.scanned": seen, "auto_scan.prepared": prepared}}
    )


async def consider(db, u: dict[str, Any], j: dict[str, Any], c: dict[str, Any], site: dict[str, Any], mailer=None):
    """Score one opted-in person against the new job and route it. → what happened (a counts key)."""
    from app.seek.support import hidden_from

    uid = u["_id"]
    a = u.get("auto_apply") or {}
    v2 = site["auto_apply_v2"]
    if not access.pair_ok(u, c, v2):
        return "switch_off"
    why = rules.check(j, a) or engine.skip_reason(j, a, {c["_id"]: c}, site)
    if why:
        return f"skip_{why}"
    if j["company_id"] in set(a.get("blocked_companies") or []):
        return "skip_company_marks"
    if hidden_from(await db[HIRE_PROFILES].find_one({"_id": uid}, {"hide_from": 1}), c):
        return "skip_hidden"
    if await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]}, {"_id": 1}) or await db[
        APPLICATIONS
    ].find_one({"user_id": uid, "job_id": j["_id"]}, {"_id": 1}):
        return "seen"
    if not (await gate(db, uid, site))["ok"]:
        return "skip_gate"
    r = await resume_for(db, uid)
    p = fitmod.Person(r) if r else None
    if not p or not p.usable():
        return "skip_gate"
    f = (await fitmod.fits(db, uid, p, [j]))[j["_id"]]
    if not engine.level_ok(f, a):
        return "skip_experience"
    parts = score.parts(j, f, a, _level(u), await learning.penalties(db, uid))
    band = score.band(parts["score"], site, a)
    if band == "skip":
        return "skip_score"
    t = now()
    if await engine.company_count(db, uid, j, t) >= int(site["auto_apply"]["company_cap"]):
        return "skip_company_cap"
    if why := await company_check(db, j, u):
        return f"skip_{why}"
    extra = {**v2engine._item_extra(parts, j), "instant": True}
    if band == "suggest":
        return "suggested" if await engine._item(db, u, j, "suggested", **extra) else "seen"
    answers, missing = await engine.saved_answers(u, j)
    if missing:
        it = await engine._item(db, u, j, "needs_answer", kind="questions", missing=[q["id"] for q in missing], **extra)
        return "waiting" if it else "seen"
    from app.companies import questions as qmod

    if qmod.knockout(j.get("questions") or [], answers):
        return "skip_not_a_fit"
    day = engine.today(t)
    if await v2engine.left_today(db, u, site, day) <= 0:
        return "skip_limit"  # today's limit is used: the morning run looks at this job again
    it = await engine._item(db, u, j, "applying", answers=answers, found=f.get("found") or [], **extra)
    if not it:
        return "seen"
    return await v2engine.prepare(db, u, it, j, site, day, mailer)
