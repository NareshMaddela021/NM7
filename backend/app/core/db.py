"""MongoDB: client, documents, indexes, counters and transactions.

Every collection is described by a small Pydantic model (a `Doc`); code reads documents into those models and
writes with explicit updates. Indexes are created at start-up (idempotent). Anything that needs all-or-nothing
writes runs in a multi-document transaction (Atlas clusters are replica sets).
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC
from typing import Annotated, Any, Self

from bson.codec_options import CodecOptions
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient, IndexModel, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.core.config import get_settings

log = logging.getLogger("nm7.db")
Session = AsyncClientSession | None

# Collection names
USERS = "users"
EMAIL_CODES = "email_codes"
SESSIONS = "sessions"
ADMIN_CHALLENGES = "admin_challenges"
TRUSTED_DEVICES = "trusted_devices"
RECOVERY_CODES = "recovery_codes"
RATE_EVENTS = "rate_events"
AUDIT_LOG = "audit_log"
COUNTERS = "counters"
LOCKS = "locks"
ORDERS = "orders"
PAYMENTS = "payments"
WEBHOOK_EVENTS = "webhook_events"
REFUNDS = "refunds"
# Customer dashboard (one owner each: user_id)
RESUMES = "resumes"
COVER_LETTERS = "cover_letters"
APPLICATIONS = "applications"
ATS_CHECKS = "ats_checks"
SHARES = "shares"
TICKETS = "tickets"
# Order fulfilment (intake, drafts, comments, chat) — _id is the order number
ORDER_WORK = "order_work"
# Experts: application form + test task (_id = user id)
EXPERT_PROFILES = "expert_profiles"
# Admin: site settings (prices, rules), quality audits
SETTINGS = "settings"
QUALITY_AUDITS = "quality_audits"
# One master career record per customer (_id = user id)
JOB_PROFILES = "job_profiles"
# Nm7 for Organizations: organizations → groups (join codes) → memberships (who shared which resume, with consent)
ORGANIZATIONS = "organizations"
ORG_GROUPS = "org_groups"
MEMBERSHIPS = "memberships"
ORG_STAFF = "org_staff"  # coordinators / viewers of an organization (invited by email)
EXPORT_JOBS = "export_jobs"  # admin bulk print / ZIP jobs: which memberships, so "done" can mark them printed
KIOSKS = "kiosks"  # kiosk links for events (Phase 3A): token and exit PIN stored hashed
RECRUITER_INVITES = "recruiter_invites"  # recruiter portal: invites by group (token, email codes, sessions hashed)
RECRUITER_LINKS = "recruiter_links"  # Phase 3C: resumes shared with a recruiter (token / access code hashed)
AI_USAGE = "ai_usage"  # daily AI call counters (core/ai_quota.py): per person, per kiosk link, site-wide, outcomes
# Phase 4: organization plans (admin-editable, versioned; _id = plan id)
ORG_PLANS = "org_plans"
INVOICES = "invoices"  # tax invoices, credit notes, proformas (never edited or deleted)
PARTNERS = "partners"  # referral partners (applications and approved partners)
COMMISSIONS = "commissions"  # partner commission ledger: earned (+) and reversed (−) entries
PARTNER_PAYOUTS = "partner_payouts"
ROLL_LISTS = "roll_lists"  # placement dashboard: a group's roll list (_id = group id; name, roll, branch, email)
LINKEDIN = "linkedin_profiles"  # LinkedIn services: the link, PDF / pasted text and the latest check, per user (_id)
LINKEDIN_PACKS = "linkedin_packs"  # who owns the LinkedIn pack (_id = user id): the paying order or an admin grant
HOME_EVENTS = "home_events"  # home page tap counters, per day (no personal data)
JOB_MATCHES = "job_matches"  # job search: the pasted job post, its reading, the score, outputs (per user, never shared)
FEATURE_GRANTS = "feature_grants"  # job search packs granted by an admin (_id = "<feature>:<user id>")
COUPONS = "coupons"  # admin-managed codes (_id = the code, upper case, no spaces): type, value, items, limits, dates
COUPON_USES = "coupon_uses"  # one row per use of a code (_id = "<code>:<user or org>:<n>", n ≤ the per-person limit)
COURSES = "courses"  # free learning links per skill (Admin → Courses), shown for the skills a job match found missing
CERTIFICATES = "certificates"  # certificate wallet: one file per document (PDF/JPG/PNG ≤ 2 MB, ≤ 10 per student)
DRIVES = "drives"  # drive days: companies, slots (company, round, room, time, students) — per organization
DRIVE_CHECKINS = "drive_checkins"  # one row per student present in a slot (_id = "<slot id>:<membership id>")
OFFERS = (
    "offers"  # offers recorded by a college: student, company, role, CTC, type, status (staff and the student only)
)
REMINDER_BATCHES = "reminder_batches"  # WhatsApp / SMS reminder batches: per student a link and "sent" (no gateway)
ALUMNI = "alumni"  # alumni who opted in: company, role, city, open to referrals / mentoring (per college)
ALUMNI_INVITES = "alumni_invites"  # a coordinator's email invites to the alumni network (token stored as a keyed hash)
ALUMNI_REQUESTS = (
    "alumni_requests"  # a student's referral / mentoring request and the replies (only the two of them see it)
)
REVIEW_COMMENTS = (
    "review_comments"  # a faculty reviewer's comments on a student's shared resume (section, line, resolved)
)
COLLEGE_GROUPS = (
    "college_groups"  # a parent college group: its campus organizations, owners (roll-up only), group price
)
JOB_FIT = "job_fit"  # _id = user:job: the cached match score of one resume for one job (rules only)
AUTO_ITEMS = "auto_items"  # Auto Apply: one per (user, job), unique: applied / needs answer / waiting approval / …
AUTO_COPIES = "auto_copies"  # the tailored resume copy Auto Apply sent for one job (the version on the application)
EMAIL_BLOCKS = "email_blocks"  # _id = an address or "@domain": no Auto Apply email after a bounce / a complaint
AUTO_RUNS = "auto_runs"  # _id = IST day: the daily Auto Apply run log
# Auto Apply 2.0 email applications (A3)
AUTO_ALIASES = "auto_aliases"  # _id = the local part of a candidate's apply address (firstname.x7k2) → user_id
AUTO_MAIL = "auto_mail"  # one row per Auto Apply 2.0 email sent (first / follow-up): to, source, day, delivery, reply
AUTO_REPLIES = "auto_replies"  # a company's reply that came to a candidate's apply address (stored, forwarded)
AUTO_MAIL_EVENTS = "auto_mail_events"  # _id = the webhook's message id: each Resend event handled once
# Auto Apply 2.0 partner integrations (A4)
ATS_CONNECTIONS = "ats_connections"  # _id = company id: its hiring system (partner, settings, the key encrypted)
ATS_DELIVERIES = "ats_deliveries"  # one per application sent to a company's hiring system: state, tries, status
FORM_SITES = "auto_form_sites"  # A5: _id = a company site (host, no www): form / one-tap only, robots, terms, counts
# Auto Apply 2.0 one-tap (A6)
AUTO_MORNINGS = "auto_mornings"  # _id = user:day: the morning "N jobs ready" list (items, count, seen, mailed)
HELPER_CODES = "auto_helper_codes"  # _id = keyed hash of a pairing code for the Nm7 Apply helper: 10 minutes, one use
HELPER_TOKENS = "auto_helper_tokens"  # one per paired browser: token hash, scope (kits, mark applied), expiry, revoked
TALENT_POOL = "talent_pool"  # a company's saved applicants (company_id, user_id), kept as long as the application
JOB_REMOVALS = "job_removals"  # round J: "remove this job" requests from companies (Admin → Jobs → Removal requests)
JOB_REPORTS = "job_reports"  # _id = user:job: a student's report of a job (3 from different people pause it)
COMPANIES = "companies"  # company accounts (Phase 2): details, registration, emails, team, trust level, review, flags
SAVED_JOBS = "saved_jobs"  # _id = user:job: a job someone saved on the job board (removed with the account)
JOBS = "jobs"  # the job board: one job post (company, places, type, experience, salary, apply, status, link check)
RECRUITER_FEEDBACK = "recruiter_feedback"  # _id = the invite: a recruiter's rating, common gaps, visit again
INTERVIEWS = "interviews"  # interview rounds a recruiter scheduled: time (UTC), place / link, each student's answer
RECRUITERS = "recruiters"  # recruiter accounts: one per email across colleges (sign-in code and sessions hashed)
STORIES = "stories"  # student testimonials and placement stories: consent, pending → approved / rejected
OPS_DAILY = "ops_daily"  # per IST day counters for the admin summary, e.g. _id "errors:2026-10-28" → n
DELETION_REQUESTS = "deletion_requests"  # self-serve account deletions: dates and status (name / email while open)
ORG_TRANSFERS = "org_transfers"  # an Owner handing the organization to someone else (code hashed, 48 hours)
REFERRAL_REWARDS = "referral_rewards"  # _id = the inviter: when the reward was given, by which friends, revoked
HEALTH = "resume_health"  # per user (_id = user id): dismissed resume health alerts, when the last alert email went
HIRE_INVITES = "hire_invites"  # Phase 5 H2: a company invites an available candidate to a job; accept / not interested
HIRE_USAGE = "hire_usage"  # Phase 5 H2, _id = company:YYYY-MM: the roles a company ran an instant shortlist for
HIRE_WALKINS = "hire_walkins"  # Phase 5 H7, _id = the QR token: a walk-in drive day for a bulk hiring post
HIRE_OFFERS = "hire_offers"  # Phase 5 H6: offers from a template; accept / decline, joining check-ins, Joined
HIRE_SLOTS = "hire_slots"  # Phase 5 H5: interview times a company offers; the candidate books one
HIRE_EVENTS = "hire_events"  # Phase 5 H4: real events behind the reliability score (attended, no-show, joined …)
SKILL_QUESTIONS = "skill_questions"  # Phase 5 H3: the skill check question bank (Admin → Skill tests)
SKILL_ATTEMPTS = "skill_attempts"  # Phase 5 H3: one skill check taken (questions, marks, tab switches, spoken text)
VETTING_BANKS = "vetting_banks"  # Vetting V2: per role the bank version, topics, practical task and rubric history
VETTING_VERIFIED = "vetting_verified"  # Vetting V2: "Skill verified" (L2) records: role, band, scores, expires_at
VETTING_QUEUE = "vetting_queue"  # Vetting V2: Admin review (task grades) and integrity queues
VETTING_DEMAND = "vetting_demand"  # Vetting V1: the hourly demand watch (live jobs by role × city × band)
VETTING_LEVEL_LOG = "vetting_level_log"  # Vetting V1: every change of a person's level or ⚡ (what changed it, when)
VETTING_SHORTLISTS = "vetting_shortlists"  # Vetting V1: cached top 20 per hot role × city (rebuilt hourly)
VETTING_INTERVIEWS = "vetting_interviews"  # Vetting V3: AI screening interviews (transcripts deleted after 180 days)
VETTING_L4 = "vetting_l4"  # Vetting V4: Nm7 human check requests, results and references
VETTING_REVIEWERS = "vetting_reviewers"  # Vetting V4: the reviewer network (roles, slots, calibration, quality)
VETTING_PHOTOS = "vetting_photos"  # Vetting V2: optional photos of past work (proof tasks), deleted after 30 days
# Vetting Trust (T1, app/trust/): consents, the age gate, the breach log, the retention runs. Every Trust data type is
# in app/trust/retention.py with its retention limit; the four data collections below are filled by later items
# (each document has user_id and created_at) and emptied by the retention job.
TRUST_CONSENTS = "trust_consents"  # one row per consent given (purpose, text version, granted / withdrawn, channel)
TRUST_PROFILES = "trust_profiles"  # _id = user id: the age gate (adult from, never the birth date), inactivity notice
TRUST_PARENTS = "trust_parents"  # parental consent requests for under-18s (one-time link hash, parent's answer)
TRUST_BREACHES = "trust_breaches"  # Admin → Vetting Trust → Breach log (72-hour incidents)
TRUST_RUNS = "trust_runs"  # _id "retention" / "inactivity": the last automatic run and its counts
TRUST_SELFIES = "trust_selfies"  # selfies and face-match results (selfie_face consent)
TRUST_VOICE = "trust_voice"  # voice recordings (voice consent)
TRUST_DOCUMENTS = "trust_documents"  # DigiLocker / KYC documents, never Aadhaar (documents consent)
TRUST_SNAPSHOTS = "trust_snapshots"  # webcam snapshots during a test (webcam_snapshots consent)
TRUST_DL_SESSIONS = "trust_dl_sessions"  # T2: DigiLocker requests (vendor reference, status; never document data)
TRUST_EMPLOYER = "trust_employer"  # T4: _id = company id: the business registry check, badge, review (no personal data)
TRUST_EMPLOYER_LOOKUPS = "trust_employer_lookups"  # T4: one row per paid registry lookup (counts; result only)
TRUST_AGENT_PREFS = "trust_agent_prefs"  # T5: _id = user id: WhatsApp / call channels, language, quiet days, opt-outs
TRUST_AGENT_CONVOS = "trust_agent_convos"  # T5: one per job × candidate: the WhatsApp / AI call flow, answers, slot
TRUST_AGENT_EVENTS = "trust_agent_events"  # T5: one row per contact / reply / call / booking / opt-out (counts, caps)
TRUST_AGENT_LOGS = "trust_agent_logs"  # T5: "What we said": message and call transcript text (consent; 90 days)
TRUST_WORK_PREFS = "trust_work_prefs"  # T6: _id = user id: Work preferences (self-declared) and the coarse location pin
TRUST_CRITERIA = "trust_criteria"  # T7: _id = job id: the job's requirements (extracted once per JD version, editable)
TRUST_CRITERIA_EVALS = "trust_criteria_evals"  # T7: _id = user:criterion hash: Met / Not met / Unknown + a quote
TRUST_CRITERIA_QUEUE = "trust_criteria_queue"  # T7: _id = user:criterion hash: waiting for the AI (capped passes)
TRUST_CRITERIA_CLAIMS = "trust_criteria_claims"  # T7: evidence a candidate added (a certificate), checked by Nm7 first
TRUST_INTEGRITY = "trust_integrity"  # T8: _id = user id: the integrity rating, human decisions per signal, the review
TRUST_SPOKEN = "trust_spoken"  # T10: _id = interview id: the spoken-English score (sub-scores, band, provider refs)
TRUST_SPOKEN_AUDIO = "trust_spoken_audio"  # T10: voice clips, only when Admin turns keeping on (off by default; days)
TRUST_FACE = "trust_face"  # T3: _id = user id: the ID + selfie result, retries, review, joining check (never photos)
LEARN_PATHS = "learn_paths"  # Phase 6 S2, _id = role id: courses → project → skill check (Admin → Learning paths)
OFFER_CHECKS = (
    "offer_checks"  # Phase 6 S5: saved offer-letter checks (text without ID numbers + result; never the file)
)
INTERVIEW_REVIEWS = "interview_reviews"  # Phase 6 S6: private self-reviews after an interview
PROGRAMS = "programs"  # Phase 6 S8: internships and 1–4 week live projects from Verified companies
PROGRAM_APPS = "program_apps"  # Phase 6 S8: applications, accepted places, work sent, review, certificate number
JOININGS = "joinings"  # Phase 6 S10: jobs joined (Nm7 offers or told by the student), checklist, day 7 / 30 check-ins
JOINING_REPORTS = "joining_reports"  # Phase 6 S10: "not as promised" reports from check-ins (Admin → Joining reports)
PRACTICE_ATTEMPTS = "practice_attempts"  # Phase 6 S3: practice tests (never a verified score; kept apart from H3)
LEARN_PROGRESS = "learn_progress"  # Phase 6 S2, _id = user:role: courses ticked, the project sent, verified at
DAILY_REPORTS = "daily_reports"  # Admin → Daily report: one snapshot per IST day (_id "YYYY-MM-DD"), 30-day trends
COLLECTOR_RUNS = "collector_runs"  # the job collector's run reports (_id = its runId): counts, reasons, ok / error
HIRE_PROFILES = "hire_profiles"  # Phase 5 H1, _id = user: "Ready to join" (join date, cities, salary), consent
COLLECTIONS = (
    USERS,
    EMAIL_CODES,
    SESSIONS,
    ADMIN_CHALLENGES,
    TRUSTED_DEVICES,
    RECOVERY_CODES,
    RATE_EVENTS,
    AUDIT_LOG,
    COUNTERS,
    LOCKS,
    ORDERS,
    PAYMENTS,
    WEBHOOK_EVENTS,
    REFUNDS,
    RESUMES,
    COVER_LETTERS,
    APPLICATIONS,
    ATS_CHECKS,
    SHARES,
    TICKETS,
    ORDER_WORK,
    EXPERT_PROFILES,
    SETTINGS,
    QUALITY_AUDITS,
    JOB_PROFILES,
    ORGANIZATIONS,
    ORG_GROUPS,
    MEMBERSHIPS,
    EXPORT_JOBS,
    ORG_STAFF,
    ROLL_LISTS,
    KIOSKS,
    RECRUITER_LINKS,
    RECRUITER_INVITES,
    AI_USAGE,
    ORG_PLANS,
    INVOICES,
    PARTNERS,
    COMMISSIONS,
    PARTNER_PAYOUTS,
    LINKEDIN,
    LINKEDIN_PACKS,
    HOME_EVENTS,
    JOB_MATCHES,
    FEATURE_GRANTS,
    COUPONS,
    COUPON_USES,
    HEALTH,
    COURSES,
    CERTIFICATES,
    DRIVES,
    DRIVE_CHECKINS,
    OFFERS,
    REMINDER_BATCHES,
    ALUMNI,
    ALUMNI_INVITES,
    ALUMNI_REQUESTS,
    REVIEW_COMMENTS,
    COLLEGE_GROUPS,
    REFERRAL_REWARDS,
    ORG_TRANSFERS,
    DELETION_REQUESTS,
    OPS_DAILY,
    STORIES,
    RECRUITERS,
    INTERVIEWS,
    RECRUITER_FEEDBACK,
    JOBS,
    SAVED_JOBS,
    JOB_FIT,
    COMPANIES,
    JOB_REPORTS,
    JOB_REMOVALS,
    TALENT_POOL,
    AUTO_ITEMS,
    AUTO_COPIES,
    AUTO_RUNS,
    EMAIL_BLOCKS,
    AUTO_ALIASES,
    AUTO_MAIL,
    AUTO_REPLIES,
    AUTO_MAIL_EVENTS,
    ATS_CONNECTIONS,
    ATS_DELIVERIES,
    FORM_SITES,
    AUTO_MORNINGS,
    HELPER_CODES,
    HELPER_TOKENS,
    HIRE_PROFILES,
    HIRE_INVITES,
    HIRE_USAGE,
    SKILL_QUESTIONS,
    SKILL_ATTEMPTS,
    VETTING_BANKS,
    VETTING_VERIFIED,
    VETTING_QUEUE,
    VETTING_PHOTOS,
    TRUST_CONSENTS,
    TRUST_PROFILES,
    TRUST_PARENTS,
    TRUST_BREACHES,
    TRUST_RUNS,
    TRUST_SELFIES,
    TRUST_VOICE,
    TRUST_DOCUMENTS,
    TRUST_SNAPSHOTS,
    TRUST_DL_SESSIONS,
    TRUST_FACE,
    TRUST_EMPLOYER,
    TRUST_EMPLOYER_LOOKUPS,
    TRUST_AGENT_PREFS,
    TRUST_AGENT_CONVOS,
    TRUST_AGENT_EVENTS,
    TRUST_AGENT_LOGS,
    TRUST_WORK_PREFS,
    TRUST_CRITERIA,
    TRUST_CRITERIA_EVALS,
    TRUST_CRITERIA_QUEUE,
    TRUST_CRITERIA_CLAIMS,
    TRUST_INTEGRITY,
    TRUST_SPOKEN,
    TRUST_SPOKEN_AUDIO,
    VETTING_L4,
    VETTING_REVIEWERS,
    VETTING_INTERVIEWS,
    VETTING_DEMAND,
    VETTING_LEVEL_LOG,
    VETTING_SHORTLISTS,
    HIRE_EVENTS,
    HIRE_SLOTS,
    HIRE_OFFERS,
    HIRE_WALKINS,
    LEARN_PATHS,
    LEARN_PROGRESS,
    PRACTICE_ATTEMPTS,
    OFFER_CHECKS,
    INTERVIEW_REVIEWS,
    PROGRAMS,
    PROGRAM_APPS,
    JOININGS,
    JOINING_REPORTS,
    DAILY_REPORTS,
    COLLECTOR_RUNS,
)

DAY = 86_400
WEBHOOK_KEEP = 90 * DAY  # provider webhook payloads are kept 90 days (duplicates are only replayed within that)


class Doc(BaseModel):
    """A stored document. `id` is Mongo's `_id`."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Any = Field(alias="_id")

    def to_mongo(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)

    @classmethod
    def load(cls, raw: dict[str, Any] | None) -> Self | None:
        return cls.model_validate(raw) if raw is not None else None


