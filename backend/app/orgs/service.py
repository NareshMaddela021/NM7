"""Nm7 for Organizations: organizations → groups (join codes) → memberships.

A membership says: this user shared this resume with this group's organization, with consent, on this date. The
organization's view (Phase 1: the super-admin's Shared resumes page) only ever includes members who gave consent,
haven't left, whose account is active and whose shared resume still exists.

Later phases (coordinator logins, dashboards, approvals, kiosk mode, branded templates, recruiter links, pricing)
hang off the same documents: organizations.roles (reserved), groups.settings and memberships.
"""

import re
import secrets
from datetime import date, datetime
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.time import IST, now
from app.me.service import ms, visible_resume
from app.photos.scrub import EPIC, IFSC, LABEL, MASKED, PAN

ORG_TYPES = ("college", "institute", "job_fair", "skill_centre", "ngo", "agency", "company", "other")
ORG_TYPE_NAMES = {
    "college": "College",
    "institute": "Coaching / training institute",
    "job_fair": "Job fair",
    "skill_centre": "Skill centre",
    "ngo": "NGO",
    "agency": "Placement agency",
    "company": "Company hiring drive",
    "other": "Other",
}
CODE = re.compile(r"^[A-Z0-9]{4,12}$")

# ---------- ID numbers never stored ----------
# Aadhaar (12 digits, 4-4-4 or run together; never starts 0/1) and VID (16 digits). Other long numbers (roll
# numbers, phone numbers) are allowed; PAN / voter ID / IFSC / masked numbers and "Aadhaar no:"-style labels are not.
AADHAAR = re.compile(r"(?<!\d)[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}(?!\d)")
VID = re.compile(r"(?<!\d)\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}(?!\d)")
ID_FIELD = re.compile(
    r"aadh?aa?r|\buid\b|\bvid\b|virtual.?id|\bpan\b|voter|\bepic\b|licen[cs]e|passport|account\s*(no|num)|ifsc|bank",
    re.I,
)


def holds_id_number(text: str) -> bool:
    return any(p.search(text) for p in (AADHAAR, VID, PAN, EPIC, IFSC, MASKED, LABEL))


def consent_text(org_name: str) -> str:
    """The exact words the member agrees to (stored with the membership)."""
    return f"My resume will be shared with {org_name} and Nm7 for printing and placement support."


# ---------- join codes ----------
def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


async def new_code(db: AsyncDatabase, org_name: str, on: date | None = None) -> str:
    """Human-friendly and unique: initials of the organization + the year, e.g. "JNTUA26"."""
    words = re.findall(r"[A-Za-z0-9]+", org_name)
    stem = "".join(w[0] for w in words).upper() if len(words) > 1 else (words[0].upper() if words else "ORG")
    stem = (stem or "ORG")[:6]
    if len(stem) < 2:
        stem = (stem + "ORG")[:3]
    base = f"{stem}{(on or now().astimezone(IST).date()).year % 100:02d}"
    if not await db[ORG_GROUPS].find_one({"code": base}):
        return base
    for n in range(2, 100):
        c = f"{base}{n}"
        if not await db[ORG_GROUPS].find_one({"code": c}):
            return c
    return f"{stem}{secrets.token_hex(3).upper()}"


# ---------- groups ----------
def _today() -> str:
    return now().astimezone(IST).date().isoformat()


def group_problem(g: dict[str, Any], org: dict[str, Any] | None, members: int) -> tuple[str, str] | None:
    """Why this group can't be joined right now, as (code, message), or None."""
    if not org or org.get("status") != "active" or not g.get("settings", {}).get("active", True):
        return "group_inactive", "This group isn’t taking new members. Please check the code with your organizer."
    today = _today()
    if g.get("starts_on") and today < g["starts_on"]:
        return "group_not_started", f"This group opens on {g['starts_on']}. Please come back then."
    if g.get("ends_on") and today > g["ends_on"]:
        return "group_expired", "This group has closed. Please ask your organizer for a new code."
    if g.get("member_limit") and members >= g["member_limit"]:
        return "group_full", "This group is full. Please ask your organizer for another code."
    return None


