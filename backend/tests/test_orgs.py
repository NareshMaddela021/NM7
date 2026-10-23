"""Nm7 for Organizations (Phase 1): join codes, consent, leaving, the free-downloads rule and the super-admin's
shared resumes (filters, CSV, export jobs, printed status, audit log)."""

import csv
import io
from datetime import timedelta

import pytest

from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import AUDIT_LOG, MEMBERSHIPS, ORG_GROUPS, RATE_EVENTS, RESUMES, USERS
from app.core.exports import csv_safe
from app.core.time import IST, now
from app.orgs.service import completeness, file_name, holds_id_number, unique_names
from tests.conftest import signup

RESUME = {
    "personal": {"name": "Asha Rao", "phone": "+91 98765 43210", "email": "asha@example.com"},
    "edu": [{"institution": "JNTU Anantapur", "degree": "B.Tech"}],
    "skillGroups": [{"label": "Skills", "value": "Python, SQL"}],
    "exp": [{"company": "Infosys", "role": "Intern"}, {"company": "Hidden Co", "role": "x", "off": True}],
}
FIELDS = [
    {"key": "roll", "label": "Roll number", "type": "text", "required": True},
    {"key": "branch", "label": "Branch", "type": "select", "options": ["CSE", "ECE"], "required": True},
]


def err(r):
    return r.json()["error"]["code"]


def today(days=0):
    return (now().astimezone(IST).date() + timedelta(days=days)).isoformat()


async def setup_group(owner, **group):
    o = await owner.post("/api/admin/orgs", json={"name": "JNTU Anantapur", "type": "college", "city": "Anantapur"})
    assert o.status_code == 201, o.text
    body = {"name": "B.Tech 2026 placements", "code": "JNTUA26", "customFields": FIELDS, **group}
    g = await owner.post(f"/api/admin/orgs/{o.json()['id']}/groups", json=body)
    assert g.status_code == 201, g.text
    return o.json(), g.json()


async def member(make_client, outbox, email="asha@example.com", name="Asha Rao", data=None, key="r1"):
    c = make_client()
    me = await signup(c, outbox, email, name=name)
    r = await c.post("/api/me/resumes", json={"id": key, "name": "Main", "data": data or RESUME})
    assert r.status_code == 201, r.text
    return c, me


async def join(c, code="JNTUA26", roll="21A01", branch="CSE", consent=True, resume="r1"):
    return await c.post(
        "/api/me/groups/join",
        json={"code": code, "consent": consent, "fields": {"roll": roll, "branch": branch}, "resumeId": resume},
    )


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


# ---------- join ----------


async def test_join_link_shows_org_group_and_consent_text(owner, client):
    await setup_group(owner)
    r = await client.get("/api/public/join/jntua26")
    assert r.status_code == 200
    j = r.json()
    assert j["org"]["name"] == "JNTU Anantapur" and j["group"]["name"] == "B.Tech 2026 placements"
    assert j["consentText"] == (
        "My resume will be shared with JNTU Anantapur and Nm7 for printing and placement support."
    )
    assert [f["key"] for f in j["group"]["customFields"]] == ["roll", "branch"]
    assert err(await client.get("/api/public/join/NOPE99")) == "invalid_code"


async def test_join_valid_with_consent_and_fields(owner, make_client, outbox, db):
    await setup_group(owner)
    c, me = await member(make_client, outbox)
    r = await join(c, code="jntua26")
    assert r.status_code == 201, r.text
    m = r.json()
    assert (
        m["orgName"] == "JNTU Anantapur" and m["resumeId"] == "r1" and m["fields"] == {"roll": "21A01", "branch": "CSE"}
    )
    doc = await db[MEMBERSHIPS].find_one({"user_id": me["id"]})
    assert doc["consent"]["given"] is True and "ip" not in doc["consent"]
    assert doc["consent"]["text"].startswith("My resume will be shared with JNTU Anantapur")
    assert [g["code"] for g in (await c.get("/api/me/groups")).json()] == ["JNTUA26"]
    # joining twice keeps one membership
    assert (await join(c, roll="21A02")).status_code == 201
    assert await db[MEMBERSHIPS].count_documents({}) == 1


