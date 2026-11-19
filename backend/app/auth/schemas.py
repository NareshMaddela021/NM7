import uuid
from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field

from app.core.schemas import CamelModel


class SignupIn(CamelModel):
    role: Literal["customer", "expert"]
    name: str = Field(max_length=80)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    password: str = Field(max_length=200)
    password_confirm: str = Field(max_length=200)
    terms_accepted: bool = False
    ref: str | None = Field(default=None, max_length=20)  # a friend's referral code


class ChangePasswordIn(CamelModel):
    current_password: str = Field(max_length=200)
    password: str = Field(max_length=200)
    password_confirm: str = Field(max_length=200)


class EmailIn(CamelModel):
    email: EmailStr


class EmailCodeIn(CamelModel):
    email: EmailStr
    code: str = Field(max_length=10)


class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(max_length=200)


class ResetIn(CamelModel):
    email: EmailStr
    code: str = Field(max_length=10)
    password: str = Field(max_length=200)
    password_confirm: str = Field(max_length=200)


class GoogleIn(CamelModel):
    credential: str = Field(max_length=4096)  # the Google ID token; checked, never stored
    role: Literal["customer", "expert"] | None = None  # a new account: the sign-up page's choice (customer if none)
    ref: str | None = Field(default=None, max_length=20)
    next: str | None = Field(default=None, max_length=300)  # the page goes there afterwards (the browser checks it)


class GoogleLinkIn(CamelModel):
    credential: str = Field(max_length=4096)


class GoogleOut(CamelModel):
    email: str
    name: str = ""
    picture: str | None = None
    linked_at: datetime | None = None


class UserOut(CamelModel):
    id: uuid.UUID
    role: str
    name: str
    email: str
    phone: str | None
    verified: bool
    expert_status: str | None
    admin_role: str | None
    created_at: datetime
    view: dict | None = None  # an admin's view (app/auth/views.py): {mode, role, label, readOnly, path, expiresAt}
    has_password: bool = True
    google: GoogleOut | None = None


class GoogleSignInOut(UserOut):
    is_new: bool = False  # a new account: the page goes on to the step after sign-up


class SignupOut(CamelModel):
    email: str
    code_sent: bool


class Ok(CamelModel):
    ok: bool = True
