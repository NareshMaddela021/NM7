"""Placement dashboard (Organizations, Phase 1 of the college features): Org > Dashboard, for the whole organization
or one group, inside the viewer's scope (a coordinator sees only their organization and their groups; only members
who joined and consented; members who left or were rejected are not counted).

  GET    …/placement?group=                       tiles (every plan); charts and "who's missing" lists (Drive / Campus)
  GET    …/placement/missing.csv?list=&group=      one "who's missing" list as CSV (Drive / Campus)
  POST   …/placement/remind {ids, note}            reminder email to chosen members, resume shared or not
  GET    …/groups/{id}/roll-list                   the uploaded roll list: how many, how many joined
  PUT    …/groups/{id}/roll-list {csv}             replace it (name, roll number, branch, email)
  DELETE …/groups/{id}/roll-list

Numbers:
- joined: members who consented and haven't left (pending approval included, rejected not); invited: roll-list rows
- shared: joined members whose shared resume is there; approved; ready (review "Ready"); printed
- ATS: the student's own ATS check score (app/orgs/ats.py) with bands < 60 / 60-79 / 80+
- LinkedIn-ready: the resume has a LinkedIn link, or the student's LinkedIn check scored 70 or more (only this yes / no
  is used: nothing from the LinkedIn check itself is shown to the organization)
- shortlisted: shortlisted by at least one recruiter link or invite of the organization

A roll list is matched to members by email or roll number when they join (worked out each time, so a late joiner
counts at once). ID numbers are refused in roll lists, never stored and never shown.
"""

import csv
import io
import re
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field

from app.audit import audit
from app.core.db import (
    DB,
    LINKEDIN,
    MEMBERSHIPS,
    ORG_GROUPS,
    ORGANIZATIONS,
    RESUMES,
    ROLL_LISTS,
    USERS,
)
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.richtext import plain
from app.core.schemas import CamelModel
from app.core.time import IST, ist_day, now
from app.jobsearch import skills as dictionary
from app.me.service import ms
from app.orgs import emails
from app.orgs.ats import all_skills, ats_score, band, bullets_of, printed
from app.orgs.scope import NOT_FOUND, Scope, features_of
from app.orgs.service import holds_id_number, opt_out_token, roll_key, shortlists
from app.orgs.shapes import ACTION_RULES, GROUP_REMIND_RULES, _ip

MAX_ROLL_ROWS = 5000
MAX_ROLL_BYTES = 2_000_000
LINKEDIN_READY = 70
NO_LINKEDIN = "No LinkedIn link, or LinkedIn check under 70"
WEEKS = 8
BRANCH_FIELD = re.compile(r"branch|department|dept|stream|speciali[sz]ation|discipline", re.I)
LISTS = ("notJoined", "noResume", "lowAts", "notLinkedin", "needsChanges", "notPrinted")
LIST_TITLES = {
    "notJoined": "Not joined",
    "noResume": "Joined, no resume",
    "lowAts": "Low ATS (under 60)",
    "notLinkedin": "Not LinkedIn-ready",
    "needsChanges": "Needs changes",
    "notPrinted": "Not printed",
}
# "top missing items": (key, how the dashboard says it)
GAPS = (
    ("no_result", "have no project or internship bullet with a result (a number)"),
    ("no_linkedin", "are missing a LinkedIn link"),
    ("no_summary", "have no summary"),
    ("few_skills", "list fewer than 8 skills"),
    ("no_experience", "have no internship or work experience"),
    ("no_projects", "have no projects"),
    ("no_grade", "don't show their CGPA or marks"),
    ("no_certs", "have no certifications"),
    ("weak_verbs", "don't start bullets with action verbs"),
    ("long", "run over one page"),
)
GAP_SHORT = {
    "no_result": "No result with a number",
    "no_linkedin": "No LinkedIn link",
    "no_summary": "No summary",
    "few_skills": "Fewer than 8 skills",
    "no_experience": "No internship / experience",
    "no_projects": "No projects",
    "no_grade": "No CGPA / marks",
    "no_certs": "No certifications",
    "weak_verbs": "Weak bullet verbs",
    "long": "Over one page",
}

router = APIRouter()  # mounted under /api/org/{org_id} (staff) by app.orgs.staff


# ---------- roll lists ----------
def _norm_roll(v: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (v or "").lower())


def _norm_email(v: str) -> str:
    return (v or "").strip().lower()


