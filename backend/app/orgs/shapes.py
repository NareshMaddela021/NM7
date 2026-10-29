"""Organizations: limits, request bodies and the JSON shapes the API answers with (no database access)."""

from datetime import date, timedelta
from typing import Any, Literal

from fastapi import Request
from pydantic import Field, field_validator

from app.auth.sessions import client_ip
from app.billing.subscription import in_effect, state_of
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.me.service import ms
from app.orgs.scope import features_of
from app.orgs.service import (
    ID_FIELD,
    ORG_TYPE_NAMES,
)

OrgType = Literal["college", "institute", "job_fair", "skill_centre", "ngo", "agency", "company", "other"]
JOIN_RULES = [(10, timedelta(hours=1))]
LOOKUP_RULES = [(60, timedelta(hours=1))]
EXPORT_RULES = [(30, timedelta(hours=1))]
ACTION_RULES = [(120, timedelta(hours=1))]  # approve / review / unprint clicks per person
GROUP_REMIND_RULES = [(3, timedelta(days=1))]  # reminder sends per group per calendar day (IST; the key holds the day)
# One reminder per member per calendar day in India: "today" and "tomorrow" in the copy mean the IST date, not a
# rolling 24 h (a reminder at 23:30 may be followed by one at 09:00 the next morning).
MAX_EMAILS = 500  # per send
BATCH = 25


def _ip(request: Request) -> str | None:
    return client_ip(request)


BAD_CODE = ApiError(404, "invalid_code", "This join code doesn’t exist. Please check it with your organizer.")


# ---------- models ----------
class FieldDef(CamelModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,29}$")
    label: str = Field(min_length=1, max_length=60)
    type: Literal["text", "select"] = "text"
    options: list[str] = Field(default_factory=list, max_length=50)
    required: bool = False

    @field_validator("options")
    @classmethod
    def _opts(cls, v):
        return [o.strip()[:60] for o in v if o.strip()]


def _check_fields(defs: list[FieldDef]) -> list[dict[str, Any]]:
    keys = [f.key for f in defs]
    if len(set(keys)) != len(keys):
        raise ApiError(400, "duplicate_field", "Each question needs its own key.")
    for f in defs:
        if ID_FIELD.search(f"{f.key} {f.label}"):
            raise ApiError(400, "id_field", f"“{f.label}” asks for an ID or bank number. Nm7 never stores those.")
        if f.type == "select" and not f.options:
            raise ApiError(400, "options_required", f"“{f.label}” needs at least one option.")
    return [f.model_dump() for f in defs]


