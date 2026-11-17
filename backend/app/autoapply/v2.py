"""Auto Apply 2.0 endpoints (A1 "Engine"), all behind the launch switch (app/autoapply/access.py): while it is OFF
only admins, demo accounts and the listed testers get an answer; everyone else gets 404 and today's Auto Apply.

Candidate (signed in):
  GET  /api/me/auto-apply/v2                    status: rules, consent, on / paused, mode, today's numbers, learning
  GET  /api/me/auto-apply/v2/rules              the rules
  PUT  /api/me/auto-apply/v2/rules {...}        save the rules (rules.RulesIn)
  POST /api/me/auto-apply/v2/consent {agree}    explicit opt-in (DPDP): may apply for me, tailor my resume (reorder and
                                                rephrase only), share my profile with these companies
  POST /api/me/auto-apply/v2/pause {paused}     pause / resume at any time
  POST /api/me/auto-apply/v2/stop               withdraw consent: nothing more is prepared or sent
  GET  /api/me/auto-apply/v2/tracker            one tracker for every channel (+ "updates": the companies' moves)
  POST /api/me/auto-apply/v2/tracker/seen       the updates were read
  GET  /api/me/auto-apply/v2/suggested          "Suggested for you" (55–69)
  POST /api/me/auto-apply/v2/suggested/{id}/apply | /dismiss
  GET  /api/me/auto-apply/v2/waiting            questions Nm7 can't answer
  POST /api/me/auto-apply/v2/waiting/{id}/answer {answers}   saved to the profile, then sent at once
  GET  /api/me/auto-apply/v2/approvals          the morning list (approve) / the weekly list (digest)
  POST /api/me/auto-apply/v2/approve/{id} | /approve-all | /approvals/{id}/skip
  GET  /api/me/auto-apply/v2/sent/{id}          what was sent: the version, cover note, answers, the email
  POST /api/me/auto-apply/v2/tracker/{id}/status {status}   a reply that came outside Nm7 (email / website)
  GET  /api/me/auto-apply/v2/email              A3: the email channel: on / off (and why), my apply address, follow-up
  PUT  /api/me/auto-apply/v2/email {emailOn, followUp}
  GET  /api/me/auto-apply/v2/replies            A3: replies companies sent to my apply address
Admin (permission "jobs"):
  GET  /api/admin/auto-apply/v2                 the switch, thresholds, testers, test inbox, pricing and the numbers
  PUT  /api/admin/auto-apply/v2/settings {...}
  GET  /api/admin/auto-apply/v2/email           A3: email channel health (sent today, bounces, complaints, blocks,
                                                opt-outs, candidates paused after a complaint)
  DELETE /api/admin/auto-apply/v2/email/blocks/{id}         undo a block or an opt-out
  POST /api/admin/auto-apply/v2/email/paused/{uid}/resume   turn a candidate's email channel back on after review
  GET  /api/admin/auto-apply/v2/partners        A4: each hiring-system partner's health
  GET  /api/admin/auto-apply/v2/forms           A5: every company site seen for forms (state, reason, counts)
  POST /api/admin/auto-apply/v2/forms/sites/{site}/one-tap | /reset    move a site to one-tap only, or reset it
"""

import re
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.autoapply import access, engine, learning, onetap, rules, tailoring, v2engine
from app.autoapply.settings import gate
from app.core.db import APPLICATIONS, AUTO_COPIES, AUTO_ITEMS, DB, JOBS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site

router = APIRouter(prefix="/api/me/auto-apply/v2", tags=["auto apply 2.0"])
admin = APIRouter(prefix="/api/admin/auto-apply/v2", tags=["auto apply 2.0 admin"])

CONSENT_TEXT = (
    "Nm7 may apply for me within my rules, tailor my resume for each job (reorder and rephrase only, "
    "never add anything) and share my profile with these companies. I can pause or stop at any time."
)


class AgreeIn(CamelModel):
    agree: bool


class PauseIn(CamelModel):
    paused: bool


class AnswerIn(CamelModel):
    answers: dict[str, str | int] = Field(default_factory=dict, max_length=5)


class StatusIn(CamelModel):
    status: Literal["viewed", "interview", "offer", "rejected"]


class EmailIn(CamelModel):
    email_on: bool = True
    follow_up: bool = False


