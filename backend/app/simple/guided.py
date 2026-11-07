"""Build a resume by talking (Phase 4, E4): one question per screen, answered by voice or tap, each answer saved at
once into the person's normal resume (the same resume the full builder opens; a new one is made when they have none).

  GET  /api/me/simple/resume              the steps, where they stopped, their answers, chips (skills, degrees,
                                          languages) and the certificate wallet's names
  PUT  /api/me/simple/resume/{step}       {value} or {skip: true}: saves the answer and writes it into the resume
  POST /api/me/simple/resume/write        {kind: projects | work, answers}: "This is what we wrote", English resume
                                          lines from the answers only
  POST /api/me/simple/resume/accept       {kind, answers, lines}: adds the project / internship to the resume
  POST /api/me/simple/resume/done         keeps a version "Made by talking" in the resume's versions

Steps: about (name, phone; the email is the account's), studied, college, year, marks (optional), skills, projects,
work (internships / jobs), certs, langs. Never asked: Aadhaar or other ID numbers, caste, religion, gender, a photo
(the photo stays optional, in the full builder, under its usual rules). ID-like numbers are removed from anything
saved.

"This is what we wrote": the project helper's writer (AI while the person's free uses last, else the rules), with a
stricter fact check: besides numbers, tools and claims, when the answers are in English letters every word of a line
must be in the answers (or be a small set of joining words and plain verbs like "built"); a line that adds anything
is dropped, and the rules' lines (the answers' own words) are used instead.
"""

import re
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.auth.sessions import client_ip
from app.autoapply.settings import resume_for
from app.core.db import CERTIFICATES, DB, RESUMES, USERS
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers
from app.core.schemas import CamelModel
from app.core.time import now
from app.jobsearch import skills as dictionary
from app.me.schemas import MAX_VERSIONS
from app.orgs.ats import _list
from app.projects import helper
from app.projects.router import _scrub, write_bullets

router = APIRouter(prefix="/api/me/simple/resume", tags=["easy dashboard"])

STEPS = ("about", "studied", "college", "year", "marks", "skills", "projects", "work", "certs", "langs")
DEGREES = (
    "10th",
    "Intermediate",
    "Diploma",
    "ITI",
    "B.Tech",
    "B.Sc",
    "B.Com",
    "BA",
    "BCA",
    "BBA",
    "MBA",
    "MCA",
    "M.Tech",
)
LANGS = ("English", "Telugu", "Hindi", "Tamil", "Kannada", "Urdu", "Marathi", "Odia")
SKILL_CHIPS = (
    "MS Excel",
    "MS Word",
    "Communication",
    "Teamwork",
    "Customer Service",
    "Python",
    "Java",
    "C",
    "SQL",
    "HTML",
    "CSS",
    "JavaScript",
    "Tally",
    "AutoCAD",
    "Data Entry",
    "Sales",
    "Problem Solving",
    "Typing",
)
PHONE = re.compile(r"^[+\d][\d\s-]{6,18}$")
# joining words and plain verbs a resume line may use without them being in the answers
JOINING = set(
    """a an the and or of for to in on at by with using from into as its it this that these those their was were is
    are be been also both each per via over under all any some can could would will so such than then which who
    built build developed develop created create designed design made make worked work handled handle used use wrote
    write tested test prepared prepare helped help did do done project projects team internship intern job role part
    tools tool app application website system page pages based simple small""".split()
)


def _clean(v: Any, n: int) -> str:
    return " ".join(scrub_id_numbers(str(v or ""))[0].split())[:n]


def _words(v: Any, n: int, size: int) -> list[str]:
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        x = _clean(x, size)
        if x and x.lower() not in (o.lower() for o in out):
            out.append(x)
    return out[:n]


def latin(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isascii() for c in letters) / len(letters) >= 0.6


def _stem(w: str) -> str:
    return w.lower()[:5]


def supported(line: str, answers: dict[str, str], title: str = "") -> bool:
    """Every word of the line is in the answers (or is a joining word / plain verb), when the answers are written in
    English letters. Numbers, tools and claims are checked by helper.grounded as well."""
    src = " ".join([title, *answers.values()])
    if not latin(src):
        return True  # translated from Telugu / Hindi: numbers, tools and claims are still checked (helper.grounded)
    have = {_stem(w) for w in re.findall(r"[A-Za-z][A-Za-z+#]*", src)}
    have |= {_stem(w) for s in dictionary.find(src) for w in re.findall(r"[A-Za-z][A-Za-z+#]*", s)}
    for w in re.findall(r"[A-Za-z][A-Za-z+#]*", line):
        lw = w.lower()
        if len(lw) <= 2 or lw in JOINING or _stem(lw) in have:
            continue
        return False
    return True


