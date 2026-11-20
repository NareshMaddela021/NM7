# ruff: noqa: E501
"""Vetting Trust T4: employer business verification, the "Verified employer" badge, the "Never pay" promise and fraud
reports. Format checks first (GSTIN check character, CIN, Udyam), the test provider (active → badge; cancelled /
another name / not found → a person, never a rejection), the re-check dropping the badge, the badge only where the
Trust switch allows (public pages unchanged while OFF), fraud reports (N independent reports pause a job, never the
company; no reporter identity to the company; rate limit), Admin (keys set / not set, review, fraud actions), retention
and the Surepass adapter against a fake vendor."""

from datetime import timedelta

import httpx
import pytest

from app.core.config import get_settings
from app.core.db import AUDIT_LOG, COMPANIES, JOB_REPORTS, JOBS, TRUST_EMPLOYER, TRUST_EMPLOYER_LOOKUPS
from app.core.security import decrypt
from app.core.time import now
from app.trust import retention as R
from app.trust.employer import formats as F
from app.trust.employer import service as S
from app.trust.employer import surepass
from tests.conftest import signup
from tests.test_companies_apply import company_job
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import GOOD_GSTIN, H, no_network  # noqa: F401
from tests.test_trust_t3 import everything

URL = "/api/company/{cid}/trust/employer"
CIN = "U72900TG2019PTC123456"
UDYAM = "UDYAM-TS-02-0001234"


def gstin(first14: str) -> str:
    from app.companies.checks import gstin_check_char

    return first14 + gstin_check_char(first14)


async def make_tester(db, email: str) -> None:
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)


async def company(client, outbox, db, *, test=True, name=None):
    session, cid, job = await company_job(client, outbox, db)
    if test:
        await make_tester(db, "founder@gmail.com")
    if name:
        await db[COMPANIES].update_one({"_id": cid}, {"$set": {"details.legal_name": name}})
    return session, cid, job


async def verify(client, session, cid, kind="gstin", number=GOOD_GSTIN, agree=True):
    return await client.post(
        URL.format(cid=cid), json={"kind": kind, "number": number, "agree": agree}, headers=H(session)
    )


async def candidate(make_client, outbox, db, email, test=True, ip="10.0.0.1"):
    c = make_client()
    c.headers["X-Forwarded-For"] = ip
    me = await signup(c, outbox, email=email, name="Asha Rao")
    if test:
        await make_tester(db, email)
    return c, me["id"]


# --- formats -------------------------------------------------------------------------------------------------------------


def test_formats_checked_locally_first():
    assert F.problem("gstin", GOOD_GSTIN) is None and F.problem("gstin", " 27aapfu0939f1zv ") is None
    assert "last character" in F.problem("gstin", "27AAPFU0939F1ZW")  # the check character
    assert "state code" in F.problem("gstin", "45AAPFU0939F1ZV") and "15 characters" in F.problem(
        "gstin", "27AAPFU0939F1Z"
    )
    assert (
        F.problem("cin", CIN) is None
        and F.problem("cin", "X72900TG2019PTC123456")
        and F.problem("cin", "U72900TG2019PTC12345")
    )
    assert F.problem("udyam", UDYAM) is None and F.problem("udyam", "udyam-ts-02-0001234") is None
    assert F.problem("udyam", "UDYAMTS020001234") is None  # typed without the dashes
    assert "UDYAM-TS-02-0001234" in F.problem("udyam", "UDYAM-TS-2-0001234") and "state code" in F.problem(
        "udyam", "UDYAM-QQ-02-0001234"
    )
    assert F.problem("pan", "ABCDE1234F")
    assert (
        F.state_of("gstin", GOOD_GSTIN) == "Maharashtra"
        and F.state_of("cin", CIN) == "Telangana"
        and F.state_of("udyam", UDYAM) == "Telangana"
    )
    m = F.mask("gstin", GOOD_GSTIN)
    assert m.startswith("27") and m.endswith("1ZV") and "AAPFU0939" not in m and len(m) == 15
    assert F.mask("udyam", UDYAM) == "UDYAM-TS-02-•••1234" and "123456" not in F.mask("cin", CIN)


