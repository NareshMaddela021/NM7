"""Placement report PDF: the numbers by branch and company (pure), the year and drive PDFs (Drive and Campus plans,
the college's own scope only), the NAAC / NIRF note without claiming an official format, packages only where offers
are tracked, and no student names or contact details in the PDF."""

import io
from datetime import UTC, date, datetime

import pytest
from pypdf import PdfReader

from app.college.report import academic_year, numbers
from app.core.db import AUDIT_LOG, MEMBERSHIPS, RECRUITER_INVITES
from tests.test_college_drives import a_drive, campus, students
from tests.test_orgs_phase2 import coordinator, second_org


def text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def person(i, branch, ready=False):
    return {"id": f"m{i}", "branch": branch, "_m": {"review_status": "ready" if ready else "none"}}


def offer(mid, company, ctc=None, type_="full_time", status="accepted"):
    return {"membership_id": mid, "company": company, "ctc_lpa": ctc, "type": type_, "status": status}


def test_numbers_by_branch_and_company():
    people = [person(1, "CSE", True), person(2, "CSE"), person(3, "ECE", True), person(4, "ECE")]
    offers = [
        offer("m1", "Infosys", 4.0),
        offer("m1", "Zoho", 8.0),
        offer("m3", "infosys ", 5.0),
        offer("m2", "TCS", 3.5, status="declined"),  # declined: not counted
        offer("m4", "Zoho", None, type_="internship"),  # an internship doesn't place
        offer("x9", "Zoho", 20.0),  # not one of these students
    ]
    boards = [
        {"company": "Infosys", "stages": {"m1": "selected", "m2": "shortlisted", "m3": "interview"}},
        {"company": "Zoho", "stages": {"m1": "selected", "m4": "rejected", "x9": "selected"}},
    ]
    n = numbers(people, offers, boards)
    assert (n["joined"], n["ready"], n["shortlisted"], n["selected"], n["offers"], n["placed"]) == (4, 2, 4, 1, 4, 2)
    assert n["packages"] == {"count": 3, "highest": 8.0, "median": 5.0, "average": 5.67}
    cse, ece = n["byBranch"]
    assert (cse["name"], cse["joined"], cse["ready"], cse["shortlisted"], cse["selected"], cse["placed"]) == (
        "CSE", 2, 1, 2, 1, 1
    )  # fmt: skip
    assert (ece["joined"], ece["placed"], ece["shortlisted"]) == (2, 1, 2)
    by = {r["company"]: r for r in n["byCompany"]}
    assert set(by) == {"Infosys", "Zoho"}  # TCS: only a declined offer and no board
    assert (by["Infosys"]["offers"], by["Infosys"]["highest"], by["Infosys"]["median"]) == (2, 5.0, 4.5)
    assert (by["Zoho"]["offers"], by["Zoho"]["selected"], by["Zoho"]["shortlisted"]) == (2, 1, 2)
    assert n["attended"] is None
    # a drive: only its companies, in its order, with attendance
    d = numbers(people, offers, boards, {"tcs": {"m2"}, "infosys": {"m1", "m3"}}, ["TCS", "Infosys"])
    assert [r["company"] for r in d["byCompany"]] == ["TCS", "Infosys"]
    assert [r["attended"] for r in d["byCompany"]] == [1, 2] and d["attended"] == 3


def test_academic_year():
    assert academic_year(date(2026, 10, 28)) == 2026
    assert academic_year(date(2027, 5, 31)) == 2026
    assert academic_year(date(2026, 6, 1)) == 2026


async def test_year_and_drive_pdfs(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    ss = await students(make_client, outbox, 3)
    (s0, m0), (s1, m1), _ = ss
    await db[MEMBERSHIPS].update_one({"_id": m0}, {"$set": {"review_status": "ready"}})
    base = f"/api/org/{org['id']}"
    today = datetime.now(UTC).date().isoformat()
    for mid, comp, ctc in ((m0, "Infosys", 4.5), (m1, "TCS", 3.6)):
        r = await c.post(
            f"{base}/offers",
            json={"membershipId": mid, "company": comp, "ctcLpa": ctc, "status": "accepted", "offerDate": today},
        )
        assert r.status_code == 201, r.text
    await db[RECRUITER_INVITES].insert_one(
        {"_id": "inv1", "org_id": org["id"], "company": "Infosys", "created_at": datetime.now(UTC),
         "board": {m0: {"stage": "selected"}, m1: {"stage": "shortlisted"}}}
    )  # fmt: skip
    r = await c.get(f"{base}/report/year.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert r.headers["content-disposition"].startswith('attachment; filename="placement_report_20')
    t = text(r.content)
    assert "Placement report" in t and "Joined 3" in t and "Ready 1" in t and "Selected 1" in t and "Placed 2" in t
    assert "highest 4.5 LPA" in t and "Infosys" in t and "CSE" in t
    assert "NAAC" in t and "not an official NAAC or NIRF format" in t
    for leak in ("Student s0", "s0@example.com", "21A00", "@"):
        assert leak not in t, leak
    # a past year: no offers then
    old = text((await c.get(f"{base}/report/year.pdf?year=2019")).content)
    assert "Offers 0" in old and "2019–20" in old
    # the drive report: its companies and attendance
    _, d = await a_drive(c, org["id"], g["id"])
    r = await c.get(f"{base}/drives/{d['id']}/report.pdf")
    t = text(r.content)
    assert r.status_code == 200 and "Drive report" in t and "Attended 0" in t and "TCS" in t and "@" not in t
    acts = [a["data"].get("kind") async for a in db[AUDIT_LOG].find({"action": "placement_report"})]
    assert sorted(acts) == ["drive", "year", "year"]
    # offer tracking off: no packages in the report; on Free (no drives): 404
    await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"offers": False})
    t = text((await c.get(f"{base}/report/year.pdf")).content)
    assert "Packages" not in t and "LPA" not in t
    await owner.put(f"/api/admin/orgs/{org['id']}/billing/plan", json={"planId": "free"})
    await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"drives": False})
    assert (await c.get(f"{base}/report/year.pdf")).status_code == 404
    # another college can't
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(f"{base}/report/year.pdf")).status_code == 404
    assert (await other.get(f"/api/org/{o2['id']}/drives/{d['id']}/report.pdf")).status_code == 404
