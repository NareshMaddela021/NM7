# ruff: noqa: E501  (dense response shapes)
"""Profile setup P2: the dashboard checklist (steps in registry.py), worked out on read from the data the site already
has, so existing users see their done steps ticked and are never asked again.

  GET  /api/me/checklist?role=            the active role's checklist (or the role asked for, one I have)
  POST /api/me/checklist/{role}/skip {step, undo?}   "Skip for now" (the next step moves on); undo puts it back
  GET  /api/me/checklist/reminders        {on}
  PUT  /api/me/checklist/reminders {on}   the weekly reminder on / off (Profile & settings → Notifications)
  POST /api/public/setup/stop-reminders {token}   the email's "Stop these emails" link (no sign-in)

Rules:
- one checklist per role; a person with several roles sees the active role's (another with ?role=)
- next step: the first step (in registry order) that is not done, not waiting for review and not skipped, required
  steps before optional ones; when everything left was skipped, the first skipped one comes back
- hidden: steps behind a switch that is off for this person (testers, demo people and an admin's personas see them,
  marked "testers only"); under-18s never get the ID + selfie step; fresher / reviewer steps only for them
- complete: every required step shown is done. From then on the card shrinks to "Profile complete" with the level,
  and comes back only for renewals: a skill badge that expired, or the weekly "Still looking?" of Ready to join
- worked out on read and cached for a short while per person and role (no work at startup)

Reminders (remind() in the automation pass): at most one email a week, only to a verified, unbounced address of a
person who hasn't turned them off, never once the checklist is complete, never in the quiet hours (9 PM–9 AM IST),
never to demo people; while the vetting or trust switch is off only to their testers. Batched and capped per pass.
WhatsApp reminders are not sent yet (they need an approved message template; see the PR).
"""

import logging
import time
from datetime import datetime, timedelta
from html import escape
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import ConfigDict, Field

from app.auth.deps import CurrentAuth
from app.auth.models import User
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    DB,
    EXPERT_PROFILES,
    HIRE_PROFILES,
    JOB_PROFILES,
    MEMBERSHIPS,
    ORDERS,
    PRACTICE_ATTEMPTS,
    SKILL_ATTEMPTS,
    TRUST_DOCUMENTS,
    TRUST_FACE,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_REVIEWERS,
    VETTING_VERIFIED,
)
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.setup import registry as R

log = logging.getLogger("nm7.setup")

router = APIRouter(prefix="/api/me/checklist", tags=["profile setup"])
public = APIRouter(prefix="/api/public/setup", tags=["profile setup"])

CACHE_SECONDS = 30
REMIND_EVERY = timedelta(days=7)
CHECK_EVERY = timedelta(days=1)  # a person the pass looked at (and didn't email) is looked at again a day later
NEW_FOR = timedelta(days=2)  # nobody is reminded in their first two days
QUIET = (21, 9)  # IST hours: no reminder from 9 PM to 9 AM
PER_PASS = 100  # people looked at per pass (each pass also sends at most this many emails)
READY_DAYS = 7  # "Still looking?": Ready to join not confirmed for this long

_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def forget(uid: str) -> None:
    """Drop the cached checklists of one person (after they change something here or in the quick start)."""
    for k in [k for k in _cache if k[0] == uid]:
        _cache.pop(k, None)


# ---------- switches ----------


async def switches(db, uid: str) -> dict[str, dict[str, bool]]:
    """{switch: {on: for this person, public: for everyone}}."""
    from app.hire.vetting import access as vetting
    from app.site import get_site
    from app.trust import access as trust
    from app.wapay.settings import payments_on

    site = await get_site(db)
    pay = await payments_on(db)
    return {
        "vetting": {"on": await vetting.for_user(db, uid), "public": bool(site["vetting"].get("public"))},
        "trust": {"on": await trust.for_user(db, uid), "public": bool(site["trust"].get("public"))},
        "hire": {"on": bool(site["hire"]["on"]), "public": bool(site["hire"]["on"])},
        "payments": {"on": pay, "public": pay},
    }


# ---------- facts (only what the role's steps read) ----------


