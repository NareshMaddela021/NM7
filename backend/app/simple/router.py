"""The Easy dashboard (Phase 4, E1 + E2 + E7): one "Your next step" card, the language the simple screens use, and the
Simple / Full switch.

  GET /api/me/simple?hint=te          what the simple home shows: the language (None = ask first), the mode, the next
                                      step and a few counts. `hint` is the site language this browser picked before
                                      (only used to choose the default mode while the person hasn't chosen one)
  PUT /api/me/simple/prefs {lang?, mode?, autoRead?}
                                      saves the language (English / Telugu / Hindi), Simple or Full, and "read screens
                                      aloud automatically"; every change is in the activity log
  GET/PUT /api/org/{org_id}/simple    a college's "Simple by default for our students" (coordinators; students can
                                      still switch)

The next step is chosen by rules, in this order: no resume yet → make one; education, skills or projects missing → add
them; resume score under the Auto Apply gate (60) → fix it; Auto Apply not on → turn it on; questions waiting in
"Needs your answer" → answer them; else → see the top jobs.

Which dashboard a person gets while they haven't chosen: Full when the simple dashboard is off (Admin → Settings);
else Simple when their college made it the default; else Admin's default for Telugu / Hindi (Simple) or for English
(Full), by the language they picked.
"""

from typing import Any, Literal

from fastapi import APIRouter, Request

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.autoapply.settings import resume_for
from app.core.db import AUTO_ITEMS, DB, MEMBERSHIPS, ORGANIZATIONS, USERS
from app.core.schemas import CamelModel
from app.core.time import now
from app.orgs.ats import _list, all_skills, ats_score, printed
from app.orgs.scope import OrgScope
from app.site import get_site, lang_for, langs_on

router = APIRouter(prefix="/api/me/simple", tags=["easy dashboard"])
org = APIRouter(prefix="/api/org/{org_id}/simple", tags=["easy dashboard"])

Lang = Literal["en", "te", "hi"]
Mode = Literal["simple", "full"]
LANGS = ("en", "te", "hi")

# where each next step's big button goes (the resume steps open "build a resume by talking" at that question)
PATHS = {
    "resume": "/me/simple/resume",
    "education": "/me/simple/resume?step=studied",
    "skills": "/me/simple/resume?step=skills",
    "projects": "/me/simple/resume?step=projects",
    "fix_score": "/me/ats",
    "auto_apply": "/me/simple/auto",
    "answer": "/me/simple/answers",
    "jobs": "/me/simple/jobs",
}


def has_content(d: dict[str, Any]) -> bool:
    p = d.get("personal") if isinstance(d.get("personal"), dict) else {}
    return bool(p.get("name") or _list(d.get("edu")) or _list(d.get("exp")) or _list(d.get("proj")) or all_skills(d))


def missing(d: dict[str, Any]) -> list[str]:
    """Which of education, skills and projects the resume still needs (in that order)."""
    out = []
    if not any(e.get("institution") or e.get("degree") for e in _list(d.get("edu"))):
        out.append("education")
    if not all_skills(d):
        out.append("skills")
    if not any(x.get("title") for x in _list(d.get("proj"))) and not any(
        e.get("role") or e.get("company") for e in _list(d.get("exp"))
    ):
        out.append("projects")
    return out


def next_step(
    resume: dict[str, Any] | None, aa: dict[str, Any], needs: int, ats_min: int, aa_site_on: bool = True
) -> dict[str, Any]:
    """{key, path, ...}: the one thing to do next, by the rules in the module docstring."""
    d = printed((resume or {}).get("data") or {})
    if not resume or not has_content(d):
        return {"key": "resume", "path": PATHS["resume"]}
    gaps = missing(d)
    if gaps:
        return {"key": gaps[0], "path": PATHS[gaps[0]]}
    score = ats_score(resume.get("data") or {})["score"]
    if score < ats_min:
        return {"key": "fix_score", "path": PATHS["fix_score"], "score": score, "need": ats_min}
    if aa_site_on and not aa.get("admin_paused") and not aa.get("on"):
        return {"key": "auto_apply", "path": PATHS["auto_apply"]}
    if needs:
        return {"key": "answer", "path": PATHS["answer"], "count": needs}
    return {"key": "jobs", "path": PATHS["jobs"]}


