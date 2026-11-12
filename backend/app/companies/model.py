"""Company accounts (Phase 2, C1): the record, the trust level and the automatic flags for Admin → Companies.

A company is made when its first admin proves their own email (a code) at the end of sign-up step 3; until then the
wizard's answers are a draft in the browser. One company record:

  kind          company | individual (an individual recruiter: no registration, LinkedIn link + declaration)
  details       legal_name, website, category, structure, industry, size, about
  reg           {kind: gstin | cin | llpin, number}  (companies) ; reg_key for the duplicate check
  individual    {linkedin, declared}  (individual recruiters; never Aadhaar, PAN or ID photos)
  phone         optional, only duplicate-checked (no SMS codes)
  admin_email / company_email, emails {admin, company}: when each was proven by a code
  members       [{email_lc, name, role: main | full | posting | view, status: active | invited, at}]
  review        {state: draft | pending | approved | rejected | blocked, reason, at, by, submitted_at}
  trust         unverified | basic | verified ; verified_until (12 months after approval, editable)
  flags         [{code, text}] shown first in the admin queue

Trust levels: Unverified (can't post) → Basic (the emails are proven: 1 live job a week) → Verified (an admin approved
it: more, default 3 live jobs). The numbers are in Admin → Settings (site "companies").
"""

import re
from datetime import timedelta
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.companies.checks import check_registration, clean_number, domain_gap, free_site, site_domain
from app.core.db import COMPANIES
from app.core.schemas import CamelModel
from app.core.time import now

CATEGORIES = ("startup", "sme", "enterprise", "ngo", "government", "individual")
STRUCTURES = ("private_limited", "public_limited", "llp", "partnership", "proprietorship", "opc", "trust_society",
              "government_body", "other")  # fmt: skip
SIZES = ("1_10", "11_50", "51_200", "201_1000", "1000_plus")
ROLES = ("main", "full", "posting", "view")  # what a team admin may do (main: the one who signed up)
MANAGE = {"main", "full"}  # may edit the company and its team
POST = {"main", "full", "posting"}  # may post jobs
LINKEDIN_RE = re.compile(r"^https://([a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_\-%.]{3,100}/?$")


def _trim(v: str | None) -> str:
    return " ".join((v or "").split())


class DetailsIn(CamelModel):
    legal_name: str = Field(min_length=2, max_length=120)
    website: str = Field("", max_length=200)
    category: Literal[CATEGORIES]  # type: ignore[valid-type]
    structure: Literal[STRUCTURES] = "other"  # type: ignore[valid-type]
    industry: str = Field("", max_length=80)
    size: Literal[SIZES] = "1_10"  # type: ignore[valid-type]
    about: str = Field("", max_length=2000)

    @field_validator("legal_name", "industry")
    @classmethod
    def _t(cls, v: str) -> str:
        return _trim(v)

    @field_validator("website")
    @classmethod
    def _site(cls, v: str) -> str:
        v = v.strip()
        if not v:
            return ""
        d = site_domain(v)
        if not d or "." not in d or not re.match(r"^[a-z0-9.-]+$", d):
            raise ValueError("Enter your website, like acme.com")
        if free_site(d):  # fix round item 21: gmail.com is an email service, not the company's website
            raise ValueError("Enter your company’s own website, not an email service like gmail.com.")
        return f"https://{d}"


class RegistrationIn(CamelModel):
    kind: Literal["gstin", "cin", "llpin"]
    number: str = Field(min_length=6, max_length=30)

    @model_validator(mode="after")
    def _check(self):
        self.number = clean_number(self.number)
        if problem := check_registration(self.kind, self.number):
            raise ValueError(problem)
        return self


class IndividualIn(CamelModel):
    linkedin: str = Field(max_length=200)
    declared: bool

    @field_validator("linkedin")
    @classmethod
    def _li(cls, v: str) -> str:
        v = v.strip()
        if v.startswith("www.") or v.startswith("linkedin.com") or v.startswith("in.linkedin.com"):
            v = "https://" + v
        v = v.replace("http://", "https://")
        if not LINKEDIN_RE.match(v):
            raise ValueError("Paste your LinkedIn profile link, like https://www.linkedin.com/in/your-name")
        return v


class CompanyIn(CamelModel):
    """Steps 1 and 2 of the sign-up (and later edits while not yet verified)."""

    details: DetailsIn
    registration: RegistrationIn | None = None
    individual: IndividualIn | None = None
    phone: str = Field("", max_length=20)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        d = re.sub(r"\D", "", v or "")
        if not d:
            return ""
        if d.startswith("91") and len(d) == 12:
            d = d[2:]
        if len(d) != 10 or d[0] not in "6789":
            raise ValueError("Enter a 10-digit Indian mobile number, or leave it empty.")
        return d

    @model_validator(mode="after")
    def _by_kind(self):
        if self.details.category == "individual":
            if not self.individual:
                raise ValueError("individual: add your LinkedIn profile link and tick the declaration.")
            if not self.individual.declared:
                raise ValueError("individual: tick the declaration.")
            self.registration = None
        else:
            if not self.registration:
                raise ValueError("registration: add your GSTIN, CIN or LLPIN.")
            if not self.details.website:
                raise ValueError("details.website: a company needs its website.")
            self.individual = None
        return self