def clean_field_values(defs: list[dict[str, Any]], values: dict[str, Any]) -> dict[str, str]:
    """The member's answers to the group's own questions (roll number, branch, trade…), checked."""
    out: dict[str, str] = {}
    for f in defs:
        v = str((values or {}).get(f["key"], "") or "").strip()[:120]
        if not v:
            if f.get("required"):
                raise ApiError(400, "field_required", f"Please fill in “{f['label']}”.", extra={"field": f["key"]})
            continue
        if f.get("type") == "select" and v not in (f.get("options") or []):
            raise ApiError(
                400, "field_invalid", f"Please choose one of the options for “{f['label']}”.", extra={"field": f["key"]}
            )
        if holds_id_number(v):
            raise ApiError(
                400,
                "id_number",
                f"“{f['label']}” looks like an ID number (Aadhaar, PAN…). Nm7 never stores those.",
                extra={"field": f["key"]},
            )
        out[f["key"]] = v
    return out


# ---------- shared resumes (the organization's view) ----------
def completeness(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Simple 4-part check: contact, education, skills, at least one job or project."""
    d = data or {}
    p = d.get("personal") or {}
    filled = lambda v: bool(str(v or "").strip())  # noqa: E731
    parts = {
        "contact": filled(p.get("email")) or filled(p.get("phone")),
        "education": any(
            filled(e.get("institution")) or filled(e.get("degree")) for e in d.get("edu") or [] if isinstance(e, dict)
        ),
        "skills": any(filled(g.get("value")) for g in d.get("skillGroups") or [] if isinstance(g, dict))
        or filled(d.get("skills")),
        "experience": any(
            filled(e.get("company")) or filled(e.get("role")) for e in d.get("exp") or [] if isinstance(e, dict)
        )
        or any(filled(x.get("title")) for x in d.get("proj") or [] if isinstance(x, dict)),
    }
    return 25 * sum(parts.values()), [k for k, ok in parts.items() if not ok]


def roll_key(defs: list[dict[str, Any]]) -> str | None:
    for f in defs:
        if re.search(r"roll|reg(istration)?\s*(no|number)|enrol", f"{f['key']} {f['label']}", re.I):
            return f["key"]
    return None


def safe_part(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9]+", "_", s or "")).strip("_")[:60]


def file_name(roll: str | None, name: str) -> str:
    parts = [safe_part(roll or ""), safe_part(name), "Resume"]
    return "_".join(p for p in parts if p) + ".pdf"


def unique_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for n in names:
        k = n.lower()
        seen[k] = seen.get(k, 0) + 1
        out.append(n if seen[k] == 1 else n.replace("_Resume.pdf", f"_{seen[k]}_Resume.pdf"))
    return out


async def shared_rows(db: AsyncDatabase, match: dict[str, Any]) -> list[dict[str, Any]]:
    """Every membership matching `match` that the organization may see, joined with user, group, org and resume.
    Members who left, never consented, were disabled or deleted their shared resume are left out."""
    q = {**match, "left_at": None, "consent.given": True}
    ms_ = [m async for m in db[MEMBERSHIPS].find(q)]
    if not ms_:
        return []
    users = {
        u["_id"]: u
        async for u in db[USERS].find({"_id": {"$in": list({m["user_id"] for m in ms_})}, "disabled_at": None})
    }
    groups = {g["_id"]: g async for g in db[ORG_GROUPS].find({"_id": {"$in": list({m["group_id"] for m in ms_})}})}
    orgs = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({m["org_id"] for m in ms_})}})}
    resumes = {
        (r["user_id"], r["key"]): r
        async for r in db[RESUMES].find(
            {"user_id": {"$in": list(users)}, "key": {"$in": list({m.get("resume_id") for m in ms_})}}
        )
    }
    rows = []
    for m in ms_:
        u, g, o, r = (
            users.get(m["user_id"]),
            groups.get(m["group_id"]),
            orgs.get(m["org_id"]),
            resumes.get((m["user_id"], m.get("resume_id"))),
        )
        if not (u and g and o and r):
            continue
        data = r.get("data") or {}
        pct, missing = completeness(data)
        personal = data.get("personal") or {}
        preset = (data.get("design") or {}).get("preset") or "fresher"
        rows.append(
            {
                "membership_id": m["_id"],
                "user_id": u["_id"],
                "name": (personal.get("name") or u["name"] or "").strip(),
                "email": u["email"],
                "phone": u.get("phone") or personal.get("phone") or "",
                "org_id": o["_id"],
                "org_name": o["name"],
                "group_id": g["_id"],
                "group_name": g["name"],
                "fields": m.get("field_values") or {},
                "field_defs": g.get("custom_fields") or [],
                "roll": (m.get("field_values") or {}).get(roll_key(g.get("custom_fields") or []) or "", ""),
                "resume_id": r["key"],
                "resume_title": r.get("name") or "",
                "template": preset,  # the template key; the admin page shows its name
                "pages": r.get("pages"),
                "completeness": pct,
                "missing": missing,
                "joined_at": m["joined_at"],
                "updated_at": r.get("updated_at"),
                "printed_at": m.get("printed_at"),
                "printed_count": m.get("printed_count", 0),
                "_data": data,
            }
        )
    return rows


async def group_downloads_free(db: AsyncDatabase, user_id: str) -> bool:
    """True when the user is (still) in an active group whose organization pays for its members' downloads."""
    async for m in db[MEMBERSHIPS].find({"user_id": user_id, "left_at": None, "consent.given": True}, {"group_id": 1}):
        g = await db[ORG_GROUPS].find_one({"_id": m["group_id"]}, {"settings": 1})
        st = (g or {}).get("settings") or {}
        if st.get("members_download_free") and st.get("active", True):
            return True
    return False


def row_out(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "membershipId": r["membership_id"],
        "name": r["name"],
        "email": r["email"],
        "phone": r["phone"],
        "orgId": r["org_id"],
        "orgName": r["org_name"],
        "groupId": r["group_id"],
        "groupName": r["group_name"],
        "fields": r["fields"],
        "roll": r["roll"],
        "resumeId": r["resume_id"],
        "resumeTitle": r["resume_title"],
        "template": r["template"],
        "pages": r["pages"],
        "completeness": r["completeness"],
        "missing": r["missing"],
        "joinedAt": ms(r["joined_at"]),
        "updatedAt": ms(r["updated_at"]),
        "printedAt": ms(r["printed_at"]),
        "printedCount": r["printed_count"],
    }


def printable(r: dict[str, Any]) -> dict[str, Any]:
    """What the admin's browser renders: the resume exactly as the member prints it (hidden entries removed)."""
    return visible_resume(r["_data"])


def _day(v: str | None, end: bool = False) -> datetime | None:
    if not v:
        return None
    d = date.fromisoformat(v)
    return datetime(d.year, d.month, d.day, 23 if end else 0, 59 if end else 0, 59 if end else 0, tzinfo=IST)


def filter_rows(rows: list[dict[str, Any]], f: dict[str, Any]) -> list[dict[str, Any]]:
    out = rows
    if f.get("q"):
        q = f["q"].strip().lower()
        out = [r for r in out if q in r["name"].lower() or q in r["email"].lower() or q in r["roll"].lower()]
    for key, start, end in (
        ("joined_at", f.get("joined_from"), f.get("joined_to")),
        ("updated_at", f.get("updated_from"), f.get("updated_to")),
    ):
        if start:
            out = [r for r in out if r[key] and r[key] >= _day(start)]
        if end:
            out = [r for r in out if r[key] and r[key] <= _day(end, end=True)]
    if f.get("field_key") and f.get("field_value"):
        want = f["field_value"].strip().lower()
        out = [r for r in out if str(r["fields"].get(f["field_key"], "")).strip().lower() == want]
    if f.get("incomplete"):
        out = [r for r in out if r["completeness"] < 100]
    if f.get("not_printed"):
        out = [r for r in out if not r["printed_at"]]
    return out


def sort_rows(rows: list[dict[str, Any]], sort: str = "joined", direction: str = "desc") -> list[dict[str, Any]]:
    epoch = datetime(1970, 1, 1, tzinfo=IST)
    keys = {
        "name": lambda r: r["name"].lower(),
        "roll": lambda r: (r["roll"] == "", r["roll"].lower(), r["name"].lower()),
        "joined": lambda r: r["joined_at"] or epoch,
        "updated": lambda r: r["updated_at"] or epoch,
        "completeness": lambda r: r["completeness"],
        "printed": lambda r: r["printed_at"] or epoch,
        "org": lambda r: (r["org_name"].lower(), r["group_name"].lower(), r["name"].lower()),
    }
    if sort.startswith("field:"):
        k = sort[6:]
        key = lambda r: (str(r["fields"].get(k, "")) == "", str(r["fields"].get(k, "")).lower(), r["name"].lower())  # noqa: E731
    else:
        key = keys.get(sort, keys["joined"])
    return sorted(rows, key=key, reverse=direction == "desc")