async def test_join_invalid_expired_not_started_inactive_full(owner, make_client, outbox):
    _, g = await setup_group(owner)
    c, _ = await member(make_client, outbox)
    r = await join(c, code="WRONG1")
    assert r.status_code == 404 and err(r) == "invalid_code"

    await owner.patch(f"/api/admin/groups/{g['id']}", json={"endsOn": today(-1)})
    r = await join(c)
    assert r.status_code == 410 and err(r) == "group_expired"
    assert err(await c.get("/api/public/join/JNTUA26")) == "group_expired"

    await owner.patch(f"/api/admin/groups/{g['id']}", json={"startsOn": today(2), "endsOn": None})
    assert err(await join(c)) == "group_not_started"

    await owner.patch(f"/api/admin/groups/{g['id']}", json={"startsOn": None, "settings": {"active": False}})
    r = await join(c)
    assert r.status_code == 410 and err(r) == "group_inactive"

    await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"active": True}, "memberLimit": 1})
    assert (await join(c)).status_code == 201
    other, _ = await member(make_client, outbox, "bala@example.com", "Bala K")
    r = await join(other, roll="21A09")
    assert r.status_code == 409 and err(r) == "group_full"
    assert (await join(c)).status_code == 201  # a member updating answers isn't blocked by the limit


async def test_consent_required_and_fields_checked(owner, make_client, outbox, db):
    await setup_group(owner)
    c, _ = await member(make_client, outbox)
    r = await join(c, consent=False)
    assert r.status_code == 400 and err(r) == "consent_required"
    r = await join(c, roll="")
    assert r.status_code == 400 and err(r) == "field_required"
    r = await join(c, branch="MECH")
    assert r.status_code == 400 and err(r) == "field_invalid"
    r = await join(c, roll="2345 6789 0123")  # looks like an Aadhaar number: never stored
    assert r.status_code == 400 and err(r) == "id_number"
    r = await join(c, resume="nope")
    assert r.status_code == 404 and err(r) == "resume_not_found"
    assert await db[MEMBERSHIPS].count_documents({}) == 0


async def test_join_needs_sign_in_and_is_rate_limited(owner, client, make_client, outbox, db):
    await setup_group(owner)
    assert (await join(client)).status_code == 401
    c, me = await member(make_client, outbox)
    key = rate_limit.stored(f"join:{me['id']}")
    await db[RATE_EVENTS].insert_many([{"key": key, "at": now()} for _ in range(10)])
    assert (await join(c)).status_code == 429


async def test_leave_group_and_change_shared_resume(owner, make_client, outbox, db):
    await setup_group(owner)
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    await c.post("/api/me/resumes", json={"id": "r2", "name": "Second", "data": RESUME})
    r = await c.patch(f"/api/me/groups/{m['id']}", json={"resumeId": "r2"})
    assert r.status_code == 200 and r.json()["resumeId"] == "r2"
    assert (await c.patch(f"/api/me/groups/{m['id']}", json={"resumeId": "zzz"})).status_code == 404

    assert (await owner.get("/api/admin/shared-resumes")).json()["total"] == 1
    assert (await c.post(f"/api/me/groups/{m['id']}/leave")).status_code == 204
    assert (await c.get("/api/me/groups")).json() == []
    assert (await db[MEMBERSHIPS].find_one({}))["left_at"] is not None
    assert (await owner.get("/api/admin/shared-resumes")).json()["total"] == 0
    assert (await c.post(f"/api/me/groups/{m['id']}/leave")).status_code == 404
    # rejoining brings them back
    assert (await join(c)).status_code == 201
    assert (await owner.get("/api/admin/shared-resumes")).json()["total"] == 1