def test_name_and_domain_matching():
    assert S.name_score("Acme Analytics Pvt Ltd", "ACME ANALYTICS PRIVATE LIMITED") == 100
    assert S.name_score("Acme Analytics", "Acme Analytics (OPC) Private Limited") == 100
    assert S.name_score("M/s. Sri Lakshmi Traders", "SRI LAKSHMI TRADERS") == 100
    assert S.name_score("Acme Analytics Pvt Ltd", "Sunrise Traders and Exports") < 50
    assert S.name_score("Infosys", "Infosys Limited") == 100 and S.name_score("Acme", "Acme Foods and Acme Farms") < 85
    assert S.domain_fits("acme", "Acme Analytics Private Limited") and S.domain_fits(
        "acmeanalytics", "Acme Analytics Pvt Ltd"
    )
    assert S.domain_fits("tcs", "Tata Consultancy Services Limited")
    assert not S.domain_fits("infosysjobs", "Infosys Limited")  # a look-alike domain goes to a person
    assert not S.domain_fits("getacme", "Acme Analytics")


# --- the company: verify, review, re-check --------------------------------------------------------------------------------


async def test_active_and_matching_gets_the_badge(client, outbox, db, make_client):
    session, cid, job = await company(client, outbox, db)
    card = (await client.get(URL.format(cid=cid), headers=H(session))).json()
    assert card["state"]["status"] == "none" and card["provider"] == {"ready": True, "test": True}
    assert card["suggest"] == {"kind": "gstin", "number": GOOD_GSTIN} and [k["key"] for k in card["kinds"]] == [
        "gstin",
        "udyam",
        "cin",
    ]
    assert (await verify(client, session, cid, agree=False)).json()["error"]["code"] == "agree"
    r = await verify(client, session, cid, number="27AAPFU0939F1ZW")
    assert r.json()["error"]["code"] == "bad_number" and "last character" in r.text  # no lookup for a typing mistake
    assert await db[TRUST_EMPLOYER_LOOKUPS].count_documents({}) == 0
    r = await verify(client, session, cid)
    assert r.status_code == 200, r.text
    st = r.json()["state"]
    assert (
        st["status"] == "verified"
        and st["statusText"] == "Verified employer"
        and st["registry"] == "GST"
        and st["verifiedBy"] == "check"
    )
    assert st["facts"] == {"found": True, "legalName": "Acme Analytics Pvt Ltd", "tradeName": "Acme Analytics Pvt Ltd", "status": "active",
                           "registeredOn": "2019-04-01", "state": "Maharashtra", "city": "Hyderabad"}  # fmt: skip
    assert st["numberMasked"] == F.mask("gstin", GOOD_GSTIN) and st["nextCheckAt"] and st["test"] is True
    row = await db[TRUST_EMPLOYER].find_one({"_id": cid})
    assert decrypt(row["number_enc"]) == GOOD_GSTIN and row["consent"]["by"] == "founder@gmail.com"
    assert GOOD_GSTIN not in str({k: v for k, v in row.items() if k != "number_enc"})  # masked + hashed, never plain
    assert (
        GOOD_GSTIN not in str(r.json()["state"])
        and await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"company_id": cid, "result": "active"}) == 1
    )
    assert await db[AUDIT_LOG].count_documents({"action": "trust.employer_check", "target": cid}) == 1
    # sending the same verified number again costs nothing
    await verify(client, session, cid)
    assert await db[TRUST_EMPLOYER_LOOKUPS].count_documents({}) == 1

    # candidates who get Vetting Trust see the badge on job cards, the job page and the company page
    asha, _ = await candidate(make_client, outbox, db, "asha@example.com")
    cards = (await asha.get("/api/jobs")).json()["items"]
    mine = next(j for j in cards if j["id"] == job["id"])
    assert mine["employer"]["label"] == "Verified employer" and mine["employer"]["registry"] == "GST"
    page = (await asha.get(f"/api/jobs/{job['slug']}")).json()
    et = page["employerTrust"]
    assert et["employer"]["registry"] == "GST" and et["promise"].startswith("Never pay for a job on Nm7")
    assert [x["key"] for x in et["reasons"]] == [
        "money",
        "fake_company",
        "impersonation",
        "misleading",
        "harassment",
        "other",
    ]
    assert any("1930" in h for h in et["help"])
    slug = (await db[COMPANIES].find_one({"_id": cid}))["slug"]
    cp = (await asha.get(f"/api/companies/{slug}")).json()
    assert (
        cp["employerTrust"]["employer"]["label"] == "Verified employer"
        and cp["jobs"][0]["employer"]["registry"] == "GST"
    )
    # removing it takes the badge and the facts away at once
    assert (await client.delete(URL.format(cid=cid), headers=H(session))).json()["state"]["status"] == "none"
    assert await db[TRUST_EMPLOYER].count_documents({"_id": cid}) == 0
    assert "employer" not in next(j for j in (await asha.get("/api/jobs")).json()["items"] if j["id"] == job["id"])