HEADER_WORDS = {
    "name": re.compile(r"^(student\s*)?name$|^full\s*name$", re.I),
    "roll": re.compile(r"roll|reg(istration)?|enrol|usn|hall\s*ticket", re.I),
    "branch": BRANCH_FIELD,
    "email": re.compile(r"e-?mail", re.I),
}


def parse_roll_list(text: str) -> list[dict[str, str]]:
    """CSV with name, roll number, branch, email (a header row is recognised in any order; without one, that order).
    Refuses ID numbers (Aadhaar, PAN…) and anything over 5,000 rows."""
    if len(text.encode()) > MAX_ROLL_BYTES:
        raise ApiError(400, "roll_list_too_big", "That file is too big. A roll list can have up to 5,000 students.")
    rows = [r for r in csv.reader(io.StringIO(text.lstrip("﻿"))) if any(c.strip() for c in r)]
    if not rows:
        raise ApiError(400, "roll_list_empty", "The file has no rows. Use columns: name, roll number, branch, email.")
    cols = {"name": 0, "roll": 1, "branch": 2, "email": 3}
    head = [c.strip() for c in rows[0]]
    found = {k: i for k, pat in HEADER_WORDS.items() for i, c in enumerate(head) if pat.search(c)}
    if "name" in found or "email" in found or "roll" in found:
        cols = {k: found.get(k, -1) for k in cols}
        rows = rows[1:]
    if len(rows) > MAX_ROLL_ROWS:
        raise ApiError(400, "roll_list_too_big", "A roll list can have up to 5,000 students. Split it by group.")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for n, r in enumerate(rows, start=1):
        get = lambda k, r=r: r[cols[k]].strip()[:120] if 0 <= cols[k] < len(r) else ""  # noqa: E731
        e = {"name": re.sub(r"\s+", " ", get("name")), "roll": get("roll"), "branch": get("branch"),
             "email": _norm_email(get("email"))}  # fmt: skip
        if not (e["name"] or e["roll"] or e["email"]):
            continue
        if any(holds_id_number(c) for c in r):  # any column, even one we don't keep
            raise ApiError(
                400,
                "id_number",
                f"Row {n} looks like it holds an ID number (Aadhaar, PAN…). "
                "Nm7 never stores those: remove that column.",
            )
        if e["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", e["email"]):
            e["email"] = ""
        key = _norm_roll(e["roll"]) or e["email"] or e["name"].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    if not out:
        raise ApiError(400, "roll_list_empty", "No students found. Use columns: name, roll number, branch, email.")
    return out