async def facts(
    db, u: dict[str, Any], role: str, sw: dict[str, dict[str, bool]], t: datetime | None = None
) -> dict[str, Any]:
    t = t or now()
    uid = u["_id"]
    f: dict[str, Any] = {}
    setup = (u.get("setup") or {}).get(role) or {}
    answers = setup.get("answers") or {}
    vetting_on, trust_on = sw["vetting"]["on"], sw["trust"]["on"]
    if trust_on:
        from app.trust import age

        f["minor"] = (await age.state(db, uid))["minor"]
        face = await db[TRUST_FACE].find_one({"_id": uid}, {"status": 1, "review": 1}) or {}
        f["face"] = (
            "review"
            if (face.get("review") or {}).get("status") == "open" or face.get("status") == "review"
            else face.get("status")
        )
        from app.trust.digilocker.service import badge_ok

        docs = (
            await db[TRUST_DOCUMENTS].find({"user_id": uid}, {"review": 1, "verify_until": 1, "fields": 1}).to_list(10)
        )
        f["docs_ok"] = any(badge_ok(d, t) for d in docs)
        f["docs_review"] = any((d.get("review") or {}).get("status") == "open" for d in docs)
    if role in ("jobseeker", "student"):
        from app.hire.vetting.ladder import resume_score

        f["resume"] = await resume_score(db, uid)
        f["practice"] = await db[PRACTICE_ATTEMPTS].count_documents(
            {"user_id": uid, "finished_at": {"$ne": None}}, limit=1
        )
        if vetting_on:
            rows = await db[VETTING_VERIFIED].find({"user_id": uid}, {"test": 1, "expires_at": 1}).to_list(60)
            f["badges"] = [b["test"] for b in rows if b.get("expires_at") and b["expires_at"] > t]
            f["expired_badges"] = sorted(
                {b["test"] for b in rows if b.get("expires_at") and b["expires_at"] <= t} - set(f["badges"])
            )
            f["skill_waiting"] = bool(
                await db[SKILL_ATTEMPTS].count_documents(
                    {"user_id": uid, "task.status": {"$in": ["grading", "review"]}}, limit=1
                )
            )
    if role == "jobseeker":
        f["hire"] = await db[HIRE_PROFILES].find_one({"_id": uid}) or {}
        f["auto_apply"] = bool((u.get("auto_apply") or {}).get("on"))
        f["fresher"] = answers.get("experience") == "fresher" or str(u.get("level") or "").lower().startswith("fresher")
        if vetting_on:
            until = u.get("vetting_l3_until")
            f["l3"] = bool(until and until > t)
            f["interview_waiting"] = bool(
                await db[VETTING_INTERVIEWS].count_documents(
                    {"user_id": uid, "status": {"$in": ["answered", "review"]}}, limit=1
                )
            )
        if f["fresher"]:
            jp = ((await db[JOB_PROFILES].find_one({"_id": uid}, {"data.edu": 1})) or {}).get("data") or {}
            e = (
                next((x for x in jp.get("edu") or [] if (x or {}).get("institution") or (x or {}).get("degree")), None)
                or {}
            )
            year = str(e.get("to") or "")[:4]
            f["edu"] = {
                "institution": e.get("institution"),
                "degree": e.get("degree"),
                "year": year.isdigit() or bool(e.get("current")),
            }
    if role == "student":
        jp = ((await db[JOB_PROFILES].find_one({"_id": uid}, {"data.skillGroups": 1})) or {}).get("data") or {}
        f["skills"] = any(
            str((g or {}).get("value") or "").strip() for g in jp.get("skillGroups") or [] if not (g or {}).get("off")
        )
        f["group"] = bool(await db[MEMBERSHIPS].count_documents({"user_id": uid, "left_at": None}, limit=1))
        f["applications"] = await db[APPLICATIONS].count_documents({"user_id": uid}, limit=1)
        f["launch"] = bool(
            await db[ORDERS].count_documents({"customer_id": uid, "plan": "launch", "paid_at": {"$ne": None}}, limit=1)
        )
    if role == "expert":
        doc = (
            await db[EXPERT_PROFILES].find_one(
                {"_id": uid},
                {"profile.about": 1, "profile.photo": 1, "profile.services": 1, "status": 1, "payout_enc": 1},
            )
            or {}
        )
        prof = doc.get("profile") or {}
        f["expert"] = {
            "about": prof.get("about") or {},
            "photo": bool(prof.get("photo")),
            "services": prof.get("services") or {},
        }
        f["expert_status"] = doc.get("status") or u.get("expert_status") or "draft"
        if sw["payments"]["on"]:
            from app.experts.service import PAN_RE, open_payout

            try:
                p = open_payout(doc.get("payout_enc"))
            except Exception:  # unreadable sealed payout: treated as not filled in, never an error page
                p = {}
            where = (
                p.get("reuseAi")
                or (p.get("method") == "upi" and p.get("upi"))
                or (p.get("method") == "bank" and p.get("account") and p.get("ifsc"))
            )
            f["payout_ok"] = bool(where and PAN_RE.match(str(p.get("pan", "")).upper()))
        rv = await db[VETTING_REVIEWERS].find_one({"_id": uid}, {"slots": 1, "calibration": 1}) if vetting_on else None
        f["reviewer"] = vetting_on and (bool(rv) or "l4_reviewer" in (answers.get("services") or []))
        f["reviewer_slots"] = bool((rv or {}).get("slots"))
        f["calibrated"] = bool(((rv or {}).get("calibration") or {}).get("passed"))
    return f


