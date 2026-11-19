# ruff: noqa: E501
"""Vetting Trust T2: DigiLocker documents through a KYC vendor. The test provider end to end (consent first, the
DigiLocker approval, the poll), what is kept (never Aadhaar, never a full PAN, no files), the name match and the review
flag (never a rejection), the callback signature, taking back the consent deleting everything, the switch keeping it
hidden, badges in company views only where the switch allows, the Setu adapter against a fake Setu, Admin settings."""

import json
import re
from datetime import timedelta

import httpx
import pytest

from app.core.config import get_settings
from app.core.db import AUDIT_LOG, TRUST_DL_SESSIONS, TRUST_DOCUMENTS, USERS
from app.core.security import keyed_hash
from app.core.time import now
from app.site import save_site
from app.trust import retention as R
from app.trust.digilocker import providers as P
from app.trust.digilocker import service as S
from app.trust.digilocker import setu, xmldoc
from tests.conftest import signup
from tests.test_companies_apply import company_job, student
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY

ALL = ["dl", "class10", "class12", "degree", "pan"]


async def person(make_client, outbox, db, email, name="Asha Rao", tester=True, consent=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        if consent:
            assert (await c.post("/api/me/trust/consents/documents")).json()["status"] == "granted"
    return c, me["id"]


async def fetch(c, kinds=ALL):
    r = await c.post("/api/me/trust/documents/sessions", json={"kinds": kinds})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["mock"] and "dlmock=1" in s["url"] and f"dl={s['id']}" in s["url"]
    return s, (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/mock-approve", json={"allow": True})).json()


def everything(rows) -> str:
    return json.dumps(rows, default=str)


def mock_pan(uid: str) -> str:
    return f"ABCPK{P._digits(uid + 'p', 4)}L"


async def test_mock_flow_keeps_only_what_is_needed(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "asha@example.com", consent=False)
    card = (await c.get("/api/me/trust/documents")).json()
    assert card["provider"] == {"ready": True, "test": True, "label": "Test provider (no real documents)"}
    assert card["consent"] is False and [k["key"] for k in card["kinds"]] == ALL and card["documents"] == []
    r = await c.post("/api/me/trust/documents/sessions", json={"kinds": ["pan"]})
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_needed"  # the T1 "documents" consent first
    assert (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["aadhaar"]})).status_code == 422
    await c.post("/api/me/trust/consents/documents")

    r = await c.post("/api/me/trust/documents/sessions", json={"kinds": ALL})
    s = r.json()
    pending = (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/check")).json()
    assert pending["session"]["status"] == "pending" and pending["documents"] == []  # not approved in DigiLocker yet
    out = (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/mock-approve", json={"allow": True})).json()
    assert out["session"]["status"] == "done" and out["session"]["fetched"] == 5
    docs = {d["kind"]: d for d in out["documents"]}
    assert list(docs) == ALL and all(
        d["state"] == "verified" and d["stateText"] == "Verified via DigiLocker" for d in docs.values()
    )
    assert docs["dl"]["summary"] == "Driving licence (MCWG, LMV) · valid to 11 Apr 2039"
    assert docs["class10"]["summary"] == "Class 10 · passed · 2015 · Board of Secondary Education, Telangana"
    assert docs["degree"]["summary"].startswith("B.Tech (Computer Science) · passed · 2021 · Jawaharlal")
    pan = mock_pan(uid)
    assert docs["pan"]["summary"] == f"PAN verified (ending {pan[-4:]})" and docs["pan"]["nameMatch"] == "match"

    rows = await db[TRUST_DOCUMENTS].find({"user_id": uid}).to_list(None)
    sessions = await db[TRUST_DL_SESSIONS].find({"user_id": uid}).to_list(None)
    blob = everything(rows) + everything(sessions)
    # never Aadhaar (the mock sends an Aadhaar document, uid fields, the eKYC XML, a photo, a date of birth)
    aadhaar = "9999" + P._digits(uid + "a", 8)
    assert aadhaar not in blob and not re.search(r"aadhaar|uid\b|OfflinePaperless|ekyc", blob, re.I)
    assert (
        "ADHAR" not in blob
        and "photo" not in blob
        and "1999-04-12" not in blob
        and "12-04-1999" not in blob
        and "dob" not in blob
        and "gender" not in blob
    )
    assert pan not in blob and "TS09" not in blob  # no PAN or licence number in plain
    p = next(r for r in rows if r["kind"] == "pan")
    assert p["pan_hash"] == keyed_hash("pan", pan) and p["pan_last4"] == pan[-4:] and p["fields"] == {"verified": True}
    d = next(r for r in rows if r["kind"] == "dl")
    assert set(d) == {"_id", "user_id", "kind", "doc_type", "issuer", "fields", "vendor", "vendor_ref", "session_id", "test",
                      "fetched_at", "created_at", "verify_until", "name_match", "review"}  # fmt: skip
    assert d["fields"] == {"classes": ["MCWG", "LMV"], "valid_until": "2039-04-11"} and d["test"] is True
    assert d["verify_until"] < now() + timedelta(days=366)  # re-verify after a year at most
    assert "doc_name" not in d  # the name on the document is kept only while it differs
    # fetching again replaces, never piles up
    await fetch(c, ["pan"])
    assert await db[TRUST_DOCUMENTS].count_documents({"user_id": uid, "kind": "pan"}) == 1
    # removing one document
    out = (await c.delete(f"/api/me/trust/documents/{docs['class12']['id']}")).json()
    assert "class12" not in [x["kind"] for x in out["documents"]]
    assert await db[AUDIT_LOG].find_one({"action": "trust.digilocker_start"})


def test_keep_whitelist_unit():
    assert S.keep(P.RawDoc("ADHAR", "UIDAI", "Asha", "999941057058", data={"uid": "999941057058"})) is None
    assert S.keep(P.RawDoc("EAADHAAR", "UIDAI", "Asha")) is None
    assert S.keep(P.RawDoc("XYZ", "Someone", "Asha")) is None  # a type Nm7 doesn't know
    assert S.keep(P.RawDoc("PANCR", "ITD", "Asha", "not-a-pan")) is None
    k = S.keep(
        P.RawDoc(
            "PANCR", "ITD", "Asha", "abcpk 1234 l", data={"uid": "999941057058", "aadhaar_seeding": "Y", "dob": "1999"}
        )
    )
    assert k["pan_last4"] == "234L" and "ABCPK1234L" not in str(k) and "9999" not in str(k) and "dob" not in str(k)
    k = S.keep(
        P.RawDoc("HSCER", "CBSE", "Asha", "123", data={"year": "2017", "result": "Pass", "aadhaar": "999941057058"})
    )
    assert k["fields"] == {"board": "CBSE", "year": 2017, "result": "pass"} and "9999" not in str(k)


SETU_DL = b"""<?xml version="1.0" encoding="UTF-8"?>
<Certificate language="99" name="Driving Licence" type="DRVLC" number="TS0920190001234" issueDate="12-05-2019" expiryDate="11-04-2039">
  <IssuedBy><Organization name="Transport Department, Telangana" code="TS"/></IssuedBy>
  <IssuedTo><Person uid="xxxxxxxx7058" name="ASHA RAO" dob="12-04-1999" gender="F"><Photo format="jpeg">/9j/4AAQSk</Photo></Person></IssuedTo>
  <CertificateData><DrivingLicense><Categories><Category abbreviation="MCWG" issueDate="12-05-2019"/><Category abbreviation="LMV" issueDate="12-05-2019"/></Categories></DrivingLicense></CertificateData>
</Certificate>"""
SETU_PAN = b"""<Certificate type="PANCR" number="ABCPR6789K"><IssuedBy><Organization name="Income Tax Department"/></IssuedBy>
<IssuedTo><Person uid="999941057058" name="Asha  Rao" dob="12/04/1999"/></IssuedTo></Certificate>"""


def test_xml_reader():
    d = xmldoc.parse(SETU_DL)
    assert d.doc_type == "DRVLC" and d.name == "ASHA RAO" and d.valid_until == "2039-04-11"
    assert d.data["classes"] == ["MCWG", "LMV"] and d.data["person"]["uid"] == "xxxxxxxx7058"  # raw, before keep()
    k = S.keep(d)
    assert (
        k["fields"] == {"classes": ["MCWG", "LMV"], "valid_until": "2039-04-11"}
        and "7058" not in str(k)
        and "Photo" not in str(k)
    )
    assert xmldoc.parse(b'<!DOCTYPE x [<!ENTITY a "aaaa">]><Certificate type="PANCR"/>') is None  # entities refused
    assert xmldoc.parse(b"not xml") is None and xmldoc.parse(b"") is None


def test_name_match():
    m = S.name_match
    assert m("Asha Rao", "ASHA RAO") == "match" and m("Asha Rao", "Rao Asha") == "match"
    assert m("Smt. Asha Rao", "Asha  Rao") == "match" and m("K. Asha", "Kalyani Asha") == "match"
    assert m("Asha Rao", "Asha Rani Rao") == "match"  # a middle name missing on the profile
    assert m("Venkata Sai", "Venkatasai") == "match" and m("Asha", "Asha R") == "match"
    assert m("Asha Rao", "Ramesh Kumar Sharma") == "mismatch" and m("Asha", "Asha Rani Rao") == "mismatch"
    assert m("A R", "Asha Rao") == "mismatch"  # initials only: a person checks
    assert m("", "Asha") == "unknown" and m("Asha", "") == "unknown"


async def test_name_mismatch_goes_to_review_never_rejects(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, db, "bala@example.com", name="Bala Mismatch Test")
    _, out = await fetch(c, ["dl", "pan"])
    for d in out["documents"]:
        assert d["state"] == "review" and d["stateText"] == "A person at Nm7 is checking this"
        assert d["nameOnDocument"] == "Ramesh Kumar Sharma" and d["nameMatch"] == "mismatch"
        assert d["reasons"] == ["The name on the document is different from your profile name."]
    assert out["documents"][0]["id"]  # kept (not deleted or rejected)
    dl = next(d for d in out["documents"] if d["kind"] == "dl")
    # the candidate explains; still with a person
    r = (
        await c.post(
            f"/api/me/trust/documents/{dl['id']}/explain",
            json={"note": "Ramesh is my official name; Bala is what everyone calls me."},
        )
    ).json()
    assert next(d for d in r["documents"] if d["kind"] == "dl")["note"].startswith("Ramesh is my")
    owner = await admin_client()
    q = (await owner.get("/api/admin/trust/documents")).json()
    assert q["counts"]["review"] == 2 and {x["kind"] for x in q["review"]} == {"dl", "pan"}
    assert q["review"][0]["userName"] == "Bala Mismatch Test" and "reasonKeys" in q["review"][0]
    q = (
        await owner.post(f"/api/admin/trust/documents/{dl['id']}/review", json={"decision": "clear", "note": "Checked"})
    ).json()
    assert q["counts"]["review"] == 1
    row = await db[TRUST_DOCUMENTS].find_one({"user_id": uid, "kind": "dl"})
    assert row["review"]["status"] == "cleared" and "doc_name" not in row and S.badge_ok(row)
    # the other one: the candidate corrects the profile name and checks again
    assert (await c.patch("/api/me/profile", json={"name": "Ramesh Kumar Sharma"})).status_code == 200
    pan = next(d for d in out["documents"] if d["kind"] == "pan")
    r = (await c.post(f"/api/me/trust/documents/{pan['id']}/recheck")).json()
    assert next(d for d in r["documents"] if d["kind"] == "pan")["state"] == "verified"
    assert await db[AUDIT_LOG].find_one({"action": "trust.document_review"})


async def test_pan_on_two_accounts_is_flagged_for_review(db, make_client, outbox):
    c1, u1 = await person(make_client, outbox, db, "one@example.com")
    await fetch(c1, ["pan"])
    c2, u2 = await person(make_client, outbox, db, "two@example.com")
    # the same PAN arrives for the second person (a shared or stolen PAN): hash lookup, never the PAN in plain
    raw = P.RawDoc("PANCR", "Income Tax Department", "Asha Rao", mock_pan(u1))
    rows = await S.store(db, u2, {"_id": "s", "kinds": ["pan"], "vendor_ref": "r"}, [raw], "mock", True)
    assert rows[0]["review"]["reasons"] == ["pan_elsewhere"] and rows[0]["review"]["status"] == "open"
    out = (await c2.get("/api/me/trust/documents")).json()
    assert out["documents"][0]["reasons"] == ["This PAN is already verified on another Nm7 account."]


async def test_callback_signature(db, make_client, outbox, client):
    c, uid = await person(make_client, outbox, db, "cee@example.com")
    s = (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["dl"]})).json()
    row = await db[TRUST_DL_SESSIONS].find_one({"_id": s["id"]})
    await db[TRUST_DL_SESSIONS].update_one({"_id": s["id"]}, {"$set": {"mock_approved": True}})
    body = json.dumps({"id": row["vendor_ref"], "status": "authenticated"}).encode()
    url = "/api/public/trust/digilocker/callback/mock"
    for headers in ({}, {P.MOCK_HEADER: "0" * 64}, {P.MOCK_HEADER: P.mock_signature(body + b" ")}):
        r = await client.post(url, content=body, headers={"content-type": "application/json", **headers})
        assert r.status_code == 401
    assert (await db[TRUST_DL_SESSIONS].find_one({"_id": s["id"]}))["status"] == "pending"
    assert (await client.post("/api/public/trust/digilocker/callback/nope", content=body)).status_code == 401
    r = await client.post(url, content=body, headers={P.MOCK_HEADER: P.mock_signature(body)})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert (await db[TRUST_DL_SESSIONS].find_one({"_id": s["id"]}))["status"] == "done"
    assert await db[TRUST_DOCUMENTS].count_documents({"user_id": uid}) == 1
    # again (vendors retry): stored once
    await client.post(url, content=body, headers={P.MOCK_HEADER: P.mock_signature(body)})
    assert await db[TRUST_DOCUMENTS].count_documents({"user_id": uid}) == 1
    # unknown request: same answer, nothing done
    other = json.dumps({"id": "mock-unknown"}).encode()
    assert (await client.post(url, content=other, headers={P.MOCK_HEADER: P.mock_signature(other)})).json() == {
        "ok": True
    }
    # Setu without a webhook secret refuses every callback (Nm7 then relies on the poll)
    assert (
        await client.post(
            "/api/public/trust/digilocker/callback/setu", content=body, headers={setu.CALLBACK_HEADER: "x"}
        )
    ).status_code == 401