def blank_resume() -> dict[str, Any]:
    return {
        "personal": {},
        "summary": "",
        "exp": [],
        "edu": [],
        "proj": [],
        "skillGroups": [],
        "certs": [],
        "langs": [],
    }


async def _resume(db, uid: str) -> dict[str, Any]:
    """The resume to write into: the one Auto Apply and the builder use, else a new one."""
    r = await resume_for(db, uid)
    if r:
        return r
    t = now()
    count = await db[RESUMES].count_documents({"user_id": uid})
    doc = {
        "key": f"r{new_id()[:8]}",
        "user_id": uid,
        "name": "My resume",
        "data": blank_resume(),
        "jd": "",
        "active": count == 0,
        "versions": [],
        "created_at": t,
        "updated_at": t,
    }
    await db[RESUMES].insert_one(doc)
    return doc


async def _save(db, r: dict[str, Any], data: dict[str, Any]) -> None:
    data, _ = scrub_id_numbers(data)
    await db[RESUMES].update_one({"_id": r["_id"]}, {"$set": {"data": data, "updated_at": now()}})


def _edu(d: dict[str, Any]) -> dict[str, Any]:
    edu = _list(d.get("edu"))
    if not edu:
        edu = [{"institution": "", "degree": "", "field": "", "from": "", "to": "", "grade": ""}]
    d["edu"] = edu
    return edu[0]


def apply(step: str, v: dict[str, Any], d: dict[str, Any], email: str = "") -> dict[str, Any]:
    """Writes one answer into the resume data (keeping everything else the person wrote)."""
    d = {**blank_resume(), **d}
    if step == "about":
        p = dict(d.get("personal") or {})
        if v.get("name"):
            p["name"] = v["name"]
        if v.get("phone"):
            p["phone"] = v["phone"]
        if email and not p.get("email"):
            p["email"] = email
        d["personal"] = p
    elif step == "studied":
        e = _edu(d)
        e["degree"], e["field"] = v.get("degree", e.get("degree", "")), v.get("field", e.get("field", ""))
    elif step == "college":
        _edu(d)["institution"] = v.get("name", "")
    elif step == "year":
        _edu(d)["to"] = str(v.get("year", ""))
    elif step == "marks":
        _edu(d)["grade"] = v.get("grade", "")
    elif step == "skills":
        groups = [dict(g) for g in _list(d.get("skillGroups"))] or [{"id": "core", "label": "Skills", "value": ""}]
        g = next((x for x in groups if x.get("id") == "core"), groups[0])
        now_ = [s.strip() for s in str(g.get("value") or "").split(",") if s.strip()]
        for s in v.get("skills", []):
            if s.lower() not in (x.lower() for x in now_):
                now_.append(s)
        g["value"] = ", ".join(now_)
        d["skillGroups"] = groups
    elif step == "certs":
        certs = _list(d.get("certs"))
        have = {str(c.get("name", "")).lower() for c in certs}
        d["certs"] = certs + [
            {"name": n, "issuer": "", "issueDate": ""} for n in v.get("names", []) if n.lower() not in have
        ]
    elif step == "langs":
        langs = _list(d.get("langs"))
        have = {str(x.get("name", "")).lower() for x in langs}
        d["langs"] = langs + [{"name": n, "level": ""} for n in v.get("names", []) if n.lower() not in have]
    return d


def check_value(step: str, raw: Any) -> dict[str, Any]:
    v = raw if isinstance(raw, dict) else {}
    if step == "about":
        out = {"name": _clean(v.get("name"), 80), "phone": _clean(v.get("phone"), 20)}
        if not out["name"]:
            raise ApiError(400, "need_name", "Please tell us your name.")
        if out["phone"] and not PHONE.match(out["phone"]):
            raise ApiError(400, "phone", "Please give a phone number with digits only.")
        return out
    if step == "studied":
        return {"degree": _clean(v.get("degree"), 60), "field": _clean(v.get("field"), 80)}
    if step == "college":
        return {"name": _clean(v.get("name"), 120)}
    if step == "year":
        y = str(v.get("year", "")).strip()
        if not re.fullmatch(r"(19[89]\d|20[0-3]\d)", y):
            raise ApiError(400, "year", "Please give the year, like 2025.")
        return {"year": int(y)}
    if step == "marks":
        return {"grade": _clean(v.get("grade"), 20)}
    if step == "skills":
        return {"skills": _words(v.get("skills"), 30, 40)}
    if step in ("certs", "langs"):
        return {"names": _words(v.get("names"), 10 if step == "certs" else 8, 120 if step == "certs" else 30)}
    return {}


class AnswerIn(CamelModel):
    value: dict[str, Any] = Field(default_factory=dict)
    skip: bool = False


class WriteIn(CamelModel):
    kind: Literal["projects", "work"]
    answers: dict[str, str] = Field(default_factory=dict)


class AcceptIn(WriteIn):
    lines: list[str] = Field(default_factory=list, max_length=6)


