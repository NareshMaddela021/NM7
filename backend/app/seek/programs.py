# ruff: noqa: E501  (rule words and messages on one line)
"""Phase 6 S8: internships and live projects from Verified companies.

Company (Verified only; posting roles):
  GET  /api/company/{cid}/programs                    my internships and live projects, with applicants
  POST /api/company/{cid}/programs {kind, title, brief, deliverable, deadline, weeks, stipend, remote, city, seats}
  POST /api/company/{cid}/programs/{pid}/close
  POST /api/company/{cid}/programs/{pid}/applicants/{aid}/accept     up to `seats`
  POST /api/company/{cid}/programs/{pid}/applicants/{aid}/review {ok, note}   after the student sends the work
Students:
  GET  /api/programs                                  open, approved programs (public)
  POST /api/programs/{pid}/apply {note, consent}
  GET  /api/me/programs                               mine: status, what to send, certificate, the resume entry
  POST /api/me/programs/{aid}/submit {link | text}
  POST /api/me/programs/{aid}/resume                  adds the suggested entry to my resume (only when I confirm)
Public:
  GET  /api/public/certificates/{token}               the verification page's data
  GET  /api/public/certificates/{token}.pdf           the completion certificate (made on the server)
Admin ("companies"):
  GET  /api/admin/programs?flagged=1 · POST /api/admin/programs/{pid}/review {approve}

Free labour: an unpaid live project for more than 20 students, an unpaid internship over 2 months, unpaid work that
reads like a regular job (full time, running the company's accounts or customers), or work that sounds like the
company's paid work (clients, production, sales targets, revenue) is held for Admin before anyone sees it, for every
company (demo companies too). Unpaid is allowed and shown clearly ("Unpaid"); never a fee.
"""

import re
import secrets
from datetime import datetime
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header
from fastapi.responses import Response
from pydantic import Field, field_validator, model_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import trust_of
from app.companies.signup import company_for
from app.core.config import get_settings
from app.core.db import COMPANIES, DB, PROGRAM_APPS, PROGRAMS, RESUMES, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.service import ms

company = APIRouter(prefix="/api/company", tags=["job seekers"])
public = APIRouter(prefix="/api/programs", tags=["job seekers"])
me = APIRouter(prefix="/api/me/programs", tags=["job seekers"])
certs = APIRouter(prefix="/api/public/certificates", tags=["job seekers"])
admin = APIRouter(prefix="/api/admin/programs", tags=["job seekers"])

POST = {"main", "full", "posting"}
PAID_WORK = re.compile(
    r"\b(our clients?|client work|production|live customers|sales targets?|revenue|billable|for our customers|real orders|deliver to (?:a |our )?client)\b",
    re.I,
)
# unpaid work that reads like a regular job: full-time hours or running the company's day-to-day work
REGULAR_JOB = re.compile(
    r"\b(full[- ]?time|9 ?(?:am)? ?(?:to|-) ?6|every day|daily (?:posts?|calls|targets|reports)|run (?:our|the company'?s)|"
    r"manage our|our (?:social media|accounts|instagram|facebook|page|store|shop|office)|handle (?:our )?customers?|"
    r"customer (?:messages|calls|queries|support|complaints)|reply to customers)\b",
    re.I,
)
FEE = re.compile(r"\b(fee|deposit|pay us|registration charges?)\b", re.I)


class ProgramIn(CamelModel):
    kind: Literal["internship", "project"]
    title: str = Field(min_length=4, max_length=120)
    brief: str = Field(min_length=30, max_length=3000)
    deliverable: str = Field("", max_length=600)  # projects: what to send
    deadline: str = Field("", pattern=r"^(\d{4}-\d{2}-\d{2})?$")  # projects
    weeks: int = Field(ge=1, le=52)  # projects: 1–4; internships: up to 52
    stipend: int = Field(0, ge=0, le=500_000)  # ₹ a month (internships) or for the whole project; 0 = unpaid
    remote: bool = True
    city: str = Field("", max_length=60)
    seats: int = Field(1, ge=1, le=500)

    @field_validator("title", "brief", "deliverable", "city")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def _rules(self):
        if FEE.search(self.title + " " + self.brief + " " + self.deliverable):
            raise ValueError("Students never pay anything on Nm7: remove fee or deposit wording.")
        if self.kind == "project":
            if self.weeks > 4:
                raise ValueError("A live project is 1–4 weeks. Post longer work as an internship.")
            if not self.deliverable or not self.deadline:
                raise ValueError("Say what the student sends and by when.")
        if not self.remote and not self.city:
            raise ValueError("Add the city for on-site work.")
        return self