@pytest.mark.parametrize(
    ("name", "kind", "number", "why"),
    [
        ("Acme Analytics cancelled Pvt Ltd", "gstin", GOOD_GSTIN, "says this registration is cancelled"),
        ("Acme Analytics Pvt Ltd", "gstin", gstin("27AAPFU0939F9Z"), "says this registration is cancelled"),
        ("Acme mismatch Analytics", "cin", CIN, "doesn’t match your company name"),
        ("Acme notfound Analytics", "udyam", UDYAM, "has no record of this number"),
    ],
)
async def test_cancelled_mismatch_or_unknown_goes_to_a_person(
    client, outbox, db, admin_client, name, kind, number, why
):
    session, cid, _ = await company(client, outbox, db, name=name)
    r = await verify(client, session, cid, kind=kind, number=number)
    st = r.json()["state"]
    assert r.status_code == 200 and st["status"] == "review" and st["statusText"] == "A person at Nm7 is checking this"
    assert any(why in x for x in st["reasons"]) and "Nothing changes for your jobs" in st["reviewNote"]
    c = await db[COMPANIES].find_one({"_id": cid})
    assert c["review"]["state"] == "approved"  # never a rejection: nothing about the company changed
    owner = await admin_client()
    q = (await owner.get("/api/admin/trust/employer")).json()
    item = next(x for x in q["review"] if x["companyId"] == cid)
    assert item["company"] == name and any(why in x for x in item["reasons"]) and q["counts"]["review"] == 1
    bad = await owner.post(f"/api/admin/trust/employer/{cid}/review", json={"decision": "not_verified"})
    assert bad.json()["error"]["code"] == "note"
    await owner.post(
        f"/api/admin/trust/employer/{cid}/review",
        json={"decision": "verified", "note": "Checked the GST certificate on a call."},
    )
    st = (await client.get(URL.format(cid=cid), headers=H(session))).json()["state"]
    assert st["status"] == "verified" and st["verifiedBy"] == "review" and st["review"]["status"] == "cleared"
    assert await db[AUDIT_LOG].count_documents({"action": "trust.employer_review", "target": cid}) == 1


async def test_look_alike_domain_goes_to_a_person(client, outbox, db):
    session, cid, _ = await company(client, outbox, db)
    await db[COMPANIES].update_one(
        {"_id": cid}, {"$set": {"details.website": "https://acme-careers.com", "review.state": "pending"}}
    )  # not verified by Nm7's team
    st = (await verify(client, session, cid)).json()["state"]
    assert st["status"] == "review" and any("acmecareers" in x for x in st["reasons"])


async def test_vendor_down_changes_nothing_and_lookups_are_rate_limited(client, outbox, db):
    session, cid, _ = await company(client, outbox, db, name="Acme vendordown Analytics")
    r = await verify(client, session, cid)
    assert r.status_code == 502 and r.json()["error"]["code"] == "vendor_error"
    assert await db[TRUST_EMPLOYER].count_documents({"_id": cid}) == 0
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"details.legal_name": "Acme mismatch Analytics"}})
    for _ in range(4):
        assert (await verify(client, session, cid)).status_code == 200
    r = await verify(client, session, cid)
    assert r.status_code == 429 and "many times" in r.text  # 5 a day: each lookup is paid


