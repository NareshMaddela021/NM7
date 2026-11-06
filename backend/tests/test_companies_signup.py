"""Phase 2 C1: company sign-up. GSTIN / CIN / LLPIN checks, email rules (throwaway, free, @asuraa.in, domain match,
mail server), the 5-step flow with email codes, team admins and what each role may do, trust levels and posting
limits, duplicate / same-address flags, individual recruiters (no ID numbers), locked details after approval."""

from datetime import timedelta

import pytest

from app.companies import checks
from app.companies.limits import posting_room
from app.companies.model import trust_of
from app.core.db import AUDIT_LOG, COMPANIES, JOBS
from app.core.time import now

GOOD_GSTIN = "27AAPFU0939F1ZV"


def err(r):
    return r.json()["error"]["code"]


def test_registration_numbers():
    assert checks.check_registration("gstin", GOOD_GSTIN) is None
    assert checks.check_registration("gstin", "29AAGCB7383J1Z4") is None
    assert checks.check_registration("gstin", " 27aapfu0939f1zv ") is None  # spaces and case don't matter
    assert "last character" in checks.check_registration("gstin", "27AAPFU0939F1ZW")
    assert "state code" in checks.check_registration("gstin", "45AAPFU0939F1ZV")
    assert "15 characters" in checks.check_registration("gstin", "27AAPFU0939F1Z")
    assert checks.check_registration("cin", "U72900TG2019PTC123456") is None
    assert checks.check_registration("cin", "X72900TG2019PTC123456")
    assert checks.check_registration("llpin", "AAB-1234") is None
    assert checks.check_registration("llpin", "AAB1234")


def test_email_rules():
    p = checks.email_problem
    assert p("hr@mailinator.com", company=False).startswith("Throwaway")
    assert p("me@gmail.com", company=False) is None  # the admin's own email may be Gmail
    assert "company email" in p("hr@gmail.com", company=True, website="acme.com")
    assert p("hr@acme.com", company=True, website="https://www.acme.com/about") is None
    assert p("jobs@careers.acme.co.in", company=True, website="acme.co.in") is None  # a subdomain is fine
    assert "acme.com" in p("hr@acme-jobs.com", company=True, website="acme.com")
    assert "can’t be used" in p("x@asuraa.in", company=False)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    async def mx(domain):
        return not domain.startswith("nomail")

    async def age(domain, client=None):
        return 30 if domain.startswith("fresh") else 2000

    monkeypatch.setattr(checks, "has_mx", mx)
    monkeypatch.setattr(checks, "domain_age_days", age)


def company(**over):
    body = {"details": {"legalName": "Acme Analytics Pvt Ltd", "website": "acme.com", "category": "startup",
                        "structure": "private_limited", "industry": "Software", "size": "11_50", "about": "We build dashboards."},
            "registration": {"kind": "gstin", "number": GOOD_GSTIN}, "phone": "98765 43210"}  # fmt: skip
    body.update(over)
    return body


async def sign_up(client, outbox, email="founder@gmail.com", **over):
    assert (await client.post("/api/company/signup/code", json={"email": email, "name": "Ravi Teja"})).json() == {
        "sent": True
    }
    r = await client.post("/api/company/signup/start", json={"email": email, "name": "Ravi Teja",
                                                            "code": outbox.last_code(email), "company": company(**over)})  # fmt: skip
    assert r.status_code == 201, r.text
    return r.json()["session"], r.json()["company"]


def H(s):
    return {"X-Recruiter-Account": s}


