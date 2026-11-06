"""The job board's job post: what one job is, how it is checked, and how two copies of the same job are recognised.

A job comes from the morning job-collector (POST /api/jobs/ingest), from Admin → Jobs (one at a time or a bulk
import) or, later, from a verified company. Whatever the source, it goes through JobIn: the same checks, the same
cleaned values. Two posts are the same job when their dedupe key matches: company + title + places + apply link
(lower-case, spaces and punctuation folded), so re-sending a job updates it instead of adding a copy.
"""

import hashlib
import re
import secrets
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.jobsearch import skills as dictionary

WORK_TYPES = {"onsite": "On-site", "hybrid": "Hybrid", "remote": "Remote"}
JOB_TYPES = {"full_time": "Full-time", "internship": "Internship", "contract": "Contract", "part_time": "Part-time"}
EXPERIENCE = {
    "internship": "Internship",
    "fresher": "Fresher",
    "0_1": "0–1 years",
    "1_3": "1–3 years",
    "3_plus": "3+ years",
}
APPLY = {"link": "Company website", "email": "By email", "nm7": "Apply on Nm7"}
STATUSES = ("active", "paused", "closed", "review")  # review: a company job waiting for Admin (C3)
SOURCES = ("collector", "admin", "bulk", "company")
PERIODS = ("monthly", "yearly")
URL_RE = re.compile(r"^https?://[^\s<>\"']{3,1990}$", re.I)
EMAIL_RE = re.compile(r"^[^\s@<>\"']+@[^\s@<>\"']+\.[^\s@<>\"']{2,}$")
# what the dedupe key and the edit check compare (everything a job says)
CONTENT = ("title", "company", "locations", "remote", "work_type", "job_type", "experience", "salary", "skills",
           "description", "apply", "closes_at")  # fmt: skip


def _fold(text: str) -> str:
    t = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _tidy(text: Any, n: int) -> str:
    return " ".join(str(text or "").split())[:n]


class CompanyIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    website: str = Field("", max_length=300)
    logo: str = Field("", max_length=500)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        return _tidy(v, 100)

    @field_validator("website", "logo")
    @classmethod
    def _url(cls, v):
        v = (v or "").strip()
        if v and not re.match(r"^https?://", v, re.I):
            v = "https://" + v
        if v and not URL_RE.match(v):
            raise ValueError("Give a full web address like https://company.com")
        return v


class SalaryIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    min: int | None = Field(None, ge=0, le=100_000_000)  # rupees
    max: int | None = Field(None, ge=0, le=100_000_000)
    period: Literal["monthly", "yearly"] = "yearly"

    @model_validator(mode="after")
    def _order(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("The lowest salary is more than the highest.")
        return self


class JobIn(BaseModel):
    """One job, as the collector, a bulk import or the admin form sends it (camelCase or snake_case keys)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    title: str = Field(min_length=2, max_length=120)
    company: CompanyIn
    locations: list[str] = Field(default_factory=list, max_length=10)  # cities; empty with workType remote
    work_type: Literal["onsite", "hybrid", "remote"] = "onsite"
    job_type: Literal["full_time", "internship", "contract", "part_time"] = "full_time"
    experience: Literal["internship", "fresher", "0_1", "1_3", "3_plus"] = "fresher"
    salary: SalaryIn | None = None
    skills: list[str] = Field(default_factory=list, max_length=30)
    description: str = Field(min_length=30, max_length=20_000)
    apply_method: Literal["link", "email", "nm7"] = "link"
    apply_url: str = Field("", max_length=2000)
    apply_email: str = Field("", max_length=200)
    status: Literal["active", "paused", "closed"] = "active"
    posted_at: datetime | None = None  # default: now
    closes_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        return _tidy(v, 120)

    @field_validator("locations")
    @classmethod
    def _locations(cls, v):
        out: list[str] = []
        for x in v:
            t = _tidy(x, 60)
            if t and t.lower() not in {o.lower() for o in out}:
                out.append(t)
        return out

    @field_validator("skills")
    @classmethod
    def _skills(cls, v):
        out: list[str] = []
        for x in v:
            t = _tidy(x, 40)
            if not t:
                continue
            c = dictionary.canonical(t) or t  # the dictionary's name when known, else as written
            if c.lower() not in {o.lower() for o in out}:
                out.append(c)
        return out

    @field_validator("description")
    @classmethod
    def _description(cls, v):
        t = re.sub(r"\r\n?", "\n", str(v or "")).strip()
        return re.sub(r"\n{3,}", "\n\n", t)

    @field_validator("apply_url")
    @classmethod
    def _apply_url(cls, v):
        v = (v or "").strip()
        if v and not URL_RE.match(v):
            raise ValueError("The apply link must start with http:// or https://")
        return v

    @field_validator("apply_email")
    @classmethod
    def _apply_email(cls, v):
        v = (v or "").strip()
        if v and not EMAIL_RE.match(v):
            raise ValueError("That apply email doesn’t look right.")
        return v.lower()

    @field_validator("posted_at", "closes_at")
    @classmethod
    def _tz(cls, v):
        if v is not None and v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        return v

    @model_validator(mode="after")
    def _rules(self):
        if self.apply_method == "link" and not self.apply_url:
            raise ValueError("A job applied for on the company website needs its apply link (applyUrl).")
        if self.apply_method == "email" and not self.apply_email:
            raise ValueError("A job applied for by email needs the email address (applyEmail).")
        if self.work_type != "remote" and not self.locations:
            raise ValueError("Give at least one city, or set workType to remote.")
        now = datetime.now(UTC)
        if self.posted_at and self.posted_at > now + timedelta(days=1):
            raise ValueError("postedAt is in the future.")
        if self.closes_at and self.closes_at < (self.posted_at or now) - timedelta(days=1):
            raise ValueError("closesAt is before the job was posted.")
        return self


def dedupe_key(company: str, title: str, locations: list[str], remote: bool, apply_to: str) -> str:
    places = "remote" if remote and not locations else "|".join(sorted(_fold(x) for x in locations))
    raw = "\x1f".join([_fold(company), _fold(title), places, apply_to.strip().lower().rstrip("/")])
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def slug_for(title: str, company: str) -> str:
    base = "-".join(_fold(f"{title} {company}").split())[:70].strip("-") or "job"
    return f"{base}-{secrets.token_hex(3)}"


def to_doc(job: JobIn) -> dict[str, Any]:
    """The stored fields a JobIn decides (not the record's own: id, slug, source, dates, link check)."""
    remote = job.work_type == "remote"
    apply_to = job.apply_url if job.apply_method == "link" else job.apply_email if job.apply_method == "email" else ""
    salary = job.salary.model_dump() if job.salary and (job.salary.min or job.salary.max) else None
    return {
        "title": job.title,
        "company": job.company.model_dump(),
        "locations": job.locations,
        "remote": remote,
        "work_type": job.work_type,
        "job_type": job.job_type,
        "experience": job.experience,
        "salary": salary,
        "skills": job.skills,
        "description": job.description,
        "apply": {"method": job.apply_method, "url": job.apply_url, "email": job.apply_email},
        "closes_at": job.closes_at,
        "dedupe_key": dedupe_key(job.company.name, job.title, job.locations, remote, apply_to),
    }


def errors_of(exc: Exception) -> list[str]:
    """Plain messages for a failed JobIn (field: problem)."""
    from pydantic import ValidationError

    if not isinstance(exc, ValidationError):
        return [str(exc)]
    out = []
    for e in exc.errors():
        where = ".".join(str(x) for x in e.get("loc") or () if x != "__root__")
        msg = str(e.get("msg", "")).removeprefix("Value error, ")
        out.append(f"{where}: {msg}" if where else msg)
    return out
