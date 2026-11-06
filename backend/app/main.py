"""Nm7 API — app factory."""

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import automation, home_events, stories
from app.admin import daily as admin_daily
from app.admin.console import router as admin_console_router
from app.admin.router import router as admin_router
from app.admin.setup import router as admin_setup_router
from app.auth.admin_router import router as admin_auth_router
from app.auth.router import router as auth_router
from app.autoapply import admin as auto_admin
from app.autoapply import demo as auto_demo
from app.autoapply import items as auto_items
from app.autoapply import settings as auto_settings
from app.autoapply import summary as auto_summary
from app.billing import invoice_router as billing_docs
from app.billing import migrate as billing_migrate
from app.billing import router as billing
from app.certs.router import router as certs_router
from app.college import alumni as college_alumni
from app.college import campuses as college_campuses
from app.college import drives as college_drives
from app.college import eligibility as college_eligibility
from app.college import offers as college_offers
from app.college import reminders as college_reminders
from app.college import report as college_report
from app.college import reviews as college_reviews
from app.companies import admin as company_admin
from app.companies import applicants as company_applicants
from app.companies import dashboard as company_dashboard
from app.companies import demo as company_demo
from app.companies import posting as company_posting
from app.companies import security as company_security
from app.companies import signup as company_signup
from app.core import errors
from app.core.body_limit import BodyLimit
from app.core.config import get_settings
from app.core.db import DB, close_client, ensure_indexes, get_database
from app.core.email import email_health, get_mailer, log_email_status
from app.core.observability import RequestContext, init_sentry
from app.coupons import router as coupons
from app.courses import router as courses
from app.downloads.router import router as downloads_router
from app.experts.router import router as expert_router
from app.health import service as resume_health
from app.jobs import admin as jobs_admin
from app.jobs import alerts as jobs_alerts
from app.jobs import apply as jobs_apply
from app.jobs import foryou as jobs_foryou
from app.jobs import ingest as jobs_ingest
from app.jobs import public as jobs_public
from app.jobs import reports as jobs_reports
from app.jobsearch.cover_router import router as jobs_cover_router
from app.jobsearch.interview_router import router as jobs_interview_router
from app.jobsearch.router import router as jobs_router
from app.jobsearch.tailor_router import router as jobs_tailor_router
from app.linkedin.pack_router import router as linkedin_pack_router
from app.linkedin.router import router as linkedin_router
from app.maintenance.router import router as maintenance_router
from app.me import delete as account_delete
from app.me import rewards as referral_rewards
from app.me import student_pass
from app.me.router import public as public_router
from app.me.router import router as me_router
from app.orders.router import router as orders_router
from app.orgs import branding as org_branding
from app.orgs import demo_login as org_demo_login
from app.orgs import feedback as org_feedback
from app.orgs import interviews as org_interviews
from app.orgs import kiosk as org_kiosk
from app.orgs import recruiter as org_recruiter
from app.orgs import recruiter_account as org_recruiter_account
from app.orgs import recruiter_portal as org_recruiter_portal
from app.orgs import router as orgs
from app.orgs import staff as org_staff
from app.orgs import transfer as org_transfer
from app.partners import router as partners
from app.payments.router import router as payments_router
from app.photos.router import router as photos_router
from app.profile.router import router as profile_router
from app.projects.router import router as projects_router
from app.simple import readiness as simple_readiness
from app.simple import router as simple
from app.summary.router import router as summary_router
from app.wapay.router import router as wapay_router
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
        # recruiter link code, portal session, recruiter account session
        allow_headers=["Content-Type", "X-Access-Code", "X-Recruiter-Session", "X-Recruiter-Account"],
        expose_headers=["Content-Disposition"],  # file downloads keep their name (e.g. the tailored resume PDF)
    )

    @app.api_route("/health", methods=["GET", "HEAD"], tags=["ops"])
    async def health(db: DB) -> JSONResponse:
        """For uptime monitors (GET or HEAD; a ping every 5 minutes also keeps a free Render server awake)."""
        try:
            await db.command("ping")
        except Exception:
            return JSONResponse({"status": "error", "db": "down"}, status_code=503)
        return JSONResponse({"status": "ok", "db": "ok"})

    @app.get("/api/public/status", tags=["ops"])
    async def public_status(db: DB) -> JSONResponse:
        """The public /status page: is the API up, can it reach its database, can it send email. States only."""
        try:
            await db.command("ping")
            api = "ok"
        except Exception:
            api = "down"
        body = {"api": api, "email": email_health(get_mailer()), "checkedAt": int(time.time() * 1000)}
        return JSONResponse(body, headers={"Cache-Control": "no-store"}, status_code=200 if api == "ok" else 503)

    @app.get("/version", tags=["ops"])
    async def version() -> dict[str, str]:
        """The git commit this server was built from (Render sets RENDER_GIT_COMMIT), to confirm a deploy."""
        commit = os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or "unknown"
        return {"commit": commit}

    app.include_router(auth_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_setup_router)  # before admin_router: /api/admin/setup is public
    app.include_router(admin_router)
    app.include_router(org_demo_login.admin)  # /api/admin/demo-org/coordinator (before orgs.admin)
    app.include_router(org_demo_login.public)  # /api/public/demo-coordinator
    app.include_router(orgs.admin)
    app.include_router(org_staff.admin_staff)
    app.include_router(orgs.public)
    app.include_router(orgs.public_stop)
    app.include_router(org_staff.invites)
    app.include_router(org_transfer.portal)  # /api/org/{org_id}/transfer (before the portal's catch-alls)
    app.include_router(org_transfer.admin)  # /api/admin/orgs/{org_id}/transfer
    app.include_router(org_staff.portal)
    app.include_router(org_kiosk.staff)
    app.include_router(org_branding.router)
    app.include_router(org_recruiter.staff)
    app.include_router(org_recruiter.public)
    app.include_router(org_recruiter_portal.staff)
    app.include_router(org_recruiter_portal.public)
    app.include_router(org_recruiter_account.router)  # /api/recruiter-account (sign-in, My drives)
    app.include_router(org_interviews.portal)  # /api/recruiter/{token}/interviews (R3)
    app.include_router(org_interviews.me)  # /api/me/interviews
    app.include_router(org_interviews.public)  # /api/public/interviews/stop-reminders
    app.include_router(org_interviews.staff)  # /api/org/{org_id}/interviews
    app.include_router(student_pass.router)  # /api/me/pass (P1)
    app.include_router(jobs_admin.router)  # /api/admin/jobs (job board J1)
    app.include_router(jobs_ingest.router)  # /api/jobs/ingest (the job collector, J2)
    app.include_router(jobs_public.router)  # /api/jobs, /api/jobs/{slug}, the jobs sitemap (J3)
    app.include_router(jobs_public.me_router)  # /api/me/saved-jobs
    app.include_router(jobs_apply.router)  # /api/jobs/{id}/apply (J5)
    app.include_router(jobs_apply.me_router)  # /api/me/job-followups
    app.include_router(jobs_apply.public)  # /api/public/jobs/stop-followups
    app.include_router(jobs_foryou.router)  # /api/me/jobs-for-you (J6)
    app.include_router(company_signup.router)  # /api/company/... sign-up and the company's own pages (Phase 2)
    app.include_router(company_security.router)  # /api/company-account/... 2-step, devices
    app.include_router(company_admin.router)  # /api/admin/companies (trust queue)
    app.include_router(company_dashboard.router)  # /api/company/{id}/overview, page, activity
    app.include_router(company_dashboard.public)  # /api/companies/{slug} (public company page)
    app.include_router(company_posting.router)  # /api/company/{id}/jobs (safe posting, C3)
    app.include_router(jobs_reports.router)  # /api/jobs/{id}/report (C4)
    app.include_router(company_applicants.router)  # /api/company/{id}/applicants, /pool (C5)
    app.include_router(company_applicants.me)  # /api/me/applications/{key}/withdraw
    app.include_router(company_demo.router)  # /api/admin/demo-company (Phase 2 demo)
    app.include_router(jobs_reports.admin)  # /api/admin/job-reports
    app.include_router(jobs_alerts.me)  # /api/me/job-alerts (C6)
    app.include_router(auto_settings.router)  # /api/me/auto-apply (Phase 3, A1)
    app.include_router(auto_items.router)  # /api/me/auto-apply/items (A2, A3)
    app.include_router(auto_summary.router)  # /api/me/auto-apply/summary, /emails (A6)
    app.include_router(auto_summary.public)  # /api/public/auto-apply/stop-emails
    app.include_router(auto_admin.router)  # /api/admin/auto-apply (A7)
    app.include_router(auto_admin.company)  # /api/company/{id}/applicants/{app}/irrelevant
    app.include_router(auto_demo.admin)  # /api/admin/auto-apply/demo
    app.include_router(auto_demo.public)  # /api/public/demo-student
    app.include_router(simple_readiness.router)  # /api/me/simple/readiness (job readiness score, E5)
    app.include_router(simple.router)  # /api/me/simple (Easy dashboard, Phase 4)
    app.include_router(simple.org)  # /api/org/{org_id}/simple (a college's Simple by default)
    app.include_router(jobs_alerts.public)  # /api/public/jobs/stop-alerts
    app.include_router(org_feedback.portal)  # /api/recruiter/{token}/feedback (R4)
    app.include_router(org_feedback.account)  # /api/recruiter-account/drives/{id}/feedback
    app.include_router(org_feedback.staff)  # /api/org/{org_id}/recruiter-feedback
    app.include_router(org_kiosk.kiosk)
    app.include_router(org_kiosk.cont)
    app.include_router(admin_console_router)
    app.include_router(maintenance_router)
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
    app.include_router(coupons.me)  # /api/me/codes (Admin → Codes)
    app.include_router(coupons.admin)
    app.include_router(wapay_router)  # pay via WhatsApp (before /api/orders/{id})
    app.include_router(orders_router)
    app.include_router(payments_router)
    app.include_router(profile_router)  # before me_router: /api/me/job-profile
    app.include_router(photos_router)  # /api/me/photo-import
    app.include_router(summary_router)  # /api/me/summary/generate
    app.include_router(projects_router)  # /api/me/projects/strengthen
    app.include_router(certs_router)  # /api/me/certificates (certificate wallet)
    app.include_router(college_drives.staff)  # /api/org/{org_id}/drives (drive days, QR check-in)
    app.include_router(college_drives.me)  # /api/me/drives, /api/me/checkin
    app.include_router(college_eligibility.staff)  # …/drives/{id}/companies/{id}/eligibility, rules, share
    app.include_router(college_eligibility.me)  # /api/me/academic/{membership_id}
    app.include_router(college_offers.staff)  # /api/org/{org_id}/offers (offers, stats, CSV, report PDF)
    app.include_router(college_offers.me)  # /api/me/offers
    app.include_router(college_report.staff)  # /api/org/{org_id}/report/year.pdf, …/drives/{id}/report.pdf
    app.include_router(college_alumni.me)  # /api/me/alumni (opt in, browse, requests, inbox)
    app.include_router(college_alumni.staff)  # /api/org/{org_id}/alumni (invites, counts)
    app.include_router(college_campuses.admin)  # /api/admin/college-groups
    app.include_router(stories.admin)  # /api/admin/stories
    app.include_router(stories.public)  # /api/public/stories
    app.include_router(admin_daily.router)  # /api/admin/today (Dashboard → Today, Share to WhatsApp)
    app.include_router(account_delete.admin)  # /api/admin/deletion-requests
    app.include_router(referral_rewards.admin)  # /api/admin/referral-rewards (see, revoke)
    app.include_router(college_campuses.owner)  # /api/college-group/{id} (roll-up, shared format, drives, invites)
    app.include_router(college_campuses.me)  # /api/me/college-groups
    app.include_router(college_reviews.staff)  # /api/org/{org_id}/reviewers (invite, assign)
    app.include_router(college_reviews.reviewer)  # /api/review/{org_id} (assigned students, comments, status)
    app.include_router(college_reviews.me)  # /api/me/review-comments
    app.include_router(college_reminders.staff)  # /api/org/{org_id}/wa-reminders (wa.me / sms: links, no gateway)
    app.include_router(courses.me)  # /api/me/courses (free courses for missing skills)
    app.include_router(courses.admin)  # /api/admin/courses
    app.include_router(linkedin_router)  # /api/me/linkedin
    app.include_router(linkedin_pack_router)  # /api/me/linkedin/pack
    app.include_router(jobs_router)  # /api/me/jobs (job match, Phases 1-3)
    app.include_router(jobs_tailor_router)  # /api/me/jobs/matches/{id}/tailor
    app.include_router(jobs_cover_router)  # /api/me/jobs/matches/{id}/cover
    app.include_router(jobs_interview_router)  # /api/me/jobs/matches/{id}/interview
    app.include_router(downloads_router)  # /api/me/entitlements, /api/me/exports
    app.include_router(resume_health.router)  # /api/me/health (resume health alerts)
    app.include_router(resume_health.public)  # /api/public/health/unsubscribe
    app.include_router(orgs.me)  # before me_router: /api/me/groups
    app.include_router(stories.me)  # /api/me/stories (before me_router)
    app.include_router(account_delete.me)  # /api/me/account/deletion (before me_router)
    app.include_router(org_staff.my_orgs)  # /api/me/orgs
    app.include_router(org_transfer.me)  # /api/me/org-transfers (accept ownership with the emailed code)
    app.include_router(me_router)
    app.include_router(public_router)
    app.include_router(work_router)
    app.include_router(expert_router)
    return app


app = create_app()