# ---------- downloads ----------


async def test_entitlement_reason_group_only_when_the_group_pays(owner, make_client, outbox):
    assert get_settings().razorpay_key_id  # payments are on in tests
    _, g = await setup_group(owner)
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    assert m["downloadsFree"] is False
    assert (await c.get("/api/me/entitlements")).json()["reason"] == "unpaid"

    await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"membersDownloadFree": True, "active": True}})
    e = (await c.get("/api/me/entitlements")).json()
    assert e["canDownload"] is True and e["reason"] == "group"
    assert (await c.post("/api/me/exports", json={"format": "pdf"})).json()["reason"] == "group"

    await c.post(f"/api/me/groups/{m['id']}/leave")
    assert (await c.get("/api/me/entitlements")).json()["reason"] == "unpaid"


# ---------- admin ----------


async def test_admin_endpoints_are_super_admin_only(owner, admin_client, make_client, outbox):
    org, g = await setup_group(owner)
    c, _ = await member(make_client, outbox)
    m = (await join(c)).json()
    ops = await admin_client("ops")
    calls = [
        ("get", "/api/admin/orgs", None),
        ("post", "/api/admin/orgs", {"name": "X College", "type": "college"}),
        ("get", f"/api/admin/orgs/{org['id']}", None),
        ("post", f"/api/admin/orgs/{org['id']}/groups", {"name": "G1"}),
        ("patch", f"/api/admin/groups/{g['id']}", {"name": "G2"}),
        ("get", "/api/admin/shared-resumes", None),
        ("get", f"/api/admin/shared-resumes/{m['id']}", None),
        ("post", "/api/admin/shared-resumes/export.csv", {}),
        ("post", "/api/admin/shared-resumes/exports", {"kind": "print_bulk"}),
        ("get", "/api/admin/org-audit", None),
    ]
    for who, status in ((c, 403), (ops, 403), (make_client(), 401)):
        for method, url, body in calls:
            r = await getattr(who, method)(url, **({"json": body} if body is not None else {}))
            assert r.status_code == status, (url, r.status_code)


async def test_orgs_and_groups_crud_codes_and_audit(owner, db):
    org, g = await setup_group(owner, code=None)
    assert g["code"] == f"JA{now().astimezone(IST).year % 100:02d}"  # initials + year
    g2 = (await owner.post(f"/api/admin/orgs/{org['id']}/groups", json={"name": "MBA"})).json()
    assert g2["code"] != g["code"]
    r = await owner.patch(f"/api/admin/groups/{g2['id']}", json={"code": g["code"].lower()})
    assert r.status_code == 409 and err(r) == "code_taken"
    r = await owner.patch(f"/api/admin/groups/{g2['id']}", json={"code": "MB"})
    assert r.status_code == 400 and err(r) == "bad_code"
    r = await owner.patch(f"/api/admin/groups/{g2['id']}", json={"code": "mba-2026"})
    assert r.json()["code"] == "MBA2026"
    r = await owner.post(
        f"/api/admin/orgs/{org['id']}/groups",
        json={"name": "Bad", "customFields": [{"key": "aadhaar", "label": "Aadhaar number"}]},
    )
    assert r.status_code == 400 and err(r) == "id_field"
    r = await owner.post(
        f"/api/admin/orgs/{org['id']}/groups", json={"name": "Bad", "startsOn": today(3), "endsOn": today(1)}
    )
    assert err(r) == "bad_dates"
    r = await owner.patch(f"/api/admin/orgs/{org['id']}", json={"city": "Kurnool"})
    assert r.json()["city"] == "Kurnool" and len(r.json()["groupList"]) == 2
    orgs = (await owner.get("/api/admin/orgs")).json()
    assert orgs[0]["groups"] == 2
    actions = [e["action"] async for e in db[AUDIT_LOG].find().sort("_id", 1)]
    assert actions.count("org_create") == 1 and actions.count("group_create") == 2
    assert "group_update" in actions and "org_update" in actions


