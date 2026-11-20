# ruff: noqa: E501  (dense response shapes)
"""Profile setup P3: the company's and the college's own checklists, with the P2 engine (registry.py STEPS["company"]
and STEPS["college"]; build(), the next step, Skip for now, hidden steps and the short cache in checklist.py).

Company (header X-Recruiter-Account; every team role sees it, main / full admins skip and set the reminder):
  GET  /api/company/{cid}/checklist?fresh=
  POST /api/company/{cid}/checklist/skip {step, undo?}
  PUT  /api/company/{cid}/checklist/reminders {on}
College (coordinator portal; Owners, coordinators and viewers of that college see it, Owners and coordinators skip):
  GET  /api/org/{org_id}/checklist?fresh=
  POST /api/org/{org_id}/checklist/skip {step, undo?}
  PUT  /api/org/{org_id}/checklist/reminders {on}

Each step is worked out on read from what the company or college already has, so an existing one sees its ticks and
is never asked again. A step needs a permission (`who`): a member without it sees the step with "… can do this" and no
button. Skips, "first complete" and the reminder setting are stored on the company / organization (setup.*); nothing
about a person, no ID numbers and no new kind of personal data.

Hidden steps: "Connect your hiring system" while Auto Apply 2.0 is off for the company (testers and the demo company see
it, marked "Testers only"); a college's drive and recruiter steps while its plan lacks the feature (they are paid plan
features, not tests); the business check for individual recruiters (they have no GST, Udyam or CIN).

Weekly reminder (remind() in the automation pass, the P2 rules): at most one email a week per company / college, to
its main admin / its Owners, never in the quiet hours (9 PM–9 AM IST), never in its first two days, never once complete,
never to a demo company / college, a bounced or blocked address or after "Stop these emails"; while the Vetting Trust
switch is off only to its testers. Capped per pass.
"""

import logging
import time
from datetime import datetime
from html import escape
from typing import Any

from fastapi import APIRouter, Header, Query

from app.companies.model import MANAGE, POST, trust_of
from app.companies.signup import company_for
from app.core.config import get_settings
from app.core.db import (
    ATS_CONNECTIONS,
    AUDIT_LOG,
    COMPANIES,
    DB,
    DRIVES,
    HIRE_SLOTS,
    JOBS,
    MEMBERSHIPS,
    ORG_GROUPS,
    ORG_STAFF,
    ORGANIZATIONS,
    RECRUITER_INVITES,
    RECRUITER_LINKS,
    TRUST_EMPLOYER,
    USERS,
)
from app.core.email import Email, Mailer, send_safely
from app.core.errors import ApiError
from app.core.time import now
from app.orgs.scope import ACTIONS, OrgScope, features_of
from app.setup import checklist as C
from app.setup import registry as R

log = logging.getLogger("nm7.setup")

company = APIRouter(prefix="/api/company", tags=["profile setup"])
college = APIRouter(prefix="/api/org/{org_id}", tags=["profile setup"])

REPORT_ACTIONS = ("placement_report", "placement_export", "export_csv", "offer_export", "drive_export")
ACT_BY = {
    "company": {"manage": "A main or full admin of your team", "post": "A team admin who can post jobs"},
    "college": {"manage": "A coordinator", "groups": "A coordinator with every group", "billing": "Your organization’s Owner",
                "export": "A coordinator"},
}  # fmt: skip
TITLE = {"company": "Set up your company", "college": "Set up your college"}

_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def forget(key: str) -> None:
    for k in [k for k in _cache if k[0] == key]:
        _cache.pop(k, None)


# ---------- facts ----------


async def company_switches(db, c: dict[str, Any], acc: dict[str, Any] | None) -> dict[str, dict[str, bool]]:
    from app.autoapply import access as aa

    return {"autoapply2": {"on": await aa.for_company(db, c, acc), "public": await aa.is_public(db)}}


