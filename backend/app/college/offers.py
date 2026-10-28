"""Offer tracking (feature `offers`: Drive and Campus plans).

Staff (/api/org/{org_id}/offers; coordinators record, viewers look; Owners and coordinators only — packages are
never shown to recruiters or to other students):
  GET    ""                 offers, with the student (roll, name, branch, group)
  POST   ""                 {membershipId, company, role, ctcLpa, type, offerDate, status}
  PUT    /{id} · DELETE /{id}
  GET    /suggestions       students a recruiter marked "Selected" on the shortlist board, with no offer from that
                            company yet — to pre-fill an offer
  GET    /stats             placed vs not placed by branch and by batch (group), highest / median / average package,
                            offers per company, students with more than one offer
  GET    /offers.csv · GET /report.pdf   (the printable placement report)
Students: GET /api/me/offers — their own offers only.

"Placed" means at least one full-time or PPO offer that wasn't declined; packages are counted over those offers.
Internships are listed and counted per company but don't make a student "placed".
"""

import csv
import io
import statistics
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fpdf.enums import XPos, YPos
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.billing.pdf import _Doc
from app.college.common import log, members_of, org_with, public, scoped_groups
from app.core.db import DB, MEMBERSHIPS, OFFERS, ORGANIZATIONS, RECRUITER_INVITES
from app.core.errors import ApiError
from app.core.exports import csv_safe
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, OrgScope, features_of

staff = APIRouter(prefix="/api/org/{org_id}/offers", tags=["offers"])
me = APIRouter(prefix="/api/me/offers", tags=["offers"])

TYPES = {"full_time": "Full-time", "internship": "Internship", "ppo": "PPO"}
STATUSES = {"offered": "Offered", "accepted": "Accepted", "declined": "Declined", "joined": "Joined"}
PLACING = ("full_time", "ppo")


class OfferIn(CamelModel):
    membership_id: str = Field(max_length=64)
    company: str = Field(min_length=1, max_length=80)
    role: str = Field("", max_length=80)
    ctc_lpa: float | None = Field(None, ge=0, le=500)  # lakhs per annum
    type: Literal["full_time", "internship", "ppo"] = "full_time"
    offer_date: date | None = None
    status: Literal["offered", "accepted", "declined", "joined"] = "offered"

    @field_validator("company", "role")
    @classmethod
    def _tidy(cls, v):
        return " ".join(v.split())


def offer_out(o: dict[str, Any], p: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "id": o["_id"],
        "student": public(p) if p else None,
        "membershipId": o["membership_id"],
        "company": o["company"],
        "role": o.get("role", ""),
        "ctcLpa": o.get("ctc_lpa"),
        "type": o["type"],
        "typeName": TYPES[o["type"]],
        "offerDate": o.get("offer_date"),
        "status": o["status"],
        "statusName": STATUSES[o["status"]],
        "createdAt": ms(o["created_at"]),
    }


async def _people(db, scope, group: str | None = None) -> dict[str, dict[str, Any]]:
    groups = await scoped_groups(db, scope, [group] if group else None)
    return {p["id"]: p for p in await members_of(db, groups)}


