"""Account documents (users, email codes, sessions, admin two-step login)."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.core.db import Doc
from app.core.time import now

ROLES = ("customer", "expert", "admin")
# One account for individuals: the things a person does on Nm7. `role` above stays the account type the rest of the
# app checks ("customer" for job seekers and students, "expert" for experts); it follows the active individual role.
INDIVIDUAL_ROLES = ("jobseeker", "student", "expert")
CODE_PURPOSES = ("verify_email", "reset_password")


def new_id() -> str:
    return str(uuid.uuid4())


class User(Doc):
    id: str = Field(default_factory=new_id, alias="_id")
    email: str  # as typed; unique and matched case-insensitively through email_lc
    email_lc: str = ""
    name: str
    phone: str | None = None
    role: str  # customer / expert / admin
    admin_role: str | None = None  # owner / ops / finance / support / quality
    expert_status: str | None = None  # draft / review / test / approved / rejected
    password_hash: str
    totp_secret_enc: str | None = None  # admins: encrypted authenticator secret
    totp_last_step: int | None = None  # last accepted 30-second step (no reuse)
    email_verified_at: datetime | None = None
    unverified_expires_at: datetime | None = None  # set at sign-up, removed on confirmation; TTL index
    signup_token_hash: str | None = None  # the browser that signed up (or signed in) is the one that may confirm
    terms_accepted_at: datetime | None = None
    roles: list[str] = Field(default_factory=list)  # jobseeker / student / expert; empty on older accounts (derived)
    active_role: str | None = None  # the dashboard shown now; None on older accounts (derived from `role`)
    roles_pending: bool = False  # signed up on the new page and hasn't answered "What would you like to do?" yet
    expert_terms_accepted_at: datetime | None = None  # ticked the Expert Terms when adding the expert role
    disabled_at: datetime | None = None
    # Customer profile (dashboard settings)
    target_role: str = ""
    cities: str = ""
    level: str = ""
    notify: dict[str, Any] = Field(default_factory=dict)  # {channel: {topic: bool}}
    ui: dict[str, Any] = Field(default_factory=dict)  # small per-user screen state: call picks, messages seen
    referral_code: str | None = None
    referred_by: str | None = None  # user id of the friend who referred them
    ref_flags: list[str] = Field(default_factory=list)  # why this sign-up does not count for a referral reward
    partner_id: str | None = None  # an approved referral partner (Phase 4C): /partner
    password_changed_at: datetime | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)

    def model_post_init(self, _ctx) -> None:
        self.email_lc = self.email.strip().lower()
        if self.role not in ROLES or (self.role == "admin") != (self.admin_role is not None):
            raise ValueError("invalid role / admin_role")

    @property
    def verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def individual_roles(self) -> list[str]:
        """The person's roles. Older accounts have none stored: they are derived from the account type (a customer is
        a job seeker, an expert an expert), so nothing has to be rewritten. Admins have no individual roles."""
        if self.role == "admin":
            return []
        have = set(self.roles) & set(INDIVIDUAL_ROLES)
        if self.role == "expert":
            have.add("expert")
        elif not have & {"jobseeker", "student"}:
            have.add("jobseeker")
        return [r for r in INDIVIDUAL_ROLES if r in have]

    @property
    def current_role(self) -> str | None:
        """The active role. It always agrees with `role` (which the route guards check)."""
        mine = self.individual_roles
        if not mine:
            return None
        if self.role == "expert":
            return "expert"
        if self.active_role in mine and self.active_role != "expert":
            return self.active_role
        return next(r for r in mine if r != "expert")


class EmailCode(Doc):
    """One-time 6-digit codes sent by email. Only a keyed hash is stored."""

    id: str = Field(default_factory=new_id, alias="_id")
    user_id: str
    purpose: str
    code_hash: str
    expires_at: datetime
    attempts: int = 0
    used_at: datetime | None = None
    ip: str | None = None
    created_at: datetime = Field(default_factory=now)


class UserSession(Doc):
    """A signed-in browser. The cookie holds a random token; only its keyed hash is stored."""

    id: str = Field(default_factory=new_id, alias="_id")
    user_id: str
    token_hash: str
    two_step: bool = False
    created_at: datetime = Field(default_factory=now)
    expires_at: datetime
    last_seen_at: datetime = Field(default_factory=now)
    ip: str | None = None
    user_agent: str | None = None
    revoked_at: datetime | None = None
    demo_org_id: str | None = None  # the demo coordinator (Admin → Organizations → Demo): only that demo college
    kiosk_id: str | None = None  # signed in at an event kiosk: short, fixed expiry; ends when the kiosk is revoked


class AdminChallenge(Doc):
    """Between admin step 1 (password) and step 2 (authenticator code). Lives 5 minutes."""

    id: str = Field(default_factory=new_id, alias="_id")
    user_id: str
    token_hash: str
    expires_at: datetime
    attempts: int = 0
    used_at: datetime | None = None
    created_at: datetime = Field(default_factory=now)


class TrustedDevice(Doc):
    """Trust this device for 30 days: skips the authenticator code (the password is still needed)."""

    id: str = Field(default_factory=new_id, alias="_id")
    user_id: str
    token_hash: str
    expires_at: datetime
    ip: str | None = None
    user_agent: str | None = None
    created_at: datetime = Field(default_factory=now)
    revoked_at: datetime | None = None


class RecoveryCode(Doc):
    """One-time codes for an admin who lost their authenticator."""

    id: str = Field(default_factory=new_id, alias="_id")
    user_id: str
    code_hash: str
    used_at: datetime | None = None
