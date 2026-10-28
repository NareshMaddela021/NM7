"""Route guards: who is signed in, and are they allowed here."""

import re
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response

from app.auth.models import User, UserSession
from app.auth.sessions import load_session
from app.core.db import DB
from app.core.errors import ApiError


@dataclass
class Auth:
    user: User
    session: UserSession


async def optional_auth(request: Request, response: Response, db: DB) -> Auth | None:
    found = await load_session(db, request, response)
    return Auth(user=found[1], session=found[0]) if found else None


# A kiosk sign-in (session.kiosk_id) is a stranger's 45 minutes on a shared screen: only what the kiosk flow calls
# (pages/kiosk/Kiosk.jsx and the builder pieces it embeds) is allowed. Everything else about the account — profile,
# share link, orders, groups, deleting resumes… — answers 403 kiosk_only, so the next person at an un-exited kiosk
# can't reach it. Methods: "*" for any.
KIOSK_ROUTES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("*", re.compile(r"^/api/kiosk/")),  # sign-in, join, print, send-link, exit
    ("GET", re.compile(r"^/api/auth/me$")),
    ("POST", re.compile(r"^/api/auth/logout$")),
    ("GET", re.compile(r"^/api/me/state$")),  # the candidate's resumes (which one the kiosk edits)
    ("POST", re.compile(r"^/api/me/resumes$")),
    ("GET|PATCH", re.compile(r"^/api/me/resumes/[^/]+$")),  # the builder saves while they type
    ("POST", re.compile(r"^/api/me/summary/generate$")),  # "Write with AI"
    ("POST", re.compile(r"^/api/me/photo-import$")),  # "Snap photos"
)


def kiosk_allowed(method: str, path: str) -> bool:
    return any((m == "*" or method in m.split("|")) and p.match(path) for m, p in KIOSK_ROUTES)


def demo_allowed(path: str, org_id: str) -> bool:
    """The demo coordinator reaches the demo college's portal, its college group and the sign-in basics. Nothing
    else: not real organizations, not resumes, orders or payments."""
    return (
        path in ("/api/auth/me", "/api/auth/logout", "/api/me/orgs", "/api/me/org-transfers", "/api/me/college-groups")
        or path == f"/api/org/{org_id}"
        or path.startswith(f"/api/org/{org_id}/")
        or path.startswith("/api/college-group/demo-college-group")
    )


async def get_auth(request: Request, auth: Annotated[Auth | None, Depends(optional_auth)]) -> Auth:
    if auth is None:
        raise ApiError(401, "not_signed_in", "Please sign in.")
    if auth.session.kiosk_id and not kiosk_allowed(request.method, request.url.path):
        raise ApiError(403, "kiosk_only", "This isn’t available at a kiosk. Sign in on your own device for it.")
    if auth.session.demo_org_id and not demo_allowed(request.url.path, auth.session.demo_org_id):
        raise ApiError(403, "demo_only", "The demo coordinator can only open the demo college. Sign out to go back.")
    return auth


def require_role(*roles: str):
    async def guard(auth: Annotated[Auth, Depends(get_auth)]) -> Auth:
        if auth.user.role not in roles:
            names = " or ".join(roles)
            article = "an" if names[:1] in "aeiou" else "a"
            raise ApiError(403, "wrong_role", f"This needs {article} {names} account.")
        return auth

    return guard


MaybeAuth = Annotated[Auth | None, Depends(optional_auth)]
CurrentAuth = Annotated[Auth, Depends(get_auth)]
CustomerAuth = Annotated[Auth, Depends(require_role("customer"))]
