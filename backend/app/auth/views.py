"""Admin views: "Switch to" (job seeker / student / expert / company / college) and "View as this user (read-only)".

The admin's own sign-in (password + authenticator, app/auth/admin_router.py) stays the only session in the browser and
is never replaced or weakened. A view is an overlay on top of it: a second, short-lived cookie (nm7_view) whose record
names the admin session it belongs to. While it is valid, load_session (app/auth/sessions.py) answers every request as
the view's person instead of the admin; drop the cookie ("Back to Admin") and the very next request is the admin
again, with no new sign-in. The view dies with the admin session (sign-out, expiry, a role change that signs the admin
out), and only an admin session that passed two-step login can start one.

  mode "persona"   the admin's own made-up people (app/admin/views.py makes one per admin per role on first use:
                   demo, so left out of every number and report, never emailed, never shown to or sent to a real
                   company), the demo company (an X-Recruiter-Account session, as before) or the demo college (its
                   made-up coordinator, held to the demo college by demo_allowed). The older demo buttons (demo
                   students, test users, the demo coordinator) open the same way now, so they no longer sign the
                   admin out.
  mode "readonly"  a real person's screens for support, owner only, with a reason. app/core/readonly.py refuses
                   every change, sends no email, skips writes made while reading, masks private fields and files;
                   each use is one audit log entry (admin, person, reason, start, end).
"""

import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import Request, Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import ADMIN_VIEWS, AUDIT_LOG, RECRUITERS, USERS
from app.core.security import hash_token, new_token
from app.core.time import now

VIEW_COOKIE = "nm7_view"
PERSONA_TTL = timedelta(hours=3)
READONLY_TTL = timedelta(minutes=30)
LABELS = {
    "jobseeker": "Job seeker",
    "student": "Student",
    "expert": "Expert",
    "company": "Company",
    "college": "College",
    "user": "this user",
}


def _session_cookie(request: Request) -> str | None:
    from app.auth.sessions import SESSION_COOKIE

    return request.cookies.get(SESSION_COOKIE)


async def find_view(db: AsyncDatabase, request: Request) -> dict[str, Any] | None:
    """The live view of this browser: its cookie and the admin session cookie it was started under must both match."""
    token, admin_token = request.cookies.get(VIEW_COOKIE), _session_cookie(request)
    if not token or not admin_token or len(token) > 100 or len(admin_token) > 100:
        return None
    return await db[ADMIN_VIEWS].find_one(
        {
            "token_hash": hash_token(token),
            "admin_token_hash": hash_token(admin_token),
            "ended_at": None,
            "expires_at": {"$gt": now()},
        }
    )