def _str(field: str) -> dict:
    return {field: {"$type": "string"}}


INDEXES: dict[str, list[IndexModel]] = {
    AI_USAGE: [IndexModel("day"), IndexModel("expires_at", expireAfterSeconds=0)],
    USERS: [
        IndexModel("email_lc", unique=True),
        IndexModel("role"),
        IndexModel("unverified_expires_at", expireAfterSeconds=0),  # sign-ups never confirmed are dropped
        IndexModel("referral_code", unique=True, partialFilterExpression=_str("referral_code")),
        IndexModel("referred_by"),
    ],
    EMAIL_CODES: [
        IndexModel([("user_id", ASCENDING), ("purpose", ASCENDING), ("used_at", ASCENDING)]),
        IndexModel("code_hash"),  # the public "continue on your phone" link is looked up by its hash alone
        IndexModel("expires_at", expireAfterSeconds=DAY),  # cleaned up a day after expiry
    ],
    SESSIONS: [
        IndexModel("token_hash", unique=True),
        IndexModel("user_id"),
        IndexModel("expires_at", expireAfterSeconds=DAY),
    ],
    ADMIN_CHALLENGES: [IndexModel("token_hash", unique=True), IndexModel("expires_at", expireAfterSeconds=DAY)],
    TRUSTED_DEVICES: [
        IndexModel("token_hash", unique=True),
        IndexModel("user_id"),
        IndexModel("expires_at", expireAfterSeconds=DAY),
    ],
    RECOVERY_CODES: [IndexModel([("user_id", ASCENDING), ("code_hash", ASCENDING)])],
    RATE_EVENTS: [IndexModel([("key", ASCENDING), ("at", ASCENDING)]), IndexModel("at", expireAfterSeconds=DAY)],
    ORGANIZATIONS: [
        IndexModel("name"),
        IndexModel([("created_at", DESCENDING)]),
        IndexModel("subscription.ends_on"),  # renewals due, end-of-plan reminders
    ],
    ORG_GROUPS: [IndexModel("code", unique=True), IndexModel("org_id")],
    MEMBERSHIPS: [
        IndexModel([("user_id", ASCENDING), ("group_id", ASCENDING)], unique=True),
        IndexModel([("group_id", ASCENDING), ("left_at", ASCENDING)]),
        IndexModel([("org_id", ASCENDING), ("left_at", ASCENDING)]),
    ],
    EXPORT_JOBS: [IndexModel("created_at", expireAfterSeconds=DAY)],
    JOBS: [
        IndexModel("dedupe_key", unique=True),
        IndexModel("slug", unique=True),
        IndexModel([("status", ASCENDING), ("posted_at", DESCENDING)]),
        IndexModel([("source", ASCENDING), ("created_at", DESCENDING)]),
    ],
    SAVED_JOBS: [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)])],
    JOB_FIT: [IndexModel("user_id"), IndexModel("at", expireAfterSeconds=30 * DAY)],
    AUTO_ITEMS: [
        IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING)], unique=True),  # never the same job twice
        IndexModel([("user_id", ASCENDING), ("state", ASCENDING)]),
        IndexModel([("state", ASCENDING), ("updated_at", DESCENDING)]),
        # A7: the Admin numbers count 2.0 items by when they were made (aggregations, never whole collections)
        IndexModel([("v2", ASCENDING), ("created_at", ASCENDING)], partialFilterExpression={"v2": True}),
    ],
    AUTO_COPIES: [
        IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING)]),
        # Auto Apply 2.0: one tailored version per (candidate, job, resume version), never tailored twice
        IndexModel("cache_key", unique=True, partialFilterExpression=_str("cache_key")),
    ],
    AUTO_ALIASES: [IndexModel("user_id", unique=True)],
    AUTO_MAIL: [
        # one first email and one follow-up per (candidate, job), ever
        IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING), ("kind", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("day", ASCENDING)]),
        IndexModel([("domain", ASCENDING), ("day", ASCENDING)]),
        IndexModel("provider_id", partialFilterExpression=_str("provider_id")),
        IndexModel([("kind", ASCENDING), ("at", ASCENDING)]),
    ],
    AUTO_REPLIES: [IndexModel([("user_id", ASCENDING), ("received_at", DESCENDING)]), IndexModel("item_id")],
    AUTO_MAIL_EVENTS: [IndexModel("at", expireAfterSeconds=30 * DAY)],
    ATS_CONNECTIONS: [IndexModel("partner")],
    FORM_SITES: [IndexModel([("state", ASCENDING), ("last_tried", DESCENDING)])],
    AUTO_MORNINGS: [IndexModel([("user_id", ASCENDING), ("day", DESCENDING)])],
    HELPER_CODES: [IndexModel("user_id"), IndexModel("expires_at", expireAfterSeconds=0)],
    HELPER_TOKENS: [
        IndexModel("token_hash", unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
    ],
    ATS_DELIVERIES: [
        IndexModel("app_id", unique=True),  # one delivery per application, ever
        IndexModel([("state", ASCENDING), ("next_at", ASCENDING)]),
        IndexModel([("state", ASCENDING), ("checked_at", ASCENDING)]),
        IndexModel([("partner", ASCENDING), ("day", ASCENDING)]),
        IndexModel([("company_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel("user_id"),
    ],
    HIRE_PROFILES: [IndexModel([("on", ASCENDING), ("confirmed_at", DESCENDING)])],
    LEARN_PROGRESS: [IndexModel([("user_id", ASCENDING), ("updated_at", DESCENDING)])],
    PRACTICE_ATTEMPTS: [IndexModel([("user_id", ASCENDING), ("started_at", DESCENDING)])],
    OFFER_CHECKS: [IndexModel([("user_id", ASCENDING), ("at", DESCENDING)])],
    INTERVIEW_REVIEWS: [IndexModel([("user_id", ASCENDING), ("at", DESCENDING)])],
    JOININGS: [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("offer_id", ASCENDING)], sparse=True),
    ],
    JOINING_REPORTS: [IndexModel([("company_id", ASCENDING), ("at", DESCENDING)]), IndexModel([("status", ASCENDING)])],
    PROGRAMS: [
        IndexModel([("company_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("status", ASCENDING)]),
    ],
    PROGRAM_APPS: [
        IndexModel([("program_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("cert", ASCENDING)], sparse=True),
    ],
    HIRE_WALKINS: [IndexModel([("company_id", ASCENDING), ("job_id", ASCENDING)], unique=True)],
    HIRE_OFFERS: [
        IndexModel([("company_id", ASCENDING), ("job_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("status", ASCENDING), ("join_date", ASCENDING)]),
    ],
    HIRE_SLOTS: [
        IndexModel([("job_id", ASCENDING), ("status", ASCENDING), ("starts_at", ASCENDING)]),
        IndexModel([("company_id", ASCENDING), ("starts_at", ASCENDING)]),
        IndexModel([("status", ASCENDING), ("starts_at", ASCENDING)]),
        IndexModel("user_id"),
    ],
    HIRE_EVENTS: [IndexModel([("user_id", ASCENDING), ("kind", ASCENDING), ("ref", ASCENDING)], unique=True)],
    SKILL_QUESTIONS: [IndexModel([("skill", ASCENDING), ("active", ASCENDING)])],
    SKILL_ATTEMPTS: [
        IndexModel([("user_id", ASCENDING), ("skill", ASCENDING), ("started_at", DESCENDING)]),
        IndexModel([("user_id", ASCENDING), ("share", ASCENDING)]),
        IndexModel([("skill", ASCENDING), ("submitted_at", DESCENDING)]),  # V2: answer patterns across accounts
        IndexModel([("skill", ASCENDING), ("fp.device", ASCENDING)]),  # V2: the same device on several accounts
    ],
    VETTING_VERIFIED: [
        IndexModel([("user_id", ASCENDING), ("test", ASCENDING)], unique=True),
        IndexModel([("test", ASCENDING), ("expires_at", ASCENDING)]),
    ],
    VETTING_QUEUE: [IndexModel([("kind", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)])],
    VETTING_PHOTOS: [IndexModel("delete_at", expireAfterSeconds=0), IndexModel("attempt_id")],
    VETTING_LEVEL_LOG: [IndexModel([("user_id", ASCENDING), ("at", DESCENDING)])],
    TRUST_CONSENTS: [IndexModel([("user_id", ASCENDING), ("purpose", ASCENDING), ("granted_at", DESCENDING)])],
    TRUST_PARENTS: [IndexModel("token_hash", unique=True, sparse=True), IndexModel("user_id")],
    TRUST_BREACHES: [IndexModel([("detected_at", DESCENDING)])],
    TRUST_SELFIES: [IndexModel("user_id"), IndexModel("created_at")],
    TRUST_VOICE: [IndexModel("user_id"), IndexModel("created_at")],
    TRUST_DOCUMENTS: [
        IndexModel("user_id"),
        IndexModel("created_at"),
        IndexModel("pan_hash", sparse=True),
        IndexModel([("review.status", ASCENDING), ("fetched_at", DESCENDING)]),
    ],  # fmt: skip
    TRUST_DL_SESSIONS: [
        IndexModel("user_id"),
        IndexModel("created_at"),
        IndexModel([("vendor", ASCENDING), ("vendor_ref", ASCENDING)]),
    ],  # fmt: skip
    TRUST_SNAPSHOTS: [
        IndexModel("user_id"),
        IndexModel("created_at"),
        IndexModel([("session", ASCENDING), ("kind", ASCENDING)]),
    ],
    TRUST_INTEGRITY: [
        IndexModel([("review.status", ASCENDING), ("review.opened_at", ASCENDING)]),
        IndexModel([("level", ASCENDING), ("at", DESCENDING)]),
        IndexModel("updated_at"),
    ],
    TRUST_FACE: [
        IndexModel("process_at"),
        IndexModel([("review.status", ASCENDING), ("updated_at", DESCENDING)]),
        IndexModel([("continuity.review.status", ASCENDING)]),
    ],  # fmt: skip
    TRUST_EMPLOYER: [
        IndexModel([("status", ASCENDING), ("next_check_at", ASCENDING)]),
        IndexModel("number_hash"),
        IndexModel("checked_at"),
    ],  # fmt: skip
    TRUST_EMPLOYER_LOOKUPS: [IndexModel("at"), IndexModel([("company_id", ASCENDING), ("at", DESCENDING)])],
    TRUST_AGENT_PREFS: [IndexModel("wa_id"), IndexModel("updated_at")],
    TRUST_WORK_PREFS: [IndexModel("updated_at"), IndexModel("location.at", sparse=True)],
    TRUST_SPOKEN: [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]), IndexModel("created_at")],
    TRUST_SPOKEN_AUDIO: [IndexModel("user_id"), IndexModel("created_at")],
    TRUST_CRITERIA_EVALS: [IndexModel("user_id"), IndexModel("at")],
    TRUST_CRITERIA_QUEUE: [IndexModel("at"), IndexModel("job_id"), IndexModel("user_id")],
    TRUST_CRITERIA_CLAIMS: [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("status", ASCENDING), ("created_at", ASCENDING)]),
    ],
    TRUST_AGENT_CONVOS: [
        IndexModel([("job_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
        IndexModel([("state", ASCENDING), ("next_at", ASCENDING)]),
        IndexModel([("user_id", ASCENDING), ("updated_at", DESCENDING)]),
        IndexModel("call.ref"),
        IndexModel("created_at"),
    ],  # fmt: skip
    TRUST_AGENT_EVENTS: [
        IndexModel([("user_id", ASCENDING), ("day", ASCENDING), ("kind", ASCENDING)]),
        IndexModel([("at", DESCENDING)]),
        IndexModel([("job_id", ASCENDING), ("kind", ASCENDING)]),
        IndexModel("msg_id", sparse=True),
    ],  # fmt: skip
    TRUST_AGENT_LOGS: [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel("convo_id"),
        IndexModel("created_at"),
    ],
    VETTING_L4: [
        IndexModel([("user_id", ASCENDING), ("requested_at", DESCENDING)]),
        IndexModel("referees.rid"),
        IndexModel("referees.keys"),
        IndexModel([("status", ASCENDING), ("due_at", ASCENDING)]),
    ],
    VETTING_INTERVIEWS: [
        IndexModel([("user_id", ASCENDING), ("test", ASCENDING), ("started_at", DESCENDING)]),
        IndexModel("delete_at", expireAfterSeconds=0),  # transcripts: 180 days
        IndexModel([("status", ASCENDING), ("graded_at", DESCENDING)]),
    ],
    VETTING_SHORTLISTS: [IndexModel("users")],
    HIRE_INVITES: [
        IndexModel([("company_id", ASCENDING), ("job_id", ASCENDING), ("user_id", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("company_id", ASCENDING), ("created_at", DESCENDING)]),
    ],
    TALENT_POOL: [IndexModel([("company_id", ASCENDING), ("user_id", ASCENDING)], unique=True), IndexModel("user_id")],
    JOB_REMOVALS: [IndexModel([("status", ASCENDING), ("at", DESCENDING)])],
    JOB_REPORTS: [
        IndexModel([("job_id", ASCENDING), ("state", ASCENDING)]),
        IndexModel([("state", ASCENDING), ("at", DESCENDING)]),
        IndexModel([("company_id", ASCENDING), ("state", ASCENDING)]),  # T4: fraud reports about a company
    ],
    COMPANIES: [
        IndexModel("slug", unique=True),
        IndexModel("reg_key"),
        IndexModel("phone_key"),
        IndexModel("members.email_lc"),
        IndexModel([("review.state", ASCENDING), ("updated_at", DESCENDING)]),
        IndexModel([("signup.ip_hash", ASCENDING), ("created_at", DESCENDING)]),
    ],
    RECRUITER_FEEDBACK: [IndexModel([("org_id", ASCENDING), ("updated_at", DESCENDING)])],
    INTERVIEWS: [
        IndexModel([("invite_id", ASCENDING), ("starts_at", ASCENDING)]),
        IndexModel([("org_id", ASCENDING), ("starts_at", ASCENDING)]),
        IndexModel("students.user_id"),
        IndexModel([("cancelled_at", ASCENDING), ("starts_at", ASCENDING)]),
    ],
    RECRUITERS: [IndexModel("email_lc", unique=True), IndexModel("sessions.hash")],
    STORIES: [IndexModel([("status", ASCENDING), ("decided_at", DESCENDING)]), IndexModel("user_id")],
    ORG_TRANSFERS: [IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]), IndexModel("to_email_lc")],
    ORG_STAFF: [
        IndexModel([("org_id", ASCENDING), ("email_lc", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel("invite_token_hash", sparse=True),
    ],
    ROLL_LISTS: [IndexModel("org_id")],
    COUPONS: [IndexModel([("created_at", DESCENDING)]), IndexModel("batch", sparse=True)],
    COUPON_USES: [IndexModel([("code", ASCENDING), ("at", DESCENDING)]), IndexModel("user_id"), IndexModel("order_id")],
    KIOSKS: [IndexModel("token_hash", unique=True), IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)])],
    RECRUITER_INVITES: [
        IndexModel("token_hash", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel("email_lc"),  # a recruiter account's drives
    ],
    RECRUITER_LINKS: [
        IndexModel("token_hash", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)]),
    ],
    COLLECTOR_RUNS: [IndexModel([("day", ASCENDING), ("started_at", DESCENDING)])],
    AUDIT_LOG: [
        IndexModel([("at", DESCENDING)]),
        IndexModel("action"),
        IndexModel("actor_id"),
        IndexModel([("target", ASCENDING), ("at", DESCENDING)]),
        IndexModel([("data.orgs", ASCENDING), ("_id", DESCENDING)]),  # an organization's audit page (newest first)
    ],
    ORDERS: [
        # _id is the order number (RS-1001…), unique by definition.
        IndexModel("invoice_no", unique=True, partialFilterExpression=_str("invoice_no")),
        IndexModel([("customer_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel("status"),
        IndexModel("deadline_at"),
        IndexModel("paid_at"),  # invoices, reports and expert work lists sort / range on it
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], partialFilterExpression=_str("org_id")),
    ],
    PARTNERS: [
        IndexModel("email_lc", unique=True),
        IndexModel("code", unique=True, partialFilterExpression=_str("code")),
        IndexModel("user_id", partialFilterExpression=_str("user_id")),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
    ],
    COMMISSIONS: [
        IndexModel(
            "order_id", name="one_commission_per_order", unique=True, partialFilterExpression={"kind": "commission"}
        ),
        IndexModel("refund_id", unique=True, partialFilterExpression=_str("refund_id")),
        IndexModel([("partner_id", ASCENDING), ("status", ASCENDING), ("payable_on", ASCENDING)]),
        IndexModel("org_id"),
    ],
    HOME_EVENTS: [IndexModel("day")],
    JOB_MATCHES: [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)])],
    COURSES: [IndexModel("skill")],
    DRIVES: [IndexModel([("org_id", ASCENDING), ("date", DESCENDING)]), IndexModel("slots.members")],
    DRIVE_CHECKINS: [IndexModel("drive_id"), IndexModel("slot_id")],
    ALUMNI: [IndexModel([("org_id", ASCENDING), ("user_id", ASCENDING)])],
    ALUMNI_INVITES: [IndexModel("token_hash"), IndexModel("org_id")],
    ALUMNI_REQUESTS: [
        IndexModel([("from_user", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel("to_user"),
        IndexModel("org_id"),
    ],
    COLLEGE_GROUPS: [IndexModel("owner_ids"), IndexModel("org_ids")],
    REVIEW_COMMENTS: [IndexModel([("org_id", ASCENDING), ("membership_id", ASCENDING)]), IndexModel("user_id")],
    REMINDER_BATCHES: [IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)])],
    OFFERS: [IndexModel([("org_id", ASCENDING), ("membership_id", ASCENDING)]), IndexModel("user_id")],
    CERTIFICATES: [IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)])],
    FEATURE_GRANTS: [IndexModel("user_id")],
    PARTNER_PAYOUTS: [IndexModel([("partner_id", ASCENDING), ("created_at", DESCENDING)])],
    INVOICES: [
        IndexModel("number", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("fy", ASCENDING), ("kind", ASCENDING), ("number", ASCENDING)]),
        IndexModel("order_id"),
        IndexModel("refund_id", unique=True, partialFilterExpression=_str("refund_id")),  # one credit note a refund
    ],
    WEBHOOK_EVENTS: [IndexModel("received_at", expireAfterSeconds=WEBHOOK_KEEP)],
    PAYMENTS: [
        IndexModel("razorpay_order_id", unique=True, partialFilterExpression=_str("razorpay_order_id")),
        IndexModel("razorpay_payment_id", unique=True, partialFilterExpression=_str("razorpay_payment_id")),
        IndexModel("razorpay_link_id", unique=True, partialFilterExpression=_str("razorpay_link_id")),
        IndexModel("reference", unique=True, partialFilterExpression=_str("reference")),  # UTR of a WhatsApp payment
        IndexModel("order_id"),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
    ],
    REFUNDS: [
        # At most one open refund (review / approved / processed) per order.
        IndexModel("order_id", name="one_open_refund_per_order", unique=True, partialFilterExpression={"open": True}),
        IndexModel("razorpay_refund_id", unique=True, partialFilterExpression=_str("razorpay_refund_id")),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
    ],
    # Each item has a per-owner `key` (the id the browser uses); every lookup includes user_id.
    RESUMES: [IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)],
    COVER_LETTERS: [IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)],
    APPLICATIONS: [
        IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True),
        # A7: Auto Apply 2.0's per-channel numbers (Admin → Daily report) count by sent day
        IndexModel([("v2", ASCENDING), ("created_at", ASCENDING)], partialFilterExpression={"v2": True}),
    ],
    ATS_CHECKS: [IndexModel([("user_id", ASCENDING), ("at", DESCENDING)])],
    # _id is the owner's user id; short is the code of the short link
    SHARES: [IndexModel("slug", unique=True), IndexModel("short", unique=True, sparse=True)],
    ORDER_WORK: [IndexModel("expert_id")],
    EXPERT_PROFILES: [IndexModel([("status", ASCENDING), ("submitted_at", DESCENDING)])],
    QUALITY_AUDITS: [IndexModel([("at", DESCENDING)]), IndexModel("expert_id")],
    TICKETS: [
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)]),
    ],
}