def free_labour(p: dict[str, Any]) -> list[str]:
    """Why a program may be unpaid work in disguise (empty: fine). Rules only; Admin decides."""
    why = []
    unpaid = not p.get("stipend")
    if unpaid and p["kind"] == "project" and p["seats"] > 20:
        why.append("Unpaid, for more than 20 students")
    if unpaid and p["kind"] == "internship" and p["weeks"] > 8:
        why.append("Unpaid internship longer than 2 months")
    if unpaid and REGULAR_JOB.search(p["title"] + " " + p["brief"] + " " + p.get("deliverable", "")):
        why.append("Unpaid, but reads like a regular job (full time, running the company's accounts or customers)")
    if PAID_WORK.search(p["title"] + " " + p["brief"] + " " + p.get("deliverable", "")):
        why.append("Sounds like the company's paid work (clients, production, sales targets)")
    return why


def program_out(p: dict[str, Any], c: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": str(p["_id"]), "kind": p["kind"], "title": p["title"], "brief": p["brief"], "deliverable": p.get("deliverable", ""),
            "deadline": p.get("deadline", ""), "weeks": p["weeks"], "stipend": p.get("stipend", 0), "remote": p["remote"],
            "city": p.get("city", ""), "seats": p["seats"], "accepted": p.get("accepted", 0), "status": p["status"],
            "flags": p.get("flags") or [], "company": {"name": (c or {}).get("details", {}).get("legal_name", ""), "slug": (c or {}).get("slug", "")},
            "createdAt": ms(p["created_at"])}  # fmt: skip


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "Not found.") from None


# --- the company --------------------------------------------------------------------------------------------------


@company.post("/{cid}/programs", status_code=201)
async def create(cid: str, body: ProgramIn, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account, POST)
    if trust_of(c) != "verified":
        raise ApiError(403, "not_verified", "Only Verified companies can post internships and live projects.")
    doc: dict[str, Any] = {
        "company_id": cid,
        **body.model_dump(),
        "accepted": 0,
        "created_at": now(),
        "demo": bool(c.get("demo")),
    }
    doc["flags"] = free_labour(doc)
    doc["status"] = "review" if doc["flags"] else "open"  # held for Admin when it looks like free labour
    doc["_id"] = (await db[PROGRAMS].insert_one(doc)).inserted_id
    await audit(
        db, None, "program.created", target=cid, data={"by": acc["email_lc"], "kind": body.kind, "flags": doc["flags"]}
    )
    return program_out(doc, c)


async def _mine(db, cid: str, pid: str) -> dict[str, Any]:
    p = await db[PROGRAMS].find_one({"_id": _oid(pid), "company_id": cid})
    if not p:
        raise ApiError(404, "not_found", "No such internship or project.")
    return p


def app_out(a: dict[str, Any], u: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": str(a["_id"]), "name": (u or {}).get("name", ""), "status": a["status"], "note": a.get("note", ""),
            "submission": {k: (a.get("submission") or {}).get(k) for k in ("link", "text")} | {"at": ms((a.get("submission") or {}).get("at"))},
            "review": {"ok": (a.get("review") or {}).get("ok"), "note": (a.get("review") or {}).get("note", "")},
            "certificate": a.get("cert") or "", "appliedAt": ms(a["created_at"])}  # fmt: skip


