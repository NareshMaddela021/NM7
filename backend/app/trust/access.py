# ruff: noqa: E501  (dense registry and response lines)
"""Who sees Vetting Trust (T1–T15) while it is tested on the live site.

Admin → Skill checks → Vetting Trust holds one switch (site settings `trust.public`, OFF by default) and a list of tester
emails. While it is OFF the new Trust features are shown only to admins, demo accounts (demo students, the demo
company) and the listed testers; everyone else gets the site exactly as before, and background jobs email nobody but
the testers (mail_filter). Admin pages are always on for admins. Modelled on app/hire/vetting/access.py.
"""

from typing import Any

from fastapi import Depends

from app.auth.deps import CustomerAuth
from app.core.db import DB, USERS
from app.core.errors import ApiError
from app.site import get_site


async def settings(db) -> dict[str, Any]:
    return (await get_site(db))["trust"]


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
    """The candidate side (privacy & consent, the age gate and every later Trust feature) for this person."""
    v = await settings(db)
    if v.get("public"):
        return True
    u = await db[USERS].find_one({"_id": uid}, {"demo": 1, "role": 1, "email": 1, "email_lc": 1})
    return _allowed(u, v)


async def for_company(db, company: dict[str, Any], account: dict[str, Any] | None = None) -> bool:
    """The company side of later items (trust badges, verified documents)."""
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


async def _on(auth: CustomerAuth, db: DB) -> None:
    """404 while Vetting Trust is hidden from this person."""
    if not await for_user(db, auth.user.id):
        raise ApiError(404, "not_found", "Not found.")


ON = Depends(_on)  # for routers: APIRouter(..., dependencies=[access.ON])
