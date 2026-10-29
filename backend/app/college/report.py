"""Placement report PDF (Drive and Campus plans): one click at the end of a drive, or for a whole academic year.

Numbers only, by branch and by company: joined, ready (resume reviewed "Ready"), shortlisted and selected by
recruiters, offers and students placed, and packages when the organization tracks offers. The college's logo,
colour and header line (its branded format) and the date go on top. It helps with NAAC / NIRF and management
reports; it is not an official NAAC or NIRF format, and says so. No student names or contact details are in it.

  GET /api/org/{org_id}/report/year.pdf?year=2025&group=   academic year June 2025 – May 2026 (default: the current one)
  GET /api/org/{org_id}/drives/{drive_id}/report.pdf       one drive: its groups and companies, attendance
"""

import base64
import io
import statistics
from datetime import date, datetime, time
from typing import Any

from fastapi import APIRouter, Query, Request, Response

from app.billing.pdf import _Doc
from app.college.common import log, members_of, org_with, scoped_groups
from app.college.offers import PLACING
from app.core.db import DB, DRIVE_CHECKINS, DRIVES, OFFERS, RECRUITER_INVITES, RECRUITER_LINKS
from app.core.time import IST, now
from app.orgs.scope import NOT_FOUND, OrgScope, features_of

staff = APIRouter(prefix="/api/org/{org_id}", tags=["org-college"])

NOTE = (
    "Helps with NAAC / NIRF and management reports. This is not an official NAAC or NIRF format: copy the numbers "
    "into the official forms. Numbers count students who joined on Nm7 and agreed to share with the college."
)
SELECTED = "selected"
SHORT_STAGES = ("shortlisted", "interview", "selected", "rejected")


def academic_year(today: date | None = None) -> int:
    """The year the current academic year started (June to May)."""
    t = today or now().astimezone(IST).date()
    return t.year if t.month >= 6 else t.year - 1


def _span(year: int) -> tuple[datetime, datetime]:
    return (
        datetime.combine(date(year, 6, 1), time.min, IST),
        datetime.combine(date(year + 1, 6, 1), time.min, IST),
    )


def _in(o: dict[str, Any], start: datetime, end: datetime) -> bool:
    d = o.get("offer_date")
    if d:
        return start.date() <= date.fromisoformat(d) < end.date()
    return start <= o["created_at"] < end


def _lpa(v: float | None) -> str:
    return f"{v:g} LPA" if v is not None else "—"


def numbers(
    people: list[dict[str, Any]],
    offers: list[dict[str, Any]],
    boards: list[dict[str, Any]],
    attended: dict[str, set[str]] | None = None,
    companies: list[str] | None = None,
) -> dict[str, Any]:
    """Pure: the report's numbers. boards = [{company, stages: {membership id: stage}}]; attended = company →
    membership ids checked in (drive report); companies = the drive's companies (in order) or None for all."""
    pid = {p["id"]: p for p in people}
    live = [o for o in offers if o["status"] != "declined" and o["membership_id"] in pid]
    placed = {o["membership_id"] for o in live if o["type"] in PLACING}
    short: dict[str, set[str]] = {}
    sel: dict[str, set[str]] = {}
    for b in boards:
        k = b["company"].strip().lower()
        for mid, st in b["stages"].items():
            if mid not in pid:
                continue
            if st in SHORT_STAGES:
                short.setdefault(k, set()).add(mid)
            if st == SELECTED:
                sel.setdefault(k, set()).add(mid)
    any_short = set().union(*short.values()) if short else set()
    any_sel = set().union(*sel.values()) if sel else set()

    branches: dict[str, dict[str, Any]] = {}
    for p in people:
        b = p.get("branch") or "—"
        r = branches.setdefault(b, {"name": b, "joined": 0, "ready": 0, "shortlisted": 0, "selected": 0, "placed": 0})
        r["joined"] += 1
        r["ready"] += (p.get("_m") or {}).get("review_status") == "ready"
        r["shortlisted"] += p["id"] in any_short
        r["selected"] += p["id"] in any_sel
        r["placed"] += p["id"] in placed

    names: dict[str, str] = {}
    for c in companies or []:
        names.setdefault(c.strip().lower(), c.strip())
    if companies is None:
        for o in live:
            names.setdefault(o["company"].strip().lower(), o["company"].strip())
        for b in boards:
            names.setdefault(b["company"].strip().lower(), b["company"].strip())
    rows = []
    for k, name in names.items():
        mine = [o for o in live if o["company"].strip().lower() == k]
        pk = sorted(o["ctc_lpa"] for o in mine if o["type"] in PLACING and o.get("ctc_lpa") is not None)
        rows.append(
            {
                "company": name,
                "attended": len((attended or {}).get(k, set())) if attended is not None else None,
                "shortlisted": len(short.get(k, set())),
                "selected": len(sel.get(k, set())),
                "offers": len(mine),
                "highest": pk[-1] if pk else None,
                "median": statistics.median(pk) if pk else None,
            }
        )
    if companies is None:
        rows.sort(key=lambda r: (-r["offers"], -r["selected"], r["company"].lower()))
    pk = sorted(o["ctc_lpa"] for o in live if o["type"] in PLACING and o.get("ctc_lpa") is not None)
    return {
        "joined": len(people),
        "ready": sum(1 for p in people if (p.get("_m") or {}).get("review_status") == "ready"),
        "shortlisted": len(any_short),
        "selected": len(any_sel),
        "offers": len(live),
        "placed": len(placed),
        "attended": len(set().union(*attended.values())) if attended else (0 if attended is not None else None),
        "packages": {
            "count": len(pk),
            "highest": pk[-1] if pk else None,
            "median": round(statistics.median(pk), 2) if pk else None,
            "average": round(sum(pk) / len(pk), 2) if pk else None,
        },
        "byBranch": sorted(branches.values(), key=lambda r: r["name"].lower()),
        "byCompany": rows,
    }


