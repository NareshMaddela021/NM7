"""Nm7 for Organizations: organizations → groups (join codes) → memberships.

A membership says: this user shared this resume with this group's organization, with consent, on this date. The
organization's view (Phase 1: the super-admin's Shared resumes page) only ever includes members who gave consent,
haven't left, whose account is active and whose shared resume still exists.

Later phases (coordinator logins, dashboards, approvals, kiosk mode, branded templates, recruiter links, pricing)
hang off the same documents: organizations.roles (reserved), groups.settings and memberships.
"""

import re
import secrets
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import MEMBERSHIPS, ORG_GROUPS, ORGANIZATIONS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers
from app.core.richtext import plain
from app.core.security import keyed_hash, same
from app.core.time import IST, now
from app.maintenance.sample_data import has_sample
from app.me.service import ms, visible_resume
from app.orgs.scope import features_of
from app.photos.scrub import DL, EPIC, IFSC, LABEL, MASKED, PAN, PASSPORT

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
    return any(p.search(text) for p in (AADHAAR, VID, PAN, EPIC, DL, PASSPORT, IFSC, MASKED, LABEL))


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
    """A file-name slug that keeps names in any script: letters and digits (`str.isalnum()`), the combining marks
    that Indic vowel signs and viramas are (category M) and the zero-width joiners inside a word stay; every other
    run of characters becomes one underscore."""
    keep = lambda c: c.isalnum() or unicodedata.category(c).startswith("M") or c in "\u200c\u200d"  # noqa: E731
    out = re.sub(r"_+", "_", "".join(c if keep(c) else "_" for c in s or "")).strip("_\u200c\u200d")
    return out[:60]


def file_name(roll: str | None, name: str, fallback: str = "") -> str:
    """`<roll>_<name>_Resume.pdf`; when neither the roll nor the name leaves a usable slug, the first 8 characters of
    `fallback` (the membership id) keep the file identifiable instead of a bare `Resume.pdf`."""
    parts = [safe_part(roll or ""), safe_part(name)]
    if not any(parts):
        parts = [safe_part(fallback)[:8]]
    return "_".join(p for p in [*parts, "Resume"] if p) + ".pdf"


def unique_names(names: list[str]) -> list[str]:
    """Repeated names get `_2`, `_3`, … before the extension (case-insensitively, for Windows), whatever the name."""
    seen: dict[str, int] = {}
    out = []
    for n in names:
        k = n.casefold()
        seen[k] = seen.get(k, 0) + 1
        if seen[k] == 1:
            out.append(n)
        else:
            stem, dot, ext = n.rpartition(".")
            out.append(f"{stem}_{seen[k]}{dot}{ext}" if dot else f"{n}_{seen[k]}")
    return out


# What a table row needs from the resume: name / contact, the template and the four completeness checks. The rest
# of the document (bullets, projects, cover letters…) can run to 200 KB per member, so it is only fetched for the
# paths that print or export it (`with_data=True`).
ROW_FIELDS = ("name", "pages", "updated_at", "key", "user_id")
ROW_DATA_FIELDS = (
    "personal.name",
    "personal.email",
    "personal.phone",
    "personal.headline",
    "design.preset",
    "edu.institution",
    "edu.degree",
    "edu.courses",
    "edu.off",
    "hidden.edu",
    "skillGroups.value",
    "skills",
    "exp.company",
    "exp.role",
    "proj.title",
    # the example person's markers (the "Contains sample data" badge)
    "links.linkedin",
    "links.github",
    "pinfo.father",
    "pinfo.mother",
    "edu.field",
    "edu.from",
    "edu.to",
    "edu.grade",
    "exp.from",
    "exp.to",
)


def courses_of(data: dict[str, Any]) -> str:
    """Education's relevant courses (switched-off entries and a hidden section left out), "A; B; C", no bold marks."""
    if (data.get("hidden") or {}).get("edu"):
        return ""
    out: list[str] = []
    seen: set[str] = set()
    for e in data.get("edu") or []:
        if not isinstance(e, dict) or e.get("off"):
            continue
        cs = e.get("courses")
        for c in cs if isinstance(cs, list) else str(cs or "").split(","):
            name = " ".join(plain(str(c)).split())
            if name and name.lower() not in seen:
                seen.add(name.lower())
                out.append(name)
    return "; ".join(out)


ROW_PROJECTION = {**dict.fromkeys(ROW_FIELDS, 1), **{f"data.{f}": 1 for f in ROW_DATA_FIELDS}}
FULL_PROJECTION = {**dict.fromkeys(ROW_FIELDS, 1), "data": 1}
# Membership filters that live on the membership document itself; they are applied in Mongo so that fewer rows
# (and resumes) are loaded, and again in filter_rows() so the behaviour is one place's.
_MEMBERSHIP_MATCH = {
    "approved": {"approval": {"$in": ["approved", None]}},  # Phase 1 members were never asked: approved
    "pending": {"approval": "pending"},
    "rejected": {"approval": "rejected"},
}