async def _offers(db, scope, people: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return (
        await db[OFFERS]
        .find({"org_id": scope.org_id, "membership_id": {"$in": list(people)}})
        .sort("created_at", -1)
        .to_list(None)
    )


@staff.get("")
async def list_offers(db: DB, scope: OrgScope, group: str | None = Query(None, max_length=64)) -> list[dict[str, Any]]:
    await org_with(db, scope, "offers")
    people = await _people(db, scope, group)
    return [offer_out(o, people.get(o["membership_id"])) for o in await _offers(db, scope, people)]


@staff.post("", status_code=201)
async def add_offer(body: OfferIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "offers")
    scope.require("manage")
    people = await _people(db, scope)
    p = people.get(body.membership_id)
    if not p:
        raise NOT_FOUND
    t = now()
    o = {
        "_id": new_id(),
        "org_id": scope.org_id,
        "membership_id": p["id"],
        "user_id": p["user_id"],
        "group_id": p["group_id"],
        **body.model_dump(exclude={"membership_id", "offer_date"}),
        "offer_date": body.offer_date.isoformat() if body.offer_date else None,
        "created_by": scope.actor_id,
        "created_at": t,
        "updated_at": t,
    }
    await db[OFFERS].insert_one(o)
    await log(db, scope, request, "offer_create", o["_id"], member=p["id"], company=o["company"], status=o["status"])
    return offer_out(o, p)


async def _mine_in_scope(db, scope, offer_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    o = await db[OFFERS].find_one({"_id": offer_id, "org_id": scope.org_id})
    people = await _people(db, scope)
    if not o or o["membership_id"] not in people:
        raise NOT_FOUND
    return o, people[o["membership_id"]]


@staff.put("/{offer_id}")
async def edit_offer(offer_id: str, body: OfferIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "offers")
    scope.require("manage")
    o, p = await _mine_in_scope(db, scope, offer_id)
    if body.membership_id != o["membership_id"]:
        raise ApiError(400, "student_fixed", "An offer stays with its student. Delete it and add a new one instead.")
    sets = {
        **body.model_dump(exclude={"membership_id", "offer_date"}),
        "offer_date": body.offer_date.isoformat() if body.offer_date else None,
        "updated_at": now(),
    }
    await db[OFFERS].update_one({"_id": offer_id}, {"$set": sets})
    await log(
        db, scope, request, "offer_update", offer_id, member=p["id"], company=sets["company"], status=sets["status"]
    )
    return offer_out({**o, **sets}, p)


@staff.delete("/{offer_id}", status_code=204)
async def delete_offer(offer_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    await org_with(db, scope, "offers")
    scope.require("manage")
    o, p = await _mine_in_scope(db, scope, offer_id)
    await db[OFFERS].delete_one({"_id": offer_id})
    await log(db, scope, request, "offer_delete", offer_id, member=p["id"], company=o["company"])
    return Response(status_code=204)


@staff.get("/students")
async def offer_students(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    """Who an offer can be recorded for: active members who joined with consent, in this scope."""
    await org_with(db, scope, "offers")
    return [public(p) for p in (await _people(db, scope)).values()]


@staff.get("/suggestions")
async def suggestions(db: DB, scope: OrgScope) -> list[dict[str, Any]]:
    """ "Selected" on a recruiter's shortlist board and no offer from that company yet: one click pre-fills an offer."""
    await org_with(db, scope, "offers")
    people = await _people(db, scope)
    have = {(o["membership_id"], o["company"].lower()) for o in await _offers(db, scope, people)}
    out = []
    async for inv in db[RECRUITER_INVITES].find({"org_id": scope.org_id}, {"company": 1, "board": 1}):
        for mid, b in (inv.get("board") or {}).items():
            if (b or {}).get("stage") == "selected" and mid in people and (mid, inv["company"].lower()) not in have:
                out.append(
                    {
                        "student": public(people[mid]),
                        "membershipId": mid,
                        "company": inv["company"],
                        "note": b.get("note", ""),
                        "at": ms(b.get("at")),
                    }
                )
                have.add((mid, inv["company"].lower()))
    return out


def _lpa(v: float | None) -> float | None:
    return round(v, 2) if v is not None else None


def stats_of(people: dict[str, dict[str, Any]], offers: list[dict[str, Any]]) -> dict[str, Any]:
    live = [o for o in offers if o["status"] != "declined"]
    placing = [o for o in live if o["type"] in PLACING]
    placed = {o["membership_id"] for o in placing}
    pk = sorted(o["ctc_lpa"] for o in placing if o.get("ctc_lpa") is not None)

    def split(key: str) -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        for p in people.values():
            r = rows.setdefault(p[key] or "—", {"name": p[key] or "—", "students": 0, "placed": 0})
            r["students"] += 1
            r["placed"] += p["id"] in placed
        for r in rows.values():
            r["notPlaced"] = r["students"] - r["placed"]
            r["percent"] = round(100 * r["placed"] / r["students"]) if r["students"] else 0
        return sorted(rows.values(), key=lambda r: r["name"])

    per_company: dict[str, dict[str, Any]] = {}
    for o in live:
        c = per_company.setdefault(
            o["company"].lower(), {"company": o["company"], "offers": 0, "fullTime": 0, "internships": 0, "ppo": 0}
        )
        c["offers"] += 1
        c[{"full_time": "fullTime", "internship": "internships", "ppo": "ppo"}[o["type"]]] += 1
    by_student: dict[str, list[dict[str, Any]]] = {}
    for o in live:
        by_student.setdefault(o["membership_id"], []).append(o)
    multi = [
        {"student": public(people[m]), "offers": len(os_), "companies": sorted({o["company"] for o in os_})}
        for m, os_ in by_student.items()
        if len(os_) > 1 and m in people
    ]
    return {
        "students": len(people),
        "placed": len(placed & set(people)),
        "notPlaced": len(people) - len(placed & set(people)),
        "offers": len(live),
        "packages": {
            "count": len(pk),
            "highest": _lpa(pk[-1]) if pk else None,
            "median": _lpa(statistics.median(pk)) if pk else None,
            "average": _lpa(sum(pk) / len(pk)) if pk else None,
        },
        "byBranch": split("branch"),
        "byBatch": split("group"),
        "byCompany": sorted(per_company.values(), key=lambda c: (-c["offers"], c["company"])),
        "multiple": sorted(multi, key=lambda m: (-m["offers"], m["student"]["roll"] or "~")),
    }


@staff.get("/stats")
async def stats(db: DB, scope: OrgScope, group: str | None = Query(None, max_length=64)) -> dict[str, Any]:
    await org_with(db, scope, "offers")
    people = await _people(db, scope, group)
    return stats_of(people, await _offers(db, scope, people))


@staff.get("/offers.csv")
async def offers_csv(
    request: Request, db: DB, scope: OrgScope, group: str | None = Query(None, max_length=64)
) -> Response:
    await org_with(db, scope, "offers")
    scope.require("export")
    people = await _people(db, scope, group)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["Roll number", "Name", "Branch", "Group", "Company", "Role", "CTC (LPA)", "Type", "Offer date", "Status"]
    )
    for o in await _offers(db, scope, people):
        p = people[o["membership_id"]]
        w.writerow(
            [
                csv_safe(x)
                for x in (
                    p["roll"],
                    p["name"],
                    p["branch"],
                    p["group"],
                    o["company"],
                    o.get("role", ""),
                    o.get("ctc_lpa") if o.get("ctc_lpa") is not None else "",
                    TYPES[o["type"]],
                    o.get("offer_date") or "",
                    STATUSES[o["status"]],
                )
            ]
        )
    await log(db, scope, request, "offer_export", None, format="csv")
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="offers.csv"', "Cache-Control": "no-store"},
    )


def _table(pdf: _Doc, head: list[str], widths: list[float], rows: list[list[str]]) -> None:
    pdf.set_font("main", "B", 8.5)
    for h, w in zip(head, widths, strict=True):
        pdf.cell(w, 6, h, border="B")
    pdf.ln(6)
    pdf.set_font("main", "", 8.5)
    for r in rows:
        for v, w in zip(r, widths, strict=True):
            pdf.cell(w, 5.4, str(v)[:60])
        pdf.ln(5.4)
    pdf.ln(3)


def report_pdf(org_name: str, s: dict[str, Any], group_name: str | None) -> bytes:
    pdf = _Doc()
    pdf.line_text(f"{org_name} · Placement report", 15, bold=True, h=7)
    pdf.line_text(f"{group_name or 'All batches'} · {now().astimezone(IST):%d %b %Y}", 9)
    pdf.ln(3)
    p = s["packages"]
    lpa = lambda v: f"{v:g} LPA" if v is not None else "—"  # noqa: E731
    pdf.line_text(
        f"Students {s['students']} · Placed {s['placed']} · Not placed {s['notPlaced']} · Offers {s['offers']}",
        10,
        bold=True,
    )
    pdf.line_text(
        f"Packages (full-time and PPO): highest {lpa(p['highest'])} · median {lpa(p['median'])}"
        f" · average {lpa(p['average'])}",
        9.5,
    )
    pdf.ln(3)
    for title, key in (("By branch", "byBranch"), ("By batch", "byBatch")):
        pdf.line_text(title, 11, bold=True, h=6)
        _table(
            pdf,
            ["", "Students", "Placed", "Not placed", "%"],
            [80, 25, 25, 25, 20],
            [[r["name"], r["students"], r["placed"], r["notPlaced"], f"{r['percent']}%"] for r in s[key]],
        )
    pdf.line_text("Offers per company", 11, bold=True, h=6)
    _table(
        pdf,
        ["Company", "Offers", "Full-time", "Internships", "PPO"],
        [80, 22, 25, 25, 20],
        [[c["company"], c["offers"], c["fullTime"], c["internships"], c["ppo"]] for c in s["byCompany"]],
    )
    if s["multiple"]:
        pdf.line_text("Students with more than one offer", 11, bold=True, h=6)
        _table(
            pdf,
            ["Roll number", "Name", "Offers", "Companies"],
            [30, 55, 18, 72],
            [
                [m["student"]["roll"], m["student"]["name"], m["offers"], ", ".join(m["companies"])]
                for m in s["multiple"]
            ],
        )
    pdf.set_font("main", "", 7.5)
    pdf.multi_cell(
        0,
        4,
        "Confidential: for the college's placement office. Packages are not shared with students or recruiters.",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    return bytes(pdf.output())


@staff.get("/report.pdf")
async def report(request: Request, db: DB, scope: OrgScope, group: str | None = Query(None, max_length=64)) -> Response:
    o = await org_with(db, scope, "offers")
    people = await _people(db, scope, group)
    s = stats_of(people, await _offers(db, scope, people))
    gname = (await scoped_groups(db, scope, [group]))[0]["name"] if group else None
    await log(db, scope, request, "offer_export", None, format="pdf")
    return Response(
        report_pdf(o["name"], s, gname),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="placement_report.pdf"', "Cache-Control": "no-store"},
    )


@me.get("")
async def my_offers(auth: CustomerAuth, db: DB) -> list[dict[str, Any]]:
    """My own offers (never anyone else's), in organizations that track offers."""
    mids = {m["_id"]: m async for m in db[MEMBERSHIPS].find({"user_id": auth.user.id, "left_at": None})}
    orgs = {
        o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({m["org_id"] for m in mids.values()})}})
    }
    out = []
    async for o in (
        db[OFFERS].find({"membership_id": {"$in": list(mids)}, "user_id": auth.user.id}).sort("created_at", -1)
    ):
        org = orgs.get(o["org_id"])
        if org and features_of(org)["offers"]:
            out.append({**offer_out(o, None), "org": org["name"]})
    return out