def reg_key(c: dict[str, Any]) -> str | None:
    r = c.get("reg")
    return f"{r['kind']}:{r['number']}" if r else None


def trust_of(c: dict[str, Any], at=None) -> str:
    at = at or now()
    state = (c.get("review") or {}).get("state")
    if state == "blocked":
        return "blocked"
    if state == "approved" and c.get("verified_until") and c["verified_until"] > at:
        return "verified"
    emails = c.get("emails") or {}
    proven = emails.get("admin") and (emails.get("company") or c.get("kind") == "individual")
    return "basic" if proven and state != "rejected" else "unverified"


async def flags_for(db, c: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, str]]:
    """The warnings an admin sees first. Nothing is blocked by them; they decide what to check by hand."""
    out: list[dict[str, str]] = []
    other = {"_id": {"$ne": c["_id"]}, "demo": {"$ne": True}}
    if c.get("reg_key") and await db[COMPANIES].count_documents({**other, "reg_key": c["reg_key"]}):
        out.append({"code": "duplicate_registration", "text": "The same registration number is on another account."})
    if c.get("phone_key") and await db[COMPANIES].count_documents({**other, "phone_key": c["phone_key"]}):
        out.append({"code": "duplicate_phone", "text": "The same phone number is on another account."})
    ip = (c.get("signup") or {}).get("ip_hash")
    if ip:
        since = (c.get("created_at") or now()) - timedelta(hours=2)
        n = 1 + await db[COMPANIES].count_documents(  # this sign-up and the others from the same address
            {"_id": {"$ne": c["_id"]}, "signup.ip_hash": ip, "created_at": {"$gte": since}, "demo": {"$ne": True}}
        )
        if n >= int(settings.get("ip_burst", 3)):
            out.append({"code": "ip_burst", "text": f"{n} sign-ups from the same address within 2 hours."})
    if c.get("kind") == "individual":
        out.append({"code": "individual", "text": "Individual recruiter: no registration; check the LinkedIn profile."})
    age = (c.get("domain") or {}).get("age_days")
    if age is not None and age < 90:
        out.append({"code": "new_domain", "text": f"The website domain was registered {age} days ago."})
    if c.get("kind") == "company" and (gap := domain_gap(c)):
        out.append({"code": "email_domain", "text": gap})  # fix round item 22
    if (c.get("domain") or {}).get("mx") is False:
        out.append({"code": "no_mail", "text": "The website domain doesn’t receive email (no mail server found)."})
    for f in c.get("login_flags") or []:  # unusual sign-ins (C1b)
        out.append(f)
    return out


def member(c: dict[str, Any], email_lc: str) -> dict[str, Any] | None:
    return next((m for m in c.get("members") or [] if m["email_lc"] == email_lc and m["status"] == "active"), None)


def company_out(c: dict[str, Any], me: str | None = None, full: bool = True) -> dict[str, Any]:
    from app.me.service import ms

    d = c.get("details") or {}
    review = c.get("review") or {}
    out: dict[str, Any] = {
        "id": c["_id"],
        "slug": c["slug"],
        "kind": c.get("kind", "company"),
        "details": {
            "legalName": d.get("legal_name", ""), "website": d.get("website", ""), "category": d.get("category", ""),
            "structure": d.get("structure", ""), "industry": d.get("industry", ""), "size": d.get("size", ""),
            "about": d.get("about", ""),
        },
        "trust": trust_of(c),
        "verifiedUntil": ms(c.get("verified_until")),
        "review": {"state": review.get("state", "draft"), "reason": review.get("reason", ""),
                   "at": ms(review.get("at")), "submittedAt": ms(review.get("submitted_at"))},
        "demo": bool(c.get("demo")),
        "policies": {k: {"text": v.get("text", ""), "removed": bool(v.get("removed"))}
                     for k, v in (c.get("policies") or {}).items()},
    }  # fmt: skip
    if full:
        r = c.get("reg") or {}
        ind = c.get("individual") or {}
        mine = member(c, me) if me else None
        out |= {
            "registration": {"kind": r.get("kind"), "number": r.get("number")} if r else None,
            "individual": {"linkedin": ind.get("linkedin", ""), "declared": bool(ind.get("declared"))} if ind else None,
            "phone": c.get("phone", ""),
            "adminEmail": c.get("admin_email", ""),
            "companyEmail": c.get("company_email", ""),
            "emails": {"admin": bool((c.get("emails") or {}).get("admin")),
                       "company": bool((c.get("emails") or {}).get("company"))},
            "pendingCompanyEmail": (c.get("company_code") or {}).get("email", ""),
            "members": [{"email": m["email_lc"], "name": m.get("name", ""), "role": m["role"], "status": m["status"]}
                        for m in c.get("members") or []],
            "myRole": mine["role"] if mine else None,
            "termsAccepted": bool(c.get("terms_at")),
            "logo": c.get("logo") or "",
        }  # fmt: skip
    return out