async def joined_three(owner, make_client, outbox, db):
    org, g = await setup_group(owner)
    people = [
        ("asha@example.com", "Asha Rao", "21A03", "CSE", RESUME),
        ("bala@example.com", "Bala K", "21A01", "ECE", {"personal": {"name": "Bala K", "email": "bala@example.com"}}),
        ("chitra@example.com", "=Chitra", "21A02", "CSE", {**RESUME, "personal": {"name": "=Chitra"}}),
    ]
    ids = []
    for email, name, roll, branch, data in people:
        c, me = await member(make_client, outbox, email, name, data)
        r = await join(c, roll=roll, branch=branch)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return org, g, ids


async def test_shared_resumes_filters_sorting_pagination(owner, make_client, outbox, db):
    org, g, ids = await joined_three(owner, make_client, outbox, db)
    j = (await owner.get("/api/admin/shared-resumes", params={"sort": "roll", "dir": "asc"})).json()
    assert j["total"] == 3 and [r["fields"]["roll"] for r in j["rows"]] == ["21A01", "21A02", "21A03"]
    assert [f["key"] for f in j["fields"]] == ["roll", "branch"]
    asha = next(r for r in j["rows"] if r["email"] == "asha@example.com")
    assert asha["orgName"] == "JNTU Anantapur" and asha["groupName"] == "B.Tech 2026 placements"
    assert asha["completeness"] == 100 and asha["resumeTitle"] == "Main" and asha["printedAt"] is None
    bala = next(r for r in j["rows"] if r["email"] == "bala@example.com")
    assert bala["completeness"] == 25 and set(bala["missing"]) == {"education", "skills", "experience"}

    page2 = (
        await owner.get("/api/admin/shared-resumes", params={"sort": "roll", "dir": "asc", "perPage": 2, "page": 2})
    ).json()
    assert page2["total"] == 3 and [r["fields"]["roll"] for r in page2["rows"]] == ["21A03"]
    q = {"fieldKey": "branch", "fieldValue": "CSE"}
    assert (await owner.get("/api/admin/shared-resumes", params=q)).json()["total"] == 2
    assert (await owner.get("/api/admin/shared-resumes", params={"incomplete": "true"})).json()["total"] == 2
    assert (await owner.get("/api/admin/shared-resumes", params={"q": "21a02"})).json()["total"] == 1
    assert (await owner.get("/api/admin/shared-resumes", params={"q": "BALA@"})).json()["total"] == 1
    assert (await owner.get("/api/admin/shared-resumes", params={"group": g["id"]})).json()["total"] == 3
    assert (await owner.get("/api/admin/shared-resumes", params={"org": "nope"})).json()["total"] == 0
    assert (await owner.get("/api/admin/shared-resumes", params={"joinedFrom": today(1)})).json()["total"] == 0
    assert (await owner.get("/api/admin/shared-resumes", params={"joinedFrom": today(), "joinedTo": today()})).json()[
        "total"
    ] == 3
    assert (await owner.get("/api/admin/shared-resumes", params={"updatedTo": today(-1)})).json()["total"] == 0
    assert (await owner.get("/api/admin/shared-resumes", params={"joinedFrom": "16/10/2026"})).status_code == 400
    names = [
        r["name"]
        for r in (await owner.get("/api/admin/shared-resumes", params={"sort": "name", "dir": "desc"})).json()["rows"]
    ]
    assert names == sorted(names, key=str.lower, reverse=True)