async def test_sign_up_flow_team_and_submit(client, outbox, db):
    # step 2 checks the number; step 3 the emails
    bad = await client.post(
        "/api/company/signup/check", json=company(registration={"kind": "gstin", "number": "27AAPFU0939F1ZW"})
    )
    assert bad.status_code == 422 and "last character" in bad.text
    assert (await client.post("/api/company/signup/check", json=company())).json() == {"ok": True}
    assert (
        err(await client.post("/api/company/signup/code", json={"email": "a@yopmail.com", "name": "Ravi"}))
        == "bad_email"
    )
    r = await client.post("/api/company/signup/start", json={"email": "founder@gmail.com", "name": "Ravi Teja", "code": "000000",
                                                            "company": company()})  # fmt: skip
    assert err(r) == "wrong_code"
    session, c = await sign_up(client, outbox)
    assert c["trust"] == "unverified" and c["review"]["state"] == "draft" and c["myRole"] == "main"
    assert (
        c["registration"] == {"kind": "gstin", "number": GOOD_GSTIN} and c["details"]["website"] == "https://acme.com"
    )
    cid = c["id"]
    # the company email: on the website's domain, not free, with a mail server
    for email, code in (("hr@gmail.com", "bad_email"), ("hr@acme-jobs.com", "bad_email")):
        assert (
            err(await client.post(f"/api/company/{cid}/company-email/code", json={"email": email}, headers=H(session)))
            == code
        )
    # can't submit before the company email is proven
    assert (
        err(await client.post(f"/api/company/{cid}/submit", json={"acceptTerms": True}, headers=H(session))) == "emails"
    )
    assert (
        await client.post(f"/api/company/{cid}/company-email/code", json={"email": "hr@acme.com"}, headers=H(session))
    ).json()["sent"]
    assert (
        err(await client.post(f"/api/company/{cid}/company-email/verify", json={"code": "000000"}, headers=H(session)))
        == "wrong_code"
    )
    r = await client.post(
        f"/api/company/{cid}/company-email/verify", json={"code": outbox.last_code("hr@acme.com")}, headers=H(session)
    )
    assert r.json()["trust"] == "basic" and r.json()["companyEmail"] == "hr@acme.com"
    # team: a posting-only admin and a view-only admin
    r = await client.post(
        f"/api/company/{cid}/team",
        json={"email": "Posts@acme.com", "name": "Anil", "role": "posting"},
        headers=H(session),
    )
    assert r.status_code == 201
    assert "team" in outbox.sent[-1].subject or "team" in outbox.sent[-1].text
    await client.post(f"/api/company/{cid}/team", json={"email": "viewer@acme.com", "role": "view"}, headers=H(session))
    assert (
        err(
            await client.post(
                f"/api/company/{cid}/team", json={"email": "posts@acme.com", "role": "view"}, headers=H(session)
            )
        )
        == "exists"
    )
    # the posting admin signs in with a code (the recruiter-account sign-in), and the invite becomes active
    await client.post("/api/recruiter-account/code", json={"email": "posts@acme.com"})
    s2 = (await client.post("/api/recruiter-account/session", json={"email": "posts@acme.com",
                                                                   "code": outbox.last_code("posts@acme.com")})).json()["session"]  # fmt: skip
    mine = (await client.get("/api/company/mine", headers=H(s2))).json()
    assert [x["myRole"] for x in mine["companies"]] == ["posting"]
    # sub-admins can't manage the team; nobody touches the main admin
    assert (
        err(await client.post(f"/api/company/{cid}/team", json={"email": "x@acme.com", "role": "view"}, headers=H(s2)))
        == "not_allowed"
    )
    assert err(await client.delete(f"/api/company/{cid}/team/founder@gmail.com", headers=H(s2))) == "not_allowed"
    assert err(await client.put(f"/api/company/{cid}", json=company(), headers=H(s2))) == "not_allowed"
    await client.put(f"/api/company/{cid}/team/posts@acme.com", json={"role": "full"}, headers=H(session))
    assert err(await client.delete(f"/api/company/{cid}/team/founder@gmail.com", headers=H(s2))) == "main_admin"
    assert (
        err(await client.put(f"/api/company/{cid}/team/founder@gmail.com", json={"role": "view"}, headers=H(s2)))
        == "main_admin"
    )
    r = await client.delete(f"/api/company/{cid}/team/viewer@acme.com", headers=H(s2))
    assert [m["email"] for m in r.json()["members"]] == ["founder@gmail.com", "posts@acme.com"]
    # someone else's company isn't visible
    s3, _ = await sign_up(client, outbox, email="other@gmail.com", registration={"kind": "cin", "number": "U72900TG2019PTC123456"},
                          phone="")  # fmt: skip
    assert (await client.get(f"/api/company/{cid}", headers=H(s3))).status_code == 404
    # submit (terms needed) → the review queue
    assert (
        err(await client.post(f"/api/company/{cid}/submit", json={"acceptTerms": False}, headers=H(session))) == "terms"
    )
    r = await client.post(f"/api/company/{cid}/submit", json={"acceptTerms": True}, headers=H(session))
    assert r.json()["review"]["state"] == "pending" and r.json()["termsAccepted"]
    assert (
        err(await client.post(f"/api/company/{cid}/submit", json={"acceptTerms": True}, headers=H(session)))
        == "already"
    )
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"target": cid})}
    assert {"company.signup", "company.email_verified", "company.team_add", "company.team_role", "company.team_remove",
            "company.submit"} <= actions  # fmt: skip


