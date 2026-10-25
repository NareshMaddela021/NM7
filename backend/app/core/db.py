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
    ORG_STAFF: [
        IndexModel([("org_id", ASCENDING), ("email_lc", ASCENDING)], unique=True),
        IndexModel([("user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel("invite_token_hash", sparse=True),
    ],
    ROLL_LISTS: [IndexModel("org_id")],
    KIOSKS: [IndexModel("token_hash", unique=True), IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)])],
    RECRUITER_LINKS: [
        IndexModel("token_hash", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)]),
    ],
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
    APPLICATIONS: [IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)],
    ATS_CHECKS: [IndexModel([("user_id", ASCENDING), ("at", DESCENDING)])],
    SHARES: [IndexModel("slug", unique=True)],  # _id is the owner's user id
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