def _logo(pdf: _Doc, b: dict[str, Any]) -> bool:
    logo = b.get("logo")
    if not logo or logo.get("mime") not in ("image/png", "image/jpeg"):
        return False  # SVG logos aren't drawn in the PDF; the name and colour still are
    try:
        pdf.image(io.BytesIO(base64.b64decode(logo["data"])), x=14, y=12, h=14)
        return True
    except Exception:  # noqa: BLE001 — a logo the PDF library can't read: leave it out
        return False


def _hex(c: str) -> tuple[int, int, int]:
    c = (c or "#1F3A8A").lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _table(pdf: _Doc, head: list[str], widths: list[float], rows: list[list[Any]]) -> None:
    pdf.set_font("main", "B", 8.5)
    for h, w in zip(head, widths, strict=True):
        pdf.cell(w, 6, h, border="B")
    pdf.ln(6)
    pdf.set_font("main", "", 8.5)
    for r in rows:
        for v, w in zip(r, widths, strict=True):
            pdf.cell(w, 5.4, str(v)[:48])
        pdf.ln(5.4)
    pdf.ln(3)


def render(org: dict[str, Any], title: str, sub: str, n: dict[str, Any], packages: bool) -> bytes:
    pdf = _Doc()
    b = org.get("branding") or {}
    pdf.set_title(f"{org['name']} · {title}")
    left = 14 + (22 if _logo(pdf, b) else 0)
    pdf.set_xy(left, 12)
    pdf.set_text_color(*_hex(b.get("color")))
    pdf.set_font("main", "B", 14)
    pdf.cell(0, 7, org["name"], new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(left)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("main", "", 9)
    pdf.cell(0, 5, b.get("header") or "Training & Placement", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*_hex(b.get("color")))
    pdf.line(14, 30, 196, 30)
    pdf.set_y(33)
    pdf.line_text(title, 13, bold=True, h=6.5)
    pdf.line_text(f"{sub} · made {now().astimezone(IST):%d %b %Y}", 9)
    pdf.ln(2)
    head = (
        f"Joined {n['joined']} · Ready {n['ready']} · Shortlisted {n['shortlisted']} · Selected {n['selected']}"
        f" · Offers {n['offers']} · Placed {n['placed']}"
    )
    if n["attended"] is not None:
        head = f"{head} · Attended {n['attended']}"
    pdf.line_text(head, 10, bold=True)
    if packages:
        p = n["packages"]
        pdf.line_text(
            f"Packages (full-time and PPO): highest {_lpa(p['highest'])} · median {_lpa(p['median'])}"
            f" · average {_lpa(p['average'])}",
            9.5,
        )
    pdf.ln(3)
    pdf.line_text("By branch", 11, bold=True, h=6)
    _table(
        pdf,
        ["Branch", "Joined", "Ready", "Shortlisted", "Selected", "Placed", "%"],
        [62, 18, 18, 22, 20, 18, 16],
        [
            [r["name"], r["joined"], r["ready"], r["shortlisted"], r["selected"], r["placed"],
             f"{round(100 * r['placed'] / r['joined']) if r['joined'] else 0}%"]
            for r in n["byBranch"]
        ],
    )  # fmt: skip
    pdf.line_text("By company", 11, bold=True, h=6)
    att = n["attended"] is not None
    head_c = ["Company", *(["Attended"] if att else []), "Shortlisted", "Selected", "Offers"]
    widths = [62 if packages else 90, *([20] if att else []), 22, 20, 18]
    if packages:
        head_c += ["Highest", "Median"]
        widths += [22, 22]
    rows = []
    for r in n["byCompany"]:
        row = [r["company"], *([r["attended"]] if att else []), r["shortlisted"], r["selected"], r["offers"]]
        if packages:
            row += [_lpa(r["highest"]), _lpa(r["median"])]
        rows.append(row)
    _table(pdf, head_c, widths, rows or [["—", *[""] * (len(head_c) - 1)]])
    pdf.set_font("main", "", 7.5)
    pdf.multi_cell(0, 4, NOTE, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


async def _boards(db, org_id: str, q: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    async for inv in db[RECRUITER_INVITES].find({"org_id": org_id, **q}, {"company": 1, "board": 1}):
        stages = {m: (b or {}).get("stage") for m, b in (inv.get("board") or {}).items()}
        out.append({"company": inv["company"], "stages": stages})
    async for link in db[RECRUITER_LINKS].find({"org_id": org_id, **q}, {"company": 1, "shortlist": 1}):
        out.append({"company": link["company"], "stages": dict.fromkeys(link.get("shortlist") or {}, "shortlisted")})
    return out


def _pdf(body: bytes, name: str) -> Response:
    return Response(
        body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


@staff.get("/report/year.pdf")
async def year_report(
    request: Request,
    db: DB,
    scope: OrgScope,
    year: int | None = Query(None, ge=2000, le=2100),
    group: str | None = Query(None, max_length=64),
) -> Response:
    o = await org_with(db, scope, "drives")
    y = year or academic_year()
    start, end = _span(y)
    groups = await scoped_groups(db, scope, [group] if group else None)
    people = await members_of(db, groups)
    packages = features_of(o)["offers"]
    offers = []
    if packages:
        q = {"org_id": scope.org_id, "membership_id": {"$in": [p["id"] for p in people]}}
        offers = [x async for x in db[OFFERS].find(q) if _in(x, start, end)]
    boards = await _boards(db, scope.org_id, {"created_at": {"$gte": start, "$lt": end}})
    n = numbers(people, offers, boards)
    sub = f"Academic year {y}–{str(y + 1)[-2:]}" + (f" · {groups[0]['name']}" if group else " · all groups")
    await log(db, scope, request, "placement_report", None, kind="year", year=y)
    return _pdf(render(o, "Placement report", sub, n, packages), f"placement_report_{y}-{str(y + 1)[-2:]}.pdf")


@staff.get("/drives/{drive_id}/report.pdf")
async def drive_report(drive_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    o = await org_with(db, scope, "drives")
    d = await db[DRIVES].find_one({"_id": drive_id, "org_id": scope.org_id})
    if not d:
        raise NOT_FOUND
    mine = {g["_id"] for g in await scoped_groups(db, scope)}
    groups = [g for g in await scoped_groups(db, scope) if g["_id"] in set(d["group_ids"]) & mine]
    if not groups:
        raise NOT_FOUND
    people = await members_of(db, groups)
    ids = {p["id"] for p in people}
    names = [c["name"] for c in d["companies"]]
    keys = {n.strip().lower() for n in names}
    packages = features_of(o)["offers"]
    offers = []
    if packages:
        q = {"org_id": scope.org_id, "membership_id": {"$in": list(ids)}}
        offers = [x async for x in db[OFFERS].find(q) if x["company"].strip().lower() in keys]
    boards = [b for b in await _boards(db, scope.org_id, {}) if b["company"].strip().lower() in keys]
    comp = {c["id"]: c["name"].strip().lower() for c in d["companies"]}
    slot_company = {s["id"]: comp.get(s["company_id"]) for s in d.get("slots", [])}
    attended: dict[str, set[str]] = {k: set() for k in keys}
    async for c in db[DRIVE_CHECKINS].find({"drive_id": drive_id}, {"slot_id": 1, "membership_id": 1}):
        k = slot_company.get(c["slot_id"])
        if k and c["membership_id"] in ids:
            attended.setdefault(k, set()).add(c["membership_id"])
    n = numbers(people, offers, boards, attended, names)
    sub = f"{d['name']} · {date.fromisoformat(d['date']):%d %b %Y} · " + ", ".join(g["name"] for g in groups)
    await log(db, scope, request, "placement_report", drive_id, kind="drive")
    return _pdf(render(o, "Drive report", sub, n, packages), "drive_report.pdf")