async def test_recheck_drops_the_badge(client, outbox, db):
    session, cid, _ = await company(client, outbox, db)
    await verify(client, session, cid)
    await db[TRUST_EMPLOYER].update_one({"_id": cid}, {"$set": {"next_check_at": now() - timedelta(days=1)}})
    out = await S.recheck(db, outbox)
    assert out == {"checked": 1, "kept": 1, "dropped": 0, "errors": 0}
    row = await db[TRUST_EMPLOYER].find_one({"_id": cid})
    assert row["status"] == "verified" and row["next_check_at"].replace(tzinfo=None) > (
        now() + timedelta(days=89)
    ).replace(tzinfo=None)
    # the registration is cancelled since: the badge drops, a person checks, the company is told
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"details.legal_name": "Acme Analytics cancelled Pvt Ltd"}})
    await db[TRUST_EMPLOYER].update_one({"_id": cid}, {"$set": {"next_check_at": now() - timedelta(days=1)}})
    before = len(outbox.sent)
    assert (await S.recheck(db, outbox))["dropped"] == 1
    st = (await client.get(URL.format(cid=cid), headers=H(session))).json()["state"]
    assert st["status"] == "review" and st["droppedAt"] and st["review"]["reason"].startswith("Re-check:")
    mail = outbox.sent[before:]
    assert len(mail) == 1 and mail[0].to == "founder@gmail.com" and "badge is off for now" in mail[0].text
    assert await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"by": "recheck"}) == 2
    assert (await S.recheck(db, outbox))["checked"] == 0  # nothing due


async def test_recheck_tells_nobody_while_hidden(client, outbox, db):
    session, cid, _ = await company(client, outbox, db)
    await verify(client, session, cid)
    await db["settings"].update_one({"_id": "site"}, {"$pull": {"trust.testers": "founder@gmail.com"}})
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"details.legal_name": "Acme Analytics cancelled Pvt Ltd"}})
    await db[TRUST_EMPLOYER].update_one({"_id": cid}, {"$set": {"next_check_at": now() - timedelta(days=1)}})
    before = len(outbox.sent)
    assert (await S.recheck(db, outbox))["dropped"] == 1 and len(outbox.sent) == before


# --- switch OFF -----------------------------------------------------------------------------------------------------------


async def test_switch_off_hides_everything_and_public_pages_are_unchanged(client, outbox, db, make_client):
    session, cid, job = await company(client, outbox, db, test=False)
    slug = (await db[COMPANIES].find_one({"_id": cid}))["slug"]
    anon = make_client()
    bob, _ = await candidate(make_client, outbox, db, "bob@example.com", test=False)

    async def views(c):
        return (
            (await c.get("/api/jobs")).json()["items"],
            (await c.get(f"/api/jobs/{job['slug']}")).json(),
            (await c.get(f"/api/companies/{slug}")).json(),
        )

    before = [await views(anon), await views(bob)]
    assert (await client.get(URL.format(cid=cid), headers=H(session))).status_code == 404  # hidden from this company
    assert (await verify(client, session, cid)).status_code == 404
    assert (await bob.get("/api/me/trust/employer")).status_code == 404
    assert (
        await bob.post("/api/me/trust/fraud", json={"context": "job", "id": job["id"], "reason": "money"})
    ).status_code == 404
    # a verified badge exists (made while the company was a tester), yet nobody outside Trust sees anything new
    await make_tester(db, "founder@gmail.com")
    assert (await verify(client, session, cid)).json()["state"]["status"] == "verified"
    await db["settings"].update_one({"_id": "site"}, {"$pull": {"trust.testers": "founder@gmail.com"}})
    after = [await views(anon), await views(bob)]

    def strip(v):  # times that move on their own
        items, page, cp = v
        return ([{k: x[k] for k in x if k != "updatedAt"} for x in items], {k: page[k] for k in page if k not in ("updatedAt", "similar")},
                {k: cp[k] for k in cp if k != "jobs"})  # fmt: skip

    assert [strip(v) for v in before] == [strip(v) for v in after]
    for items, page, cp in after:
        assert all("employer" not in x for x in items) and "employerTrust" not in page and "employerTrust" not in cp
        assert all("employer" not in x for x in cp["jobs"])
    # the switch public: everyone sees it (also signed out)
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}})
    items, page, cp = await views(anon)
    assert next(x for x in items if x["id"] == job["id"])["employer"]["label"] == "Verified employer"
    assert page["employerTrust"]["employer"] and cp["employerTrust"]["promise"]


