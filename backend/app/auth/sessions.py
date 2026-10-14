"""Session cookies: create, read (with sliding expiry) and revoke."""

from datetime import timedelta

from fastapi import Request, Response
from pymongo.asynchronous.database import AsyncDatabase

from app.auth.models import User, UserSession
from app.core.config import get_settings
from app.core.db import SESSIONS, USERS, Session
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
        secure=s.is_prod or s.cookie_samesite == "none",
        httponly=True,
        samesite=s.cookie_samesite,
    )


def clear_cookie(response: Response, name: str, path: str = "/") -> None:
    s = get_settings()
    secure = s.is_prod or s.cookie_samesite == "none"
    response.delete_cookie(
        name, path=path, domain=s.cookie_domain, secure=secure, httponly=True, samesite=s.cookie_samesite
    )


async def start_session(
    db: AsyncDatabase, request: Request, response: Response, user: User, two_step: bool = False
) -> UserSession:
    ttl = ADMIN_TTL if user.role == "admin" else USER_TTL
    token = new_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        two_step=two_step,
        expires_at=now() + ttl,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
    )
    await db[SESSIONS].insert_one(session.to_mongo())
    set_cookie(response, SESSION_COOKIE, token, ttl)
    return session


async def load_session(db: AsyncDatabase, request: Request, response: Response) -> tuple[UserSession, User] | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = UserSession.load(
        await db[SESSIONS].find_one({"token_hash": hash_token(token), "revoked_at": None, "expires_at": {"$gt": now()}})
    )
    if session is None:
        return None
    user = User.load(await db[USERS].find_one({"_id": session.user_id, "disabled_at": None}))
    if user is None:
        return None
    if user.role != "admin" and now() - session.last_seen_at > SLIDE_AFTER:
        session.last_seen_at = now()
        session.expires_at = now() + USER_TTL
        await db[SESSIONS].update_one(
            {"_id": session.id}, {"$set": {"last_seen_at": session.last_seen_at, "expires_at": session.expires_at}}
        )
        set_cookie(response, SESSION_COOKIE, token, USER_TTL)
    return session, user


async def revoke_all(db: AsyncDatabase, user_id: str, session: Session = None) -> None:
    await db[SESSIONS].update_many(
        {"user_id": user_id, "revoked_at": None}, {"$set": {"revoked_at": now()}}, session=session
    )