async def college_simple(db, uid: str) -> bool:
    """Is the person a member of a college that made the simple dashboard the default?"""
    orgs = await db[MEMBERSHIPS].distinct("org_id", {"user_id": uid, "left_at": None})
    return bool(orgs) and bool(await db[ORGANIZATIONS].find_one({"_id": {"$in": orgs}, "simple_default": True}))


def mode_of(prefs: dict[str, Any], site: dict[str, Any], college: bool, hint: str | None = None) -> Mode:
    s = site["simple"]
    if not s["on"]:
        return "full"
    if prefs.get("mode") in ("simple", "full"):
        return prefs["mode"]
    if college:
        return "simple"
    lang = lang_for(site, prefs.get("lang") or hint)  # hidden Telugu / Hindi count as English
    return s["default_te_hi"] if lang in ("te", "hi") else s["default_other"]


@router.get("")
async def home(db: DB, auth: CustomerAuth, hint: str | None = None) -> dict[str, Any]:
    uid = auth.user.id
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid}, {"simple": 1, "auto_apply": 1, "name": 1}) or {}
    prefs = u.get("simple") or {}
    counts = {
        state: await db[AUTO_ITEMS].count_documents({"user_id": uid, "state": state})
        for state in ("needs_answer", "ready")
    }
    aa = u.get("auto_apply") or {}
    from app.simple.readiness import readiness  # (it reads this module's rules)

    ready = await readiness(db, uid, site)
    return {
        "on": bool(site["simple"]["on"]),
        # None: ask first; while Telugu and Hindi are hidden there is nothing to ask: English
        "lang": prefs.get("lang") and lang_for(site, prefs["lang"]) if langs_on(site) else "en",
        "langs": langs_on(site),
        "mode": mode_of(prefs, site, await college_simple(db, uid), hint if hint in LANGS else None),
        "modeChosen": prefs.get("mode") in ("simple", "full"),
        "autoRead": bool(prefs.get("auto_read")),
        "name": (u.get("name") or "").split(" ")[0],
        "next": next_step(
            await resume_for(db, uid),
            aa,
            counts["needs_answer"],
            int(site["auto_apply"]["ats_min"]),
            bool(site["auto_apply"]["on"]),
        ),
        "counts": {"needs": counts["needs_answer"], "ready": counts["ready"], "autoOn": bool(aa.get("on"))},
        "readiness": {"score": ready["score"], "left": ready["left"]},
    }


class PrefsIn(CamelModel):
    lang: Lang | None = None
    mode: Mode | None = None
    auto_read: bool | None = None


@router.put("/prefs")
async def prefs(body: PrefsIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    sets = {f"simple.{k}": v for k, v in body.model_dump().items() if v is not None}
    if sets:
        await db[USERS].update_one({"_id": auth.user.id}, {"$set": {**sets, "simple.updated_at": now()}})
        await audit(
            db,
            auth.user.id,
            "simple.prefs",
            data={k.split(".")[1]: v for k, v in sets.items()},
            ip=client_ip(request),
        )
    return await home(db, auth)


class CollegeIn(CamelModel):
    simple_default: bool


@org.get("")
async def college_get(db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id}, {"simple_default": 1}) or {}
    return {"simpleDefault": bool(o.get("simple_default"))}


@org.put("")
async def college_put(body: CollegeIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    scope.require("manage")
    await db[ORGANIZATIONS].update_one({"_id": scope.org_id}, {"$set": {"simple_default": body.simple_default}})
    await audit(
        db,
        scope.actor_id,
        "org_simple_default",
        target=scope.org_id,
        data=scope.audit_data(on=body.simple_default),
        ip=client_ip(request),
    )
    return {"simpleDefault": body.simple_default}