# --- fraud reports ----------------------------------------------------------------------------------------------------------


@pytest.fixture
def proxied(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 1)


async def report(c, job_id, reason="money", note="They asked me to pay Rs 2,000 for training.", context="job"):
    return await c.post("/api/me/trust/fraud", json={"context": context, "id": job_id, "reason": reason, "note": note})


async def test_fraud_reports_pause_after_n_independent_and_never_ban(
    client, outbox, db, make_client, admin_client, proxied
):
    session, cid, job = await company(client, outbox, db)
    owner = await admin_client()
    await owner.put(
        "/api/admin/trust/employer", json={"provider": "mock", "recheckDays": 90, "pauseAt": 3, "nameMin": 85}
    )
    a, auid = await candidate(make_client, outbox, db, "a@example.com", ip="10.1.1.5")
    b, _ = await candidate(make_client, outbox, db, "b@example.com", ip="10.1.1.9")  # same network as a: counts once
    c, _ = await candidate(make_client, outbox, db, "c@example.com", ip="10.2.2.2")
    d, _ = await candidate(make_client, outbox, db, "d@example.com", ip="10.3.3.3")
    r = await report(a, job["id"])
    assert (
        r.status_code == 201
        and r.json()["paused"] is False
        and "never told who reported" in r.json()["next"]
        and "1930" in r.json()["next"]
    )
    assert (await report(a, job["id"])).json()["error"]["code"] == "already"
    assert (await report(b, job["id"], reason="fake_company")).json()["paused"] is False
    assert (await report(c, job["id"], reason="impersonation")).json()["paused"] is False  # 2 independent so far
    assert (await db[JOBS].find_one({"_id": job["id"]}))["status"] == "active"
    assert (await report(d, job["id"], reason="harassment", note="")).json()["paused"] is True
    j = await db[JOBS].find_one({"_id": job["id"]})
    assert j["status"] == "paused" and j["reports_hold"] is True
    co = await db[COMPANIES].find_one({"_id": cid})
    assert co["review"]["state"] == "approved"  # the company is never suspended automatically

    # the company never sees who reported: nothing about the reporters in any company view
    seen = ""
    for path in (
        f"/api/company/{cid}/jobs",
        f"/api/company/{cid}",
        f"/api/company/{cid}/overview",
        f"/api/company/{cid}/activity",
    ):
        seen += (await client.get(path, headers=H(session))).text
    for leak in ("a@example.com", "b@example.com", "Asha Rao", auid, "Rs 2,000"):
        assert leak not in seen

    # Admin: the queue (reporters shown to Admin only), then dismiss → the job goes live again
    q = (await owner.get("/api/admin/trust/fraud")).json()
    case = next(x for x in q["items"] if x["key"] == f"job:{job['id']}")
    assert case["count"] == 4 and case["independent"] == 3 and case["money"] == 1 and case["job"]["held"] is True
    assert {x["reporter"]["email"] for x in case["reports"]} == {
        "a@example.com",
        "b@example.com",
        "c@example.com",
        "d@example.com",
    }
    assert case["reports"][-1]["reasonText"].startswith("Asked me for money")
    await owner.post("/api/admin/trust/fraud/action", json={"key": case["key"], "action": "dismiss"})
    assert (await db[JOBS].find_one({"_id": job["id"]}))["status"] == "active"
    assert await db[JOB_REPORTS].count_documents({"job_id": job["id"], "state": "open"}) == 0
    assert await db[AUDIT_LOG].count_documents({"action": "trust.fraud_dismiss"}) == 1


