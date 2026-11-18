"""Who gets Auto Apply 2.0 (A1 "Engine") while it is tested on the live site: the launch-switch pattern of the
vetting engine (app/hire/vetting/access.py).

Admin → Auto Apply → "Auto Apply 2.0" holds one switch (site settings `auto_apply_v2.public`, OFF by default) and a
list of tester emails. While it is OFF the 2.0 engine (match score parts, "Suggested for you", tailored versions with
the truth check, approval modes, the tracker, learning) runs only for admins, demo accounts and the listed testers;
everyone else keeps today's Auto Apply exactly as it was (same scores, limits, preview days, endpoints and answers).
"""

from typing import Any

from app.core.db import USERS
from app.site import get_site

PROJECTION = {"demo": 1, "role": 1, "email": 1, "email_lc": 1}


def allowed(user: dict[str, Any] | None, v2: dict[str, Any]) -> bool:
    """2.0 for this user (a user document with demo / role / email) under these settings."""
    if v2.get("public"):
        return True
    if not user:
        return False
    if user.get("demo") or user.get("role") == "admin":
        return True
    email = (user.get("email_lc") or user.get("email") or "").lower()
    return bool(email) and email in {str(e).lower() for e in v2.get("testers") or []}


async def for_user(db, uid: str, site: dict[str, Any] | None = None) -> bool:
    v2 = (site or await get_site(db))["auto_apply_v2"]
    if v2.get("public"):
        return True
    return allowed(await db[USERS].find_one({"_id": uid}, PROJECTION), v2)


async def is_public(db) -> bool:
    return bool((await get_site(db))["auto_apply_v2"].get("public"))


async def testers(db) -> set[str]:
    return {str(e).lower() for e in (await get_site(db))["auto_apply_v2"].get("testers") or []}


def may_mail(user: dict[str, Any] | None, v2: dict[str, Any]) -> bool:
    """Background 2.0 emails to this person: everyone when public; while hidden only the listed testers (admins and
    demo accounts see 2.0 on the site but get no 2.0 email)."""
    if v2.get("public"):
        return True
    if not user or user.get("demo"):
        return False
    email = (user.get("email_lc") or user.get("email") or "").lower()
    return bool(email) and email in {str(e).lower() for e in v2.get("testers") or []}


async def mail_filter(db) -> dict[str, Any] | None:
    """A Mongo filter on users for background 2.0 emails: {} when public, only the testers while hidden, or None when
    nobody may be emailed (the vetting engine's rule)."""
    v2 = (await get_site(db))["auto_apply_v2"]
    if v2.get("public"):
        return {}
    emails = sorted({str(e).lower() for e in v2.get("testers") or []})
    return {"email_lc": {"$in": emails}, "demo": {"$ne": True}} if emails else None


# ---------- A2: the company side (instant apply to jobs posted on Nm7) ----------


def test_company(company: dict[str, Any] | None, testers_: set[str]) -> bool:
    """A company used for testing while the switch is OFF: the demo company, or one with a listed tester on its team."""
    if not company:
        return False
    if company.get("demo"):
        return True
    return any((m.get("email_lc") or "").lower() in testers_ for m in company.get("members") or [])


def pair_ok(user: dict[str, Any] | None, company: dict[str, Any] | None, v2: dict[str, Any]) -> bool:
    """May this candidate's 2.0 application reach this company? Demo accounts only ever meet the demo company (and
    the other way round). While the switch is OFF a real person (a tester or an admin) reaches only a test company,
    so real companies never get 2.0 applications from real users until launch."""
    if not user or not company:
        return False
    if user.get("demo") or company.get("demo"):
        return bool(user.get("demo")) and bool(company.get("demo"))
    if v2.get("public"):
        return True
    return allowed(user, v2) and test_company(company, {str(e).lower() for e in v2.get("testers") or []})


async def for_company(db, company: dict[str, Any], account: dict[str, Any] | None = None) -> bool:
    """The company side of 2.0 (per-job Auto Apply controls, the "Sent by Auto Apply" details) for this company."""
    v2 = (await get_site(db))["auto_apply_v2"]
    if v2.get("public") or company.get("demo"):
        return True
    t = {str(e).lower() for e in v2.get("testers") or []}
    return test_company(company, t) or ((account or {}).get("email_lc") or "").lower() in t