def _answers(kind: str, a: dict[str, Any]) -> tuple[dict[str, str], str]:
    """The project helper's answers and a title: what was made / done, the tools, what it does or the person's part."""
    keys = ("built", "tools", "does") if kind == "projects" else ("company", "role", "built", "tools")
    raw = {k: _scrub(str(a.get(k) or ""))[:300] for k in keys}
    title = " ".join(raw.get("built", "").split()[:8]) if kind == "projects" else raw.get("role", "")
    return helper.clean({k: v for k, v in raw.items() if k in helper.KEYS}), title


async def _state(db, uid: str) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": uid}, {"simple.guided": 1, "name": 1, "email": 1}) or {}
    g = ((u.get("simple") or {}).get("guided")) or {}
    wallet = [c.get("name") or c.get("title") or "" async for c in db[CERTIFICATES].find({"user_id": uid})]
    return {
        "steps": list(STEPS),
        "step": min(int(g.get("step", 0)), len(STEPS)),
        "answers": g.get("answers") or {},
        "account": {"name": u.get("name") or "", "email": u.get("email") or ""},
        "wallet": [w for w in wallet if w][:10],
        "chips": {"skills": list(SKILL_CHIPS), "degrees": list(DEGREES), "langs": list(LANGS)},
    }


@router.get("")
async def guided(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _state(db, auth.user.id)


@router.put("/{step}")
async def answer(step: str, body: AnswerIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    if step not in STEPS:
        raise ApiError(404, "not_found", "That question doesn’t exist.")
    uid = auth.user.id
    i = STEPS.index(step)
    sets: dict[str, Any] = {"simple.guided.step": i + 1, "simple.guided.updated_at": now()}
    if not body.skip and step not in ("projects", "work"):
        v = check_value(step, body.value)
        r = await _resume(db, uid)
        u = await db[USERS].find_one({"_id": uid}, {"email": 1}) or {}
        await _save(db, r, apply(step, v, r.get("data") or {}, u.get("email") or ""))
        sets[f"simple.guided.answers.{step}"] = v
    elif body.skip:
        sets[f"simple.guided.skipped.{step}"] = True
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    await audit(db, uid, "simple.resume_answer", data={"step": step, "skip": body.skip}, ip=client_ip(request))
    return await _state(db, uid)


@router.post("/write")
async def write(body: WriteIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    answers, title = _answers(body.kind, body.answers)
    if not answers.get("built") and not title:
        raise ApiError(400, "need_answers", "Tell us what you made or did first.")
    out = await write_bullets(
        db, str(auth.user.id), auth.session.kiosk_id, answers, title, check=lambda b: supported(b, answers, title)
    )
    return {"lines": out["bullets"], "source": out["source"], "note": out["note"]}


@router.post("/accept")
async def accept(body: AcceptIn, request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    lines = [_clean(x, 300) for x in body.lines if _clean(x, 300)]
    if not lines:
        raise ApiError(400, "need_lines", "There is nothing to add yet.")
    raw = {k: _scrub(str(v or ""))[:300] for k, v in body.answers.items()}
    r = await _resume(db, uid)
    d = {**blank_resume(), **(r.get("data") or {})}
    if body.kind == "projects":
        title = " ".join(raw.get("built", "").split()[:8]) or "Project"
        d["proj"] = [
            *_list(d.get("proj")),
            {"title": title, "tagline": "", "description": "\n".join(lines), "tech": raw.get("tools", "")},
        ]
    else:
        d["exp"] = [
            *_list(d.get("exp")),
            {
                "company": raw.get("company", ""),
                "role": raw.get("role", ""),
                "employmentType": "Internship",
                "from": "",
                "to": "",
                "current": False,
                "description": "\n".join(lines),
            },
        ]
    await _save(db, r, d)
    await db[USERS].update_one(
        {"_id": uid},
        {
            "$push": {f"simple.guided.answers.{body.kind}": {**raw, "lines": lines}},
            "$set": {"simple.guided.updated_at": now()},
        },
    )
    await audit(db, uid, "simple.resume_accept", data={"kind": body.kind, "lines": len(lines)}, ip=client_ip(request))
    return await _state(db, uid)


@router.post("/done")
async def done(request: Request, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    r = await _resume(db, uid)
    versions = [
        *(r.get("versions") or []),
        {"at": int(now().timestamp() * 1000), "label": "Made by talking", "data": r.get("data") or {}},
    ][-MAX_VERSIONS:]
    await db[RESUMES].update_one({"_id": r["_id"]}, {"$set": {"versions": versions}})
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"simple.guided.step": len(STEPS), "simple.guided.done_at": now()}}
    )
    await audit(db, uid, "simple.resume_done", target=r["key"], ip=client_ip(request))
    return {"path": "/me/simple", "resumeId": r["key"]}