async def company_facts(db, c: dict[str, Any], acc: dict[str, Any] | None) -> dict[str, Any]:
    from app.trust import access as trust

    cid = c["_id"]
    review = (c.get("review") or {}).get("state") or "draft"
    trust_level = trust_of(c)
    f: dict[str, Any] = {
        "emails_ok": trust_level in ("basic", "verified"),
        "about": bool(str((c.get("details") or {}).get("about") or "").strip()),
        "registered": c.get("kind", "company") != "individual",
        "verified": trust_level == "verified",
        "in_review": review == "pending",
        "team": len(c.get("members") or []),
        "links": {},
    }
    if not f["emails_ok"]:
        f["links"]["basics"] = "/company#overview"  # "Continue sign-up" is on the overview
    trust_on = await trust.for_company(db, c, acc)
    if trust_on:  # Vetting Trust T4: the registry check (GSTIN / Udyam / CIN) also counts
        st = await db[TRUST_EMPLOYER].find_one({"_id": cid}, {"status": 1}) or {}
        f["verified"] = f["verified"] or st.get("status") == "verified"
        f["in_review"] = f["in_review"] or st.get("status") == "review"
    if review in ("draft", "rejected") and not trust_on:
        f["links"]["business"] = "/company#overview"  # sign-up's last step sends it to Nm7's team
    statuses = set(await db[JOBS].distinct("status", {"company_id": cid}))
    f["jobs_live"] = bool(statuses & {"active", "paused", "closed"})
    f["jobs_review"] = "review" in statuses
    f["questions"] = bool(
        await db[JOBS].count_documents({"company_id": cid, "questions.0": {"$exists": True}}, limit=1)
    )
    f["slots"] = bool(await db[HIRE_SLOTS].count_documents({"company_id": cid}, limit=1))
    f["ats"] = bool(await db[ATS_CONNECTIONS].count_documents({"_id": cid}, limit=1))
    return f


async def college_facts(db, o: dict[str, Any]) -> dict[str, Any]:
    oid = o["_id"]
    bd = o.get("billing_details") or {}
    return {
        "id": oid,
        "named": bool(str(o.get("name") or "").strip()),
        "city": bool(str(o.get("city") or "").strip()),
        "billing": bool(bd.get("legal_name") and bd.get("address")),
        "features": features_of(o),
        "groups": await db[ORG_GROUPS].count_documents({"org_id": oid}, limit=1),
        "members": await db[MEMBERSHIPS].count_documents({"org_id": oid, "left_at": None}, limit=1),
        "drives": await db[DRIVES].count_documents({"org_id": oid}, limit=1),
        "recruiters": await db[RECRUITER_INVITES].count_documents({"org_id": oid}, limit=1)
        or await db[RECRUITER_LINKS].count_documents({"org_id": oid}, limit=1),
        "reports": bool(
            await db[AUDIT_LOG].count_documents({"data.orgs": oid, "action": {"$in": list(REPORT_ACTIONS)}}, limit=1)
        ),
    }


# ---------- one checklist ----------


async def _cached(key: tuple[str, str], fresh: bool, load) -> dict[str, Any]:
    hit = _cache.get(key)
    if hit and not fresh and hit[0] > time.monotonic():
        return hit[1]
    out = await load()
    _cache[key] = (time.monotonic() + C.CACHE_SECONDS, out)
    return out


async def _finish(db, coll: str, doc: dict[str, Any], kind: str, out: dict[str, Any]) -> dict[str, Any]:
    if out.pop("firstComplete"):
        await db[coll].update_one({"_id": doc["_id"]}, {"$set": {"setup.check_done_at": now()}})
    out["level"] = None
    out["renewals"] = []  # no renewals for a team yet
    out["reminders"] = not (doc.get("setup") or {}).get("reminders_off")
    out["title"] = TITLE[kind]
    return out


def _decorate(out: dict[str, Any], kind: str, can: set[str], may_skip: bool) -> dict[str, Any]:
    by = ACT_BY[kind]
    steps = []
    for s in out["steps"]:
        need = next((x.who for x in R.STEPS[kind] if x.id == s["id"]), None)
        s = {**s, "canAct": not need or need in can}
        if not s["canAct"]:
            s["actBy"] = by.get(need or "", "Someone else on your team")
        steps.append(s)
    return {**out, "steps": steps, "canSkip": may_skip}


async def company_checklist(db, c: dict[str, Any], acc: dict[str, Any] | None, fresh: bool = False) -> dict[str, Any]:
    """The company's checklist as seen by the whole team (no per-member parts; see _decorate)."""

    async def load():
        sw = await company_switches(db, c, acc)
        f = await company_facts(db, c, acc)
        out = C.build("company", f, sw, c.get("setup") or {})
        return await _finish(db, COMPANIES, c, "company", out)

    return await _cached((f"co:{c['_id']}", (acc or {}).get("email_lc", "")), fresh, load)


async def college_checklist(db, o: dict[str, Any], fresh: bool = False) -> dict[str, Any]:
    async def load():
        f = await college_facts(db, o)
        out = C.build("college", f, {}, o.get("setup") or {})
        return await _finish(db, ORGANIZATIONS, o, "college", out)

    return await _cached((f"org:{o['_id']}", ""), fresh, load)