# ---------- the engine (pure: tested step by step) ----------


def visible_steps(role: str, f: dict[str, Any], sw: dict[str, dict[str, bool]]) -> list[tuple[R.Step, bool]]:
    """The steps this person sees, in order, each with "testers only" (its switch is on for them but not for all)."""
    out = []
    for s in R.STEPS.get(role, ()):
        if s.switch and not sw.get(s.switch, {}).get("on"):
            continue
        if s.adult_only and f.get("minor"):
            continue
        if s.only == "fresher" and not f.get("fresher"):
            continue
        if s.only == "reviewer" and not f.get("reviewer"):
            continue
        out.append((s, bool(s.switch) and not sw[s.switch].get("public")))
    return out


def pick_next(rows: list[dict[str, Any]]) -> str | None:
    """The single most valuable next step: required before optional, registry order, skipped ones last."""
    open_ = [r for r in rows if r["state"] == "todo"]
    for pool in ([r for r in open_ if not r["skipped"] and r["required"]], [r for r in open_ if not r["skipped"]],
                 [r for r in open_ if r["required"]], open_):  # fmt: skip
        if pool:
            return pool[0]["id"]
    return None


def renewals(role: str, f: dict[str, Any], sw: dict[str, dict[str, bool]], t: datetime) -> list[dict[str, Any]]:
    out = []
    if role in ("jobseeker", "student") and sw["vetting"]["on"] and f.get("expired_badges"):
        names = ", ".join(f["expired_badges"][:3])
        out.append(
            {
                "id": "badge",
                "title": f"Renew your skill badge ({names})",
                "reward": "Companies hiring now see a current badge only.",
                "minutes": 30,
                "link": "/me/skill-checks",
            }
        )
    hp = f.get("hire") or {}
    confirmed = hp.get("confirmed_at")
    if (
        role == "jobseeker"
        and sw["hire"]["on"]
        and hp.get("on")
        and not hp.get("paused_at")
        and confirmed
        and confirmed.replace(tzinfo=confirmed.tzinfo or IST) < t - timedelta(days=READY_DAYS)
    ):
        out.append(
            {
                "id": "still_looking",
                "title": "Still looking? Tap to confirm",
                "reward": "Companies hiring now see people who confirmed this week first.",
                "minutes": 1,
                "link": "/me/hire",
            }
        )
    return out


def build(
    role: str, f: dict[str, Any], sw: dict[str, dict[str, bool]], saved: dict[str, Any], t: datetime | None = None
) -> dict[str, Any]:
    """The checklist from the facts, the switches and what the person saved (skips, when it was first complete)."""
    t = t or now()
    skipped = set(saved.get("check_skipped") or [])
    rows = []
    for s, testers in visible_steps(role, f, sw):
        state = s.detect(f)
        rows.append({"id": s.id, "title": s.title, "reward": s.reward, "minutes": s.minutes, "link": s.link, "required": s.required,
                     "state": state, "skipped": state == "todo" and s.id in skipped, "testersOnly": testers})  # fmt: skip
    req_left = any(r["required"] and r["state"] != "done" for r in rows)
    nxt = pick_next(rows) if req_left or not rows else None  # complete: no "next step" (optional ones stay listed)
    for r in rows:
        r["status"] = (
            "done"
            if r["state"] == "done"
            else "waiting"
            if r["state"] == "waiting"
            else "next"
            if r["id"] == nxt
            else "later"
        )
        del r["state"]
    req = [r for r in rows if r["required"]]
    done = sum(r["status"] == "done" for r in req)
    complete = bool(req) and done == len(req)
    was = bool(saved.get("check_done_at"))
    return {
        "role": role,
        "steps": rows,
        "next": nxt,
        "done": done,
        "total": len(req),
        "percent": round(100 * done / len(req)) if req else 100,
        "complete": complete or was,  # once complete, the card stays small; it comes back only for renewals
        "renewals": renewals(role, f, sw, t) if complete or was else [],
        "firstComplete": complete and not was,
    }