async def test_fraud_admin_actions_warn_pause_suspend(client, outbox, db, make_client, admin_client, proxied):
    session, cid, job = await company(client, outbox, db)
    owner = await admin_client()
    a, _ = await candidate(make_client, outbox, db, "a@example.com", ip="10.1.1.5")
    slug = (await db[COMPANIES].find_one({"_id": cid}))["slug"]
    assert (await report(a, slug, context="company", reason="impersonation")).status_code == 201
    await report(a, job["id"])
    before = len(outbox.sent)
    await owner.post(
        "/api/admin/trust/fraud/action",
        json={"key": f"job:{job['id']}", "action": "warn", "note": "Please check your recruiters."},
    )
    warn = outbox.sent[before:]
    assert (
        len(warn) == 1
        and warn[0].to == "founder@gmail.com"
        and "never allows asking candidates for money" in warn[0].text
    )
    assert "a@example.com" not in warn[0].text and "Asha" not in warn[0].text  # never who reported
    # a company case: suspend (the existing block: jobs paused, the company emailed); needs a reason
    bad = await owner.post("/api/admin/trust/fraud/action", json={"key": f"company:{cid}", "action": "suspend_company"})
    assert bad.json()["error"]["code"] == "note"
    r = await owner.post(
        "/api/admin/trust/fraud/action",
        json={"key": f"company:{cid}", "action": "suspend_company", "note": "Asked candidates for deposits."},
    )
    assert r.status_code == 200, r.text
    assert (await db[COMPANIES].find_one({"_id": cid}))["review"]["state"] == "blocked"
    assert (await db[JOBS].find_one({"_id": job["id"]}))["status"] == "paused"
    assert (
        await db[AUDIT_LOG].count_documents({"action": {"$in": ["trust.fraud_warn", "trust.fraud_suspend_company"]}})
        == 2
    )


async def test_fraud_on_invites_offers_and_rate_limit(client, outbox, db, make_client, proxied):
    from bson import ObjectId

    session, cid, job = await company(client, outbox, db)
    a, auid = await candidate(make_client, outbox, db, "a@example.com")
    iid, oid = ObjectId(), ObjectId()
    await db["hire_invites"].insert_one(
        {
            "_id": iid,
            "company_id": cid,
            "job_id": job["id"],
            "user_id": auid,
            "status": "sent",
            "note": "Pay 500 to book",
            "created_at": now(),
        }
    )
    await db["hire_offers"].insert_one(
        {
            "_id": oid,
            "company_id": cid,
            "job_id": job["id"],
            "user_id": auid,
            "status": "sent",
            "title": "Analyst",
            "created_at": now(),
        }
    )
    mine = (await a.get("/api/me/trust/employer")).json()
    assert mine["promise"].startswith("Never pay") and mine["badges"] == {}
    await verify(client, session, cid)
    assert (await a.get("/api/me/trust/employer")).json()["badges"][cid]["label"] == "Verified employer"
    assert (await report(a, str(iid), context="invite")).status_code == 201
    assert (await report(a, str(oid), context="offer")).status_code == 201
    other, _ = await candidate(make_client, outbox, db, "z@example.com", ip="10.9.9.9")
    assert (await report(other, str(iid), context="invite")).status_code == 404  # only your own invite
    rows = await db[JOB_REPORTS].find({"user_id": auid}).to_list(None)
    assert {r["context"] for r in rows} == {"invite", "offer"} and all(
        r["job_id"] == job["id"] and r["company_id"] == cid for r in rows
    )
    # rate limit: 5 an hour (2 sent above; the 404 was refused before it counted)
    from app.core import rate_limit

    for _ in range(3):
        await rate_limit.record(db, f"trust-fraud:{auid}")
    r = await report(a, job["id"])
    assert r.status_code == 429 and "many reports" in r.text


# --- Admin ---------------------------------------------------------------------------------------------------------------