async def test_flags_duplicates_and_same_address(client, outbox, db):
    await sign_up(client, outbox, email="a1@gmail.com")
    _, c2 = await sign_up(client, outbox, email="a2@gmail.com")  # same GSTIN and phone as the first
    doc = await db[COMPANIES].find_one({"_id": c2["id"]})
    codes = {f["code"] for f in doc["flags"]}
    assert {"duplicate_registration", "duplicate_phone"} <= codes
    _, c3 = await sign_up(client, outbox, email="a3@gmail.com", phone="", registration={"kind": "llpin", "number": "AAB-1234"},
                          details={**company()["details"], "website": "fresh-startup.in"})  # fmt: skip
    doc = await db[COMPANIES].find_one({"_id": c3["id"]})
    codes = {f["code"] for f in doc["flags"]}
    assert "ip_burst" in codes and "new_domain" in codes and "duplicate_registration" not in codes
    _, c4 = await sign_up(client, outbox, email="a4@gmail.com", phone="", registration={"kind": "cin", "number": "U72900TG2019PTC654321"},
                          details={**company()["details"], "website": "nomail-co.com"})  # fmt: skip
    doc = await db[COMPANIES].find_one({"_id": c4["id"]})
    assert "no_mail" in {f["code"] for f in doc["flags"]}


async def test_individual_recruiter_and_trust_levels(client, outbox, db):
    ind = {"details": {"legalName": "Priya Sharma", "category": "individual", "website": "", "about": "Freelance IT recruiter"},
           "individual": {"linkedin": "linkedin.com/in/priya-sharma-hr", "declared": True}}  # fmt: skip
    r = await client.post(
        "/api/company/signup/check", json={**ind, "individual": {**ind["individual"], "declared": False}}
    )
    assert r.status_code == 422
    r = await client.post(
        "/api/company/signup/check",
        json={**ind, "individual": {"linkedin": "https://facebook.com/x", "declared": True}},
    )
    assert r.status_code == 422
    session, c = await sign_up(client, outbox, email="priya.hr@gmail.com", **ind)
    assert c["kind"] == "individual" and c["registration"] is None and c["trust"] == "basic"  # admin email is enough
    assert c["individual"]["linkedin"] == "https://linkedin.com/in/priya-sharma-hr"
    doc = await db[COMPANIES].find_one({"_id": c["id"]})
    assert "individual" in {f["code"] for f in doc["flags"]}
    assert not any(k in str(doc).lower() for k in ("aadhaar", "pan_number", "id_photo"))
    # posting room by trust level
    room = await posting_room(db, doc)
    assert (room["allowed"], room["limit"], room["period"]) == (True, 1, "week")
    await db[JOBS].insert_one({"_id": "j1", "company_id": c["id"], "status": "active", "created_at": now()})
    assert (await posting_room(db, doc))["allowed"] is False
    doc["review"], doc["verified_until"] = {"state": "approved"}, now() + timedelta(days=365)
    assert trust_of(doc) == "verified"
    room = await posting_room(db, doc)
    assert (room["allowed"], room["used"], room["limit"]) == (True, 1, 3)
    doc["verified_until"] = now() - timedelta(days=1)  # 12 months on: back to Basic until re-checked
    assert trust_of(doc) == "basic"
    doc["review"] = {"state": "blocked"}
    assert trust_of(doc) == "blocked" and (await posting_room(db, doc))["allowed"] is False
    assert trust_of({"emails": {}, "review": {"state": "draft"}}) == "unverified"


async def test_details_locked_after_approval(client, outbox, db):
    session, c = await sign_up(client, outbox)
    r = await client.put(
        f"/api/company/{c['id']}",
        json=company(details={**company()["details"], "about": "New about"}),
        headers=H(session),
    )
    assert r.json()["details"]["about"] == "New about"
    await db[COMPANIES].update_one(
        {"_id": c["id"]}, {"$set": {"review": {"state": "approved"}, "verified_until": now() + timedelta(days=30)}}
    )
    assert err(await client.put(f"/api/company/{c['id']}", json=company(), headers=H(session))) == "locked"
    await db[COMPANIES].update_one({"_id": c["id"]}, {"$set": {"review": {"state": "blocked"}}})
    assert err(await client.get(f"/api/company/{c['id']}", headers=H(session))) == "blocked"