def match_roll(entries: list[dict[str, Any]], students: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Roll-list row index → the member it belongs to (same group; same email or same roll number)."""
    by_email: dict[tuple[str, str], dict[str, Any]] = {}
    by_roll: dict[tuple[str, str], dict[str, Any]] = {}
    for s in students:
        if s["email"]:
            by_email[(s["group_id"], _norm_email(s["email"]))] = s
        if s["roll"]:
            by_roll[(s["group_id"], _norm_roll(s["roll"]))] = s
    out: dict[int, dict[str, Any]] = {}
    for i, e in enumerate(entries):
        g = e["group_id"]
        s = (e["email"] and by_email.get((g, e["email"]))) or (e["roll"] and by_roll.get((g, _norm_roll(e["roll"]))))
        if s:
            out[i] = s
    return out


# ---------- the students in view ----------
def gaps_of(data: dict[str, Any], ats: dict[str, Any]) -> list[str]:
    d = printed(data)
    bullets = bullets_of(d)
    checks = {c["key"]: c["ok"] for c in ats["checks"]}
    exp = [e for e in d.get("exp") or [] if isinstance(e, dict) and (e.get("role") or e.get("company"))]
    proj = [x for x in d.get("proj") or [] if isinstance(x, dict) and x.get("title")]
    edu = [e for e in d.get("edu") or [] if isinstance(e, dict)]
    out = []
    if not any(re.search(r"\d", b) for b in bullets):
        out.append("no_result")
    if not checks.get("linkedin"):
        out.append("no_linkedin")
    if not str(d.get("summary") or "").strip():
        out.append("no_summary")
    if len(all_skills(d)) < 8:
        out.append("few_skills")
    if not exp:
        out.append("no_experience")
    if not proj:
        out.append("no_projects")
    if edu and not any(str(e.get("grade") or "").strip() for e in edu):
        out.append("no_grade")
    if not [c for c in d.get("certs") or [] if isinstance(c, dict) and c.get("name")]:
        out.append("no_certs")
    if bullets and not checks.get("verbs"):
        out.append("weak_verbs")
    if not checks.get("length"):
        out.append("long")
    return out


def _branch_key(defs: list[dict[str, Any]]) -> str | None:
    for f in defs:
        if BRANCH_FIELD.search(f"{f['key']} {f['label']}"):
            return f["key"]
    return None


async def _groups(db, scope: Scope, group: str | None) -> list[dict[str, Any]]:
    if group:
        return [await scope.group(db, group)]
    q: dict[str, Any] = {"org_id": scope.org_id}
    if scope.group_ids is not None:
        q["_id"] = {"$in": scope.group_ids}
    return [g async for g in db[ORG_GROUPS].find(q)]


async def students(db, groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every member of these groups who consented and hasn't left (rejected left out), with their shared resume
    (when it is there), its ATS score, gaps, skills, LinkedIn-ready and shortlisted."""
    gmap = {g["_id"]: g for g in groups}
    if not gmap:
        return []
    q = {"group_id": {"$in": list(gmap)}, "left_at": None, "consent.given": True, "approval": {"$ne": "rejected"}}
    mems = [m async for m in db[MEMBERSHIPS].find(q)]
    uids = list({m["user_id"] for m in mems})
    users = {
        u["_id"]: u
        async for u in db[USERS].find({"_id": {"$in": uids}, "disabled_at": None}, {"name": 1, "email": 1, "demo": 1})
    }
    resumes = {
        (r["user_id"], r["key"]): r
        async for r in db[RESUMES].find(
            {"user_id": {"$in": uids}, "key": {"$in": list({m.get("resume_id") for m in mems if m.get("resume_id")})}},
            {"user_id": 1, "key": 1, "data": 1, "updated_at": 1},
        )
    }
    linkedin = {
        d["_id"]: d async for d in db[LINKEDIN].find({"_id": {"$in": uids}}, {"url": 1, "result.score": 1})
    }  # only these two fields: nothing else from the LinkedIn record is read
    by = await shortlists(db, list({g["org_id"] for g in groups}))
    shortlisted = {mid: sorted({x["company"] for x in xs}) for mid, xs in by.items()}
    out = []
    for m in mems:
        u, g = users.get(m["user_id"]), gmap[m["group_id"]]
        if not u:
            continue
        defs = g.get("custom_fields") or []
        fields = m.get("field_values") or {}
        r = resumes.get((m["user_id"], m.get("resume_id")))
        data = (r or {}).get("data") or {}
        ats = ats_score(data) if r else None
        li = linkedin.get(m["user_id"]) or {}
        li_score = ((li.get("result") or {}).get("score")) if isinstance(li.get("result"), dict) else None
        has_link = bool(ats and next(c["ok"] for c in ats["checks"] if c["key"] == "linkedin"))
        name = plain((data.get("personal") or {}).get("name") or u.get("name") or "").strip()
        updated = (r or {}).get("updated_at")
        out.append(
            {
                "membership_id": m["_id"],
                "user_id": u["_id"],
                "demo": bool(u.get("demo")),
                "name": name,
                "email": u.get("email", ""),
                "group_id": g["_id"],
                "group_name": g["name"],
                "org_id": g["org_id"],
                "roll": str(fields.get(roll_key(defs) or "", "") or ""),
                "branch": str(fields.get(_branch_key(defs) or "", "") or ""),
                "joined_at": m["joined_at"],
                "has_resume": bool(r),
                "approval": m.get("approval") or "approved",
                "review_status": m.get("review_status") or "none",
                "review_note": m.get("review_note") or "",
                "reviewed_at": m.get("reviewed_at"),
                "printed_at": m.get("printed_at"),
                "updated_at": updated,
                "last_active": max([t for t in (updated, m["joined_at"]) if t]),
                "ats": ats["score"] if ats else None,
                "ats_fails": [c["label"] for c in ats["checks"] if not c["ok"]] if ats else [],
                "gaps": gaps_of(data, ats) if ats else [],
                "skills": dictionary.find(", ".join(all_skills(printed(data)))) if r else [],
                "linkedin_ready": has_link or bool(li.get("url")) or (li_score or 0) >= LINKEDIN_READY,
                "shortlisted_by": shortlisted.get(m["_id"], []),
                "reminders_opt_out": bool(m.get("reminders_opt_out")),
                "last_reminded_at": m.get("last_reminded_at"),
            }
        )
    return out


async def roll_entries(db, groups: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Every roll-list row of these groups (with its group), or None when none of them has a roll list."""
    docs = [d async for d in db[ROLL_LISTS].find({"_id": {"$in": [g["_id"] for g in groups]}})]
    if not docs:
        return None
    names = {g["_id"]: g["name"] for g in groups}
    return [
        {**e, "group_id": d["_id"], "group_name": names.get(d["_id"], "")} for d in docs for e in d.get("rows") or []
    ]


# ---------- the numbers ----------
def _pct(n: int, of: int) -> int:
    return round(100 * n / of) if of else 0


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _ist(t: datetime | None) -> date | None:
    return t.astimezone(IST).date() if t else None


def summarize(
    rows: list[dict[str, Any]], roll: list[dict[str, Any]] | None, today: date | None = None
) -> dict[str, Any]:
    """Tiles, charts and "who's missing" lists from the students in view (pure, so tests can check every number)."""
    today = today or now().astimezone(IST).date()
    shared = [r for r in rows if r["has_resume"]]
    scored = [r for r in shared if r["ats"] is not None]
    bands = Counter(band(r["ats"]) for r in scored)
    matches = match_roll(roll, rows) if roll is not None else {}
    not_joined = [e for i, e in enumerate(roll or []) if i not in matches]
    approved = [r for r in shared if r["approval"] == "approved"]
    ready = [r for r in shared if r["review_status"] == "ready"]
    printed_ = [r for r in shared if r["printed_at"]]
    tiles = {
        "invited": len(roll) if roll is not None else None,
        "joined": len(rows),
        "joinedFromRoll": len(matches) if roll is not None else None,
        "shared": len(shared),
        "sharedPct": _pct(len(shared), len(rows)),
        "approved": len(approved),
        "ready": len(ready),
        "atsAvg": round(sum(r["ats"] for r in scored) / len(scored)) if scored else None,
        "atsBands": {k: bands.get(k, 0) for k in ("low", "mid", "high")},
        "linkedinReady": sum(1 for r in rows if r["linkedin_ready"]),
        "linkedinReadyPct": _pct(sum(1 for r in rows if r["linkedin_ready"]), len(rows)),
        "printed": len(printed_),
        "readyNotPrinted": sum(1 for r in ready if not r["printed_at"]),
        "shortlisted": sum(1 for r in rows if r["shortlisted_by"]),
    }
    funnel = [
        *([("invited", "Invited", len(roll))] if roll is not None else []),
        ("joined", "Joined", len(rows)),
        ("shared", "Shared a resume", len(shared)),
        ("approved", "Approved", len(approved)),
        ("ready", "Ready", len(ready)),
        ("shortlisted", "Shortlisted", tiles["shortlisted"]),
    ]
    by: dict[str, Counter] = {}
    use_branch = any(r["branch"] for r in scored)
    for r in scored:
        k = (r["branch"] or "No branch given") if use_branch else r["group_name"]
        by.setdefault(k, Counter())[band(r["ats"])] += 1
    gap_count = Counter(g for r in shared for g in r["gaps"])
    skill_count = Counter(s for r in shared for s in set(r["skills"]))
    weeks = [_week_start(today) - timedelta(weeks=i) for i in range(WEEKS - 1, -1, -1)]
    weekly = []
    for w in weeks:
        end = w + timedelta(days=7)
        within = lambda t, w=w, end=end: bool(t) and w <= _ist(t) < end  # noqa: E731
        weekly.append(
            {
                "week": w.isoformat(),
                "joined": sum(1 for r in rows if within(r["joined_at"])),
                "updated": sum(1 for r in shared if within(r["updated_at"])),
                "ready": sum(1 for r in ready if within(r["reviewed_at"])),
            }
        )

    def row(r: dict[str, Any], missing: list[str]) -> dict[str, Any]:
        return {
            "membershipId": r.get("membership_id"),
            "name": r["name"],
            "roll": r["roll"],
            "branch": r["branch"],
            "group": r["group_name"],
            "groupId": r["group_id"],
            "missing": missing,
            "lastActive": ms(r.get("last_active")),
            "ats": r.get("ats"),
        }

    lists = {
        "notJoined": [
            {
                **row({**e, "roll": e["roll"], "branch": e["branch"], "last_active": None}, ["Hasn't joined yet"]),
                "membershipId": None,
            }
            for e in not_joined
        ],
        "noResume": [row(r, ["No resume shared"]) for r in rows if not r["has_resume"]],
        "lowAts": [row(r, r["ats_fails"][:3]) for r in sorted(scored, key=lambda r: r["ats"]) if r["ats"] < 60],
        "notLinkedin": [row(r, [NO_LINKEDIN]) for r in rows if not r["linkedin_ready"]],
        "needsChanges": [row(r, [r["review_note"] or "Needs changes"]) for r in shared
                         if r["review_status"] == "needs_changes"],
        "notPrinted": [row(r, ["Not printed yet"]) for r in approved if not r["printed_at"]],
    }  # fmt: skip
    return {
        "tiles": tiles,
        "funnel": [{"key": k, "label": label, "n": n} for k, label, n in funnel],
        "atsByBranch": [
            {"key": k, "low": c["low"], "mid": c["mid"], "high": c["high"], "n": sum(c.values())}
            for k, c in sorted(by.items(), key=lambda kv: kv[0].lower())
        ],
        "atsBy": "branch" if use_branch else "group",
        "topMissing": [
            {"key": k, "text": text, "short": GAP_SHORT[k], "n": gap_count[k], "pct": _pct(gap_count[k], len(shared))}
            for k, text in sorted(GAPS, key=lambda g: -gap_count[g[0]])
            if gap_count[k]
        ],
        "skills": [{"name": s, "n": n} for s, n in skill_count.most_common(40)],
        "weekly": weekly,
        "lists": lists,
        "listTitles": LIST_TITLES,
    }


async def placement_view(db, scope: Scope, group: str | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    groups = await _groups(db, scope, group)
    rows = await students(db, groups)
    out = summarize(rows, await roll_entries(db, groups))
    return rows, out


# ---------- endpoints ----------
class RollIn(CamelModel):
    csv: str = Field(min_length=1, max_length=MAX_ROLL_BYTES)


class PlacementRemindIn(CamelModel):
    ids: list[str] = Field(min_length=1, max_length=2000)
    note: str = Field("", max_length=300)


async def _org(db, scope: Scope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    if not o:
        raise NOT_FOUND
    return o


def _insights(o: dict[str, Any]) -> bool:
    return features_of(o)["placement_insights"]


def _need_insights(o: dict[str, Any]) -> None:
    if not _insights(o):
        raise ApiError(
            402,
            "plan_feature",
            "Charts, who's-missing lists, reminders and roll lists are in the Drive and Campus plans. "
            "Ask your Owner to upgrade (Organization → Billing).",
        )


def register_placement(router: APIRouter, ScopeDep) -> None:  # noqa: N803 — a dependency type
    @router.get("/placement")
    async def placement(db: DB, scope: ScopeDep, group: str | None = Query(None, max_length=64)) -> dict[str, Any]:
        o = await _org(db, scope)
        _, out = await placement_view(db, scope, group)
        insights = _insights(o)
        if not insights:  # Free: the tiles only
            out = {"tiles": out["tiles"]}
        in_scope = await _groups(db, scope, None)
        return {
            **out,
            "insights": insights,
            "role": scope.role,
            "group": group,
            "groups": [{"id": g["_id"], "name": g["name"]} for g in sorted(in_scope, key=lambda g: g["name"].lower())],
            "updatedAt": ms(now()),
        }

    @router.get("/placement/missing.csv")
    async def missing_csv(
        request: Request,
        db: DB,
        scope: ScopeDep,
        list_: Literal[LISTS] = Query(alias="list"),  # type: ignore[valid-type]
        group: str | None = Query(None, max_length=64),
    ) -> Response:
        scope.require("export")
        _need_insights(await _org(db, scope))
        _, out = await placement_view(db, scope, group)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Name", "Roll number", "Branch", "Group", "What's missing", "Last active (IST)", "ATS score"])
        for r in out["lists"][list_]:
            last = datetime.fromtimestamp(r["lastActive"] / 1000, IST).strftime("%Y-%m-%d") if r["lastActive"] else ""
            cells = (r["name"], r["roll"], r["branch"], r["group"], "; ".join(r["missing"]), last,
                     "" if r["ats"] is None else r["ats"])  # fmt: skip
            w.writerow([csv_safe(str(x)) for x in cells])
        await audit(db, scope.actor_id, "placement_export", data=scope.audit_data(list=list_, group=group,
                                                                                  count=len(out["lists"][list_])),
                    ip=_ip(request))  # fmt: skip
        name = f"{LIST_TITLES[list_].split(' (')[0].replace(' ', '_').replace(',', '')}_{ist_day()}.csv"
        return Response(
            CSV_BOM + buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
        )

    @router.post("/placement/remind")
    async def placement_remind(
        body: PlacementRemindIn, request: Request, db: DB, mailer: MailerDep, scope: ScopeDep
    ) -> dict[str, Any]:
        """A reminder to chosen members (whether they shared a resume yet or not): one a day per member (IST), 3 sends
        per group a day, opted-out members and demo students skipped."""
        from app.core import rate_limit
        from app.core.config import get_settings
        from app.orgs.shared import _email_members, _limit

        scope.require("remind")
        o = await _org(db, scope)
        _need_insights(o)
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = [r for r in await students(db, await _groups(db, scope, None)) if r["membership_id"] in set(body.ids)]
        groups = sorted({r["group_id"] for r in rows})
        day = ist_day()
        for gid in groups:
            await rate_limit.check(
                db, f"remind-group:{gid}:{day}", GROUP_REMIND_RULES,
                "This group already had 3 reminder sends today. Please try again tomorrow.",
            )  # fmt: skip
        site = get_settings().site_url
        org_name = o["name"]

        def make(r):
            missing = ["resume"] if not r["has_resume"] else [GAP_SHORT[g] for g in r["gaps"][:4]]
            return emails.reminder(
                r["email"], r["name"] or "there", org_name, r["group_name"], missing, body.note.strip(),
                f"{site}/groups/stop?t={opt_out_token(r['membership_id'])}",
            )  # fmt: skip

        sent, skipped = await _email_members(db, mailer, rows, make)
        if sent or not skipped["failed"]:
            for gid in groups:
                await rate_limit.record(db, f"remind-group:{gid}:{day}")
        data = scope.audit_data(segment="placement", groups=groups, sent=sent, skipped=skipped)
        await audit(db, scope.actor_id, "remind", data=data, ip=_ip(request))
        return {"sent": sent, "skipped": sum(skipped.values()), "reasons": skipped}

    @router.get("/groups/{group_id}/roll-list")
    async def get_roll(group_id: str, db: DB, scope: ScopeDep) -> dict[str, Any]:
        g = await scope.group(db, group_id)
        doc = await db[ROLL_LISTS].find_one({"_id": group_id})
        if not doc:
            return {"count": 0, "joined": 0, "uploadedAt": None}
        entries = await roll_entries(db, [g]) or []
        return {"count": len(entries), "joined": len(match_roll(entries, await students(db, [g]))),
                "uploadedAt": ms(doc.get("uploaded_at"))}  # fmt: skip

    @router.put("/groups/{group_id}/roll-list")
    async def put_roll(group_id: str, body: RollIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        scope.require("manage")
        g = await scope.group(db, group_id)
        _need_insights(await _org(db, scope))
        entries = parse_roll_list(body.csv)
        await db[ROLL_LISTS].replace_one(
            {"_id": group_id},
            {
                "_id": group_id,
                "org_id": g["org_id"],
                "rows": entries,
                "uploaded_at": now(),
                "uploaded_by": scope.actor_id,
            },
            upsert=True,
        )
        await audit(db, scope.actor_id, "roll_list_upload", data=scope.audit_data(group=group_id, count=len(entries)),
                    ip=_ip(request))  # fmt: skip
        joined = len(match_roll([{**e, "group_id": group_id} for e in entries], await students(db, [g])))
        return {"count": len(entries), "joined": joined, "uploadedAt": ms(now())}

    @router.delete("/groups/{group_id}/roll-list", status_code=204)
    async def delete_roll(group_id: str, request: Request, db: DB, scope: ScopeDep) -> Response:
        scope.require("manage")
        await scope.group(db, group_id)
        await db[ROLL_LISTS].delete_one({"_id": group_id})
        await audit(db, scope.actor_id, "roll_list_delete", data=scope.audit_data(group=group_id), ip=_ip(request))
        return Response(status_code=204)