async def test_admin_settings_keys_and_production_gate(client, outbox, db, admin_client, monkeypatch):
    owner = await admin_client()
    assert (await (await admin_client("support")).get("/api/admin/trust/employer")).status_code == 403
    d = (await owner.get("/api/admin/trust/employer")).json()
    assert d["provider"] == "mock" and d["recheckDays"] == 90 and d["pauseAt"] == 3 and d["nameMin"] == 85
    sp = next(p for p in d["providers"] if p["key"] == "surepass")
    assert sp == {
        "key": "surepass",
        "label": "Surepass (GST, Udyam and MCA lookups)",
        "test": False,
        "ready": False,
        "keys": {"SUREPASS_TOKEN": False},
    }
    monkeypatch.setattr(get_settings(), "surepass_token", "sk_live_SECRET_VALUE")
    r = await owner.get("/api/admin/trust/employer")
    assert "sk_live_SECRET_VALUE" not in r.text and next(p for p in r.json()["providers"] if p["key"] == "surepass")[
        "keys"
    ] == {"SUREPASS_TOKEN": True}
    assert (await owner.put("/api/admin/trust/employer", json={"provider": "nope"})).status_code == 422
    assert (await owner.put("/api/admin/trust/employer", json={"provider": "mock", "pauseAt": 1})).status_code == 422
    r = await owner.put(
        "/api/admin/trust/employer", json={"provider": "surepass", "recheckDays": 60, "pauseAt": 4, "nameMin": 90}
    )
    assert r.json()["provider"] == "surepass" and r.json()["pauseAt"] == 4
    assert await db[AUDIT_LOG].count_documents({"action": "trust.employer_settings"}) == 1
    # the test provider on production: only the demo company and testers
    await owner.put("/api/admin/trust/employer", json={"provider": "mock"})
    monkeypatch.setattr(type(get_settings()), "is_prod", property(lambda self: True))
    site = {"trust": {"employer": {"provider": "mock"}, "testers": ["t@x.com"]}}
    assert await S.provider_for(site, {"_id": "c"}, {"email_lc": "someone@x.com"}) is None
    assert await S.provider_for(site, {"_id": "c"}, {"email_lc": "t@x.com"}) is not None
    assert await S.provider_for(site, {"_id": "c", "demo": True}, None) is not None


async def test_retention(client, outbox, db):
    session, cid, _ = await company(client, outbox, db)
    await verify(client, session, cid)
    assert {"employer_checks", "fraud_reports"} <= set(R.TYPES)
    t = now()
    await db[TRUST_EMPLOYER].update_one({"_id": cid}, {"$set": {"checked_at": t - timedelta(days=400)}})
    await db[TRUST_EMPLOYER_LOOKUPS].update_many({}, {"$set": {"at": t - timedelta(days=400)}})
    await db[JOB_REPORTS].insert_many([
        {"_id": "u1:company:x", "user_id": "u1", "fraud": True, "state": "done", "resolved_at": t - timedelta(days=400)},
        {"_id": "u2:company:x", "user_id": "u2", "fraud": True, "state": "open", "at": t - timedelta(days=400)},
    ])  # fmt: skip
    counts = await R.run(db, force=True)
    assert counts["employer_checks"] == 2 and counts["fraud_reports"] == 1
    assert (
        await db[TRUST_EMPLOYER].count_documents({}) == 0
        and await db[JOB_REPORTS].count_documents({"_id": "u2:company:x"}) == 1
    )
    assert await R.erase_user(db, "u2") and await db[JOB_REPORTS].count_documents({"_id": "u2:company:x"}) == 0


# --- the Surepass adapter -------------------------------------------------------------------------------------------------


