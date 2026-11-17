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
