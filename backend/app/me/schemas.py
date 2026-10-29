"""Shapes of the dashboard data as the browser sends and receives it (times are milliseconds since 1970, like
JavaScript's Date.now())."""

import json
import re
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import CamelModel

KEY = r"^[A-Za-z0-9_-]{1,40}$"  # ids the browser picks for its own items (unique per owner)
SLUG = r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$"
MAX_RESUME_JSON = 200_000  # bytes; a full resume is about 10 KB
MAX_VERSIONS = 20
Ms = int


def _json_size(v: Any) -> int:
    return len(json.dumps(v, separators=(",", ":"), ensure_ascii=False).encode())


def _limit(v: dict[str, Any], limit: int, what: str) -> dict[str, Any]:
    if _json_size(v) > limit:
        raise ValueError(f"{what} is too large")
    return v


# ---------- resumes ----------


class Version(CamelModel):
    at: Ms
    label: str = Field(max_length=120)
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def _size(cls, v):
        return _limit(v, MAX_RESUME_JSON, "resume")


class ResumeIn(CamelModel):
    id: str = Field(pattern=KEY)
    name: str = Field(min_length=1, max_length=80)
    data: dict[str, Any]
    jd: str = Field("", max_length=20_000)
    active: bool = False
    versions: list[Version] = Field(default_factory=list, max_length=MAX_VERSIONS)

    @field_validator("data")
    @classmethod
    def _size(cls, v):
        return _limit(v, MAX_RESUME_JSON, "resume")


