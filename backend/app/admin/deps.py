from typing import Annotated

from fastapi import Depends

from app.admin.roles import can
from app.auth.deps import Auth, get_auth
from app.core.errors import ApiError


def require_admin(perm: str):
    """Signed-in admin, who passed two-step login, whose role includes `perm`."""

    async def guard(auth: Annotated[Auth, Depends(get_auth)]) -> Auth:
        if auth.user.role != "admin" or not auth.session.two_step:
            raise ApiError(403, "admin_only", "This needs an admin account with two-step login.")
        if not can(auth.user.admin_role, perm):
            raise ApiError(403, "no_permission", "Your admin role can’t open this.")
        return auth

    return guard


def AdminAuth(perm: str):  # noqa: N802 — used like a type: auth: AdminAuth("refunds")
    return Annotated[Auth, Depends(require_admin(perm))]