@company.get("/{cid}/programs")
async def mine_company(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> list[dict[str, Any]]:
    _, c, _ = await company_for(db, cid, x_recruiter_account)
    out = []
    async for p in db[PROGRAMS].find({"company_id": cid}).sort("created_at", -1).limit(100):
        apps = await db[PROGRAM_APPS].find({"program_id": p["_id"]}).sort("created_at", 1).to_list(500)
        users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [a["user_id"] for a in apps]}}, {"name": 1})}
        out.append({**program_out(p, c), "applicants": [app_out(a, users.get(a["user_id"])) for a in apps]})
    return out


@company.post("/{cid}/programs/{pid}/close")
async def close(cid: str, pid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await company_for(db, cid, x_recruiter_account, POST)
    p = await _mine(db, cid, pid)
    await db[PROGRAMS].update_one({"_id": p["_id"]}, {"$set": {"status": "closed"}})
    return {"status": "closed"}


@company.post("/{cid}/programs/{pid}/applicants/{aid}/accept")
async def accept(
    cid: str, pid: str, aid: str, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    await company_for(db, cid, x_recruiter_account, POST)
    p = await _mine(db, cid, pid)
    a = await db[PROGRAM_APPS].find_one({"_id": _oid(aid), "program_id": p["_id"]})
    if not a or a["status"] != "applied":
        raise ApiError(409, "not_open", "Only a new application can be accepted.")
    seat = await db[PROGRAMS].find_one_and_update(
        {"_id": p["_id"], "accepted": {"$lt": p["seats"]}}, {"$inc": {"accepted": 1}}
    )
    if not seat:
        raise ApiError(409, "full", f"All {p['seats']} places are taken.")
    await db[PROGRAM_APPS].update_one({"_id": a["_id"]}, {"$set": {"status": "accepted", "accepted_at": now()}})
    return {"status": "accepted"}


class ReviewIn(CamelModel):
    ok: bool
    note: str = Field("", max_length=500)


def cert_token() -> str:
    return secrets.token_urlsafe(9)


@company.post("/{cid}/programs/{pid}/applicants/{aid}/review")
async def review(
    cid: str, pid: str, aid: str, body: ReviewIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict:
    acc, _, _ = await company_for(db, cid, x_recruiter_account, POST)
    p = await _mine(db, cid, pid)
    a = await db[PROGRAM_APPS].find_one({"_id": _oid(aid), "program_id": p["_id"]})
    if not a or a["status"] != "submitted":
        raise ApiError(409, "not_submitted", "Review the work after the student sends it.")
    sets: dict[str, Any] = {"review": {"ok": body.ok, "note": body.note.strip(), "at": now()},
                            "status": "completed" if body.ok else "not_completed"}  # fmt: skip
    if body.ok:
        sets["cert"] = cert_token()
        sets["completed_at"] = now()
    await db[PROGRAM_APPS].update_one({"_id": a["_id"]}, {"$set": sets})
    await audit(db, None, "program.reviewed", target=cid, data={"by": acc["email_lc"], "app": aid, "ok": body.ok})
    return {"status": sets["status"], "certificate": sets.get("cert", "")}


# --- students -----------------------------------------------------------------------------------------------------


@public.get("")
async def open_programs(db: DB) -> list[dict[str, Any]]:
    rows = (
        await db[PROGRAMS]
        .find({"status": "open", "demo": {"$ne": True}})
        .sort("created_at", -1)
        .limit(200)
        .to_list(200)
    )
    cs = {
        c["_id"]: c
        async for c in db[COMPANIES].find(
            {"_id": {"$in": [p["company_id"] for p in rows]}}, {"details.legal_name": 1, "slug": 1}
        )
    }
    return [program_out(p, cs.get(p["company_id"])) for p in rows]


class ApplyIn(CamelModel):
    note: str = Field("", max_length=600)
    consent: bool


@public.post("/{pid}/apply", status_code=201)
async def apply(pid: str, body: ApplyIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    p = await db[PROGRAMS].find_one({"_id": _oid(pid), "status": "open"})
    if not p:
        raise ApiError(404, "not_found", "This internship or project isn't open.")
    if not body.consent:
        raise ApiError(422, "consent", "Tick the box to share your resume with the company.")
    if await db[PROGRAM_APPS].find_one({"program_id": p["_id"], "user_id": auth.user.id}):
        raise ApiError(409, "applied", "You have applied already.")
    doc = {"program_id": p["_id"], "company_id": p["company_id"], "user_id": auth.user.id, "status": "applied",
           "note": body.note.strip(), "created_at": now()}  # fmt: skip
    doc["_id"] = (await db[PROGRAM_APPS].insert_one(doc)).inserted_id
    return app_out(doc)


def month(d: datetime | None) -> str:
    return d.astimezone(IST).strftime("%Y-%m") if d else ""


def resume_entry(p: dict[str, Any], a: dict[str, Any], cname: str) -> dict[str, Any]:
    """The entry we suggest for the resume: only facts Nm7 recorded (company, title, dates, what was sent)."""
    what = "Internship" if p["kind"] == "internship" else "Live project"
    return {"company": cname, "role": f"{p['title']} ({what})", "from": month(a.get("accepted_at")),
            "to": month(a.get("completed_at")), "description": (p.get("deliverable") or p["brief"])[:300]}  # fmt: skip


@me.get("")
async def mine_student(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    out = []
    async for a in db[PROGRAM_APPS].find({"user_id": auth.user.id}).sort("created_at", -1).limit(50):
        p = await db[PROGRAMS].find_one({"_id": a["program_id"]}) or {}
        c = await db[COMPANIES].find_one({"_id": a["company_id"]}, {"details.legal_name": 1, "slug": 1}) or {}
        row = {**app_out(a), "program": program_out(p, c) if p else None}
        if a["status"] == "completed" and p:
            row["resumeEntry"] = resume_entry(p, a, c.get("details", {}).get("legal_name", ""))
            row["resumeAdded"] = bool(a.get("resume_added"))
            row["verifyUrl"] = f"{get_settings().site_url.rstrip('/')}/verify/{a['cert']}"
        out.append(row)
    return out


class SubmitIn(CamelModel):
    link: str = Field("", max_length=500)
    text: str = Field("", max_length=4000)

    @model_validator(mode="after")
    def _some(self):
        if self.link and not re.match(r"^https?://\S+\.\S+", self.link.strip()):
            raise ValueError("Paste the full link, starting with https://")
        if not self.link.strip() and len(self.text.strip()) < 40:
            raise ValueError("Paste a link to your work, or write at least a few lines about it.")
        return self


@me.post("/{aid}/submit")
async def submit(aid: str, body: SubmitIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[PROGRAM_APPS].find_one({"_id": _oid(aid), "user_id": auth.user.id})
    if not a or a["status"] not in ("accepted", "submitted"):
        raise ApiError(409, "not_accepted", "You can send your work once the company accepts you.")
    sub = {"link": body.link.strip(), "text": body.text.strip(), "at": now()}
    await db[PROGRAM_APPS].update_one({"_id": a["_id"]}, {"$set": {"submission": sub, "status": "submitted"}})
    return {**app_out({**a, "submission": sub, "status": "submitted"})}


@me.post("/{aid}/resume")
async def add_to_resume(aid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    a = await db[PROGRAM_APPS].find_one({"_id": _oid(aid), "user_id": auth.user.id, "status": "completed"})
    if not a:
        raise ApiError(404, "not_found", "Only a completed internship or project can go on your resume.")
    p = await db[PROGRAMS].find_one({"_id": a["program_id"]})
    c = await db[COMPANIES].find_one({"_id": a["company_id"]}, {"details.legal_name": 1}) or {}
    r = await db[RESUMES].find_one({"user_id": auth.user.id, "active": True}) or await db[RESUMES].find_one(
        {"user_id": auth.user.id}, sort=[("updated_at", -1)]
    )
    if not r:
        raise ApiError(409, "no_resume", "Make a resume first, then add this to it.")
    if a.get("resume_added"):
        return {"added": False, "already": True}
    entry = {"id": f"nm7-{aid}", **resume_entry(p, a, c.get("details", {}).get("legal_name", ""))}
    await db[RESUMES].update_one({"_id": r["_id"]}, {"$push": {"data.intern": entry}, "$set": {"updated_at": now()}})
    await db[PROGRAM_APPS].update_one({"_id": a["_id"]}, {"$set": {"resume_added": True}})
    return {"added": True, "entry": entry}


# --- certificates -------------------------------------------------------------------------------------------------


async def cert_data(db, token: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,20}", token or ""):
        raise ApiError(404, "not_found", "No certificate with this number.")
    a = await db[PROGRAM_APPS].find_one({"cert": token, "status": "completed"})
    if not a:
        raise ApiError(404, "not_found", "No certificate with this number.")
    p = await db[PROGRAMS].find_one({"_id": a["program_id"]}) or {}
    c = await db[COMPANIES].find_one({"_id": a["company_id"]}, {"details.legal_name": 1}) or {}
    u = await db[USERS].find_one({"_id": a["user_id"]}, {"name": 1, "deleted_at": 1}) or {}
    if u.get("deleted_at"):
        raise ApiError(404, "not_found", "No certificate with this number.")
    d = lambda x: x.astimezone(IST).strftime("%-d %b %Y") if x else ""  # noqa: E731
    return {"number": token, "name": u.get("name", ""), "company": c.get("details", {}).get("legal_name", ""),
            "title": p.get("title", ""), "kind": p.get("kind", ""), "from": d(a.get("accepted_at")), "to": d(a.get("completed_at")),
            "verifyUrl": f"{get_settings().site_url.rstrip('/')}/verify/{token}"}  # fmt: skip


@certs.get("/{token}.pdf")
async def cert_pdf(token: str, db: DB) -> Response:
    from fpdf import FPDF

    x = await cert_data(db, token)
    pdf = FPDF(orientation="L")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 26)
    pdf.cell(0, 30, "Certificate of completion", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=14)
    what = "internship" if x["kind"] == "internship" else "live project"
    for line in (f"This certifies that {x['name']}", f"completed the {what} \"{x['title']}\"", f"with {x['company']},",
                 f"from {x['from']} to {x['to']}."):  # fmt: skip
        pdf.cell(0, 11, line.encode("latin-1", "replace").decode("latin-1"), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(12)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(
        0,
        7,
        f"Certificate number {x['number']}. Check it at {x['verifyUrl']}",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0, 7, "Issued through Nm7 on behalf of the company; the company reviewed and accepted the work.", align="C"
    )
    return Response(
        bytes(pdf.output()),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="certificate-{token}.pdf"'},
    )


@certs.get("/{token}")
async def cert_check(token: str, db: DB) -> dict[str, Any]:
    return {**await cert_data(db, token), "valid": True}


# --- admin --------------------------------------------------------------------------------------------------------


@admin.get("")
async def admin_list(db: DB, _: AdminAuth("companies"), flagged: bool = False) -> list[dict[str, Any]]:
    q = {"status": "review"} if flagged else {}
    rows = await db[PROGRAMS].find(q).sort("created_at", -1).limit(200).to_list(200)
    cs = {
        c["_id"]: c
        async for c in db[COMPANIES].find(
            {"_id": {"$in": [p["company_id"] for p in rows]}}, {"details.legal_name": 1, "slug": 1}
        )
    }
    return [program_out(p, cs.get(p["company_id"])) for p in rows]


class AdminReviewIn(CamelModel):
    approve: bool


@admin.post("/{pid}/review")
async def admin_review(pid: str, body: AdminReviewIn, db: DB, auth: AdminAuth("companies")) -> dict[str, Any]:
    p = await db[PROGRAMS].find_one({"_id": _oid(pid)})
    if not p:
        raise ApiError(404, "not_found", "No such program.")
    st = "open" if body.approve else "removed"
    await db[PROGRAMS].update_one(
        {"_id": p["_id"]}, {"$set": {"status": st, "reviewed_at": now(), "reviewed_by": auth.user.id}}
    )
    await audit(db, auth.user.id, "program.admin_review", target=str(p["_id"]), data={"approve": body.approve})
    return {"status": st}
