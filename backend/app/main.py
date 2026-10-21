"""Nm7 API — app factory."""

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import automation, home_events
from app.admin.console import router as admin_console_router
from app.admin.router import router as admin_router
from app.admin.setup import router as admin_setup_router
from app.auth.admin_router import router as admin_auth_router
from app.auth.router import router as auth_router
from app.billing import invoice_router as billing_docs
from app.billing import migrate as billing_migrate
from app.billing import router as billing
from app.core import errors
from app.core.body_limit import BodyLimit
from app.core.config import get_settings
from app.core.db import DB, close_client, ensure_indexes, get_database
from app.core.email import log_email_status
from app.core.observability import RequestContext, init_sentry
from app.downloads.router import router as downloads_router
from app.experts.router import router as expert_router
from app.me.router import public as public_router
from app.me.router import router as me_router
from app.orders.router import router as orders_router
from app.orgs import branding as org_branding
from app.orgs import kiosk as org_kiosk
from app.orgs import recruiter as org_recruiter
from app.orgs import router as orgs
from app.orgs import staff as org_staff
from app.partners import router as partners
from app.payments.router import router as payments_router
from app.photos.router import router as photos_router
from app.profile.router import router as profile_router
from app.summary.router import router as summary_router
from app.work.router import router as work_router

# Our own loggers ("nm7.*") speak at INFO - one line per AI call, deploy notes - while libraries stay at WARNING.
# Uvicorn configures only its own loggers, so without this nothing below WARNING would reach the Render logs.
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("nm7").setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await ensure_indexes(get_database())  # collections + indexes; safe to run on every start
    await billing_migrate.run(get_database())  # Phase 4: existing organizations keep working (runs once)
    log_email_status()
    task = asyncio.create_task(automation.loop(get_database)) if get_settings().app_env != "test" else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await close_client()


PRIVATE_PREFIXES = ("/api/me", "/api/auth", "/api/orders", "/api/org", "/api/admin", "/api/expert")


def create_app() -> FastAPI:
    settings = get_settings()
    if init_sentry(settings.sentry_dsn, settings.app_env):
        logging.getLogger("nm7").info("Sentry error reporting is on")
    app = FastAPI(
        title="Nm7 API",
        version="0.1.0",
        lifespan=lifespan,
        # No public API docs in production.
        docs_url=None if settings.is_prod else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/openapi.json",
    )
    errors.install(app)
    app.add_middleware(RequestContext)  # innermost: request ids and a JSON 500 for anything unexpected
    app.add_middleware(BodyLimit)

    @app.middleware("http")
    async def origin_check(request: Request, call_next):
        # Cookie-authenticated changes must come from our own site (CSRF protection on top of SameSite). Every
        # Nm7 cookie counts: the session, the admin two-step challenge, a trusted device, the owner-setup ticket.
        if request.method not in ("GET", "HEAD", "OPTIONS") and any(c.startswith("nm7_") for c in request.cookies):
            if not settings.origin_allowed(request.headers.get("origin") or ""):
                return JSONResponse(
                    {"error": {"code": "bad_origin", "message": "Request blocked: unknown origin."}}, 403
                )
        response = await call_next(request)
        # A person's own data (their resumes, account, sign-in answers) is never kept by a shared cache or CDN.
        if request.url.path.startswith(PRIVATE_PREFIXES) and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "private, no-store"
        return response

    # Added last so it is outermost: every answer, the 403s and 413s above included, carries the CORS headers
    # and the browser shows the message instead of a CORS error.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,  # session cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Access-Code"],  # the access code of a recruiter link
    )

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
    app.include_router(orgs.admin)
    app.include_router(org_staff.admin_staff)
    app.include_router(orgs.public)
    app.include_router(orgs.public_stop)
    app.include_router(org_staff.invites)
    app.include_router(org_staff.portal)
    app.include_router(org_kiosk.staff)
    app.include_router(org_branding.router)
    app.include_router(org_recruiter.staff)
    app.include_router(org_recruiter.public)
    app.include_router(org_kiosk.kiosk)
    app.include_router(org_kiosk.cont)
    app.include_router(admin_console_router)
    app.include_router(billing.public)
    app.include_router(billing.me)
    app.include_router(billing.portal)
    app.include_router(billing.admin)
    app.include_router(billing_docs.portal)
    app.include_router(billing_docs.admin)
    app.include_router(partners.public)
    app.include_router(partners.me)
    app.include_router(partners.admin)
    app.include_router(home_events.public)
    app.include_router(home_events.admin)
    app.include_router(orders_router)
    app.include_router(payments_router)
    app.include_router(profile_router)  # before me_router: /api/me/job-profile
    app.include_router(photos_router)  # /api/me/photo-import
    app.include_router(summary_router)  # /api/me/summary/generate
    app.include_router(downloads_router)  # /api/me/entitlements, /api/me/exports
    app.include_router(orgs.me)  # before me_router: /api/me/groups
    app.include_router(org_staff.my_orgs)  # /api/me/orgs
    app.include_router(me_router)
    app.include_router(public_router)
    app.include_router(work_router)
    app.include_router(expert_router)
    return app


app = create_app()