async def test_view_hides_hidden_entries_and_is_audited(owner, make_client, outbox, db):
    _, _, ids = await joined_three(owner, make_client, outbox, db)
    r = await owner.get(f"/api/admin/shared-resumes/{ids[0]}")
    assert r.status_code == 200
    assert [e["company"] for e in r.json()["data"]["exp"]] == ["Infosys"]
    e = await db[AUDIT_LOG].find_one({"action": "view"})
    assert e["target"] == ids[0]
    assert (await owner.get("/api/admin/shared-resumes/nope")).status_code == 404


async def test_deleted_resume_or_disabled_account_disappears(owner, make_client, outbox, db):
    _, _, ids = await joined_three(owner, make_client, outbox, db)
    m0 = await db[MEMBERSHIPS].find_one({"_id": ids[0]})
    await db[RESUMES].delete_one({"user_id": m0["user_id"], "key": "r1"})
    m1 = await db[MEMBERSHIPS].find_one({"_id": ids[1]})
    await db[USERS].update_one({"_id": m1["user_id"]}, {"$set": {"disabled_at": now()}})
    j = (await owner.get("/api/admin/shared-resumes")).json()
    assert [r["membershipId"] for r in j["rows"]] == [ids[2]]


async def test_csv_contents_safe_and_without_id_numbers(owner, make_client, outbox, db):
    await joined_three(owner, make_client, outbox, db)
    r = await owner.post("/api/admin/shared-resumes/export.csv?sort=roll", json={})
    assert r.status_code == 200 and r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM, so Excel reads every script correctly
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    head = "Name,Email,Phone,Organization,Group,Roll number,Branch,Completeness %,Approval,Review,Last updated,Printed"
    assert rows[0] == head.split(",")
    assert [x[5] for x in rows[1:]] == ["21A01", "21A02", "21A03"]
    assert rows[2][0] == "'=Chitra"  # no spreadsheet formulas
    assert rows[3][:7] == [
        "Asha Rao",
        "asha@example.com",
        "'+91 98765 43210",
        "JNTU Anantapur",
        "B.Tech 2026 placements",
        "21A03",
        "CSE",
    ]
    assert rows[3][7:10] == ["100", "Approved", ""] and rows[3][11] == "No"
    assert not any(holds_id_number(cell) for row in rows for cell in row)
    assert "user_id" not in r.text and "membership" not in r.text.lower()
    e = await db[AUDIT_LOG].find_one({"action": "export_csv"})
    assert e["data"]["count"] == 3
    filtered = await owner.post(
        "/api/admin/shared-resumes/export.csv", json={"fieldKey": "branch", "fieldValue": "ECE"}
    )
    assert len(list(csv.reader(io.StringIO(filtered.text)))) == 2


async def test_csv_has_bom_and_keeps_telugu_names(owner, make_client, outbox, db):
    await setup_group(owner)
    people = [
        ("ramu@example.com", "రాము కుమార్", "21A01"),
        ("neha@example.com", "नेहा शर्मा", "21A02"),
    ]
    for email, name, roll in people:
        c, _ = await member(make_client, outbox, email, name, {**RESUME, "personal": {"name": name}})
        assert (await join(c, roll=roll)).status_code == 201
    r = await owner.post("/api/admin/shared-resumes/export.csv?sort=roll", json={})
    assert r.status_code == 200 and r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.content[:3] == b"\xef\xbb\xbf" and r.content.count(b"\xef\xbb\xbf") == 1
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][0] == "Name"  # the BOM is not part of the first header
    assert [x[0] for x in rows[1:]] == ["రాము కుమార్", "नेहा शर्मा"]
    assert "రాము కుమార్".encode() in r.content
    # the formula guard also covers the tab and carriage-return tricks (sign-up strips them from names, so direct)
    assert [csv_safe(v) for v in ("\tcmd|' /C calc'!A0", "\r=1+1", "=SUM(A1)", "+1", "-1", "@x", "", "Asha", 7)] == [
        "'\tcmd|' /C calc'!A0",
        "'\r=1+1",
        "'=SUM(A1)",
        "'+1",
        "'-1",
        "'@x",
        "",
        "Asha",
        7,
    ]


