import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import EmailStr, Field, model_validator

from app.core.schemas import CamelModel


class SignupIn(CamelModel):
    role: Literal["customer", "expert"] = "customer"
    name: str = Field(max_length=80)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    password: str = Field(max_length=200)
    password_confirm: str = Field(max_length=200)
    terms_accepted: bool = False  # the one tick: Terms, Privacy Policy, and 18+ (or a parent's consent)
    pick_roles: bool = False  # the individual sign-up page: ask "What would you like to do?" after the code
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
    roles: list[str] = []
    active_role: str | None = None
    roles_pending: bool = False

    @model_validator(mode="before")
    @classmethod
    def _derived_roles(cls, v: Any) -> Any:
        """From a User: the roles derived for older accounts and the active one (see User.individual_roles)."""
        if hasattr(v, "individual_roles"):
            return {**v.model_dump(), "id": v.id, "verified": v.verified, "has_password": v.has_password,
                    "roles": v.individual_roles, "active_role": v.current_role}  # fmt: skip
        return v


class GoogleSignInOut(UserOut):
    is_new: bool = False  # a new account: the page goes on to the step after sign-up


class RolesIn(CamelModel):
    add: list[Literal["jobseeker", "student", "expert"]] = Field(default_factory=list, max_length=3)
    active: Literal["jobseeker", "student", "expert"] | None = None
    expert_terms: bool = False


class SwitchIn(CamelModel):
    role: Literal["jobseeker", "student", "expert"]


class SignupOut(CamelModel):
    email: str
    code_sent: bool


class Ok(CamelModel):
    ok: bool = True
