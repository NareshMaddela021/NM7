"""Who sees the vetting engine (V1–V5) while it is tested on the live site.

Admin → Skill checks → "Launch" holds one switch (site settings `vetting.public`, OFF by default) and a list of tester
emails. While it is OFF the new candidate and company features are shown only to demo accounts (the demo
organization's students, the demo company) and to the listed testers; everyone else gets the site exactly as before
(the old skill checks, the old Hire now order, no new emails). Admin pages are always on for admins.
"""

from typing import Any

from app.core.db import USERS
from app.site import get_site


async def settings(db) -> dict[str, Any]:
    return (await get_site(db))["vetting"]


async def is_public(db) -> bool:
    return bool((await settings(db)).get("public"))


async def testers(db) -> set[str]:
    return {str(e).lower() for e in (await settings(db)).get("testers") or []}


def _allowed(user: dict[str, Any] | None, v: dict[str, Any]) -> bool:
    if v.get("public"):
        return True
    if not user:
        return False
    if user.get("demo") or user.get("role") in ("admin",):
        return True
    email = (user.get("email_lc") or user.get("email") or "").lower()
    return bool(email) and email in {str(e).lower() for e in v.get("testers") or []}


async def for_user(db, uid: str) -> bool:
    """The candidate side (skill checks V2, levels, interviews, appeals, the human check) for this person."""
    v = await settings(db)
    if v.get("public"):
        return True
    u = await db[USERS].find_one({"_id": uid}, {"demo": 1, "role": 1, "email": 1, "email_lc": 1})
    return _allowed(u, v)


async def for_company(db, company: dict[str, Any], account: dict[str, Any] | None = None) -> bool:
    """The company side (badges, level filters and ranking, the interview summary, the human check)."""
    v = await settings(db)
    if v.get("public") or company.get("demo"):
        return True
    return _allowed({"email_lc": (account or {}).get("email_lc", "")}, v)


async def mail_filter(db) -> dict[str, Any] | None:
    """A Mongo filter on users for background emails: {} when public, only the testers while hidden (demo accounts
    never get real email), or None when nobody may be emailed."""
    v = await settings(db)
    if v.get("public"):
        return {}
    emails = sorted({str(e).lower() for e in v.get("testers") or []})
    return {"email_lc": {"$in": emails}} if emails else None
