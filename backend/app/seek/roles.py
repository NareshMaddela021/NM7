# ruff: noqa: E501  (rule tables and result rows: one per line, easier to read)
"""Phase 6 S1: the role finder. Ten simple questions → three roles that fit, with plain reasons, what to learn, the
typical starting salary (S4, only with enough data), live jobs for each and a learning path (S2).

  GET  /api/me/roles               the questions, my saved answers and my three roles (live jobs looked up again)
  POST /api/me/roles {answers}     work out the three roles and save them (retake any time)

Rules decide (catalogue.py): the qualification must reach the role's usual minimum (ITI and 12th count as side by
side), then points for the work style, the subjects and tasks they like, their strengths, the languages, the branch
they studied; a role that needs a laptop to learn or more hours a week than they have is pushed down and says why.
AI only rephrases the "why" into one friendly sentence (core/ai_quota "roles", 5 a day); the sentence is checked
(no numbers, no promises, no other role, short) and the rules' own words are used when it isn't fine or there is no AI.

The result is saved on the account (role_finder) and feeds the rest: the job profile's target role (when empty) and
the role suggestions on Auto Apply.
"""

import logging
import re
from typing import Any

from fastapi import APIRouter
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.core import ai_quota, claude
from app.core.config import get_settings
from app.core.db import DB, JOBS, RESUMES, USERS
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobs.fit import EDU_RANK
from app.jobs.public import live_filter
from app.jobsearch import skills as dictionary
from app.me.service import ms
from app.seek.catalogue import EDU_LEVELS, LANGUAGES, LIKES, ROLES, STYLES

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/me/roles", tags=["job seekers"])

STRENGTHS = {  # strength → the work style it points to
    "talking to people": "people", "patience": "people", "numbers": "numbers", "careful with details": "numbers",
    "fixing things": "machines", "using my hands": "machines", "computers": "computers", "learning fast": "computers",
    "staying active": "outdoors", "finding my way around": "outdoors",
}  # fmt: skip
BRANCH = [  # words in what they studied → roles that suit it
    (r"\b(com|commerce|account|finance|ca\b|cma)", {"accounts-assistant": 12, "office-assistant": 6}),
    (r"\b(cse|computer|it\b|bca|mca|software|b\.?sc.*comp)", {"python-developer": 10, "web-developer": 10, "data-analyst": 8, "qa-tester": 8, "it-support": 6}),
    (r"\b(stat|math)", {"data-analyst": 10, "accounts-assistant": 4}),
    (r"\b(eee|electrical|electrician)", {"electrician": 15}),
    (r"\b(mech|fitter|turner|machinist)", {"fitter": 12, "cnc-operator": 12}),
    (r"\b(ece|electronics)", {"service-technician": 8, "it-support": 8}),
    (r"\b(nurs|gnm|anm)", {"staff-nurse": 20}),
    (r"\b(mba|bba|hr\b|human resource)", {"hr-recruiter": 12, "sales-executive": 6}),
]  # fmt: skip


class AnswersIn(CamelModel):
    studies: str = Field(pattern="^(10th|12th|iti|diploma|graduate|postgraduate)$")  # the highest finished or nearly
    branch: str = Field("", max_length=80)
    likes: list[str] = Field(default_factory=list, max_length=5)
    strengths: list[str] = Field(default_factory=list, max_length=3)
    style: str = Field(pattern="^(people|numbers|machines|computers|outdoors)$")
    second_style: str = Field("", pattern="^(|people|numbers|machines|computers|outdoors)$")
    city: str = Field("", max_length=60)
    salary_need: int = Field(0, ge=0, le=500_000)  # ₹ a month they need to start (0: no need given)
    languages: list[str] = Field(default_factory=list, max_length=3)
    laptop: bool = False
    hours_week: int = Field(5, ge=1, le=60)

    @field_validator("likes")
    @classmethod
    def _likes(cls, v):
        return [x for x in dict.fromkeys(v) if x in LIKES]

    @field_validator("strengths")
    @classmethod
    def _strengths(cls, v):
        return [x for x in dict.fromkeys(v) if x in STRENGTHS]

    @field_validator("languages")
    @classmethod
    def _langs(cls, v):
        return [x for x in dict.fromkeys(v) if x in LANGUAGES]


def eligible(studies: str, need: str) -> bool:
    have, want = EDU_RANK.get(studies, 0), EDU_RANK.get(need, 0)
    return have >= want or {have, want} == {2, 3}  # ITI and 12th side by side