class ResumePatch(CamelModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    data: dict[str, Any] | None = None
    jd: str | None = Field(None, max_length=20_000)
    active: Literal[True] | None = None  # make this the one the builder edits
    versions: list[Version] | None = Field(None, max_length=MAX_VERSIONS)
    pages: int | None = Field(None, ge=1, le=20)  # measured by the builder (for the organizations' print table)
    # the `updated` stamp the browser last saw: when the server's is newer (another tab or device saved since) the
    # edit is refused with 409 `stale` instead of overwriting it
    if_updated: int | None = Field(None, ge=0)

    @field_validator("data")
    @classmethod
    def _size(cls, v):
        return v if v is None else _limit(v, MAX_RESUME_JSON, "resume")


class ResumeOut(CamelModel):
    id: str
    name: str
    active: bool
    data: dict[str, Any]
    jd: str
    versions: list[Version]
    pages: int | None = None
    created: Ms
    updated: Ms


# ---------- cover letters ----------


class CoverIn(CamelModel):
    id: str = Field(pattern=KEY)
    company: str = Field("", max_length=120)
    role: str = Field("", max_length=120)
    resume_id: str | None = Field(None, max_length=40)
    jd: str = Field("", max_length=20_000)
    body: str = Field("", max_length=20_000)
    at: Ms | None = None


class CoverPatch(CamelModel):
    company: str | None = Field(None, max_length=120)
    role: str | None = Field(None, max_length=120)
    resume_id: str | None = Field(None, max_length=40)
    jd: str | None = Field(None, max_length=20_000)
    body: str | None = Field(None, max_length=20_000)


class CoverOut(CoverIn):
    at: Ms


# ---------- job applications ----------

AppStatus = Literal["saved", "applied", "interview", "offer", "rejected"]
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
_HOST = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$", re.I)


def job_link(v: str | None) -> str | None:
    """Only web links: http(s), or a bare domain (gets https://). Anything else (javascript:, data:…) is refused."""
    if v is None:
        return v
    v = v.strip()
    if not v:
        return ""
    if _SCHEME.match(v):
        if not re.match(r"^https?://[^\s/]+\.[^\s]+", v, re.I):
            raise ValueError("Use a web link starting with http:// or https://")
        return v
    if v.startswith("//") or not _HOST.match(v) or any(c.isspace() for c in v):
        raise ValueError("Use a web link like https://company.com/jobs/123")
    return f"https://{v}"


class ApplicationIn(CamelModel):
    id: str = Field(pattern=KEY)
    company: str = Field(min_length=1, max_length=120)
    role: str = Field("", max_length=120)
    status: AppStatus = "saved"
    date: Ms | None = None
    resume_id: str | None = Field(None, max_length=40)
    url: str = Field("", max_length=500)
    notes: str = Field("", max_length=2_000)
    next: Ms | None = None
    # from a job match (Phase 1): the match, its score and the tailored copy sent
    match_id: str | None = Field(None, max_length=40)
    score: int | None = Field(None, ge=0, le=100)
    tailored_resume_id: str | None = Field(None, max_length=40)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return job_link(v)


class ApplicationPatch(CamelModel):
    company: str | None = Field(None, min_length=1, max_length=120)
    role: str | None = Field(None, max_length=120)
    status: AppStatus | None = None
    date: Ms | None = None
    resume_id: str | None = Field(None, max_length=40)
    url: str | None = Field(None, max_length=500)
    notes: str | None = Field(None, max_length=2_000)
    next: Ms | None = None
    score: int | None = Field(None, ge=0, le=100)
    tailored_resume_id: str | None = Field(None, max_length=40)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return job_link(v)


class ApplicationOut(ApplicationIn):
    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        try:  # links saved before this check: unsafe ones are dropped, never sent back
            return job_link(v)
        except ValueError:
            return ""


# ---------- ATS checks ----------


class CheckIn(CamelModel):
    score: int = Field(ge=0, le=100)
    resume_id: str | None = Field(None, max_length=40)
    label: str = Field("", max_length=120)


class CheckOut(CheckIn):
    at: Ms


# ---------- share link ----------


class ShareIn(CamelModel):
    on: bool
    slug: str = Field(pattern=SLUG)
    resume_id: str | None = Field(None, max_length=40)
    hide_phone: bool = False
    hide_email: bool = False


class ShareOut(ShareIn):
    short: str | None = None  # the short link nm7.si/r/<short>, made when the link is first turned on
    views: list[Ms]  # when the link was opened (latest 500)
    view_count: int


class PublicResumeOut(CamelModel):
    name: str
    data: dict[str, Any]
    updated: Ms
    can_download: bool = True  # the owner may download (so may anyone with the link)


# ---------- profile ----------

Channel = Literal["whatsapp", "email", "sms"]
Topic = Literal["order", "draft", "jobs", "tips"]


class ProfileOut(CamelModel):
    name: str
    email: str
    phone: str | None
    target_role: str
    cities: str
    level: str
    notify: dict[str, dict[str, bool]]
    ui: dict[str, Any]
    joined: Ms
    referral_code: str


class ProfilePatch(CamelModel):
    """Email is not here on purpose: it is the sign-in name and changing it needs the new address confirmed."""

    name: str | None = Field(None, min_length=1, max_length=80)
    phone: str | None = Field(None, max_length=20)
    target_role: str | None = Field(None, max_length=80)
    cities: str | None = Field(None, max_length=200)
    level: str | None = Field(None, max_length=40)
    notify: dict[Channel, dict[Topic, bool]] | None = None
    ui: dict[str, Any] | None = None

    @field_validator("ui")
    @classmethod
    def _ui_size(cls, v):
        return v if v is None else _limit(v, 20_000, "ui")


# ---------- support tickets ----------


class TicketIn(CamelModel):
    topic: str = Field(min_length=1, max_length=40)
    order_id: str | None = Field(None, max_length=20)
    text: str = Field(min_length=1, max_length=2_000)


class TicketOut(CamelModel):
    id: str
    topic: str
    order_id: str | None
    text: str
    status: Literal["open", "resolved"]
    reply: str | None
    at: Ms
    replied_at: Ms | None


class TicketCreated(TicketOut):
    emailed: bool


# ---------- referrals ----------


class Referred(CamelModel):
    name: str  # first name only
    at: Ms
    status: Literal["joined", "bought"]
    counts: bool = False  # counts towards the referral reward
    why: Literal["email_not_confirmed", "no_resume", "not_eligible"] | None = None


class RewardOut(CamelModel):
    on: bool
    needed: int
    counted: int
    unlocked: bool
    revoked: bool
    at: Ms | None = None


class ReferralOut(CamelModel):
    code: str
    referrals: list[Referred]
    reward: RewardOut | None = None


class MeState(CamelModel):
    profile: ProfileOut
    resumes: list[ResumeOut]
    covers: list[CoverOut]
    apps: list[ApplicationOut]
    checks: list[CheckOut]
    share: ShareOut
    tickets: list[TicketOut]
    referral: ReferralOut
