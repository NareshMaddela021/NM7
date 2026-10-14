"""Session cookies: create, read (with sliding expiry) and revoke."""

import uuid
from datetime import timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User, UserSession
from app.core.config import get_settings
from app.core.security import hash_token, new_token
from app.core.time import now

SESSION_COOKIE = "nm7_session"
USER_TTL = timedelta(days=30)  # customers and experts, extended while they use the site
ADMIN_TTL = timedelta(hours=12)  # admins, fixed
SLIDE_AFTER = timedelta(hours=1)  # refresh the expiry at most once an hour


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def set_cookie(response: Response, name: str, value: str, max_age: timedelta, path: str = "/") -> None:
    s = get_settings()
    response.set_cookie(
        name,
        value,
        max_age=int(max_age.total_seconds()),
        path=path,
        domain=s.cookie_domain,
        secure=s.is_prod,
        httponly=True,
        samesite="lax",
    )


def clear_cookie(response: Response, name: str, path: str = "/") -> None:
    s = get_settings()
    response.delete_cookie(name, path=path, domain=s.cookie_domain, secure=s.is_prod, httponly=True, samesite="lax")


async def start_session(
    db: AsyncSession, request: Request, response: Response, user: User, two_step: bool = False
) -> UserSession:
    ttl = ADMIN_TTL if user.role == "admin" else USER_TTL
    token = new_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        two_step=two_step,
        expires_at=now() + ttl,
        last_seen_at=now(),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
    )
    db.add(session)
    await db.commit()
    set_cookie(response, SESSION_COOKIE, token, ttl)
    return session


async def load_session(db: AsyncSession, request: Request, response: Response) -> tuple[UserSession, User] | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = (
        await db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.token_hash == hash_token(token),
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now(),
                User.disabled_at.is_(None),
            )
        )
    ).first()
    if row is None:
        return None
    session, user = row
    if user.role != "admin" and now() - session.last_seen_at > SLIDE_AFTER:
        session.last_seen_at = now()
        session.expires_at = now() + USER_TTL
        await db.commit()
        set_cookie(response, SESSION_COOKIE, token, USER_TTL)
    return session, user


async def revoke_all(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now())
    )