def company_can(role: str) -> set[str]:
    return ({"manage"} if role in MANAGE else set()) | ({"post"} if role in POST else set())


def college_can(scope) -> set[str]:
    can = set(ACTIONS[scope.role])
    if scope.role in ("owner", "admin"):
        can.add("billing")
    if "manage" in can and scope.group_ids is None:
        can.add("groups")
    return can


# ---------- endpoints ----------


async def _company_out(db, c, acc, m, fresh=False) -> dict[str, Any]:
    out = await company_checklist(db, c, acc, fresh)
    return _decorate(out, "company", company_can(m["role"]), m["role"] in MANAGE)


@company.get("/{cid}/checklist")
async def get_company(
    cid: str, db: DB, fresh: bool = False, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, m = await company_for(db, cid, x_recruiter_account)
    return await _company_out(db, c, acc, m, fresh)


@company.post("/{cid}/checklist/skip")
async def skip_company(
    cid: str, body: C.SkipIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, c, m = await company_for(db, cid, x_recruiter_account, MANAGE)
    c = await _skip(db, COMPANIES, c, "company", body)
    forget(f"co:{cid}")
    return await _company_out(db, c, acc, m, True)


@company.put("/{cid}/checklist/reminders")
async def remind_company(
    cid: str, body: C.RemindIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, bool]:
    await company_for(db, cid, x_recruiter_account, MANAGE)
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"setup.reminders_off": not body.on}})
    forget(f"co:{cid}")
    return {"on": body.on}


