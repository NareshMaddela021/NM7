"""Account documents (users, email codes, sessions, admin two-step login)."""

import uuid
from datetime import datetime

from pydantic import Field

from app.core.db import Doc
from app.core.time import now

ROLES = ("customer", "expert", "admin")
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
    terms_accepted_at: datetime | None = None
    disabled_at: datetime | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)

    def model_post_init(self, _ctx) -> None:
        self.email_lc = self.email.strip().lower()
        if self.role not in ROLES or (self.role == "admin") != (self.admin_role is not None):
            raise ValueError("invalid role / admin_role")

    @property
    def verified(self) -> bool:
        return self.email_verified_at is not None


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