async def test_zip_names_unique_for_indic_names(owner, make_client, outbox, db):
    await setup_group(owner)
    people = [
        ("ramu1@example.com", "రాము కుమార్", "-"),
        ("ramu2@example.com", "రాము కుమార్", "-"),
        ("dots@example.com", "...", "-"),  # no letters at all: the membership id names the file
    ]
    ids = []
    for email, name, roll in people:
        c, _ = await member(make_client, outbox, email, name, {**RESUME, "personal": {"name": name}})
        r = await join(c, roll=roll)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    r = await owner.post("/api/admin/shared-resumes/exports", json={"kind": "export_zip", "sort": "name"})
    assert r.status_code == 201, r.text
    names = {i["membershipId"]: i["fileName"] for i in r.json()["items"]}
    assert sorted(names[i] for i in ids[:2]) == ["రాము_కుమార్_Resume.pdf", "రాము_కుమార్_Resume_2.pdf"]
    assert names[ids[2]] == f"{ids[2][:8]}_Resume.pdf"
    assert len(set(names.values())) == 3


async def test_export_job_zip_names_batches_and_printed_status(owner, make_client, outbox, db):
    _, g, ids = await joined_three(owner, make_client, outbox, db)
    r = await owner.post("/api/admin/shared-resumes/exports", json={"kind": "export_zip", "sort": "roll"})
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["total"] == 3
    assert [i["fileName"] for i in job["items"]] == [
        "21A01_Bala_K_Resume.pdf",
        "21A02_Chitra_Resume.pdf",
        "21A03_Asha_Rao_Resume.pdf",
    ]
    assert job["cover"] == {
        "orgs": ["JNTU Anantapur"],
        "groups": ["JNTU Anantapur · B.Tech 2026 placements"],
        "count": 3,
    }
    batch = (
        await owner.get(f"/api/admin/shared-resumes/exports/{job['job']}/data", params={"offset": 2, "limit": 5})
    ).json()
    assert len(batch) == 1 and batch[0]["membershipId"] == job["items"][2]["membershipId"]
    assert [e["company"] for e in batch[0]["data"]["exp"]] == ["Infosys"]  # hidden entries stay hidden
    assert (
        await owner.get(f"/api/admin/shared-resumes/exports/{job['job']}/data", params={"limit": 26})
    ).status_code == 422

    assert (await owner.get("/api/admin/shared-resumes", params={"notPrinted": "true"})).json()["total"] == 3
    done = (await owner.post(f"/api/admin/shared-resumes/exports/{job['job']}/done")).json()
    assert done["marked"] == 3
    again = (await owner.post(f"/api/admin/shared-resumes/exports/{job['job']}/done")).json()
    assert again["marked"] == 0  # once per job
    rows = (await owner.get("/api/admin/shared-resumes")).json()["rows"]
    assert all(r["printedAt"] and r["printedCount"] == 1 for r in rows)
    assert (await owner.get("/api/admin/shared-resumes", params={"notPrinted": "true"})).json()["total"] == 0
    e = await db[AUDIT_LOG].find_one({"action": "export_zip"})
    assert e["data"]["count"] == 3 and e["target"] == job["job"]