def membership_match(f: dict[str, Any] | None) -> dict[str, Any]:
    """The part of the table's filters that Mongo can apply to memberships before anything is joined."""
    f = f or {}
    out: dict[str, Any] = dict(_MEMBERSHIP_MATCH.get(f.get("approval") or "approved", {}))
    if f.get("review"):
        out["review_status"] = {"$in": ["none", None]} if f["review"] == "none" else f["review"]
    joined: dict[str, Any] = {}
    if f.get("joined_from"):
        joined["$gte"] = _day(f["joined_from"])
    if f.get("joined_to"):
        joined["$lte"] = _day(f["joined_to"], end=True)
    if joined:
        out["joined_at"] = joined
    if f.get("not_printed") or f.get("ready_not_printed"):
        out["printed_at"] = None
    if f.get("ready_not_printed") and not f.get("review"):
        out["review_status"] = "ready"
    return out


async def shared_rows(db: AsyncDatabase, match: dict[str, Any], *, with_data: bool = False) -> list[dict[str, Any]]:
    """Every membership matching `match` that the organization may see, joined with user, group, org and resume.
    Members who left, never consented, were disabled or deleted their shared resume are left out.
    `with_data=True` also carries the whole resume (for printing / viewing: `printable()`); the default loads
    only the fields a table row needs."""
    q = {**match, "left_at": None, "consent.given": True}
    ms_ = [m async for m in db[MEMBERSHIPS].find(q)]
    if not ms_:
        return []
    users = {
        u["_id"]: u
        async for u in db[USERS].find(
            {"_id": {"$in": list({m["user_id"] for m in ms_})}, "disabled_at": None},
            {"name": 1, "email": 1, "phone": 1, "demo": 1},
        )
    }
    groups = {
        g["_id"]: g
        async for g in db[ORG_GROUPS].find(
            {"_id": {"$in": list({m["group_id"] for m in ms_})}}, {"name": 1, "custom_fields": 1}
        )
    }
    orgs = {
        o["_id"]: o
        async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({m["org_id"] for m in ms_})}}, {"name": 1})
    }
    resumes = {
        (r["user_id"], r["key"]): r
        async for r in db[RESUMES].find(
            {"user_id": {"$in": list(users)}, "key": {"$in": list({m.get("resume_id") for m in ms_})}},
            FULL_PROJECTION if with_data else ROW_PROJECTION,
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
                "demo": bool(u.get("demo")),
                "name": plain(personal.get("name") or u["name"] or "").strip(),  # no bold markers in lists or CSV
                "email": u["email"],
                "phone": u.get("phone") or personal.get("phone") or "",
                "headline": str(personal.get("headline") or ""),
                "courses": courses_of(data),
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
                "approval": m.get("approval") or "approved",  # Phase 1 members were never asked: approved
                "review_status": m.get("review_status") or "none",
                "review_note": m.get("review_note") or "",
                "reminders_opt_out": bool(m.get("reminders_opt_out")),
                "last_reminded_at": m.get("last_reminded_at"),
                "recruiter_opt_in": bool(m.get("recruiter_opt_in")),  # Phase 3C: never assumed, only ticked
                "shortlisted_by": [],  # filled by with_shortlists()
                "sample": has_sample(data),  # still holds the example person's values (older builder versions)
                **({"_data": data} if with_data else {}),
            }
        )
    return rows


async def group_downloads_free(db: AsyncDatabase, user_id: str) -> bool:
    """True when the user is (still) in an active group whose organization pays for its members' downloads."""
    q = {"user_id": user_id, "left_at": None, "consent.given": True, "approval": {"$nin": ["pending", "rejected"]}}
    gids = [m["group_id"] async for m in db[MEMBERSHIPS].find(q, {"group_id": 1})]
    if not gids:
        return False
    groups = [
        g
        async for g in db[ORG_GROUPS].find({"_id": {"$in": gids}}, {"settings": 1, "org_id": 1})
        if (g.get("settings") or {}).get("members_download_free") and (g.get("settings") or {}).get("active", True)
    ]
    if not groups:
        return False
    # only while the organization's plan (or Nm7) includes free downloads: an expired plan stops paying for them
    orgs = db[ORGANIZATIONS].find({"_id": {"$in": list({g["org_id"] for g in groups})}})
    return any([features_of(o)["members_download_free"] async for o in orgs])


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
        "fieldDefs": [{"key": d["key"], "label": d["label"]} for d in r["field_defs"]],
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
        "approval": r["approval"],
        "reviewStatus": r["review_status"],
        "reviewNote": r["review_note"],
        "remindersOptOut": r["reminders_opt_out"],
        "lastRemindedAt": ms(r["last_reminded_at"]),
        "recruiterOptIn": r["recruiter_opt_in"],
        "shortlistedBy": r["shortlisted_by"],
        "sample": r.get("sample", False),
    }