async def _allowed(db, uid: str) -> dict[str, Any]:
    site = await get_site(db)
    if not await access.for_user(db, uid, site):
        raise ApiError(404, "not_found", "Not found.")
    return site


async def _user(db, uid: str) -> dict[str, Any]:
    return await db[USERS].find_one(
        {"_id": uid}, {"auto_apply": 1, "email": 1, "email_lc": 1, "name": 1, "demo": 1, "role": 1}
    ) or {"_id": uid}


async def _status(db, uid: str, site: dict[str, Any]) -> dict[str, Any]:
    u = await _user(db, uid)
    a = u.get("auto_apply") or {}
    v2 = site["auto_apply_v2"]
    day = engine.today()
    auto, suggest = (int(v2["auto_min"]), int(v2["suggest_min"]))
    counts = {}
    for k, states in (
        ("waiting", ["needs_answer"]),
        ("approvals", ["waiting_approval"]),
        ("suggested", ["suggested"]),
        ("ready", ["ready"]),
    ):
        counts[k] = await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": {"$in": states}})
    return {
        "rules": rules.rules_of(a, site),
        "consent": {"text": CONSENT_TEXT, "at": ms(a.get("v2_consent_at"))},
        "on": bool(a.get("v2_consent_at") and a.get("on")),
        "pausedAt": ms(a.get("paused_at")),
        "siteOn": bool(site["auto_apply"]["on"]),
        "thresholds": {"auto": auto, "suggest": suggest},
        "limits": {"dailyLimit": int(v2["daily_limit"]), "maxDailyLimit": int(v2["max_daily_limit"])},
        "today": {"used": await engine.used_today(db, uid, day), "limit": rules.limit_of(a, site)},
        "counts": counts,
        "gate": await gate(db, uid, site),
        "learning": learning.explain(await learning.penalties(db, uid)),
        "public": bool(v2.get("public")),
        "morning": (await onetap.listing(db, uid))["morning"],  # A6: today's "N jobs ready" (in-app)
    }