async def _college(db, scope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    if not o or o.get("type") != "college":
        raise ApiError(404, "not_a_college", "The setup checklist is for colleges.")
    return o


async def _college_out(db, o, scope, fresh=False) -> dict[str, Any]:
    out = await college_checklist(db, o, fresh)
    return _decorate(out, "college", college_can(scope), "manage" in ACTIONS[scope.role])


@college.get("/checklist")
async def get_college(db: DB, scope: OrgScope, fresh: bool = Query(False)) -> dict[str, Any]:
    return await _college_out(db, await _college(db, scope), scope, fresh)


@college.post("/checklist/skip")
async def skip_college(body: C.SkipIn, db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("manage")
    o = await _skip(db, ORGANIZATIONS, await _college(db, scope), "college", body)
    forget(f"org:{o['_id']}")
    return await _college_out(db, o, scope, True)


@college.put("/checklist/reminders")
async def remind_college(body: C.RemindIn, db: DB, scope: OrgScope) -> dict[str, bool]:
    scope.require("manage")
    o = await _college(db, scope)
    await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": {"setup.reminders_off": not body.on}})
    forget(f"org:{o['_id']}")
    return {"on": body.on}


async def _skip(db, coll: str, doc: dict[str, Any], kind: str, body: C.SkipIn) -> dict[str, Any]:
    if body.step not in R.step_ids(kind):
        raise ApiError(400, "no_such_step", "No such step.")
    op = (
        {"$pull": {"setup.check_skipped": body.step}}
        if body.undo
        else {"$addToSet": {"setup.check_skipped": body.step}}
    )
    await db[coll].update_one({"_id": doc["_id"]}, op)
    return await db[coll].find_one({"_id": doc["_id"]}) or doc


# ---------- "Stop these emails" ----------


async def stop(db, key: str) -> bool:
    kind, _, oid = key.partition(":")
    coll = COMPANIES if kind == "co" else ORGANIZATIONS
    r = await db[coll].update_one({"_id": oid}, {"$set": {"setup.reminders_off": True}})
    forget(key)
    return bool(r.matched_count)


# ---------- weekly reminders ----------


def _email(to: str, name: str, what: str, c: dict[str, Any], key: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (name or "").split(" ")[0] or "there"
    step = next(s for s in c["steps"] if s["id"] == c["next"])
    link = f"{site}{step['link']}"
    stop_link = f"{site}/stop-alerts#t={C.unsub_token(key)}&k=setup"
    left = c["total"] - c["done"]
    lines = [f"Hi {first},", "", f"{what} is {c['done']} of {c['total']} setup steps done. Next: {step['title']} (about {step['minutes']} min).",
             step["reward"], "", f"Do it now: {link}", "",
             "You get this at most once a week until setup is complete. Your checklist stays on your dashboard.", f"Stop these emails: {stop_link}"]  # fmt: skip
    html = (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>Hi {escape(first)},</p>'
            f"<p>{escape(what)} is {c['done']} of {c['total']} setup steps done. Next: <strong>{escape(step['title'])}</strong> (about {step['minutes']} min).</p>"
            f"<p>{escape(step['reward'])}</p><p><a href=\"{escape(link)}\">Do it now</a></p>"
            f'<p style="color:#666;font-size:13px">You get this at most once a week until setup is complete. '
            f'<a href="{escape(stop_link)}" style="color:#666">Stop these emails</a></p></div>')  # fmt: skip
    return Email(to=to, to_name=name or "", subject=f"{left} setup step{'s' if left != 1 else ''} left for {what} on Nm7",
                 text="\n".join(lines), html=html)  # fmt: skip


async def _testers(db) -> set[str] | None:
    """None: everyone (Vetting Trust is public); else only these addresses (maybe none)."""
    from app.trust import access as trust

    return None if await trust.is_public(db) else await trust.testers(db)


async def _mailable(db, email: str) -> bool:
    from app.autoapply.emailing import blocked

    if not email or await blocked(db, email):
        return False
    return not await db[USERS].count_documents({"email_lc": email.lower(), "email_bounced": True}, limit=1)


def _due(t: datetime) -> dict[str, Any]:
    return {"demo": {"$ne": True}, "created_at": {"$lt": t - C.NEW_FOR}, "setup.reminders_off": {"$ne": True},
            "$and": [{"$or": [{"setup.reminded_at": None}, {"setup.reminded_at": {"$lt": t - C.REMIND_EVERY}}]},
                     {"$or": [{"setup.checked_at": None}, {"setup.checked_at": {"$lt": t - C.CHECK_EVERY}}]}]}  # fmt: skip


async def remind(db, mailer: Mailer, limit: int = C.PER_PASS, t: datetime | None = None) -> int:
    """One pass over companies, then colleges: at most `limit` of each looked at, at most one email a week each."""
    t = t or now()
    if C.quiet(t):
        return 0
    testers = await _testers(db)
    if testers is not None and not testers:
        return 0
    ok = (lambda e: True) if testers is None else (lambda e: (e or "").lower() in testers)
    sent = 0
    async for c in (
        db[COMPANIES].find({**_due(t), "review.state": {"$ne": "blocked"}}).sort("setup.checked_at", 1).limit(limit)
    ):
        await db[COMPANIES].update_one({"_id": c["_id"]}, {"$set": {"setup.checked_at": t}})
        main = next(
            (m for m in c.get("members") or [] if m.get("role") == "main" and m.get("status") == "active"), None
        )
        if not main or not ok(main.get("email_lc")) or not await _mailable(db, main["email_lc"]):
            continue
        out = await company_checklist(db, c, {"email_lc": main["email_lc"]}, fresh=True)
        if out["complete"] or not out["next"]:
            continue
        await db[COMPANIES].update_one({"_id": c["_id"]}, {"$set": {"setup.reminded_at": t}})
        name = (c.get("details") or {}).get("legal_name") or "Your company"
        if await send_safely(mailer, _email(main["email_lc"], main.get("name", ""), name, out, f"co:{c['_id']}")):
            sent += 1
    async for o in (
        db[ORGANIZATIONS]
        .find({**_due(t), "type": "college", "status": "active"})
        .sort("setup.checked_at", 1)
        .limit(limit)
    ):
        await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": {"setup.checked_at": t}})
        uids = [
            s["user_id"]
            async for s in db[ORG_STAFF]
            .find({"org_id": o["_id"], "role": "owner", "status": "active"}, {"user_id": 1})
            .limit(3)
            if s.get("user_id")
        ]
        owners = [u async for u in db[USERS].find({"_id": {"$in": uids}, "email_verified_at": {"$ne": None}, "email_bounced": {"$ne": True},
                                                   "deleted_at": None, "disabled_at": None, "demo": {"$ne": True}}, {"email": 1, "email_lc": 1, "name": 1})]  # fmt: skip
        owners = [
            u
            for u in owners
            if ok(u.get("email_lc") or u.get("email")) and await _mailable(db, u.get("email_lc") or u["email"])
        ]
        if not owners:
            continue
        out = await college_checklist(db, o, fresh=True)
        if out["complete"] or not out["next"]:
            continue
        await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": {"setup.reminded_at": t}})
        for u in owners:
            if await send_safely(
                mailer, _email(u["email"], u.get("name", ""), o.get("name") or "Your college", out, f"org:{o['_id']}")
            ):
                sent += 1
    if sent:
        log.info("company / college setup reminders: %d email(s) sent", sent)
    return sent
