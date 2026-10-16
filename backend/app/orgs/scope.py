"""Who may see which shared resumes. Every organization endpoint resolves a Scope on the server:

- the super-admin ("owner" role, two-step login) at /api/admin/… sees every organization;
- the same admin at /api/org/{org_id}/… sees that organization;
- a coordinator or viewer (an active org_staff row for this signed-in account) at /api/org/{org_id}/… sees only that
  organization and, when their access is limited to some groups, only those groups.

Anything outside the scope answers 404 (never 403), so a coordinator can't even learn that another organization's
group or member exists. Org and group ids from the browser are never trusted on their own: they are intersected with
the scope here. Staff access is read on every request, so removing someone takes effect at once.
"""

from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import Depends, Path

from app.admin.roles import can as admin_can
from app.auth.deps import Auth, get_auth
from app.core.db import DB, ORG_GROUPS, ORG_STAFF, ORGANIZATIONS
from app.core.errors import ApiError

NOT_FOUND = ApiError(404, "not_found", "We couldn’t find that.")

# what each kind of user may do (inside their scope)
ACTIONS = {
    "admin": {"view", "print", "export", "manage", "approve", "remind", "review", "unprint", "audit"},
    "coordinator": {"view", "print", "export", "manage", "approve", "remind", "review", "unprint", "audit"},
    "viewer": {"view", "print", "audit"},
}
ACTION_TEXT = {
    "export": "download exports",
    "manage": "change groups",
    "approve": "approve members",
    "remind": "send reminders",
    "review": "review resumes",
    "unprint": "change printed status",
}


FEATURES = ("kiosk", "branding", "recruiter_links")  # Phase 3 switches, per organization; Nm7 sets them


def features_of(o: dict[str, Any] | None) -> dict[str, bool]:
    """Every Phase 3 feature is off until Nm7 switches it on for the organization."""
    f = (o or {}).get("features") or {}
    return {k: bool(f.get(k)) for k in FEATURES}


def require_feature(o: dict[str, Any] | None, name: str) -> None:
    """A switched-off feature doesn't exist for that organization: 404, like anything outside a scope."""
    if not o or not features_of(o)[name]:
        raise NOT_FOUND


@dataclass
class Scope:
    actor_id: str
    role: Literal["admin", "coordinator", "viewer"]
    org_id: str | None = None  # None: every organization (the admin console)
    group_ids: list[str] | None = None  # None: every group of the organization
    staff_id: str | None = None

    @property
    def is_staff(self) -> bool:
        return self.role != "admin"

    def match(self) -> dict[str, Any]:
        """The membership filter every query in this scope starts from."""
        m: dict[str, Any] = {}
        if self.org_id:
            m["org_id"] = self.org_id
        if self.group_ids is not None:
            m["group_id"] = {"$in": self.group_ids}
        return m

    def allows_group(self, g: dict[str, Any] | None) -> bool:
        return bool(
            g
            and (self.org_id is None or g["org_id"] == self.org_id)
            and (self.group_ids is None or g["_id"] in self.group_ids)
        )

    def require(self, action: str) -> None:
        if action not in ACTIONS[self.role]:
            raise ApiError(403, "viewer_only", f"Your access is view and print only — you can’t {ACTION_TEXT[action]}.")

    def audit_data(self, orgs: list[str] | None = None, **extra: Any) -> dict[str, Any]:
        """What every organization audit entry carries: which organizations it touched and who (staff or admin)."""
        out: dict[str, Any] = {"orgs": orgs if orgs is not None else ([self.org_id] if self.org_id else [])}
        if self.is_staff:
            out.update(by="staff", role=self.role)
        return {**out, **extra}

    async def group(self, db, group_id: str) -> dict[str, Any]:
        """A group inside the scope, or 404."""
        g = await db[ORG_GROUPS].find_one({"_id": group_id})
        if not self.allows_group(g):
            raise NOT_FOUND
        return g


def _is_org_admin(auth: Auth) -> bool:
    u = auth.user
    return u.role == "admin" and auth.session.two_step and admin_can(u.admin_role, "organizations")


async def admin_scope(auth: Annotated[Auth, Depends(get_auth)]) -> Scope:
    """/api/admin/…: the super-admin, every organization."""
    if auth.user.role != "admin" or not auth.session.two_step:
        raise ApiError(403, "admin_only", "This needs an admin account with two-step login.")
    if not admin_can(auth.user.admin_role, "organizations"):
        raise ApiError(403, "no_permission", "Your admin role can’t open this.")
    return Scope(actor_id=auth.user.id, role="admin")


async def active_staff(db, user_id: str, org_id: str) -> dict[str, Any] | None:
    return await db[ORG_STAFF].find_one({"org_id": org_id, "user_id": user_id, "status": "active"})


async def org_scope(db: DB, auth: Annotated[Auth, Depends(get_auth)], org_id: str = Path(max_length=64)) -> Scope:
    """/api/org/{org_id}/…: this organization's staff (or the super-admin). Everyone else: 404."""
    org = await db[ORGANIZATIONS].find_one({"_id": org_id}, {"status": 1})
    if not org:
        raise NOT_FOUND
    if _is_org_admin(auth):
        return Scope(actor_id=auth.user.id, role="admin", org_id=org_id)
    st = await active_staff(db, auth.user.id, org_id)
    if not st or org.get("status") == "archived":
        raise NOT_FOUND
    return Scope(
        actor_id=auth.user.id, role=st["role"], org_id=org_id, group_ids=st.get("group_ids"), staff_id=st["_id"]
    )


AdminScope = Annotated[Scope, Depends(admin_scope)]
OrgScope = Annotated[Scope, Depends(org_scope)]
