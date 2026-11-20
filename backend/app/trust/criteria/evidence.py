# ruff: noqa: E501  (dense lines)
"""Vetting Trust T7: what one candidate can show, as quotable lines per source, with personal details removed.

Sources (each line is something the person or Nm7 wrote, so a quote can be checked word for word):
  resume       the resume they applied with (else their active one): headline, summary, each job ("Role at Company
               (2021-06 – present)" and its lines), projects, skills, certificates they listed, languages, education
               (degree, field and year only, never the college)
  skill_check  shared skill check results ("Excel: skill check score 82/100 on 12 Nov 2026") and Skill verified badges
               (test + practical task: "Excel: Skill verified · 3–5 years · test 82/100 · practical task 80/100 on …")
  interview    the candidate's own answers in their latest graded AI screening interview (V3)
  documents    DigiLocker documents that are verified now (T2): "Driving licence (MCWG, LMV) · verified via DigiLocker",
               "B.Com · passed · 2019 · verified via DigiLocker" (never the university or board)
  prefs        Work preferences (T6, self-declared): "Night shifts: yes", "Languages: Telugu, English", …
  certificate  certificates the candidate added as evidence for a criterion and Nm7 checked (router.py, claims)

Anonymised before anything is used or sent to the AI (best effort, `anonymiser`): the person's name (and each part of
it), email, phone, addresses / their location, the colleges in their education, dates of birth and ages, gender,
religion, caste, marital status and pregnancy words, links (a profile link can carry a name) and photos (never read)
become "[removed]". Quotes are checked against these anonymised lines, so a quote can never carry them either.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.config import get_settings
from app.core.db import (
    CERTIFICATES,
    RESUMES,
    SKILL_ATTEMPTS,
    TRUST_CRITERIA_CLAIMS,
    TRUST_DOCUMENTS,
    TRUST_WORK_PREFS,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_VERIFIED,
)
from app.core.time import IST, now
from app.jobsearch.score import Resume
from app.trust.fairness import blind as B

SOURCES = ("resume", "skill_check", "interview", "documents", "prefs", "certificate")
LABEL = {"resume": "Resume", "skill_check": "Skill check", "interview": "AI interview", "documents": "DigiLocker",
         "prefs": "Work preferences (self-declared)", "certificate": "Certificate checked by Nm7"}  # fmt: skip
GONE = B.GONE
MAX_LINES = 80  # per source
MAX_LINE = B.MAX_LINE
# T12: the anonymiser lives in app/trust/fairness/blind.py (one for every AI grading call); these names stay for callers
EMAIL, URL, DOB, AGE, TITLES, COLLEGE, PERSONAL = B.EMAIL, B.URL, B.DOB, B.AGE, B.TITLES, B.COLLEGE, B.PERSONAL
anonymiser = B.anonymiser


def norm(text: str) -> str:
    s = str(text or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-")
    return " ".join(s.split())


def quote_in(quote: str, text: str) -> bool:
    """Is the quote word for word in the source (spaces and curly quotes / dashes aside)? At least 3 characters."""
    q = norm(quote).strip(" \"'")
    return len(q) >= 3 and q in norm(text)


def day(t: datetime | None) -> str:
    if not t:
        return ""
    return t.astimezone(IST).strftime("%-d %b %Y") if t.tzinfo else t.strftime("%-d %b %Y")


@dataclass
class Bundle:
    uid: str
    lines: dict[str, list[str]] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    years: float = 0.0
    exp_lines: list[str] = field(default_factory=list)  # one per job on the resume ("Role at Company (from – to)")
    edu_lines: list[str] = field(default_factory=list)  # "Education: B.Com, Commerce, 2019"
    doc_rows: list[dict[str, Any]] = field(default_factory=list)  # verified DigiLocker rows (kind, fields)
    doc_lines: dict[str, str] = field(default_factory=dict)  # document kind → its line
    prefs: dict[str, Any] = field(default_factory=dict)
    prefs_lines: dict[str, str] = field(default_factory=dict)  # "night_shift" → "Night shifts: yes"
    rev: str = ""

    def text(self, source: str) -> str:
        return "\n".join(self.lines.get(source) or [])

    def label(self, source: str) -> str:
        return self.labels.get(source) or LABEL.get(source, source)

    def empty(self) -> bool:
        return not any(self.lines.values())


def _resume_lines(data: dict[str, Any], scrub) -> tuple[list[str], list[str], list[str]]:
    d = data or {}
    p = d.get("personal") or {}
    out: list[str] = []
    exp_lines: list[str] = []
    edu_lines: list[str] = []

    def add(s: Any) -> str:
        s = scrub(str(s or ""))
        if s and s != GONE:
            out.append(s)
        return s

    if p.get("headline"):
        add(p["headline"])
    for ln in str(d.get("summary") or "").split("\n"):
        if ln.strip():
            add(ln)
    for e in d.get("exp") or []:
        if not isinstance(e, dict):
            continue
        role, company = str(e.get("role") or "").strip(), str(e.get("company") or "").strip()
        when = " – ".join(
            x for x in [str(e.get("from") or ""), "present" if e.get("current") else str(e.get("to") or "")] if x
        )
        head = " at ".join(x for x in (role, company) if x) + (f" ({when})" if when else "")
        if head.strip():
            exp_lines.append(add(head))
        for ln in str(e.get("description") or "").split("\n"):
            if ln.strip():
                add(ln.strip().lstrip("•-* "))
    for x in d.get("proj") or []:
        if not isinstance(x, dict):
            continue
        add(" – ".join(str(x.get(k) or "") for k in ("title", "tagline") if x.get(k)))
        for ln in str(x.get("description") or "").split("\n"):
            if ln.strip():
                add(ln.strip().lstrip("•-* "))
        if x.get("tech"):
            add(f"Project tools: {x['tech']}")
    for x in d.get("ach") or []:
        if isinstance(x, dict):
            add(" – ".join(str(x.get(k) or "") for k in ("title", "description") if x.get(k)))
    skills = [str(g.get("value") or "") for g in d.get("skillGroups") or [] if isinstance(g, dict)]
    if isinstance(d.get("skills"), str):
        skills.append(d["skills"])
    elif isinstance(d.get("skills"), list):
        skills += [str(s) for s in d["skills"]]
    if any(s.strip() for s in skills):
        add("Skills: " + ", ".join(s.strip() for s in skills if s.strip()))
    for c in d.get("certs") or []:
        if isinstance(c, dict) and c.get("name"):
            add("Certificate: " + " – ".join(str(c.get(k)) for k in ("name", "issuer", "issueDate") if c.get(k)))
    langs = [str(lg.get("name")) for lg in d.get("langs") or [] if isinstance(lg, dict) and lg.get("name")]
    if langs:
        add("Languages: " + ", ".join(langs))
    for e in d.get("edu") or []:
        if not isinstance(e, dict):
            continue
        year = str(e.get("to") or e.get("year") or "")[:4]
        bits = [str(e.get(k) or "").strip() for k in ("degree", "field")] + [year]
        line = ", ".join(b for b in bits if b)
        if line:
            edu_lines.append(add(f"Education: {line}"))
    return out[:MAX_LINES], [x for x in exp_lines if x], [x for x in edu_lines if x]


PREF_WORDS = {"two_wheeler": "two-wheeler", "car": "car", "bicycle": "bicycle"}


def _prefs_lines(p: dict[str, Any]) -> dict[str, str]:
    yn = lambda v: "yes" if v else "no"  # noqa: E731
    out: dict[str, str] = {}
    if p.get("shifts"):
        out["shifts"] = "Shifts: " + ", ".join(p["shifts"])
    for k, label in (("night_shift", "Night shifts"), ("weekends", "Weekends"), ("relocate", "Willing to relocate")):
        if p.get(k) is not None:
            out[k] = f"{label}: {yn(p[k])}"
    if p.get("vehicles") is not None:
        out["vehicles"] = "Vehicles owned: " + (", ".join(PREF_WORDS.get(v, v) for v in p["vehicles"]) or "none")
    if p.get("languages"):
        out["languages"] = "Languages: " + ", ".join(p["languages"])
    if p.get("available_now") or p.get("notice_days") == 0:
        out["notice"] = "Can join: now"
    elif p.get("notice_days"):
        out["notice"] = f"Notice period: {int(p['notice_days'])} days"
    return out


async def resume_for(db, uid: str) -> dict[str, Any] | None:
    return await db[RESUMES].find_one({"user_id": uid, "active": True}) or await db[RESUMES].find_one(
        {"user_id": uid}, sort=[("updated_at", -1)]
    )


async def bundles(db, uids: list[str], resumes: dict[str, dict[str, Any] | None] | None = None, *, show_test: bool | None = None,
                  t: datetime | None = None) -> dict[str, Bundle]:  # fmt: skip
    """The evidence of each person (batched: one query per source). `resumes`: uid → the resume to read (the one they
    applied with); missing ones use the person's active resume. `show_test`: count test-provider documents (a demo
    company, or anywhere outside production)."""
    from app.hire.vetting import engine as V
    from app.trust.digilocker.service import badge_ok, summary

    t = t or now()
    uids = list(dict.fromkeys(uids))
    if not uids:
        return {}
    if show_test is None:
        show_test = not get_settings().is_prod
    resumes = dict(resumes or {})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "email": 1})}
    for uid in uids:
        if uid not in resumes or resumes[uid] is None:
            resumes[uid] = await resume_for(db, uid)
    checks: dict[str, dict[str, dict[str, Any]]] = {}
    async for a in (
        db[SKILL_ATTEMPTS]
        .find({"user_id": {"$in": uids}, "share": True, "submitted_at": {"$ne": None}})
        .sort("submitted_at", -1)
    ):
        checks.setdefault(a["user_id"], {}).setdefault(a["skill"], a)
    verified: dict[str, list[dict[str, Any]]] = {}
    async for v in db[VETTING_VERIFIED].find({"user_id": {"$in": uids}, "expires_at": {"$gt": t}}).sort("at", -1):
        verified.setdefault(v["user_id"], []).append(v)
    interviews: dict[str, dict[str, Any]] = {}
    async for iv in db[VETTING_INTERVIEWS].find({"user_id": {"$in": uids}, "status": "graded"}).sort("graded_at", -1):
        interviews.setdefault(iv["user_id"], iv)
    dq: dict[str, Any] = {"user_id": {"$in": uids}}
    if not show_test:
        dq["test"] = {"$ne": True}
    docs: dict[str, list[dict[str, Any]]] = {}
    async for d in db[TRUST_DOCUMENTS].find(
        dq, {"user_id": 1, "kind": 1, "fields": 1, "review": 1, "verify_until": 1, "fetched_at": 1, "test": 1}
    ):
        if badge_ok(d, t) and d.get("kind") != "pan":
            docs.setdefault(d["user_id"], []).append(d)
    prefs = {p["_id"]: p async for p in db[TRUST_WORK_PREFS].find({"_id": {"$in": uids}})}
    claims: dict[str, list[dict[str, Any]]] = {}
    async for c in db[TRUST_CRITERIA_CLAIMS].find({"user_id": {"$in": uids}, "status": "verified"}):
        claims.setdefault(c["user_id"], []).append(c)
    cert_ids = [c["cert_id"] for cs in claims.values() for c in cs if c.get("cert_id")]
    certs = (
        {
            c["_id"]: c
            async for c in db[CERTIFICATES].find({"_id": {"$in": cert_ids}}, {"title": 1, "issuer": 1, "date": 1})
        }
        if cert_ids
        else {}
    )

    out: dict[str, Bundle] = {}
    for uid in uids:
        u = users.get(uid) or {}
        r = resumes.get(uid) or {}
        data = r.get("data") or {}
        scrub = anonymiser(*B.identifiers(u, r))  # T12: the shared anonymiser
        b = Bundle(uid)
        if data:
            b.lines["resume"], b.exp_lines, b.edu_lines = _resume_lines(data, scrub)
            b.years = Resume(data).years if b.exp_lines else 0.0
        sc: list[str] = []
        for v in verified.get(uid) or []:
            band = V.BANDS.get(v.get("band"), {}).get("label", "")
            task = f" · practical task {int(v['task_score'])}/100" if v.get("task_score") is not None else ""
            sc.append(
                f"{v['test']}: Skill verified{f' · {band}' if band else ''} · test {int(v.get('score') or 0)}/100{task} on {day(v.get('at'))}"
            )
        for skill, a in (checks.get(uid) or {}).items():
            sc.append(f"{skill}: skill check score {int(a.get('score') or 0)}/100 on {day(a.get('submitted_at'))}")
        if sc:
            b.lines["skill_check"] = sc[:MAX_LINES]
        iv = interviews.get(uid)
        if iv:
            ans = []
            for x in iv.get("turns") or []:
                for k in ("answer", "follow_answer"):
                    for ln in str(x.get(k) or "").split("\n"):
                        s = scrub(ln)
                        if len(s) >= 3 and s != GONE:
                            ans.append(s)
            if ans:
                b.lines["interview"] = ans[:MAX_LINES]
                b.labels["interview"] = f"AI interview ({iv.get('test', '')}, {day(iv.get('graded_at'))})"
        dl = []
        for d in docs.get(uid) or []:
            line = f"{summary(d, for_company=True)} · verified via DigiLocker"
            b.doc_rows.append(d)
            b.doc_lines[d["kind"]] = line
            dl.append(line)
        if dl:
            b.lines["documents"] = dl
        p = prefs.get(uid) or {}
        b.prefs = p
        b.prefs_lines = _prefs_lines(p)
        if b.prefs_lines:
            b.lines["prefs"] = list(b.prefs_lines.values())
        cl = []
        for c in claims.get(uid) or []:
            cert = certs.get(c.get("cert_id")) or {}
            title = scrub(cert.get("title") or c.get("title") or "")
            if title and title != GONE:
                issuer = scrub(cert.get("issuer") or "")
                cl.append(
                    f"{title}{f' – {issuer}' if issuer and issuer != GONE else ''} (checked by Nm7 on {day(c.get('reviewed_at'))})"
                )
        if cl:
            b.lines["certificate"] = cl
        b.rev = hashlib.sha1(json.dumps([b.lines, b.years], sort_keys=True, default=str).encode()).hexdigest()[:16]
        out[uid] = b
    return out
