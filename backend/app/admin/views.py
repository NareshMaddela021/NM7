"""Admin "Switch to" menu and "View as this user (read-only)" (how a view works: app/auth/views.py).

  GET  /api/admin/views                  the menu: which views this admin may open, and the one open now
  POST /api/admin/views/switch {role}    jobseeker / student / expert: the admin's own persona (made on first use);
                                         company: the demo company (→ {session}, kept like a company sign-in);
                                         college: the demo college as its coordinator → {path, view}
  POST /api/admin/views/user {userId, reason}   owner only: a real person's screens, read-only (30 minutes)
  POST /api/admin/views/stop             Back to Admin → {path: "/admin"}

Every call checks the admin's own session (two-step login done), never the view's person, so a view can't open
another view and a persona can't reach these. Each admin has their own personas: one per role, demo (left out of every
number, report and company search), with a made-up @persona.nm7.invalid address (no email can be sent there) and no
password (the only way in is this menu).
"""

import uuid
from datetime import timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field
from pymongo.errors import DuplicateKeyError

from app.admin.roles import can
from app.audit import audit
from app.auth.deps import Auth
from app.auth.sessions import client_ip, load_session
from app.auth.views import LABELS, end_view, find_view, public, start_view
from app.core import rate_limit
from app.core.db import COMPANIES, DB, EXPERT_PROFILES, ORGANIZATIONS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now

router = APIRouter(prefix="/api/admin/views", tags=["admin views"])

PERSONA_DOMAIN = "persona.nm7.invalid"
# where each view opens, and which admin permission it needs (None: every admin)
VIEWS: dict[str, tuple[str, str | None]] = {
    "jobseeker": ("/me", None),
    "student": ("/me", None),
    "expert": ("/expert", None),
    "company": ("/company", "companies"),
    "college": ("/org/demo-engineering-college", "organizations"),
}
ADMIN_ONLY = ApiError(403, "admin_only", "This needs an admin account with two-step login.")


async def primary_admin(request: Request, response: Response, db: DB) -> Auth:
    """The admin's own session, whatever view is open on top of it."""
    found = await load_session(db, request, response, overlay=False)
    if not found:
        raise ApiError(401, "not_signed_in", "Please sign in.")
    session, user = found
    if user.role != "admin" or not session.two_step:
        raise ADMIN_ONLY
    return Auth(user=user, session=session)


AdminSelf = Annotated[Auth, Depends(primary_admin)]