async def test_denied_and_expired(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "dee@example.com")
    s = (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["dl"]})).json()
    out = (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/mock-approve", json={"allow": False})).json()
    assert out["session"]["status"] == "denied" and out["documents"] == []
    s = (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["dl"]})).json()
    await db[TRUST_DL_SESSIONS].update_one({"_id": s["id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    out = (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/check")).json()
    assert out["session"]["status"] == "expired"
    owner_counts = await S.counts(db)
    assert owner_counts["failedToday"] == 2 and owner_counts["pending"] == 0


async def test_withdrawing_consent_deletes_documents_and_badges(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "eve@example.com")
    await fetch(c)
    assert await db[TRUST_DOCUMENTS].count_documents({"user_id": uid}) == 5
    r = (await c.delete("/api/me/trust/consents/documents")).json()
    assert r["status"] == "withdrawn" and r["deleted"] == 6  # five documents and the request
    assert await db[TRUST_DOCUMENTS].count_documents({"user_id": uid}) == 0
    assert await db[TRUST_DL_SESSIONS].count_documents({"user_id": uid}) == 0
    card = (await c.get("/api/me/trust/documents")).json()
    assert card["documents"] == [] and card["consent"] is False
    assert (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["dl"]})).status_code == 403


async def test_retention_schedule_and_job(db, make_client, outbox):
    keys = {x["key"]: x for x in await R.schedule(db)}
    assert keys["documents"]["purpose"] == "documents" and keys["documents_requests"]["purpose"] == "documents"
    c, uid = await person(make_client, outbox, db, "fay@example.com")
    await fetch(c, ["dl"])
    await db[TRUST_DOCUMENTS].update_many({"user_id": uid}, {"$set": {"created_at": now() - timedelta(days=181)}})
    counts = await R.run_types(db, "trust")
    assert counts["documents"] == 1 and await db[TRUST_DOCUMENTS].count_documents({}) == 0


