"""Nm7 API — app factory."""

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import automation
from app.admin.console import router as admin_console_router
from app.admin.router import router as admin_router
from app.admin.setup import router as admin_setup_router
from app.auth.admin_router import router as admin_auth_router
from app.auth.router import router as auth_router
from app.auth.sessions import SESSION_COOKIE
from app.core import errors
from app.core.config import get_settings
from app.core.db import DB, close_client, ensure_indexes, get_database
from app.core.email import log_email_status
from app.experts.router import router as expert_router
from app.me.router import public as public_router
from app.me.router import router as me_router
from app.orders.router import router as orders_router
from app.payments.router import router as payments_router
from app.profile.router import router as profile_router
from app.work.router import router as work_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await ensure_indexes(get_database())  # collections + indexes; safe to run on every start
    log_email_status()
    task = asyncio.create_task(automation.loop(get_database)) if get_settings().app_env != "test" else None
    yield
    if task:
        task.cancel()
    await close_client()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Nm7 API",
        version="0.1.0",
        lifespan=lifespan,
        # No public API docs in production.
        docs_url=None if settings.is_prod else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,  # session cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )
    errors.install(app)

    @app.middleware("http")
    async def origin_check(request: Request, call_next):
        # Cookie-authenticated changes must come from our own site (CSRF protection on top of SameSite).
        if request.method not in ("GET", "HEAD", "OPTIONS") and SESSION_COOKIE in request.cookies:
            if not settings.origin_allowed(request.headers.get("origin") or ""):
                return JSONResponse(
                    {"error": {"code": "bad_origin", "message": "Request blocked: unknown origin."}}, 403
                )
        return await call_next(request)

    @app.get("/health", tags=["ops"])
    async def health(db: DB) -> JSONResponse:
        try:
            await db.command("ping")
        except Exception:
            return JSONResponse({"status": "error", "db": "down"}, status_code=503)
        return JSONResponse({"status": "ok", "db": "ok"})

    @app.get("/version", tags=["ops"])
    async def version() -> dict[str, str]:
        """The git commit this server was built from (Render sets RENDER_GIT_COMMIT), to confirm a deploy."""
        commit = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or "unknown"
        return {"commit": commit}

    app.include_router(auth_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_setup_router)  # before admin_router: /api/admin/setup is public
    app.include_router(admin_router)
    app.include_router(admin_console_router)
    app.include_router(orders_router)
    app.include_router(payments_router)
    app.include_router(profile_router)  # before me_router: /api/me/job-profile
    app.include_router(me_router)
    app.include_router(public_router)
    app.include_router(work_router)
    app.include_router(expert_router)
    return app


app = create_app()