def score(a: dict[str, Any], role: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    """(points, reasons for, things to know)."""
    pts, why, note = 0, [], []
    if a["style"] in role["styles"]:
        pts += 40
        why.append(f"You like working with {a['style']}")
    if a.get("second_style") and a["second_style"] in role["styles"]:
        pts += 15
        why.append(f"it also uses {a['second_style']}")
    liked = [x for x in a.get("likes") or [] if x in role["likes"]]
    if liked:
        pts += min(24, 8 * len(liked))
        why.append(f"you enjoy {', '.join(liked)}")
    strong = [s for s in a.get("strengths") or [] if STRENGTHS[s] in role["styles"]]
    if strong:
        pts += min(15, 5 * len(strong))
        why.append(f"your strengths ({', '.join(strong)}) help here")
    langs = set(a.get("languages") or [])
    if langs & set(role["langs"]):
        pts += 5
    elif langs:
        pts -= 15
        note.append(f"Most of these jobs use {' or '.join(role['langs'])}")
    branch = (a.get("branch") or "").lower()
    for pat, boosts in BRANCH:
        if role["id"] in boosts and re.search(pat, branch):
            pts += boosts[role["id"]]
            why.append("it fits what you studied")
            break
    if role["laptop"] and not a.get("laptop"):
        pts -= 25
        note.append("Learning it needs a laptop or computer (a cyber café or college lab works)")
    if a.get("hours_week", 5) < role["hours"]:
        pts -= 10
        note.append(f"Plan about {role['hours']} hours a week to learn it")
    return pts, why, note


def pick(a: dict[str, Any], n: int = 3) -> list[dict[str, Any]]:
    rows = []
    for r in ROLES:
        if not eligible(a["studies"], r["edu"]):
            continue
        pts, why, note = score(a, r)
        rows.append({"role": r, "points": pts, "why": why, "note": note})
    rows.sort(key=lambda x: (-x["points"], x["role"]["id"]))
    return rows[:n]


def rule_why(row: dict[str, Any]) -> str:
    parts = row["why"] or ["It is open to people with your studies"]
    text = "; ".join(parts)
    return text[0].upper() + text[1:] + "."


# --- AI: one friendlier sentence per role, checked ----------------------------------------------------------------

SCHEMA = {"type": "object", "properties": {"why": {"type": "array", "items": {"type": "string"}}}, "required": ["why"]}
PROMISE = re.compile(r"\b(guarantee|assured|sure to|definitely|100%|will get|placement)\b", re.I)


def check_why(titles: list[str]):
    others = [r["title"].lower() for r in ROLES]

    def check(raw: Any) -> list[str]:
        lines = raw.get("why") if isinstance(raw, dict) else None
        if not isinstance(lines, list) or len(lines) != len(titles):
            raise claude.Unusable("count")
        out = []
        for line, title in zip(lines, titles, strict=True):
            s = " ".join(str(line).split())
            low = s.lower()
            if not s or len(s) > 220 or re.search(r"\d", s) or PROMISE.search(s):
                raise claude.Unusable("unsafe")
            if any(o in low for o in others if o != title.lower()):
                raise claude.Unusable("other_role")
            out.append(s)
        return out

    return check


async def ai_why(db, uid: str, rows: list[dict[str, Any]]) -> list[str] | None:
    if not get_settings().anthropic_api_key:
        return None
    try:
        await ai_quota.take(db, "roles", uid)
    except Exception:
        return None
    titles = [r["role"]["title"] for r in rows]
    facts = "\n".join(f"{i + 1}. {r['role']['title']}: {rule_why(r)}" for i, r in enumerate(rows))
    text = ("Rewrite each reason as one short, warm sentence for an Indian student, in simple English. Use only the "
            "facts given. No numbers, no salary, no promises of a job, no other job titles. Same order.\n" + facts)  # fmt: skip
    try:
        return await claude.ask_models("role finder", [{"type": "text", "text": text}], SCHEMA, check_why(titles),
                                       max_tokens=600, effort="low", timeout_s=20, retries=1)  # fmt: skip
    except Exception as e:  # unusable, API down: the rules' words
        log.info("role finder why: %s", type(e).__name__)
        await ai_quota.note(db, "roles", "fallback")
        return None


# --- what to learn and live jobs ----------------------------------------------------------------------------------


async def have_skills(db, uid: str) -> set[str]:
    r = await db[RESUMES].find_one({"user_id": uid, "active": True}, {"data": 1}) or await db[RESUMES].find_one(
        {"user_id": uid}, {"data": 1}, sort=[("updated_at", -1)]
    )
    return set(dictionary.find(str((r or {}).get("data") or "")))


async def live_jobs(db, role: dict[str, Any], city: str, n: int = 3) -> list[dict[str, Any]]:
    words = "|".join(re.escape(w) for w in role["words"])
    q: dict[str, Any] = {
        "$and": [live_filter(), {"demo": {"$ne": True}}, {"title": {"$regex": words, "$options": "i"}}]
    }
    if city:
        q["$and"].append(
            {"$or": [{"remote": True}, {"locations": {"$regex": f"^{re.escape(city)}$", "$options": "i"}}]}
        )
    rows = await db[JOBS].find(q, {"title": 1, "company": 1, "slug": 1, "locations": 1, "remote": 1}).sort(
        "posted_at", -1).limit(n).to_list(n)  # fmt: skip
    return [{"id": j["_id"], "title": j["title"], "company": (j.get("company") or {}).get("name", ""), "slug": j["slug"],
             "where": "Remote" if j.get("remote") else ", ".join(j.get("locations") or [])} for j in rows]  # fmt: skip


async def results(db, uid: str, a: dict[str, Any], rows: list[dict[str, Any]], why: list[str] | None) -> list[dict]:
    from app.seek.salary import starting_range  # S4: only with enough real jobs

    have = await have_skills(db, uid)
    out = []
    for i, row in enumerate(rows):
        r = row["role"]
        pay = await starting_range(db, r, a.get("city") or "")
        notes = list(row["note"])
        if pay and a.get("salary_need") and a["salary_need"] > pay["max"]:  # honest: from real jobs only
            notes.append(
                "Most starting jobs in this role pay less than you need at first; pay usually grows with experience."
            )
        out.append({
            "id": r["id"], "title": r["title"], "domain": r["domain"], "why": (why or [None] * len(rows))[i] or rule_why(row),
            "notes": notes, "learn": [s for s in r["skills"] if s not in have], "have": [s for s in r["skills"] if s in have],
            "salary": pay, "jobs": await live_jobs(db, r, a.get("city") or ""),
            "test": r["test"],
        })  # fmt: skip
    return out


# --- endpoints ----------------------------------------------------------------------------------------------------


def questions() -> dict[str, Any]:
    return {"studies": list(EDU_LEVELS), "likes": list(LIKES), "strengths": list(STRENGTHS), "styles": list(STYLES),
            "languages": list(LANGUAGES)}  # fmt: skip


@router.get("")
async def mine(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": auth.user.id}, {"role_finder": 1})
    saved = (u or {}).get("role_finder") or {}
    out: dict[str, Any] = {"questions": questions(), "answers": saved.get("answers"), "at": ms(saved.get("at")),
                           "roles": []}  # fmt: skip
    if saved.get("answers"):
        rows = pick(saved["answers"])
        why = saved.get("why") if [r["role"]["id"] for r in rows] == saved.get("picks") else None
        out["roles"] = await results(db, auth.user.id, saved["answers"], rows, why)
    return out


@router.post("")
async def find(body: AnswersIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    a = body.model_dump()
    rows = pick(a)
    why = await ai_why(db, uid, rows) if rows else None
    t = now()
    picks = [r["role"]["id"] for r in rows]
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"role_finder": {"answers": a, "picks": picks, "why": why, "at": t}}}
    )
    if rows:  # the job profile's target role, when they haven't set one
        await db[USERS].update_one(
            {"_id": uid, "target_role": {"$in": ["", None]}}, {"$set": {"target_role": rows[0]["role"]["title"]}}
        )
    return {"questions": questions(), "answers": a, "at": ms(t), "roles": await results(db, uid, a, rows, why)}


async def suggested_roles(db, uid: str) -> list[str]:
    """For Auto Apply: the role finder's titles (empty when it hasn't been done)."""
    u = await db[USERS].find_one({"_id": uid}, {"role_finder.picks": 1}) or {}
    by = {r["id"]: r["title"] for r in ROLES}
    return [by[p] for p in ((u.get("role_finder") or {}).get("picks") or []) if p in by]