async def test_combined_print_of_a_selection_and_downloads_dont_mark_printed(owner, make_client, outbox, db):
    _, _, ids = await joined_three(owner, make_client, outbox, db)
    r = await owner.post(
        "/api/admin/shared-resumes/exports", json={"kind": "print_bulk", "ids": ids[:2], "sort": "name"}
    )
    job = r.json()
    assert job["total"] == 2 and {i["membershipId"] for i in job["items"]} == set(ids[:2])
    await owner.post(f"/api/admin/shared-resumes/exports/{job['job']}/done")
    printed = {m["_id"]: m.get("printed_count", 0) async for m in db[MEMBERSHIPS].find()}
    assert printed == {ids[0]: 1, ids[1]: 1, ids[2]: 0}
    assert await db[AUDIT_LOG].count_documents({"action": "print_bulk"}) == 1

    d = (await owner.post("/api/admin/shared-resumes/exports", json={"kind": "download", "ids": [ids[2]]})).json()
    assert (await owner.post(f"/api/admin/shared-resumes/exports/{d['job']}/done")).json()["marked"] == 0
    assert await db[AUDIT_LOG].count_documents({"action": "download"}) == 1
    r = await owner.post("/api/admin/shared-resumes/exports", json={"kind": "print", "ids": ["nope"]})
    assert r.status_code == 400 and err(r) == "nothing_selected"
    other = await make_client().get(f"/api/admin/shared-resumes/exports/{job['job']}/data")
    assert other.status_code == 401
    audit = (await owner.get("/api/admin/org-audit")).json()
    assert {"print_bulk", "download", "group_create", "org_create"} <= {a["action"] for a in audit}


async def test_exports_are_rate_limited(owner, db):
    me = await db[USERS].find_one({"role": "admin"})
    key = rate_limit.stored(f"org-export:{me['_id']}")
    await db[RATE_EVENTS].insert_many([{"key": key, "at": now()} for _ in range(30)])
    assert (await owner.post("/api/admin/shared-resumes/export.csv", json={})).status_code == 429


async def test_id_numbers_never_reach_exports_or_recruiters(owner, make_client, outbox, db):
    """The second lock: a resume that holds ID numbers in the database (saved before the save-time scrub, or
    written some other way) is shown to organizations and recruiters without them."""
    from tests.test_orgs_kiosk import features
    from tests.test_orgs_recruiter import make_link, opted_in

    org, g = await setup_group(owner)
    await features(owner, org["id"], recruiter_links=True)
    await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    c, m = await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    dirty = {
        "data.summary": "Clerk. Aadhaar 2345 6789 0123, PAN ABCPE1234F, call 9876543210.",
        "data.exp.0.role": "Intern (passport A1234567)",
        "data.custom": [{"title": "IDs", "items": [{"value": "2345 6789 ABCPE1234F 0123"}, {"value": "fine"}]}],
        "data.pinfo": {"father": "R Rao", "address": "A/c 123456789012, 1 Main Road"},
    }
    await db[RESUMES].update_one({"key": "r1"}, {"$set": dirty})
    clean_summary = "Clerk. Aadhaar, PAN, call 9876543210."

    def check(d):
        assert d["summary"] == clean_summary and d["exp"][0]["role"] == "Intern (passport)"
        assert d["custom"][0]["items"] == [{"value": ""}, {"value": "fine"}]
        s = str(d)
        assert not any(x in s for x in ("2345", "ABCPE", "A1234567", "123456789012"))

    check((await owner.get(f"/api/admin/shared-resumes/{m['id']}")).json()["data"])
    job = (await owner.post("/api/admin/shared-resumes/exports", json={"kind": "export_zip"})).json()
    batch = (await owner.get(f"/api/admin/shared-resumes/exports/{job['job']}/data")).json()
    check(batch[0]["data"])
    assert batch[0]["data"]["pinfo"] == {"father": "R Rao", "address": "A/c, 1 Main Road"}
    _, token = await make_link(owner, org["id"], includeContact=True)
    rec = make_client()
    cid = (await rec.get(f"/api/recruit/{token}")).json()["candidates"][0]["id"]
    one = (await rec.get(f"/api/recruit/{token}/candidates/{cid}")).json()["data"]
    check(one)
    assert one["pinfo"] == {"father": "R Rao", "address": ""}  # recruiters: a labelled line goes whole
    items = (await rec.post(f"/api/recruit/{token}/downloads", json={})).json()["items"]
    check(items[0]["data"])
    csv_text = (await owner.post("/api/admin/shared-resumes/export.csv", json={})).text
    assert "2345" not in csv_text and "ABCPE" not in csv_text