def public(v: dict[str, Any] | None, person: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """What the page shows in the banner."""
    if not v:
        return None
    role = v["role"]
    label = LABELS.get(role, role)
    if role == "user":
        label = (person or {}).get("name") or v.get("user_name") or "this user"
    return {
        "mode": v["mode"],
        "role": role,
        "label": label,
        "readOnly": v["mode"] == "readonly",
        "path": v.get("path") or "/",
        "expiresAt": int(v["expires_at"].timestamp() * 1000),
    }


async def start_view(
    db: AsyncDatabase,
    request: Request,
    response: Response,
    admin_session,
    admin_user,
    *,
    mode: str,
    role: str,
    path: str,
    user_id: str | None = None,
    user_name: str | None = None,
    org_id: str | None = None,
    reason: str | None = None,
    recruiter_hash: str | None = None,
) -> dict[str, Any]:
    """Opens a view on top of this admin session (any view it had is closed first)."""
    from app.auth.sessions import set_cookie

    await end_views(db, admin_session.id)
    t = now()
    ttl = READONLY_TTL if mode == "readonly" else PERSONA_TTL
    expires = min(t + ttl, admin_session.expires_at)
    token = new_token()
    doc: dict[str, Any] = {
        "_id": secrets.token_hex(12),
        "token_hash": hash_token(token),
        "admin_id": admin_user.id,
        "admin_session_id": admin_session.id,
        "admin_token_hash": admin_session.token_hash,
        "mode": mode,
        "role": role,
        "path": path,
        "user_id": user_id,
        "user_name": user_name,
        "org_id": org_id,
        "reason": reason,
        "recruiter_hash": recruiter_hash,
        "audit_id": None,
        "started_at": t,
        "expires_at": expires,
        "ended_at": None,
    }
    if mode == "readonly":
        from app.audit import AuditLog
        from app.auth.sessions import client_ip
        from app.core.db import next_number

        # one entry per use: the start now, the end filled in by "Back to Admin" (or the expiry time it ran to)
        n = await next_number(db, "audit", 1)
        entry = AuditLog(_id=n, actor_id=admin_user.id, action="admin.view_as_user", target=user_id,
                         data={"reason": reason, "user": user_name, "started_at": t, "expires_at": expires,
                               "ended_at": None, "view": doc["_id"]}, ip=client_ip(request))  # fmt: skip
        await db[AUDIT_LOG].insert_one(entry.to_mongo())
        doc["audit_id"] = n
    await db[ADMIN_VIEWS].insert_one(doc)
    set_cookie(response, VIEW_COOKIE, token, max(timedelta(seconds=60), expires - t))
    return doc


async def _close(db: AsyncDatabase, v: dict[str, Any], at: datetime) -> None:
    r = await db[ADMIN_VIEWS].update_one({"_id": v["_id"], "ended_at": None}, {"$set": {"ended_at": at}})
    if not r.modified_count:
        return
    if v.get("audit_id"):
        await db[AUDIT_LOG].update_one({"_id": v["audit_id"]}, {"$set": {"data.ended_at": at}})
    if v.get("recruiter_hash"):  # the demo company's sign-in made for this view stops working too
        h = v["recruiter_hash"]
        await db[RECRUITERS].update_many({"sessions.hash": h}, {"$pull": {"sessions": {"hash": h}}})


async def end_views(db: AsyncDatabase, admin_session_id: str) -> int:
    n = 0
    async for v in db[ADMIN_VIEWS].find({"admin_session_id": admin_session_id, "ended_at": None}):
        await _close(db, v, min(now(), v["expires_at"]))
        n += 1
    return n


async def end_view(db: AsyncDatabase, request: Request, response: Response) -> dict[str, Any] | None:
    """Back to Admin: closes this browser's view and forgets its cookie. The admin session is not touched."""
    from app.auth.sessions import clear_cookie

    v = await find_view(db, request)
    if v:
        await _close(db, v, now())
    clear_cookie(response, VIEW_COOKIE)
    return v


async def overlay(db: AsyncDatabase, request: Request, session, user):
    """(session, user) to answer as while this admin session has a view open, else None. The returned session is
    never stored (its id matches no sessions document), so nothing a request does to "its session" reaches the
    admin's."""
    from app.auth.models import User, UserSession

    v = await find_view(db, request)
    if not v or v["admin_session_id"] != session.id:
        return None
    fields = dict(view_id=v["_id"], view_mode=v["mode"], view_role=v["role"], acting_admin_id=user.id)
    if not v.get("user_id"):  # the company view: the admin stays the signed-in person; the banner still shows
        return session.model_copy(update=fields), user
    q: dict[str, Any] = {"_id": v["user_id"], "disabled_at": None}
    if v["mode"] == "persona":
        q["demo"] = True  # a persona view only ever opens a made-up person
    target = User.load(await db[USERS].find_one(q))
    if target is None or target.role == "admin":
        return None
    acting = UserSession(
        id=f"view-{v['_id']}",
        user_id=target.id,
        token_hash=session.token_hash,
        two_step=False,
        created_at=v["started_at"],
        expires_at=v["expires_at"],
        demo_org_id=v.get("org_id"),
        **fields,
    )
    return acting, target