async def with_shortlists(db: AsyncDatabase, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adds "Shortlisted by <Company>" to each row from the organizations' recruiter links (any state)."""
    from app.core.db import RECRUITER_LINKS

    orgs = list({r["org_id"] for r in rows})
    if not orgs:
        return rows
    by: dict[str, list[dict[str, str]]] = {}
    q = {"org_id": {"$in": orgs}, "shortlist": {"$ne": {}}}
    async for link in db[RECRUITER_LINKS].find(q, {"company": 1, "shortlist": 1}):
        for mid in link.get("shortlist") or {}:
            by.setdefault(mid, []).append({"linkId": link["_id"], "company": link["company"]})
    for r in rows:
        r["shortlisted_by"] = by.get(r["membership_id"], [])
    return rows


def printable(r: dict[str, Any]) -> dict[str, Any]:
    """What the admin's browser renders: the resume exactly as the member prints it (hidden entries removed).
    ID numbers were removed when the resume was saved; this is the second lock, for anything saved before that or
    missed then: the number goes, and a string that still holds one goes whole.
    Only rows from `shared_rows(…, with_data=True)` carry the resume."""
    if "_data" not in r:
        raise RuntimeError("printable() needs a row loaded with shared_rows(..., with_data=True)")
    return scrub_id_numbers(visible_resume(r["_data"]), strict=True)[0]


def _day(v: str | None, end: bool = False) -> datetime | None:
    if not v:
        return None
    d = date.fromisoformat(v)
    return datetime(d.year, d.month, d.day, 23 if end else 0, 59 if end else 0, 59 if end else 0, tzinfo=IST)


COMPLETE = 80  # "complete enough": the dashboard's ≥ 80 % (completeness moves in steps of 25)
APPROVALS = ("approved", "pending", "rejected")
REVIEWS = ("none", "needs_changes", "ready")


def filter_rows(rows: list[dict[str, Any]], f: dict[str, Any]) -> list[dict[str, Any]]:
    """The table's filters. Pending and rejected members only show when asked for (approval "pending", "rejected"
    or "all"); exports always pass approval="approved"."""
    approval = f.get("approval") or "approved"
    out = rows if approval == "all" else [r for r in rows if r["approval"] == approval]
    if f.get("review"):
        out = [r for r in out if r["review_status"] == f["review"]]
    if f.get("shortlisted_by"):
        out = [r for r in out if any(s["linkId"] == f["shortlisted_by"] for s in r["shortlisted_by"])]
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
        out = [r for r in out if r["completeness"] < COMPLETE]
    if f.get("not_printed"):
        out = [r for r in out if not r["printed_at"]]
    if f.get("ready_not_printed"):
        out = [r for r in out if r["review_status"] == "ready" and not r["printed_at"]]
    return out


def dashboard(rows: list[dict[str, Any]], days: int = 30, today: date | None = None) -> dict[str, Any]:
    """One group's numbers from its rows (every consented member who hasn't left, whatever their approval)."""
    today = today or now().astimezone(IST).date()
    live = [r for r in rows if r["approval"] != "rejected"]
    count = lambda pred: sum(1 for r in live if pred(r))  # noqa: E731
    per_day = {(today - timedelta(days=i)).isoformat(): 0 for i in range(days - 1, -1, -1)}
    for r in rows:
        d = r["joined_at"].astimezone(IST).date().isoformat()
        if d in per_day:
            per_day[d] += 1
    incomplete = sorted(
        (r for r in live if r["completeness"] < COMPLETE), key=lambda r: (r["completeness"], r["name"].lower())
    )
    return {
        "counts": {
            "joined": len(rows),
            "pending": sum(1 for r in rows if r["approval"] == "pending"),
            "approved": sum(1 for r in rows if r["approval"] == "approved"),
            "rejected": sum(1 for r in rows if r["approval"] == "rejected"),
            "complete": count(lambda r: r["completeness"] >= COMPLETE),
            "incomplete": len(incomplete),
            "needsChanges": count(lambda r: r["review_status"] == "needs_changes"),
            "ready": count(lambda r: r["review_status"] == "ready"),
            "printed": count(lambda r: bool(r["printed_at"])),
            "readyNotPrinted": count(lambda r: r["review_status"] == "ready" and not r["printed_at"]),
        },
        "joinsPerDay": [{"day": d, "n": n} for d, n in per_day.items()],
        "buckets": {
            "low": count(lambda r: r["completeness"] < 40),
            "mid": count(lambda r: 40 <= r["completeness"] < COMPLETE),
            "high": count(lambda r: r["completeness"] >= COMPLETE),
        },
        "incompleteMembers": [
            {
                "membershipId": r["membership_id"],
                "name": r["name"],
                "roll": r["roll"],
                "completeness": r["completeness"],
                "missing": r["missing"],
                "approval": r["approval"],
            }
            for r in incomplete[:200]
        ],
    }


# ---------- reminder opt-out links ----------
def opt_out_token(membership_id: str) -> str:
    return f"{membership_id}.{keyed_hash('reminders-opt-out', membership_id)[:32]}"


def opt_out_membership(token: str) -> str | None:
    mid, _, sig = (token or "").partition(".")
    return mid if mid and sig and same(sig, keyed_hash("reminders-opt-out", mid)[:32]) else None


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


async def active_members(db, group_id: str) -> int:
    """Members who have not left the group."""
    return await db[MEMBERSHIPS].count_documents({"group_id": group_id, "left_at": None})