async def test_left_or_unconsented_members_are_never_shown(owner, make_client, outbox, db):
    _, _, ids = await joined_three(owner, make_client, outbox, db)
    await db[MEMBERSHIPS].update_one({"_id": ids[0]}, {"$set": {"consent.given": False}})
    await db[MEMBERSHIPS].update_one({"_id": ids[1]}, {"$set": {"left_at": now()}})
    assert (await owner.get("/api/admin/shared-resumes")).json()["total"] == 1
    assert (await owner.get(f"/api/admin/shared-resumes/{ids[1]}")).status_code == 404
    r = await owner.post("/api/admin/shared-resumes/exports", json={"kind": "print_bulk", "ids": ids[:2]})
    assert r.status_code == 400


async def test_pages_is_saved_without_touching_last_updated(client, outbox, db):
    await signup(client, outbox)
    await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": RESUME})
    before = (await db[RESUMES].find_one({"key": "r1"}))["updated_at"]
    r = await client.patch("/api/me/resumes/r1", json={"pages": 2})
    assert r.status_code == 200 and r.json()["pages"] == 2
    assert (await db[RESUMES].find_one({"key": "r1"}))["updated_at"] == before
    assert (await client.patch("/api/me/resumes/r1", json={"pages": 0})).status_code == 422


# ---------- helpers ----------


def test_file_names_and_completeness():
    assert file_name("21/A-01", "Asha  Rao!") == "21_A_01_Asha_Rao_Resume.pdf"
    assert file_name(None, "Bala") == "Bala_Resume.pdf"
    assert file_name("", "") == "Resume.pdf"
    assert file_name("", "", "mem_8f2k1x9qZ") == "mem_8f2k_Resume.pdf"  # nothing usable: the membership id
    assert file_name("", "రాము కుమార్") == "రాము_కుమార్_Resume.pdf"  # vowel signs and viramas stay
    assert file_name("21A01", "नेहा शर्मा") == "21A01_नेहा_शर्मा_Resume.pdf"
    assert file_name("", "ಸಾಫ್ಟ್\u200cವೇರ್ ಕುಮಾರ್") == "ಸಾಫ್ಟ್\u200cವೇರ್_ಕುಮಾರ್_Resume.pdf"  # ZWNJ inside a word
    assert file_name("", "../../etc/passwd") == "etc_passwd_Resume.pdf"
    assert unique_names(["A_Resume.pdf", "a_resume.pdf", "B_Resume.pdf", "same.pdf", "same.pdf", "same.pdf"]) == [
        "A_Resume.pdf",
        "a_resume_2.pdf",
        "B_Resume.pdf",
        "same.pdf",
        "same_2.pdf",
        "same_3.pdf",
    ]
    assert completeness(RESUME)[0] == 100 and completeness({})[0] == 0
    assert holds_id_number("2345 6789 0123") and holds_id_number("ABCDE1234F") and not holds_id_number("21A01")


async def test_group_ids_never_leak_from_join_info(owner, client, db):
    await setup_group(owner)
    j = (await client.get("/api/public/join/JNTUA26")).json()
    g = await db[ORG_GROUPS].find_one({})
    assert g["_id"] not in str(j) and g["org_id"] not in str(j)


async def test_csv_and_list_names_never_carry_bold_markers(owner, make_client, outbox, db):
    await joined_three(owner, make_client, outbox, db)
    await db[RESUMES].update_many({"data.personal.name": "Bala K"}, {"$set": {"data.personal.name": "**Bala** K"}})
    r = await owner.post("/api/admin/shared-resumes/export.csv?sort=roll", json={})
    assert "**" not in r.content.decode("utf-8-sig")
    assert list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))[1][0] == "Bala K"
    assert "**" not in str((await owner.get("/api/admin/shared-resumes")).json()["rows"])