_client: AsyncMongoClient | None = None


def get_client() -> AsyncMongoClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = AsyncMongoClient(
            s.mongodb_uri,
            tz_aware=True,
            tzinfo=UTC,
            uuidRepresentation="standard",
            appname="nm7-api",
            serverSelectionTimeoutMS=10_000,
        )
    return _client


def get_database() -> AsyncDatabase:
    return get_client().get_database(get_settings().mongodb_db, codec_options=CodecOptions(tz_aware=True, tzinfo=UTC))


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.close()
    _client = None


async def get_db() -> AsyncDatabase:
    """FastAPI dependency."""
    return get_database()


DB = Annotated[AsyncDatabase, Depends(get_db)]


INDEX_CONFLICT = (
    85,
    86,
)  # IndexOptionsConflict (same name, other options) / IndexKeySpecsConflict (same name, other keys)


async def _replace_index(db: AsyncDatabase, name: str, index: IndexModel) -> None:
    """An index exists under this name (other keys or options) or these keys (other name): drop it, make ours."""
    spec = index.document
    want = list(spec["key"].items())
    info = await db[name].index_information()
    for existing, meta in info.items():
        if existing == "_id_":
            continue
        if existing == spec["name"] or [tuple(k) for k in meta.get("key", [])] == want:
            log.warning("index %s.%s conflicts with the current definition: dropping and recreating it", name, existing)
            await db[name].drop_index(existing)
    await db[name].create_indexes([index])