async def test_switch_off_hides_it(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "gita@example.com", tester=False)
    for method, path, body in (("get", "/api/me/trust/documents", None), ("post", "/api/me/trust/documents/sessions", {"kinds": ["dl"]}),
                               ("post", "/api/me/trust/documents/sessions/x/check", None), ("post", "/api/me/trust/documents/0123456789abcdef01234567/explain", {"note": "abc"}),
                               ("delete", "/api/me/trust/documents/0123456789abcdef01234567", None)):  # fmt: skip
        r = await getattr(c, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 404, path


async def test_provider_choice_keys_and_production_gate(db, admin_client, monkeypatch):
    owner = await admin_client()
    d = (await owner.get("/api/admin/trust/documents")).json()
    assert d["provider"] == "mock" and {p["key"] for p in d["providers"]} == {"mock", "setu"}
    st = next(p for p in d["providers"] if p["key"] == "setu")
    assert st["ready"] is False and set(st["keys"].values()) == {False}
    assert st["callbackUrl"] == "https://nm7-api.onrender.com/api/public/trust/digilocker/callback/setu"
    monkeypatch.setattr(get_settings(), "setu_dg_client_id", "cid-123")
    monkeypatch.setattr(get_settings(), "setu_dg_client_secret", "very-secret-value")
    monkeypatch.setattr(get_settings(), "setu_dg_product_instance_id", "pi-456")
    r = await owner.put("/api/admin/trust/documents", json={"provider": "setu"})
    d = r.json()
    assert d["provider"] == "setu" and next(p for p in d["providers"] if p["key"] == "setu")["ready"] is True
    assert "very-secret-value" not in r.text and "cid-123" not in r.text  # keys: set / not set only
    assert (await owner.put("/api/admin/trust/documents", json={"provider": "other"})).status_code == 422
    assert (await (await admin_client("ops")).get("/api/admin/trust/documents")).status_code == 403
    # production: the test provider only for admins, demo accounts and testers (its documents aren't real)
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    site = {"trust": {"documents": {"provider": "mock"}}}
    assert await S.provider_for(db, {"email": "x@example.com"}, site, set()) is None
    assert await S.provider_for(db, {"email": "x@example.com"}, site, {"x@example.com"}) is not None
    assert await S.provider_for(db, {"demo": True}, site, set()) is not None
    monkeypatch.setattr(get_settings(), "setu_dg_client_id", "")
    assert await S.provider_for(db, {"demo": True}, {"trust": {"documents": {"provider": "setu"}}}, set()) is None


async def test_badges_in_company_views_only_where_allowed(db, client, outbox, make_client):
    session, cid, job = await company_job(client, outbox, db)
    asha = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await asha.put("/api/me/hire", json=READY)
    assert (
        await asha.post(
            f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {"q1": "yes", "q2": 12, "q3": "Day"}}
        )
    ).status_code == 201
    uid = (await db[USERS].find_one({"email": "asha@example.com"}))["_id"]
    sess = {"_id": "s1", "kinds": ALL, "vendor_ref": "mock-s1", "mock_approved": True, "user_id": uid}
    got = await P.Mock().fetch(sess, name_hint="Asha Rao")
    await S.store(db, uid, sess, got.docs, "mock", True)
    await db[TRUST_DOCUMENTS].update_one(
        {"user_id": uid, "kind": "class12"}, {"$set": {"review.status": "open"}}
    )  # under review: no badge

    async def views():
        apps = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
        one = (await client.get(f"/api/company/{cid}/applicants/{apps[0]['id']}", headers=H(session))).json()
        hire = (
            await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job["id"]}, headers=H(session))
        ).json()["items"]
        return apps[0], one, next(x for x in hire if x["key"] == uid)

    # Trust hidden from this company: no `docs` at all
    for row in await views():
        assert "docs" not in row
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}}, upsert=True)
    for row in await views():
        kinds = [b["kind"] for b in row["docs"]]
        assert kinds == ["dl", "class10", "degree", "pan"]  # class 12 is with a person
        labels = " | ".join(b["label"] for b in row["docs"])
        assert (
            "Telangana" not in labels.replace("Transport Department, Telangana", "") and "Jawaharlal" not in labels
        )  # no board / university for companies
        assert (
            "PAN verified" in labels
            and "ending" not in labels
            and all(b["via"] == "DigiLocker" and b["at"] for b in row["docs"])
        )
    # expired (re-verify date passed): the badge goes
    await db[TRUST_DOCUMENTS].update_many({"user_id": uid}, {"$set": {"verify_until": now() - timedelta(days=1)}})
    assert (await views())[0]["docs"] == []
    # public: every company (production hides test-provider badges from real companies)
    await save_site(db, {"trust.public": True, "trust.testers": []})
    await db[TRUST_DOCUMENTS].update_many({"user_id": uid}, {"$set": {"verify_until": now() + timedelta(days=30)}})
    assert len((await views())[0]["docs"]) == 4