@router.get("")
async def status(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site = await _allowed(db, auth.user.id)
    return await _status(db, auth.user.id, site)


@router.get("/rules")
async def get_rules(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site = await _allowed(db, auth.user.id)
    return rules.rules_of((await _user(db, auth.user.id)).get("auto_apply") or {}, site)


@router.put("/rules")
async def put_rules(body: rules.RulesIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await _allowed(db, uid)
    mx = int(site["auto_apply_v2"]["max_daily_limit"])
    if body.daily_limit > mx:
        raise ApiError(400, "daily_limit", f"The daily limit can be at most {mx}.")
    if not body.roles:
        raise ApiError(400, "roles", "Add at least one role, like “Data analyst” or “Java developer”.")
    sets = {f"auto_apply.{k}": v for k, v in body.model_dump().items()}
    sets["auto_apply.updated_at"] = now()
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    await audit(
        db, uid, "auto_apply.v2_rules", data={"roles": body.roles, "mode": body.mode, "daily_limit": body.daily_limit}
    )
    return await _status(db, uid, site)


@router.post("/consent")
async def consent(body: AgreeIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await _allowed(db, uid)
    if not body.agree:
        raise ApiError(400, "consent", "Tick the box so Nm7 may apply for you.")
    a = (await _user(db, uid)).get("auto_apply") or {}
    if not a.get("roles"):
        raise ApiError(400, "roles", "Save your rules first.")
    g = await gate(db, uid, site)
    if not g["ok"]:
        raise ApiError(
            409,
            "gate",
            f"Your resume scores {g['score'] or 0} in the ATS check; Auto Apply needs "
            f"{g['need']}. Fix the items listed first.",
            extra={"gate": g},
        )
    t = now()
    sets = {
        "auto_apply.v2_consent_at": t,
        "auto_apply.v2_consent_text": CONSENT_TEXT,
        "auto_apply.on": True,
        "auto_apply.paused_at": None,
    }
    if not a.get("consent_at"):
        sets |= {"auto_apply.consent_at": t, "auto_apply.started_at": t}
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    await audit(db, uid, "auto_apply.v2_consent", data={"text": CONSENT_TEXT})
    return await _status(db, uid, site)


@router.post("/pause")
async def pause(body: PauseIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await _allowed(db, uid)
    a = (await _user(db, uid)).get("auto_apply") or {}
    if not a.get("v2_consent_at"):
        raise ApiError(409, "not_set_up", "Turn on Auto Apply 2.0 first.")
    t = now()
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"auto_apply.on": not body.paused, "auto_apply.paused_at": t if body.paused else None}}
    )
    await audit(db, uid, "auto_apply.v2_pause" if body.paused else "auto_apply.v2_resume")
    return await _status(db, uid, site)


@router.post("/stop")
async def stop(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Withdraw consent: Auto Apply stops; everything not yet sent is withdrawn (nothing is deleted)."""
    uid = auth.user.id
    site = await _allowed(db, uid)
    t = now()
    await db[USERS].update_one(
        {"_id": uid},
        {
            "$set": {
                "auto_apply.on": False,
                "auto_apply.v2_consent_at": None,
                "auto_apply.paused_at": t,
                "auto_apply.v2_stopped_at": t,
            }
        },
    )
    n = (
        await db[AUTO_ITEMS].update_many(
            {
                "user_id": uid,
                "state": {
                    "$in": ["needs_answer", "waiting_approval", "queued", "suggested", "applying", "form_queued"]
                },
            },
            {"$set": {"state": "withdrawn", "updated_at": t}, "$unset": {"counted_day": ""}},
        )
    ).modified_count
    await audit(db, uid, "auto_apply.v2_stop", data={"withdrawn": n})
    return await _status(db, uid, site)


@router.get("/tracker")
async def tracker(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    return await v2engine.tracker(db, auth.user.id)


@router.post("/tracker/seen")
async def tracker_seen(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """The tracker's "Updates" (companies' moves on Nm7) were read."""
    from app.autoapply import sync

    await _allowed(db, auth.user.id)
    return {"seen": await sync.mark_seen(db, auth.user.id)}


async def _rows(db, uid: str, state: str) -> list[dict[str, Any]]:
    items = (
        await db[AUTO_ITEMS]
        .find({"user_id": uid, "state": state})
        .sort([("score", -1), ("updated_at", -1)])
        .to_list(100)
    )
    return [v2engine.row(i, None) for i in items]


@router.get("/suggested")
async def suggested(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    await _allowed(db, auth.user.id)
    return await _rows(db, auth.user.id, "suggested")


async def _context(db, uid: str, iid: str, states: tuple[str, ...]):
    site = await _allowed(db, uid)
    if not site["auto_apply"]["on"]:
        raise ApiError(409, "site_off", "Auto Apply is paused for everyone right now. Nothing is being sent.")
    u = await _user(db, uid)
    a = u.get("auto_apply") or {}
    if a.get("admin_paused"):
        raise ApiError(409, "admin_paused", "Auto Apply is paused on your account. Write to us from Help.")
    if not a.get("v2_consent_at"):
        raise ApiError(409, "not_set_up", "Turn on Auto Apply 2.0 first.")
    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": uid})
    if not it or it["state"] not in states:
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    j = await db[JOBS].find_one({"_id": it["job_id"]})
    if not j or j.get("status") != "active":
        await db[AUTO_ITEMS].update_one({"_id": iid}, {"$set": {"state": "expired", "updated_at": now()}})
        raise ApiError(409, "closed", "This job has closed.")
    return site, u, it, j


async def _go(db, site, u, it, j, answers: dict[str, Any]) -> str:
    """Send now within today's limit (the candidate asked for it), else queue it for the next run."""
    day = engine.today()
    if await v2engine.left_today(db, u, site, day) <= 0:
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]}, {"$set": {"state": "queued", "answers": answers, "approved": True, "updated_at": now()}}
        )
        return "queued"
    it = {**it, "answers": answers, "counted_day": day}
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"answers": answers, "counted_day": day}})
    return await v2engine.prepare(db, u, it, j, site, day, approved=True)