class OrgIn(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    type: OrgType
    city: str = Field("", max_length=60)
    logo_url: str = Field("", max_length=500, pattern=r"^(https://.*)?$")


class OrgPatch(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    type: OrgType | None = None
    city: str | None = Field(None, max_length=60)
    logo_url: str | None = Field(None, max_length=500, pattern=r"^(https://.*)?$")
    status: Literal["active", "archived"] | None = None


class GroupSettings(CamelModel):
    members_download_free: bool = False
    active: bool = True
    require_approval: bool = False
    print_branded: bool = False  # Phase 3B: org-side copies in the organization's template (needs `branding`)
    share_with_recruiters: bool = False  # Phase 3C: members may opt in to recruiter links (needs `recruiter_links`)


class GroupSettingsPatch(CamelModel):  # only what's sent changes (e.g. a coordinator's open / close switch)
    members_download_free: bool | None = None
    active: bool | None = None
    require_approval: bool | None = None
    print_branded: bool | None = None
    share_with_recruiters: bool | None = None


class GroupIn(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(None, max_length=20)
    starts_on: date | None = None
    ends_on: date | None = None
    member_limit: int | None = Field(None, ge=1, le=100_000)
    custom_fields: list[FieldDef] = Field(default_factory=list, max_length=20)
    settings: GroupSettings = Field(default_factory=GroupSettings)


class GroupPatch(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    code: str | None = Field(None, max_length=20)
    starts_on: date | None = None
    ends_on: date | None = None
    member_limit: int | None = Field(None, ge=1, le=100_000)
    custom_fields: list[FieldDef] | None = Field(None, max_length=20)
    settings: GroupSettingsPatch | None = None


class JoinIn(CamelModel):
    code: str = Field(max_length=20)
    consent: bool = False
    recruiter_opt_in: bool = False  # "Allow <Org> to share my resume with recruiters" (groups that use it)
    fields: dict[str, Any] = Field(default_factory=dict)
    resume_id: str = Field(max_length=64)


class MembershipPatch(CamelModel):
    resume_id: str | None = Field(None, max_length=64)
    reminders_opt_out: bool | None = None
    recruiter_opt_in: bool | None = None


Approval = Literal["approved", "pending", "rejected", "all"]
Review = Literal["none", "needs_changes", "ready"]


class Filters(CamelModel):
    org: str | None = Field(None, max_length=64)
    group: str | None = Field(None, max_length=64)
    q: str | None = Field(None, max_length=100)
    joined_from: str | None = None
    joined_to: str | None = None
    updated_from: str | None = None
    updated_to: str | None = None
    field_key: str | None = Field(None, max_length=30)
    field_value: str | None = Field(None, max_length=120)
    incomplete: bool = False
    not_printed: bool = False
    ready_not_printed: bool = False
    approval: Approval = "approved"
    review: Review | None = None
    shortlisted_by: str | None = Field(None, max_length=64)  # a recruiter link id
    only_ready: bool = False  # exports: only resumes marked Ready


ExportKind = Literal["print_bulk", "export_zip", "download", "print"]


class ExportIn(CamelModel):
    kind: ExportKind
    ids: list[str] | None = Field(None, max_length=2000)  # a selection; else everything matching `filters`
    filters: Filters = Field(default_factory=Filters)
    sort: str = Field("name", max_length=40)
    direction: Literal["asc", "desc"] = "asc"


class IdsIn(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=2000)


class ApprovalIn(IdsIn):
    action: Literal["approve", "reject"]


class ReviewIn(IdsIn):
    status: Review
    note: str = Field("", max_length=500)


class RemindIn(CamelModel):
    segment: Literal["incomplete", "needs_changes", "stale", "selected"]
    group: str | None = Field(None, max_length=64)
    ids: list[str] | None = Field(None, max_length=2000)
    since: date | None = None  # "stale": not updated since this day
    note: str = Field("", max_length=300)


class StopIn(CamelModel):
    token: str = Field(max_length=200)


class FeaturesIn(CamelModel):
    """Nm7 (the super-admin) only: overrides on top of the plan. true / false forces a feature on or off for this
    organization; null goes back to what the plan gives. Fields not sent stay as they are."""

    kiosk: bool | None = None
    branding: bool | None = None
    recruiter_links: bool | None = None
    members_download_free: bool | None = None
    placement_insights: bool | None = None
    template_rules: bool | None = None
    recruiter_job_match: bool | None = None
    drives: bool | None = None
    eligibility: bool | None = None
    offers: bool | None = None
    wa_reminders: bool | None = None
    alumni: bool | None = None
    faculty_review: bool | None = None
    multi_campus: bool | None = None
    recruiter_accounts: bool | None = None
    recruiter_compare: bool | None = None
    interview_scheduling: bool | None = None
    recruiter_feedback: bool | None = None


# ---------- helpers ----------
def org_out(o: dict[str, Any], groups: int = 0, members: int = 0) -> dict[str, Any]:
    return {
        "id": o["_id"],
        "name": o["name"],
        "type": o["type"],
        "typeName": ORG_TYPE_NAMES.get(o["type"], o["type"]),
        "city": o.get("city", ""),
        "logoUrl": o.get("logo_url", ""),
        "status": o.get("status", "active"),
        "createdAt": ms(o["created_at"]),
        "groups": groups,
        "members": members,
        "features": _features_out(o),
        "featureOverrides": overrides_out(o),
        "plan": plan_brief(o),
        "demo": bool(o.get("demo")),
    }


def _features_out(o: dict[str, Any]) -> dict[str, bool]:
    f = features_of(o)
    return {
        "kiosk": f["kiosk"],
        "branding": f["branding"],
        "recruiterLinks": f["recruiter_links"],
        "membersDownloadFree": f["members_download_free"],
        "placementInsights": f["placement_insights"],
        "templateRules": f["template_rules"],
        "recruiterJobMatch": f["recruiter_job_match"],
        "drives": f["drives"],
        "eligibility": f["eligibility"],
        "offers": f["offers"],
        "waReminders": f["wa_reminders"],
        "alumni": f["alumni"],
        "facultyReview": f["faculty_review"],
        "multiCampus": f["multi_campus"],
        "recruiterAccounts": f["recruiter_accounts"],
        "recruiterCompare": f["recruiter_compare"],
        "interviewScheduling": f["interview_scheduling"],
        "recruiterFeedback": f["recruiter_feedback"],
    }


def plan_brief(o: dict[str, Any]) -> dict[str, Any]:
    sub = o.get("subscription") or {}
    st = state_of(o)
    return {
        "id": in_effect(o).get("plan_id", "free"),
        "name": in_effect(o).get("plan_name", "Free"),
        "state": st,
        "endsOn": sub.get("ends_on") if st != "free" else None,
        "lastPlan": sub.get("plan_name") if st == "expired" else None,
    }


def overrides_out(o: dict[str, Any]) -> dict[str, bool | None]:
    """The admin's per-organization switches: true / false, or None (follows the plan)."""
    f = o.get("features") or {}
    return {
        "kiosk": f.get("kiosk"),
        "branding": f.get("branding"),
        "recruiterLinks": f.get("recruiter_links"),
        "membersDownloadFree": f.get("members_download_free"),
        "placementInsights": f.get("placement_insights"),
        "templateRules": f.get("template_rules"),
        "recruiterJobMatch": f.get("recruiter_job_match"),
        "drives": f.get("drives"),
        "eligibility": f.get("eligibility"),
        "offers": f.get("offers"),
        "waReminders": f.get("wa_reminders"),
        "alumni": f.get("alumni"),
        "facultyReview": f.get("faculty_review"),
        "multiCampus": f.get("multi_campus"),
        "recruiterAccounts": f.get("recruiter_accounts"),
        "recruiterCompare": f.get("recruiter_compare"),
        "interviewScheduling": f.get("interview_scheduling"),
        "recruiterFeedback": f.get("recruiter_feedback"),
    }


def group_out(g: dict[str, Any], members: int = 0) -> dict[str, Any]:
    st = g.get("settings", {})
    return {
        "id": g["_id"],
        "orgId": g["org_id"],
        "name": g["name"],
        "code": g["code"],
        "startsOn": g.get("starts_on"),
        "endsOn": g.get("ends_on"),
        "memberLimit": g.get("member_limit"),
        "customFields": g.get("custom_fields", []),
        "settings": {
            "membersDownloadFree": st.get("members_download_free", False),
            "active": st.get("active", True),
            "requireApproval": st.get("require_approval", False),
            "printBranded": st.get("print_branded", False),
            "shareWithRecruiters": st.get("share_with_recruiters", False),
        },
        "members": members,
        "createdAt": ms(g["created_at"]),
    }


# ---------- members ----------
def recruiters_on(g: dict[str, Any] | None, o: dict[str, Any] | None) -> bool:
    """The group asks members whether its organization may share their resume with recruiters."""
    return bool(g and o and g.get("settings", {}).get("share_with_recruiters") and features_of(o)["recruiter_links"])


def membership_out(m: dict[str, Any], g: dict[str, Any] | None, o: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "id": m["_id"],
        "code": g["code"] if g else "",
        "groupName": g["name"] if g else "",
        "orgName": o["name"] if o else "",
        "resumeId": m.get("resume_id"),
        "fields": m.get("field_values", {}),
        "customFields": g.get("custom_fields", []) if g else [],
        "joinedAt": ms(m["joined_at"]),
        "downloadsFree": bool(g and g.get("settings", {}).get("members_download_free")),
        "approval": m.get("approval") or "approved",
        "reviewStatus": m.get("review_status") or "none",
        "reviewNote": m.get("review_note") or "",
        "remindersOptOut": bool(m.get("reminders_opt_out")),
        "shareWithRecruiters": recruiters_on(g, o),
        "recruiterOptIn": bool(m.get("recruiter_opt_in")),
        "format": _format(g, o),  # the college's official placement format, when the group prints in it
    }


def _format(g: dict[str, Any] | None, o: dict[str, Any] | None) -> dict[str, Any] | None:
    from app.orgs.branding import brand_out  # (branding imports this module's neighbours)

    if not (g and o and g.get("settings", {}).get("print_branded") and features_of(o)["branding"]):
        return None
    return brand_out(o)