class FakeSetu:
    def __init__(self):
        self.calls = []
        self.status = "unauthenticated"

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path, req.headers.get("x-client-secret")))
        p = req.url.path
        if p == "/api/digilocker" and req.method == "POST":
            return httpx.Response(
                201,
                json={
                    "id": "setu-req-1",
                    "status": "unauthenticated",
                    "url": "https://digilocker.example/consent/1",
                    "validUpto": "2030-01-01T00:00:00Z",
                },
            )
        if p.endswith("/status"):
            return httpx.Response(200, json={"id": "setu-req-1", "status": self.status})
        if p.endswith("/aadhaar"):
            raise AssertionError("Nm7 must never ask for Aadhaar")
        if p.endswith("/document"):
            t = json.loads(req.content)["docType"]
            return (
                httpx.Response(200, json={"fileUrl": f"https://files.example/{t}.xml"})
                if t in ("DRVLC", "PANCR")
                else httpx.Response(404, json={"error": "not found"})
            )
        if p.endswith("/revoke"):
            return httpx.Response(200, json={})
        if req.url.host == "files.example":
            return httpx.Response(200, content=SETU_DL if "DRVLC" in p else SETU_PAN)
        return httpx.Response(404)


@pytest.fixture
def fake_setu(monkeypatch):
    fake = FakeSetu()
    monkeypatch.setattr(setu, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    for k, v in (("setu_dg_client_id", "cid"), ("setu_dg_client_secret", "sek"), ("setu_dg_product_instance_id", "pi"),
                 ("digilocker_webhook_secret", "whsec")):  # fmt: skip
        monkeypatch.setattr(get_settings(), k, v)
    return fake


async def test_setu_adapter(db, make_client, outbox, client, fake_setu):
    await save_site(db, {"trust.documents.provider": "setu"})
    c, uid = await person(make_client, outbox, db, "hari@example.com", name="Asha Rao")
    s = (await c.post("/api/me/trust/documents/sessions", json={"kinds": ["dl", "pan", "class10"]})).json()
    assert s == {"id": s["id"], "url": "https://digilocker.example/consent/1", "mock": False}
    assert (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/mock-approve", json={})).status_code == 404
    assert (await c.post(f"/api/me/trust/documents/sessions/{s['id']}/check")).json()["session"]["status"] == "pending"
    fake_setu.status = "authenticated"
    body = json.dumps({"id": "setu-req-1"}).encode()
    import hashlib
    import hmac

    sig = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
    assert (
        await client.post(
            "/api/public/trust/digilocker/callback/setu", content=body, headers={setu.CALLBACK_HEADER: sig}
        )
    ).status_code == 200
    out = (await c.get("/api/me/trust/documents")).json()
    assert out["session"]["status"] == "done" and out["session"]["missing"] == ["class10"]
    assert [d["kind"] for d in out["documents"]] == ["dl", "pan"] and all(
        d["state"] == "verified" for d in out["documents"]
    )
    assert out["documents"][0]["summary"] == "Driving licence (MCWG, LMV) · valid to 11 Apr 2039"
    blob = everything(await db[TRUST_DOCUMENTS].find({}).to_list(None))
    assert (
        "ABCPR6789K" not in blob
        and "999941057058" not in blob
        and "xxxxxxxx7058" not in blob
        and "TS0920190001234" not in blob
    )
    assert "9/4AAQ" not in blob and "12-04-1999" not in blob and "12/04/1999" not in blob and "ASHA RAO" not in blob
    paths = [p for _, p, _ in fake_setu.calls]
    assert not any(p.endswith("/aadhaar") for p in paths) and paths[-1].endswith("/revoke")
    assert all(sec == "sek" for m, p, sec in fake_setu.calls if not p.endswith(".xml"))