async def ensure_indexes(db: AsyncDatabase) -> None:
    """Creates collections and indexes (safe on every start). An index whose definition changed since the last
    deploy (a TTL, uniqueness, different keys under the same name) is dropped and recreated instead of failing
    the start-up with IndexOptionsConflict / IndexKeySpecsConflict."""
    existing = set(await db.list_collection_names())
    for name in COLLECTIONS:
        if name not in existing:
            await db.create_collection(name)  # transactions can't create collections, so make them all up front
    for name, indexes in INDEXES.items():
        try:
            await db[name].create_indexes(indexes)
            continue
        except OperationFailure as e:
            if e.code not in INDEX_CONFLICT:
                raise
        for index in indexes:  # one at a time: only the conflicting one is replaced
            try:
                await db[name].create_indexes([index])
            except OperationFailure as e:
                if e.code not in INDEX_CONFLICT:
                    raise
                await _replace_index(db, name, index)


async def transaction[T](fn: Callable[[AsyncClientSession], Awaitable[T]]) -> T:
    """Runs `fn(session)` in a multi-document transaction; retried automatically on transient conflicts, so `fn`
    must only touch the database (no emails or payment-provider calls inside)."""
    async with get_client().start_session() as s:
        return await s.with_transaction(fn)


async def next_number(db: AsyncDatabase, name: str, start: int, session: Session = None) -> int:
    """Atomic counter: the first call returns `start`, then start+1, … (never repeats)."""
    doc = await db[COUNTERS].find_one_and_update(
        {"_id": name},
        [{"$set": {"value": {"$add": [{"$ifNull": ["$value", start - 1]}, 1]}}}],
        upsert=True,
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    return int(doc["value"])