# ---------- one person's checklist ----------


def _level(u: dict[str, Any], sw: dict[str, dict[str, bool]], role: str) -> dict[str, Any] | None:
    from app.hire.vetting.levels import LEVELS

    v = u.get("vetting") or {}
    if role == "expert" or not sw["vetting"]["on"] or v.get("level") is None:
        return None
    return {"level": int(v["level"]), "label": LEVELS.get(int(v["level"]), "")}


async def checklist(db, u: dict[str, Any], role: str, *, fresh: bool = False) -> dict[str, Any]:
    key = (u["_id"], role)
    hit = _cache.get(key)
    if hit and not fresh and hit[0] > time.monotonic():
        return hit[1]
    sw = await switches(db, u["_id"])
    f = await facts(db, u, role, sw)
    saved = (u.get("setup") or {}).get(role) or {}
    out = build(role, f, sw, saved)
    if out.pop("firstComplete"):
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {f"setup.{role}.check_done_at": now()}})
    out["level"] = _level(u, sw, role)
    out["reminders"] = not u.get("setup_reminders_off")
    _cache[key] = (time.monotonic() + CACHE_SECONDS, out)
    return out


# ---------- the person's endpoints ----------


def _individual(auth) -> list[str]:
    if auth.user.role == "admin" or auth.session.kiosk_id or auth.session.demo_org_id:
        raise ApiError(403, "not_individual", "The checklist is for personal accounts.")
    return auth.user.individual_roles


def _role(auth, role: str | None) -> str:
    mine = _individual(auth)
    role = role or auth.user.current_role
    if role not in R.ROLES or role not in mine:
        raise ApiError(404, "no_such_role", "You don’t have this role.")
    return role


class SkipIn(CamelModel):
    model_config = ConfigDict(extra="forbid")
    step: str = Field(max_length=30)
    undo: bool = False


class RemindIn(CamelModel):
    on: bool


@router.get("/reminders")
async def get_reminders(auth: CurrentAuth, db: DB) -> dict[str, bool]:
    _individual(auth)
    u = await db[USERS].find_one({"_id": auth.user.id}, {"setup_reminders_off": 1}) or {}
    return {"on": not u.get("setup_reminders_off")}


@router.put("/reminders")
async def put_reminders(body: RemindIn, auth: CurrentAuth, db: DB) -> dict[str, bool]:
    _individual(auth)
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"setup_reminders_off": not body.on}})
    forget(auth.user.id)
    return {"on": body.on}


@router.get("")
async def get_checklist(auth: CurrentAuth, db: DB, role: str | None = Query(None, max_length=20)) -> dict[str, Any]:
    role = _role(auth, role)
    u = await db[USERS].find_one({"_id": auth.user.id}) or {}
    return {**await checklist(db, u, role), "roles": auth.user.individual_roles, "active": auth.user.current_role}


@router.post("/{role}/skip")
async def skip(role: str, body: SkipIn, auth: CurrentAuth, db: DB) -> dict[str, Any]:
    role = _role(auth, role)
    if body.step not in R.step_ids(role):
        raise ApiError(400, "no_such_step", "No such step.")
    op = (
        {"$pull": {f"setup.{role}.check_skipped": body.step}}
        if body.undo
        else {"$addToSet": {f"setup.{role}.check_skipped": body.step}}
    )
    await db[USERS].update_one({"_id": auth.user.id}, op)
    forget(auth.user.id)
    u = await db[USERS].find_one({"_id": auth.user.id}) or {}
    return {
        **await checklist(db, u, role, fresh=True),
        "roles": auth.user.individual_roles,
        "active": auth.user.current_role,
    }


# ---------- weekly reminders ----------


def unsub_token(uid: str) -> str:
    return f"{uid}.{keyed_hash('setup-unsub', uid)[:32]}"