def persona_id(admin_id: str, role: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://nm7.si/admin-persona/{admin_id}/{role}"))


def _first(name: str) -> str:
    return (name or "Admin").split()[0][:30]


async def ensure_persona(db, admin, role: str) -> dict[str, Any]:
    """This admin's made-up person for this role, made the first time and reused after."""
    uid = persona_id(admin.id, role)
    doc = await db[USERS].find_one({"_id": uid})
    if doc:
        return doc
    t = now()
    email = f"{role}.{admin.id.replace('-', '')[:12]}@{PERSONA_DOMAIN}"
    doc = {
        "_id": uid,
        "email": email,
        "email_lc": email,
        "name": f"{_first(admin.name)} ({LABELS[role].lower()} preview)",
        "phone": None,
        "role": "expert" if role == "expert" else "customer",
        "admin_role": None,
        "expert_status": "approved" if role == "expert" else None,
        "password_hash": "",  # no password: only the admin's Switch to menu opens it
        "demo": True,
        "persona": role,
        "owner_admin_id": admin.id,
        "email_verified_at": t,
        "terms_accepted_at": t,
        "disabled_at": None,
        "target_role": "Data analyst" if role != "expert" else "",
        "cities": "Hyderabad",
        "level": "student" if role == "student" else "",
        "notify": {},
        "ui": {},
        "ref_flags": [],
        "created_at": t,
        "updated_at": t,
    }
    try:
        await db[USERS].insert_one(doc)
    except DuplicateKeyError:  # two clicks at the same moment: the other one made it
        return await db[USERS].find_one({"_id": uid})
    if role == "expert":
        await db[EXPERT_PROFILES].update_one(
            {"_id": uid}, {"$setOnInsert": {"status": "approved", "profile": {}, "demo": True}}, upsert=True
        )
    await audit(db, admin.id, "admin.persona_created", target=uid, data={"role": role})
    return doc


def _allowed(admin, role: str) -> bool:
    perm = VIEWS[role][1]
    return perm is None or can(admin.admin_role, perm)


@router.get("")
async def menu(request: Request, db: DB, auth: AdminSelf) -> dict[str, Any]:
    v = await find_view(db, request)
    person = await db[USERS].find_one({"_id": v["user_id"]}, {"name": 1}) if v and v.get("user_id") else None
    return {
        "view": public(v, person),
        "views": [{"role": r, "label": f"{LABELS[r]} view"} for r in VIEWS if _allowed(auth.user, r)],
        "canViewAsUser": auth.user.admin_role == "owner",
    }


class SwitchIn(CamelModel):
    role: Literal["jobseeker", "student", "expert", "company", "college"]


@router.post("/switch")
async def switch(body: SwitchIn, request: Request, response: Response, db: DB, auth: AdminSelf) -> dict[str, Any]:
    admin, role = auth.user, body.role
    if not _allowed(admin, role):
        raise ApiError(403, "no_permission", "Your admin role can’t open this view.")
    await rate_limit.check(db, f"admin-view:{admin.id}", [(120, timedelta(hours=1))])
    await rate_limit.record(db, f"admin-view:{admin.id}")
    path = VIEWS[role][0]
    out: dict[str, Any] = {}
    kw: dict[str, Any] = {}
    if role in ("jobseeker", "student", "expert"):
        p = await ensure_persona(db, admin, role)
        kw = {"user_id": p["_id"], "user_name": p["name"]}
    elif role == "college":
        from app.orgs.demo import COORDINATOR_ID, ORG_ID

        if not await db[ORGANIZATIONS].find_one({"_id": ORG_ID}, {"_id": 1}) or not await db[USERS].find_one(
            {"_id": COORDINATOR_ID, "demo": True}, {"_id": 1}
        ):
            from app.core.heavy import heavy_or_busy
            from app.orgs.demo import create_demo

            async with heavy_or_busy(db):  # the demo college, made once (Admin → Organizations → Demo resets it)
                await create_demo(db, admin.id)
        kw = {"user_id": COORDINATOR_ID, "user_name": "Demo coordinator", "org_id": ORG_ID}
        path = f"/org/{ORG_ID}"
    else:  # company: the demo company, signed in the way a company is (X-Recruiter-Account), the admin stays signed in
        from app.companies import demo as company_demo
        from app.orgs.recruiter_account import _hash, issue_session

        if not await db[COMPANIES].find_one({"_id": company_demo.COMPANY_ID, "demo": True}, {"_id": 1}):
            from app.core.heavy import heavy_or_busy

            async with heavy_or_busy(db):
                await company_demo.create(db)
        session = await issue_session(db, company_demo.MAIN[0], company_demo.MAIN[1], request=request)
        kw = {"recruiter_hash": _hash("session", session)}
        out["session"] = session
    v = await start_view(db, request, response, auth.session, admin, mode="persona", role=role, path=path, **kw)
    await audit(db, admin.id, "admin.view_switch", target=kw.get("user_id"), data={"role": role},
                ip=client_ip(request))  # fmt: skip
    return {**out, "path": path, "view": public(v)}


class ViewUserIn(CamelModel):
    user_id: str = Field(min_length=10, max_length=64)
    reason: str = Field(min_length=1, max_length=300)


@router.post("/user")
async def view_user(body: ViewUserIn, request: Request, response: Response, db: DB, auth: AdminSelf) -> dict[str, Any]:
    """Support: a real person's screens, read-only. Owner only, with a reason; one audit log entry per use."""
    if auth.user.admin_role != "owner":
        raise ApiError(403, "owner_only", "Only the owner can view a person’s screens.")
    reason = " ".join(body.reason.split())
    if len(reason) < 5:
        raise ApiError(400, "reason_required", "Write why you need to see this person’s screens (for the audit log).")
    u = await db[USERS].find_one({"_id": body.user_id, "role": {"$in": ["customer", "expert"]}})
    if not u:
        raise ApiError(404, "not_found", "No such customer.")
    await rate_limit.check(db, f"admin-view-user:{auth.user.id}", [(30, timedelta(hours=1))])
    await rate_limit.record(db, f"admin-view-user:{auth.user.id}")
    path = "/expert" if u["role"] == "expert" else "/me"
    v = await start_view(db, request, response, auth.session, auth.user, mode="readonly", role="user", path=path,
                         user_id=u["_id"], user_name=u.get("name") or "", reason=reason)  # fmt: skip
    return {"path": path, "view": public(v, u)}


@router.post("/stop")
async def stop(request: Request, response: Response, db: DB, auth: AdminSelf) -> dict[str, Any]:
    """Back to Admin: the view ends at once; the admin's own sign-in carries on (no password, no code)."""
    v = await end_view(db, request, response)
    if v:
        await audit(db, auth.user.id, "admin.view_back", target=v.get("user_id"), data={"role": v["role"]},
                    ip=client_ip(request))  # fmt: skip
    return {"path": "/admin", "ended": bool(v)}


async def demo_as_view(db, request: Request, response: Response, person: dict[str, Any], role: str, path: str,
                       org_id: str | None = None) -> bool:  # fmt: skip
    """The older demo links (demo students, test users, the demo coordinator) opened in an admin's browser: open them
    as a view on top of the admin session instead of replacing it, so the admin stays signed in. False when this
    browser has no admin session (the caller signs in as before)."""
    found = await load_session(db, request, response, overlay=False)
    if not found or found[1].role != "admin" or not found[0].two_step or not person.get("demo"):
        return False
    session, admin = found
    await start_view(db, request, response, session, admin, mode="persona", role=role, path=path,
                     user_id=person["_id"], user_name=person.get("name") or "", org_id=org_id)  # fmt: skip
    return True


async def company_view(db, request: Request, response: Response, auth: Auth, session: str, path: str) -> None:
    """Admin → Companies → "Reset and open as company": the company sign-in it hands out (X-Recruiter-Account) never
    touched the admin's; this marks it as a view too, so the banner shows and Back to Admin ends that sign-in."""
    from app.orgs.recruiter_account import _hash

    await start_view(db, request, response, auth.session, auth.user, mode="persona", role="company", path=path,
                     recruiter_hash=_hash("session", session))  # fmt: skip
