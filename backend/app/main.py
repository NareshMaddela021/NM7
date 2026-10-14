"""Nm7 API — app factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.admin.router import router as admin_router
from app.auth.admin_router import router as admin_auth_router
from app.auth.router import router as auth_router
from app.auth.sessions import SESSION_COOKIE
from app.core import errors
from app.core.config import get_settings
from app.core.db import DB, dispose_engine
from app.orders.router import router as orders_router
from app.payments.router import router as payments_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()


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
            await db.execute(text("SELECT 1"))
        except Exception:
            return JSONResponse({"status": "error", "db": "down"}, status_code=503)
        return JSONResponse({"status": "ok", "db": "ok"})

    app.include_router(auth_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_router)
    app.include_router(orders_router)
    app.include_router(payments_router)
    return app


app = create_app()