class FakeSurepass:
    def __init__(self):
        self.calls = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(req.content)
        self.calls.append((req.url.path, req.headers.get("authorization"), body))
        n = body["id_number"]
        if n.endswith("00000"):
            return httpx.Response(
                422,
                json={"data": {"client_id": "corporate_x"}, "success": False, "message_code": "verification_failed"},
            )
        if req.url.path.endswith("/gstin"):
            return httpx.Response(200, json={"success": True, "status_code": 200, "data": {
                "client_id": "corporate_gstin_abc", "gstin": n, "business_name": "ACME ANALYTICS", "legal_name": "ACME ANALYTICS PRIVATE LIMITED",
                "gstin_status": "Active", "date_of_registration": "2018-07-01",
                "address": "Plot 12, Hitech City, Madhapur, Hyderabad, Telangana, 500081"}})  # fmt: skip
        if req.url.path.endswith("/company-details"):
            return httpx.Response(200, json={"success": True, "data": {"client_id": "corporate_cin_1", "details": {"company_info": {
                "company_name": "ACME ANALYTICS PRIVATE LIMITED", "company_status": "Strike Off", "date_of_incorporation": "12/03/2019",
                "registered_address": "4th floor, Road 36, Jubilee Hills, Hyderabad, Telangana, 500033"}}}})  # fmt: skip
        return httpx.Response(200, json={"success": True, "data": {"client_id": "udyam_1", "main_details": {
            "name_of_enterprise": "M/S ACME ANALYTICS", "date_of_udyam_registration": "05/01/2021", "state": "TELANGANA", "city": "Hyderabad"}}})  # fmt: skip


@pytest.fixture
def fake_surepass(monkeypatch):
    fake = FakeSurepass()
    monkeypatch.setattr(surepass, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    monkeypatch.setattr(get_settings(), "surepass_token", "sk_test_TOKEN")
    return fake


async def test_surepass_adapter(client, outbox, db, admin_client, fake_surepass):
    p = surepass.Surepass()
    assert p.ready()
    g = await p.lookup("gstin", GOOD_GSTIN)
    assert (g.found, g.legal_name, g.trade_name, g.status, g.registered_on, g.city, g.state, g.vendor_ref) == (
        True, "ACME ANALYTICS PRIVATE LIMITED", "ACME ANALYTICS", "active", "2018-07-01", "Hyderabad", "Telangana", "corporate_gstin_abc")  # fmt: skip
    path, auth, body = fake_surepass.calls[-1]
    assert (
        path == "/api/v1/corporate/gstin"
        and auth == "Bearer sk_test_TOKEN"
        and body == {"id_number": GOOD_GSTIN, "filing_status_get": False}
    )
    cin = await p.lookup("cin", CIN)
    assert cin.status == "cancelled" and cin.registered_on == "2019-03-12" and cin.city == "Hyderabad"
    u = await p.lookup("udyam", UDYAM)
    assert (
        u.status == "active"
        and u.legal_name == "M/S ACME ANALYTICS"
        and u.registered_on == "2021-01-05"
        and u.state == "Telangana"
    )
    assert (await p.lookup("cin", "U72900TG2019PTC100000")).found is False
    # end to end through the company card
    owner = await admin_client()
    await owner.put("/api/admin/trust/employer", json={"provider": "surepass"})
    session, cid, _ = await company(client, outbox, db)
    st = (await verify(client, session, cid)).json()["state"]
    assert (
        st["status"] == "verified"
        and st["test"] is False
        and st["facts"]["legalName"] == "ACME ANALYTICS PRIVATE LIMITED"
    )
    assert b"sk_test_TOKEN" not in await everything(db)


async def test_test_provider_badges_never_reach_the_public_on_production(db, monkeypatch):
    t = now()
    await db[COMPANIES].insert_many(
        [{"_id": "co-real", "slug": "real"}, {"_id": "co-demo", "slug": "demo", "demo": True}]
    )
    for cid in ("co-real", "co-demo"):
        await db[TRUST_EMPLOYER].insert_one(
            {"_id": cid, "status": "verified", "kind": "gstin", "test": True, "checked_at": t, "verified_at": t}
        )
    monkeypatch.setattr(type(get_settings()), "is_prod", property(lambda self: True))
    assert set(await S.badges(db, ["co-real", "co-demo"])) == {"co-real", "co-demo"}  # switch off: only testers see any
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.public": True}}, upsert=True)
    assert set(await S.badges(db, ["co-real", "co-demo"])) == {"co-demo"}  # public: no "(test)" badge on a real company
