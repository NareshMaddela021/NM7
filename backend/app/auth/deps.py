"""Route guards: who is signed in, and are they allowed here."""

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


async def get_auth(auth: Annotated[Auth | None, Depends(optional_auth)]) -> Auth:
    if auth is None:
        raise ApiError(401, "not_signed_in", "Please sign in.")
    return auth


def require_role(*roles: str):
    async def guard(auth: Annotated[Auth, Depends(get_auth)]) -> Auth:
        if auth.user.role not in roles:
            raise ApiError(403, "wrong_role", f"This needs a {' or '.join(roles)} account.")
        return auth

    return guard


MaybeAuth = Annotated[Auth | None, Depends(optional_auth)]
CurrentAuth = Annotated[Auth, Depends(get_auth)]
CustomerAuth = Annotated[Auth, Depends(require_role("customer"))]