@router.post("/suggested/{iid}/apply")
async def apply_suggested(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site, u, it, j = await _context(db, auth.user.id, iid, ("suggested",))
    no_form = None
    if j["apply"]["method"] == "link":  # A5: a simple form on the company's own site goes like any other
        from app.autoapply.forms import service as forms

        no_form = await forms.route(db, u, j, site)
        if not no_form:
            await db[AUTO_ITEMS].update_one({"_id": iid}, {"$set": {"channel_v2": "form"}})
            it = {**it, "channel_v2": "form"}
    if j["apply"]["method"] == "link" and no_form:
        r = await engine.resume_for(db, u["_id"])
        copy = await tailoring.build(db, u["_id"], r, j, u.get("auto_apply") or {}) if r else None
        await db[AUTO_ITEMS].update_one(
            {"_id": iid},
            {"$set": {"state": "ready", "copy_id": (copy or {}).get("_id"), "reason": no_form, "updated_at": now()}},
        )
        return {"state": "ready"}
    answers, missing = await engine.saved_answers(u, j)
    if missing:
        await db[AUTO_ITEMS].update_one(
            {"_id": iid},
            {
                "$set": {
                    "state": "needs_answer",
                    "kind": "questions",
                    "missing": [q["id"] for q in missing],
                    "updated_at": now(),
                }
            },
        )
        return {"state": "needs_answer"}
    state = await _go(db, site, u, it, j, answers)
    await audit(db, u["_id"], "auto_apply.v2_suggested_apply", target=j["_id"], data={"state": state})
    return {"state": state}


@router.post("/suggested/{iid}/dismiss")
async def dismiss(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    r = await db[AUTO_ITEMS].update_one(
        {"_id": iid, "user_id": auth.user.id, "state": "suggested"},
        {"$set": {"state": "skipped", "reason": "candidate", "updated_at": now()}},
    )
    if not r.modified_count:
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    return {"state": "skipped"}


@router.get("/waiting")
async def waiting(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    from app.companies.questions import public

    uid = auth.user.id
    await _allowed(db, uid)
    u = await _user(db, uid)
    out = []
    async for it in db[AUTO_ITEMS].find({"user_id": uid, "state": "needs_answer"}).sort("updated_at", -1):
        if it.get("kind") == "form":  # A5: questions the company's own form asks
            from app.autoapply.forms import service as forms

            out.append({**v2engine.row(it, None), "questions": forms.open_questions(it, u)})
            continue
        j = await db[JOBS].find_one({"_id": it["job_id"]}, {"questions": 1})
        missing = {q["id"] for q in (await engine.saved_answers(u, j))[1]} if j else set(it.get("missing") or [])
        out.append(
            {
                **v2engine.row(it, None),
                "questions": [q for q in public((j or {}).get("questions")) if q["id"] in missing],
            }
        )
    return out


@router.post("/waiting/{iid}/answer")
async def answer(iid: str, body: AnswerIn, auth: CustomerAuth, db: DB, background: BackgroundTasks) -> dict[str, Any]:
    """The answers are saved to the profile (never asked again), then this application is sent at once."""
    from app.companies import questions as qmod

    site, u, it, j = await _context(db, auth.user.id, iid, ("needs_answer",))
    if it.get("kind") == "form":
        return await _answer_form(db, site, u, it, j, body, background)
    qs = j.get("questions") or []
    saved, missing = await engine.saved_answers(u, j)
    given, problems = qmod.answers_for(missing, body.answers)
    if problems:
        raise ApiError(400, "answers", " ".join(problems), extra={"problems": problems})
    if given:
        texts = {q["id"]: q["text"] for q in qs}
        await db[USERS].update_one(
            {"_id": u["_id"]}, {"$set": {f"auto_apply.answers.{engine.norm(texts[k])}": v for k, v in given.items()}}
        )
        u = await _user(db, u["_id"])
    answers = {**saved, **given}
    if qmod.knockout(qs, answers):
        await db[AUTO_ITEMS].update_one(
            {"_id": iid}, {"$set": {"state": "skipped", "reason": "not_a_fit", "updated_at": now()}}
        )
        await audit(db, u["_id"], "auto_apply.v2_answer", target=j["_id"], data={"state": "skipped"})
        return {"state": "skipped", "reason": "not_a_fit", "saved": len(given)}
    state = await _go(db, site, u, it, j, answers)
    await audit(db, u["_id"], "auto_apply.v2_answer", target=j["_id"], data={"state": state, "saved": len(given)})
    return {"state": state, "saved": len(given)}


async def _answer_form(db, site, u, it, j, body: AnswerIn, background: BackgroundTasks) -> dict[str, Any]:
    """A5: answers to the company form's questions, saved to the profile like any other; then the form goes back to
    the background pass (within today's limit), which fills it again with the answers."""
    from app.autoapply.forms import service as forms

    qs = forms.open_questions(it, u)
    given, problems = forms.clean_answers(qs, body.answers)
    if problems:
        raise ApiError(400, "answers", " ".join(problems), extra={"problems": problems})
    texts = {q["id"]: q["text"] for q in qs}
    if given:
        await db[USERS].update_one(
            {"_id": u["_id"]}, {"$set": {f"auto_apply.answers.{engine.norm(texts[k])}": v for k, v in given.items()}}
        )
    left = await v2engine.left_today(db, u, site, engine.today())
    state = await forms.answered(db, u, it, site, left)
    if state == "form_queued":
        background.add_task(forms.kick, db)
    await audit(db, u["_id"], "auto_apply.v2_answer", target=j["_id"], data={"state": state, "saved": len(given)})
    return {"state": state, "saved": len(given)}


@router.get("/approvals")
async def approvals(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    await _allowed(db, uid)
    a = (await _user(db, uid)).get("auto_apply") or {}
    items = (
        await db[AUTO_ITEMS]
        .find({"user_id": uid, "state": "waiting_approval"})
        .sort([("score", -1), ("updated_at", -1)])
        .to_list(100)
    )
    copies = {c["_id"]: c async for c in db[AUTO_COPIES].find({"_id": {"$in": [i.get("copy_id") for i in items]}})}
    rows = [{**v2engine.row(i, None), "version": tailoring.public(copies.get(i.get("copy_id")))} for i in items]
    return {"mode": rules.mode_of(a), "items": rows}


async def _approve_one(db, uid: str, iid: str) -> str:
    site, u, it, j = await _context(db, uid, iid, ("waiting_approval",))  # counted in the limit when prepared
    return await v2engine.send(db, u, it, j, site)


@router.post("/approve-all")
async def approve_all(auth: CustomerAuth, db: DB, background: BackgroundTasks) -> dict[str, Any]:
    uid = auth.user.id
    await _allowed(db, uid)
    n = 0
    async for it in db[AUTO_ITEMS].find({"user_id": uid, "state": "waiting_approval"}, {"_id": 1}):
        try:
            n += (await _approve_one(db, uid, it["_id"])) in ("applied", "sent")
        except ApiError as e:
            if e.code in ("site_off", "admin_paused", "not_set_up"):
                raise
    await audit(db, uid, "auto_apply.v2_approve_all", data={"applied": n})
    background.add_task(_partner_kick, db)
    return {"applied": n}


@router.post("/approve/{iid}")
async def approve(iid: str, auth: CustomerAuth, db: DB, background: BackgroundTasks) -> dict[str, Any]:
    state = await _approve_one(db, auth.user.id, iid)
    await audit(db, auth.user.id, "auto_apply.v2_approve", target=iid, data={"state": state})
    background.add_task(_partner_kick, db)
    return {"state": state}


async def _partner_kick(db) -> None:
    """A4: an approved application to a job linked to the company's hiring system goes out now, after the answer.
    A5: an approved company-form application is tried now too."""
    from app.autoapply.ats import service as ats
    from app.autoapply.forms import service as forms

    await ats.kick(db)
    await forms.kick(db)


@router.post("/approvals/{iid}/skip")
async def skip(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    r = await db[AUTO_ITEMS].update_one(
        {"_id": iid, "user_id": auth.user.id, "state": {"$in": ["waiting_approval", "queued", "ready"]}},
        {"$set": {"state": "skipped", "reason": "candidate", "updated_at": now()}, "$unset": {"counted_day": ""}},
    )
    if not r.modified_count:
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    return {"state": "skipped"}


@router.get("/sent/{iid}")
async def sent(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await _allowed(db, auth.user.id)
    out = await v2engine.what_was_sent(db, auth.user.id, iid)
    if not out:
        raise ApiError(404, "not_found", "Not found.")
    return out


@router.post("/tracker/{iid}/status")
async def set_status(iid: str, body: StatusIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """A reply that reached the candidate outside Nm7 (an email channel or a company website). A rejection counts in
    learning (app/autoapply/learning.py) like one marked by a company on Nm7."""
    from app.jobs.apply import status_change

    uid = auth.user.id
    await _allowed(db, uid)
    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": uid})
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": (it or {}).get("job_id")}) if it else None
    if not app:
        raise ApiError(404, "not_found", "No application for this job yet.")
    if app.get("company_id") and app.get("channel") == "nm7":
        raise ApiError(409, "company", "The company updates this one on Nm7.")
    upd = status_change(app, body.status)
    if upd:
        await db[APPLICATIONS].update_one({"_id": app["_id"]}, upd)
    await audit(db, uid, "auto_apply.v2_status", target=it["job_id"], data={"status": body.status})
    return {"stage": v2engine.stage_of(it, {**app, "status": body.status})[0]}


# ---------- A3: the email channel ----------


async def _email_status(db, uid: str, site: dict[str, Any]) -> dict[str, Any]:
    from app.autoapply import emailing
    from app.core.db import AUTO_MAIL

    u = await _user(db, uid)
    a = u.get("auto_apply") or {}
    off = emailing.channel_off()
    paused = a.get("email_paused_at")
    return {
        "channel": {"on": not off, "reason": emailing.REASONS.get(off or "", "") if off else ""},
        "address": await emailing.apply_address(db, u),
        "emailOn": a.get("email_on") is not False,
        "followUp": bool(a.get("email_follow_up")),
        "paused": {"at": ms(paused), "reason": a.get("email_paused_reason") or ""} if paused else None,
        "profileLink": await emailing.profile_link(db, uid),
        "sentToday": await db[AUTO_MAIL].count_documents({"user_id": uid, "day": engine.today()}),
        "perDay": emailing.PER_CANDIDATE_DAY,
        "testMode": not site["auto_apply_v2"].get("public"),
        "demo": bool(u.get("demo")),
    }


@router.get("/email")
async def email_status(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site = await _allowed(db, auth.user.id)
    return await _email_status(db, auth.user.id, site)


@router.put("/email")
async def email_settings(body: EmailIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    site = await _allowed(db, uid)
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"auto_apply.email_on": body.email_on, "auto_apply.email_follow_up": body.follow_up}}
    )
    await audit(db, uid, "auto_apply.v2_email", data={"on": body.email_on, "follow_up": body.follow_up})
    return await _email_status(db, uid, site)


@router.get("/replies")
async def replies(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    await _allowed(db, auth.user.id)
    return await v2engine.replies_of(db, auth.user.id)


# ---------- Admin ----------


class AdminIn(CamelModel):
    public: bool
    testers: list[str] = Field(default_factory=list, max_length=200)
    auto_min: int = Field(ge=50, le=100)
    suggest_min: int = Field(ge=30, le=100)
    daily_limit: int = Field(ge=1, le=50)
    max_daily_limit: int = Field(ge=1, le=50)
    free_per_week: int = Field(0, ge=0, le=500)
    paid_limit: int = Field(0, ge=0, le=1000)
    payments_on: bool = False
    test_inbox: str = Field("", max_length=200)  # A3: while OFF, 2.0 emails go here (else the tester's own inbox)

    @field_validator("test_inbox")
    @classmethod
    def _inbox(cls, v: str) -> str:
        v = str(v or "").strip().lower()
        if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("The test inbox must be an email address.")
        return v

    @field_validator("testers")
    @classmethod
    def _testers(cls, v: list[str]) -> list[str]:
        out = []
        for e in v:
            e = str(e).strip().lower()
            if e and "@" in e and e not in out:
                out.append(e[:200])
        return out


KEYS = (
    "public",
    "testers",
    "auto_min",
    "suggest_min",
    "daily_limit",
    "max_daily_limit",
    "free_per_week",
    "paid_limit",
    "payments_on",
    "test_inbox",
)


def _camel(k: str) -> str:
    return "".join(w.capitalize() if i else w for i, w in enumerate(k.split("_")))


def _admin_out(v2: dict[str, Any]) -> dict[str, Any]:
    return {_camel(k): v2.get(k) for k in KEYS}


@admin.get("")
async def admin_overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    site = await get_site(db)
    opted = {"auto_apply.v2_consent_at": {"$ne": None}}
    by_state: dict[str, int] = {}
    async for r in await db[AUTO_ITEMS].aggregate(
        [{"$match": {"v2": True}}, {"$group": {"_id": "$state", "n": {"$sum": 1}}}]
    ):
        by_state[r["_id"]] = r["n"]
    versions: dict[str, int] = {}
    async for r in await db[AUTO_COPIES].aggregate(
        [{"$match": {"v2": True}}, {"$group": {"_id": "$source", "n": {"$sum": 1}}}]
    ):
        versions[r["_id"] or "rules"] = r["n"]
    modes = {
        m: await db[USERS].count_documents(
            {"auto_apply.v2_consent_at": {"$ne": None}, "auto_apply.mode": m if m != "approve" else {"$in": [m, None]}}
        )
        for m in rules.MODES
    }
    return {
        "settings": _admin_out(site["auto_apply_v2"]),
        "stats": {
            "optedIn": await db[USERS].count_documents(opted),
            "paused": await db[USERS].count_documents({**opted, "auto_apply.on": False}),
            "modes": modes,
            "items": by_state,
            "versions": versions,
            "blocked": await db[AUTO_COPIES].count_documents({"v2": True, "truth.blocked": True}),
            "applied": await db[APPLICATIONS].count_documents({"v2": True}),
        },
    }


@admin.put("/settings")
async def admin_settings(body: AdminIn, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    if body.suggest_min > body.auto_min:
        raise ApiError(400, "suggest_min", "“Suggested” must start below the auto-apply score.")
    if body.daily_limit > body.max_daily_limit:
        raise ApiError(400, "daily_limit", "The default daily limit can't be above the maximum.")
    before = (await get_site(db))["auto_apply_v2"]
    new = body.model_dump()
    diff = {k: [before.get(k), v] for k, v in new.items() if before.get(k) != v}
    await save_site(db, {"auto_apply_v2": {**before, **new}})
    if diff:
        await audit(db, auth.user.id, "auto_apply.v2_admin_settings", data=diff, ip=client_ip(request))
    return _admin_out({**before, **new})


@admin.get("/email")
async def admin_email(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    """Email channel health: sent today, bounce and complaint rates (last 30 days), blocks and opt-outs, candidates
    whose channel is paused after a complaint, and whether the server has what the channel needs."""
    from app.autoapply import emailing
    from app.core.config import get_settings
    from app.core.db import AUTO_MAIL, AUTO_REPLIES, EMAIL_BLOCKS

    site = await get_site(db)
    off = emailing.channel_off()
    since = now() - timedelta(days=30)
    sent30 = await db[AUTO_MAIL].count_documents({"at": {"$gte": since}})
    bounced = await db[AUTO_MAIL].count_documents({"at": {"$gte": since}, "bounced_at": {"$ne": None}})
    complained = await db[AUTO_MAIL].count_documents({"at": {"$gte": since}, "complained_at": {"$ne": None}})
    blocks = await db[EMAIL_BLOCKS].find().sort("at", -1).to_list(300)
    paused = (
        await db[USERS]
        .find({"auto_apply.email_paused_at": {"$ne": None}}, {"name": 1, "email": 1, "auto_apply": 1})
        .to_list(100)
    )
    s = get_settings()
    needs = (
        ("RESEND_API_KEY", s.resend_api_key),
        ("RESEND_INBOUND_SECRET", s.resend_inbound_secret),
        ("AUTOAPPLY_EMAIL_DOMAIN", s.autoapply_email_domain),
    )
    return {
        "channel": {
            "on": not off,
            "reason": emailing.REASONS.get(off or "", "") if off else "",
            "domain": s.autoapply_email_domain,
            "missing": [n for n, v in needs if not str(v).strip()],
        },
        "public": bool(site["auto_apply_v2"].get("public")),
        "testInbox": site["auto_apply_v2"].get("test_inbox") or "",
        "limits": {"perCandidateDay": emailing.PER_CANDIDATE_DAY, "perDomainDay": emailing.PER_DOMAIN_DAY},
        "sentToday": await db[AUTO_MAIL].count_documents({"day": engine.today()}),
        "testToday": await db[AUTO_MAIL].count_documents({"day": engine.today(), "test": True}),
        "sent30": sent30,
        "bounces30": bounced,
        "complaints30": complained,
        "bounceRate": round(100 * bounced / sent30, 1) if sent30 else 0,
        "complaintRate": round(100 * complained / sent30, 2) if sent30 else 0,
        "replies30": await db[AUTO_REPLIES].count_documents({"received_at": {"$gte": since}}),
        "blocks": [
            {
                "id": b["_id"],
                "kind": "domain" if b["_id"].startswith("@") else "address",
                "reason": b.get("reason") or "",
                "at": ms(b.get("at")),
            }
            for b in blocks
        ],
        "optOuts": sum(1 for b in blocks if b.get("reason") == "opt_out"),
        "blockedDomains": sum(1 for b in blocks if b["_id"].startswith("@")),
        "paused": [
            {
                "id": u["_id"],
                "name": u.get("name") or "",
                "email": u.get("email") or "",
                "reason": (u.get("auto_apply") or {}).get("email_paused_reason") or "",
                "at": ms((u.get("auto_apply") or {}).get("email_paused_at")),
            }
            for u in paused
        ],
    }


@admin.delete("/email/blocks/{bid:path}")
async def admin_unblock(bid: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    from app.core.db import EMAIL_BLOCKS

    got = await db[EMAIL_BLOCKS].find_one_and_delete({"_id": bid.lower()})
    if not got:
        raise ApiError(404, "not_found", "Not on the list.")
    await audit(
        db, auth.user.id, "auto_apply.v2_unblock", target=bid.lower(), data={"reason": got.get("reason")},
        ip=client_ip(request),
    )  # fmt: skip
    return {"removed": bid.lower()}


@admin.post("/email/paused/{uid}/resume")
async def admin_resume_email(uid: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    r = await db[USERS].update_one(
        {"_id": uid, "auto_apply.email_paused_at": {"$ne": None}},
        {"$set": {"auto_apply.email_paused_at": None, "auto_apply.email_paused_reason": None}},
    )
    if not r.modified_count:
        raise ApiError(404, "not_found", "That candidate's email channel isn't paused.")
    await audit(db, auth.user.id, "auto_apply.v2_email_resume", target=uid, ip=client_ip(request))
    return {"resumed": uid}


@admin.get("/partners")
async def admin_partners(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    """A4: each hiring-system partner's health: connected companies, deliveries today, retries and failures, the last
    error's kind (never a key, never a company's settings) and the last successful status sync."""
    from app.autoapply.ats import service as ats

    site = await get_site(db)
    return {"public": bool(site["auto_apply_v2"].get("public")), "partners": await ats.health(db)}


# ---------- A5: company forms ----------


@admin.get("/forms")
async def admin_forms(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    """Every company site Auto Apply 2.0 has seen for forms: allowed (simple form), one-tap only and why, blocked by
    robots.txt or by its terms, or a job board; when it was last tried, and the successes and failures."""
    from app.autoapply.forms import polite
    from app.autoapply.forms import service as forms

    site = await get_site(db)
    return {
        "public": bool(site["auto_apply_v2"].get("public")),
        "counts": await forms.counts(db),
        "rules": {
            "userAgent": polite.UA,
            "delay": polite.DELAY,
            "requestsPerDay": polite.REQUESTS_PER_DAY,
            "submitsPerDay": polite.SUBMITS_PER_DAY,
        },  # fmt: skip
        "sites": await forms.sites(db),
    }


@admin.post("/forms/sites/{key}/one-tap")
async def admin_form_one_tap(key: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    from app.autoapply.forms import service as forms

    if not await forms.admin_one_tap(db, key.lower(), auth.user.id, client_ip(request)):
        raise ApiError(404, "not_found", "That site isn’t on the list.")
    return {"site": key.lower(), "state": "one_tap"}


@admin.post("/forms/sites/{key}/reset")
async def admin_form_reset(key: str, request: Request, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    from app.autoapply.forms import service as forms

    if not await forms.admin_reset(db, key.lower(), auth.user.id, client_ip(request)):
        raise ApiError(404, "not_found", "That site isn’t on the list.")
    from app.core.db import FORM_SITES

    return {"site": key.lower(), "state": (await db[FORM_SITES].find_one({"_id": key.lower()}))["state"]}