def unsub_user(token: str) -> str | None:
    uid, _, sig = (token or "").rpartition(".")
    return uid if uid and sig and same(sig, keyed_hash("setup-unsub", uid)[:32]) else None


class TokenIn(CamelModel):
    token: str = Field(min_length=10, max_length=200)


@public.post("/stop-reminders")
async def stop_reminders(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    from app.auth.sessions import client_ip

    key = f"setup-unsub:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, [(20, timedelta(hours=1))])
    await rate_limit.record(db, key)
    uid = unsub_user(body.token)
    if not uid or not await db[USERS].find_one({"_id": uid}, {"_id": 1}):
        raise ApiError(404, "invalid_link", "This link doesn't work.")
    await db[USERS].update_one({"_id": uid}, {"$set": {"setup_reminders_off": True}})
    forget(uid)
    return {"ok": True}


def quiet(t: datetime) -> bool:
    h = t.astimezone(IST).hour
    return h >= QUIET[0] or h < QUIET[1]


def reminder_email(u: dict[str, Any], c: dict[str, Any]) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    step = next(s for s in c["steps"] if s["id"] == c["next"])
    link = f"{site}{step['link']}"
    stop = f"{site}/stop-alerts#t={unsub_token(u['_id'])}&k=setup"
    left = c["total"] - c["done"]
    lines = [f"Hi {first},", "", f"Your profile is {c['done']} of {c['total']} steps done. Next: {step['title']} (about {step['minutes']} min).",
             step["reward"], "", f"Do it now: {link}", "",
             "You get this at most once a week until your profile is complete. You can turn it off in Profile & settings.", f"Stop these emails: {stop}"]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            f"<p>Your profile is {c['done']} of {c['total']} steps done. Next: <strong>{escape(step['title'])}</strong> (about {step['minutes']} min).</p>"
            f"<p>{escape(step['reward'])}</p>"
            f'<p><a href="{escape(link)}">Do it now</a></p>'
            f'<p style="color:#666;font-size:13px">You get this at most once a week until your profile is complete. '
            f'<a href="{escape(stop)}" style="color:#666">Stop these emails</a></p></div>')  # fmt: skip
    return Email(to=u["email"], to_name=u.get("name", ""), subject=f"{left} step{'s' if left != 1 else ''} left on your Nm7 profile",
                 text="\n".join(lines), html=html)  # fmt: skip


async def _audience(db) -> dict[str, Any] | None:
    """Everyone while the vetting and trust switches are both public; otherwise only their testers (None: nobody)."""
    from app.hire.vetting import access as vetting
    from app.trust import access as trust

    if await vetting.is_public(db) and await trust.is_public(db):
        return {}
    emails = sorted(await vetting.testers(db) | await trust.testers(db))
    return {"email_lc": {"$in": emails}} if emails else None


async def remind(db, mailer: Mailer, limit: int = PER_PASS, t: datetime | None = None) -> int:
    """One pass: people whose checklist may need a reminder, at most `limit` looked at, at most one email a week each."""
    t = t or now()
    if quiet(t):
        return 0
    who = await _audience(db)
    if who is None:
        return 0
    q = {**who, "role": {"$in": ["customer", "expert"]}, "email_verified_at": {"$ne": None}, "email_bounced": {"$ne": True}, "setup_reminders_off": {"$ne": True},
         "deleted_at": None, "disabled_at": None, "demo": {"$ne": True}, "created_at": {"$lt": t - NEW_FOR},
         "$and": [{"$or": [{"setup_reminded_at": None}, {"setup_reminded_at": {"$lt": t - REMIND_EVERY}}]},
                  {"$or": [{"setup_checked_at": None}, {"setup_checked_at": {"$lt": t - CHECK_EVERY}}]}]}  # fmt: skip
    sent = 0
    async for u in db[USERS].find(q).sort("setup_checked_at", 1).limit(limit):
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"setup_checked_at": t}})
        try:
            role = User.model_validate(u).current_role
        except Exception:  # an odd old account: skipped, never a failed pass
            continue
        if role not in R.ROLES:
            continue
        c = await checklist(db, u, role, fresh=True)
        if c["complete"] or not c["next"]:
            continue
        await db[USERS].update_one({"_id": u["_id"]}, {"$set": {"setup_reminded_at": t}})
        if await send_safely(mailer, reminder_email(u, c)):
            sent += 1
    if sent:
        log.info("profile setup reminders: %d email(s) sent", sent)
    return sent
