"""One account for individuals: job seeker, student and expert are roles of the same account.

After sign-up the person answers "What would you like to do?" (one or more roles); later they can add another role
and switch between them from the account menu. Each role keeps its own dashboard. `User.role` (the account type the
route guards check) follows the active role: "expert" while working as an expert, "customer" as a job seeker or
student. Older accounts have no stored roles; they are derived from the account type when read, so nothing is
rewritten at startup.

Adding the expert role starts the expert application (status "draft"): an expert gets paid work only after an admin
approves the application, exactly as before (Admin → Experts, and every expert work route checks the status).

  POST /api/auth/roles          {add: [...], active?, expertTerms?}   add roles (never removes), answer the picker
  POST /api/auth/roles/switch   {role}                                switch the active role
"""

from typing import Any

from fastapi import APIRouter

from app.audit import audit
from app.auth.deps import CurrentAuth
from app.auth.models import INDIVIDUAL_ROLES, User
from app.auth.schemas import RolesIn, SwitchIn, UserOut
from app.core.db import DB, USERS
from app.core.errors import ApiError
from app.core.time import now

router = APIRouter(prefix="/api/auth/roles", tags=["auth"])


def account_type(role: str) -> str:
    return "expert" if role == "expert" else "customer"


def _individual(auth) -> User:
    if auth.user.role == "admin" or auth.session.kiosk_id or auth.session.demo_org_id:
        raise ApiError(403, "not_individual", "Roles are for personal accounts.")
    return auth.user


async def _save(db, user: User, sets: dict[str, Any]) -> User:
    sets["updated_at"] = now()
    await db[USERS].update_one({"_id": user.id}, {"$set": sets})
    return user.model_copy(update=sets)


@router.post("")
async def add_roles(body: RolesIn, auth: CurrentAuth, db: DB) -> UserOut:
    """Adds roles. Right after sign-up (roles_pending) the answer replaces the placeholder job seeker role; an empty
    answer then keeps the account as it is. The first new role (or `active`) becomes the active one."""
    user = _individual(auth)
    have = user.individual_roles
    add = [r for r in INDIVIDUAL_ROLES if r in body.add]
    if user.roles_pending and add:
        roles = add
    else:
        roles = [r for r in INDIVIDUAL_ROLES if r in have or r in add]
    new = [r for r in add if r not in have or user.roles_pending]
    sets: dict[str, Any] = {"roles": roles, "roles_pending": False}
    if "expert" in roles and "expert" not in have:
        if not body.expert_terms and not user.expert_terms_accepted_at:
            raise ApiError(400, "expert_terms", "Please agree to the Expert Terms to work as an expert.")
        sets["expert_terms_accepted_at"] = user.expert_terms_accepted_at or now()
        if not user.expert_status:
            sets["expert_status"] = "draft"  # the application; paid work only after an admin approves it
    active = body.active if body.active in roles else (new[0] if new else user.current_role)
    if active not in roles:
        active = roles[0]
    sets["active_role"] = active
    sets["role"] = account_type(active)
    user = await _save(db, user, sets)
    if new:
        await audit(db, user.id, "account.roles_added", target=user.id, data={"roles": new, "active": active})
    return UserOut.model_validate(user)


@router.post("/switch")
async def switch_role(body: SwitchIn, auth: CurrentAuth, db: DB) -> UserOut:
    user = _individual(auth)
    if body.role not in user.individual_roles:
        raise ApiError(400, "no_such_role", "Add this role first (account menu → Add another role).")
    if body.role != user.current_role:
        user = await _save(
            db, user, {"roles": user.individual_roles, "active_role": body.role, "role": account_type(body.role)}
        )
        await audit(db, user.id, "account.role_switched", target=user.id, data={"to": body.role})
    return UserOut.model_validate(user)
