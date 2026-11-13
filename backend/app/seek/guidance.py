# ruff: noqa: E501  (guidance sentences on one line each)
"""Phase 6 S9: guidance. Government-exam backup (private roles that use the same subjects, with live jobs), and honest
resume wording for a gap year or backlogs: suggestions built only from what the person tells us, and a checker that
flags wording that hides a gap or shows dates the person didn't give.

  GET  /api/public/guidance/exams                      exam types → private roles that use the same subjects (+ live jobs)
  POST /api/me/guidance/wording {kind, from, to, reason, did, backlogs, cleared, clearedOn}   honest suggestions
  POST /api/me/guidance/check {text, kind, from, to, backlogs, cleared}                      is my own line honest?
"""

import re
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.core.db import DB, JOBS
from app.core.schemas import CamelModel
from app.jobs.public import live_filter
from app.seek.catalogue import ROLES

public = APIRouter(prefix="/api/public/guidance", tags=["job seekers"])
me = APIRouter(prefix="/api/me/guidance", tags=["job seekers"])

EXAMS = [
    {"id": "ssc", "name": "SSC (CGL, CHSL, MTS)", "subjects": "Maths and reasoning, English, general awareness, typing",
     "roles": ["data-entry", "office-assistant", "accounts-assistant", "data-analyst"],
     "why": "The same numbers, reasoning, English and typing are what office, accounts and data jobs test."},
    {"id": "banking", "name": "Banking (IBPS / SBI PO and Clerk)", "subjects": "Quantitative aptitude, reasoning, English, banking awareness",
     "roles": ["accounts-assistant", "customer-support", "sales-executive", "data-analyst"],
     "why": "Aptitude, English and customer handling carry straight into accounts, customer support and banking sales."},
    {"id": "railways", "name": "Railways (RRB NTPC, Group D, ALP / Technician)", "subjects": "Maths, reasoning, general science; trade skills for ALP",
     "roles": ["electrician", "fitter", "warehouse-associate", "office-assistant"],
     "why": "ITI trades and technical basics are wanted by factories, maintenance teams and warehouses."},
    {"id": "state_psc", "name": "State PSC (Group 2, Group 4)", "subjects": "General studies, aptitude, the state language, English",
     "roles": ["office-assistant", "hr-recruiter", "data-entry", "customer-support"],
     "why": "Writing, the state language and aptitude suit HR, office and local customer-facing jobs."},
]  # fmt: skip
BY_ID = {r["id"]: r for r in ROLES}


async def live_count(db, role: dict[str, Any]) -> int:
    rx = "|".join(re.escape(w) for w in role["words"])
    return await db[JOBS].count_documents(
        {"$and": [live_filter(), {"demo": {"$ne": True}}, {"title": {"$regex": rx, "$options": "i"}}]}
    )


@public.get("/exams")
async def exams(db: DB) -> list[dict[str, Any]]:
    out = []
    for e in EXAMS:
        roles = [{"id": r, "title": BY_ID[r]["title"], "liveJobs": await live_count(db, BY_ID[r])} for r in e["roles"]]
        out.append({k: e[k] for k in ("id", "name", "subjects", "why")} | {"roles": roles})
    return out


# --- honest wording -----------------------------------------------------------------------------------------------

MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec"
DATE = re.compile(rf"\b(?:(?:{MONTHS})[a-z]*\.?\s+)?((?:19|20)\d{{2}})\b", re.I)
HIDES = re.compile(
    r"\b(no gap|without (?:a )?(?:gap|break)|continuous(?:ly)?|uninterrupted|straight after|immediately after)\b", re.I
)
NO_BACKLOG = re.compile(
    r"\b(no backlogs?|without (?:any )?backlogs?|first attempt|all subjects in one go|never failed|clean record)\b",
    re.I,
)


def ym(s: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"(\d{4})-(\d{2})", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def label(s: str) -> str:
    y, m = ym(s) or (0, 0)
    return (
        f"{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} {y}"
        if y
        else ""
    )


class Facts(CamelModel):
    kind: Literal["gap", "backlog"]
    from_: str = Field("", alias="from", pattern=r"^(\d{4}-\d{2})?$")
    to: str = Field("", pattern=r"^(\d{4}-\d{2})?$")
    reason: Literal["", "exam_prep", "health", "family", "caregiving", "work", "learning", "other"] = ""
    did: str = Field("", max_length=300)  # what they did in the gap, in their words
    backlogs: int = Field(0, ge=0, le=60)
    cleared: bool = False
    cleared_on: str = Field("", pattern=r"^(\d{4}-\d{2})?$")


def problems(text: str, f: Facts) -> list[str]:
    """Why a line isn't honest for these facts (empty: fine): it hides a gap or a backlog, or shows years the
    person didn't give."""
    out = []
    if f.kind == "gap" and HIDES.search(text):
        out.append("It suggests there was no gap. Say the gap plainly; a short honest line is better.")
    if f.kind == "backlog" and f.backlogs and NO_BACKLOG.search(text):
        out.append("It suggests there were no backlogs. You don't have to mention them, but don't say there were none.")
    given = {str((ym(x) or (0,))[0]) for x in (f.from_, f.to, f.cleared_on) if ym(x)}
    for m in DATE.finditer(text):
        if m.group(1) not in given:
            out.append(f"It shows {m.group(1)}, a year you didn't give. Use only your real dates.")
    if f.kind == "backlog" and f.backlogs and not f.cleared and re.search(r"\bcleared\b", text, re.I):
        out.append("It says the backlogs are cleared; you said they aren't yet.")
    return list(dict.fromkeys(out))


REASON = {"exam_prep": "preparing for competitive exams", "health": "a health matter, now resolved", "family": "family responsibilities",
          "caregiving": "caring for a family member", "work": "working", "learning": "learning new skills", "other": "personal reasons"}  # fmt: skip


def suggestions(f: Facts) -> list[str]:
    span = " – ".join(x for x in (label(f.from_), label(f.to)) if x)
    did = f.did.strip().rstrip(".")
    out: list[str] = []
    if f.kind == "gap":
        why = REASON.get(f.reason, "")
        out.append(
            f"Career break{f' ({span})' if span else ''}: {why or 'a planned break'}.{f' During this time I {did}.' if did else ''}"
        )
        if did:
            out.append(f"{span + ': ' if span else ''}{did[0].upper() + did[1:]}{f' while {why}' if why else ''}.")
        out.append(
            "In an interview: say what the break was for in one line, then what you learned or did, then why you are ready now."
        )
    else:
        if f.cleared:
            when = label(f.cleared_on)
            out.append(f"Completed the degree{f' in {when}' if when else ''}; all subjects cleared.")
        elif f.backlogs:
            out.append(
                f"Final-year student with {f.backlogs} subject{'s' if f.backlogs != 1 else ''} to clear; working to finish them{f' by {label(f.cleared_on)}' if f.cleared_on else ''}."
            )
        out.append(
            "On a resume you can give your current CGPA or percentage without listing backlogs. If a form asks about backlogs, answer truthfully."
        )
    return [s for s in out if not problems(s, f)]  # every suggestion passes the same check


@me.post("/wording")
async def wording(body: Facts, auth: CustomerAuth) -> dict[str, Any]:
    return {
        "suggestions": suggestions(body),
        "note": "Only from what you told us: we never hide a gap or change your dates.",
    }


class CheckIn(Facts):
    text: str = Field(min_length=3, max_length=600)


@me.post("/check")
async def check(body: CheckIn, auth: CustomerAuth) -> dict[str, Any]:
    found = problems(body.text, body)
    return {"honest": not found, "problems": found}
