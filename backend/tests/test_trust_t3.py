# ruff: noqa: E501
"""Vetting Trust T3: ID + live selfie. The test provider end to end (consent first, a fresh challenge, the check),
photos never kept (no image bytes anywhere in the database), Aadhaar refused, retries then a person (never a
rejection), asking for a manual check, the gate before the AI interview and a skill check (and not when switched off),
the joining-day "same person" check, taking back the consent deleting everything (also at the provider), retention,
switch OFF isolation, Admin settings (keys set / not set only), company badges only where allowed, the Rekognition
adapter against a fake AWS."""

import base64
import json
from datetime import timedelta

import httpx
import pytest
from bson import ObjectId

from app.core.config import get_settings
from app.core.db import AUDIT_LOG, HIRE_OFFERS, TRUST_FACE, TRUST_SELFIES, USERS, VETTING_VERIFIED
from app.core.security import decrypt, encrypt
from app.core.time import IST, now
from app.trust import retention as R
from app.trust.face import providers as P
from app.trust.face import rekognition
from app.trust.face import service as S
from tests.conftest import signup
from tests.test_companies_apply import company_job, student
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY

URL = "/api/me/trust/face"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"


def jpeg(mark: bytes = b"", n: int = 0) -> bytes:
    return JPEG + bytes([n % 256]) * 40 + b"SELFIEPIXELS" + mark + b"\xff\xd9"


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


ID_CARD = JPEG + b"IDCARDPIXELS-DL" + b"\xff\xd9"


async def person(make_client, outbox, db, email, name="Asha Rao", tester=True, consent=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        if consent:
            assert (await c.post("/api/me/trust/consents/selfie_face")).json()["status"] == "granted"
    return c, me["id"]


async def check(c, step="settings", frames=None, id_image=ID_CARD, doc="dl", challenge=None):
    if challenge is None:
        challenge = (await c.post(f"{URL}/challenge")).json()["key"]
    frames = frames or [jpeg(n=1), jpeg(n=2), jpeg(n=3)]
    return await c.post(f"{URL}/check", json={"step": step, "docType": doc, "idImage": b64(id_image),
                                               "frames": [b64(f) for f in frames], "challenge": challenge})  # fmt: skip


async def everything(db) -> bytes:
    """Every document in every collection, as bytes (to prove no photo was kept anywhere)."""
    out = []
    for name in await db.list_collection_names():
        async for d in db[name].find({}):
            out.append(json.dumps(d, default=lambda v: v.hex() if isinstance(v, bytes) else str(v)))
    return "\n".join(out).encode()


async def test_mock_check_flow_and_no_photo_is_kept(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "asha@example.com", consent=False)
    card = (await c.get(URL)).json()
    assert card["provider"] == {"ready": True, "test": True, "label": "Test provider (no real face check)"}
    assert card["consent"] is False and card["required"] == {"interview": True, "skillCheck": True}
    assert "never Aadhaar" in card["consentText"] and "30 days after your hiring process ends" in card["consentText"]
    assert "Amazon Web Services" in card["consentText"] and "don't save the photos" in card["consentText"]
    assert [d["key"] for d in card["docTypes"]] == ["dl", "pan"] and card["state"]["status"] == "none"
    r = await c.post(f"{URL}/challenge")
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_needed"  # the T1 "selfie_face" consent first
    await c.post("/api/me/trust/consents/selfie_face")

    assert (await check(c, challenge="smile-old")).json()["error"][
        "code"
    ] == "challenge_old"  # not the one we asked for
    marks = [b"FRAME-ONE-UNIQUE", b"FRAME-TWO-UNIQUE", b"FRAME-THREE-UNIQUE"]
    frames = [jpeg(m) for m in marks]
    r = await check(c, frames=frames)
    assert r.status_code == 200, r.text
    st = r.json()["state"]
    assert st["status"] == "verified" and st["statusText"] == "ID + selfie verified" and st["verifiedBy"] == "check"
    assert (
        st["liveness"] == {"pass": True, "score": 97}
        and st["match"] == {"pass": True, "score": 96}
        and st["hasReference"]
    )
    assert st["docType"] == "dl" and st["triesLeft"] == 3

    # photos are never kept: not the bytes, not the base64, not a marker; only results
    blob = await everything(db)
    for raw in [*frames, ID_CARD]:
        assert b64(raw).encode() not in blob and raw.hex().encode() not in blob
    for m in [*marks, b"IDCARDPIXELS", b"SELFIEPIXELS", b"/9j/", JPEG.hex().encode()]:
        assert m not in blob
    row = await db[TRUST_SELFIES].find_one({"user_id": uid})
    assert set(row) == {
        "_id",
        "user_id",
        "kind",
        "vendor",
        "test",
        "created_at",
        "step",
        "doc_type",
        "liveness",
        "match",
        "passed",
        "vendor_ref",
    }
    stt = await db[TRUST_FACE].find_one({"_id": uid})
    assert decrypt(stt["reference_enc"]).startswith("mock:")  # the face reference, encrypted
    assert await db[AUDIT_LOG].find_one({"action": "trust.face_check", "data.passed": True})
    # done: a second check just answers the state
    assert (await check(c)).json()["state"]["status"] == "verified"
    assert (await c.post(f"{URL}/check", json={"docType": "dl", "idImage": b64(b"GIF89a-not-a-photo"), "frames": [b64(jpeg()), b64(jpeg())],
                                               "challenge": "x"})).json()["error"]["code"] == "bad_image"  # fmt: skip


async def test_aadhaar_is_refused(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "bala@example.com")
    for doc in ("aadhaar", "Aadhar", "uid"):
        r = await check(c, doc=doc)
        assert r.status_code == 400 and r.json()["error"]["code"] == "aadhaar_refused", doc
    card = JPEG + "Government of India आधार AADHAAR 1234 5678 9012".encode() + b"\xff\xd9"
    r = await check(c, id_image=card)
    assert r.status_code == 400 and r.json()["error"]["code"] == "aadhaar_refused"
    assert "never take Aadhaar" in r.json()["error"]["message"]
    st = await db[TRUST_FACE].find_one({"_id": uid})
    assert st["status"] == "none" and st["tries"] == 0  # not counted as a failed try
    assert await db[TRUST_SELFIES].count_documents({"user_id": uid}) == 0  # nothing about the card is kept
    blob = await everything(db)
    assert b"1234 5678 9012" not in blob and "आधार".encode() not in blob
    assert await db[AUDIT_LOG].find_one({"action": "trust.face_aadhaar_refused"})


async def test_retries_then_a_person_never_a_rejection(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, db, "chitra@example.com")
    bad = [jpeg(b"MOCK:NOLIVE"), jpeg(n=2)]
    for left in (2, 1):
        st = (await check(c, frames=bad)).json()["state"]
        assert st["status"] == "retry" and st["triesLeft"] == left and "movement" in st["lastReason"]
    st = (await check(c, id_image=JPEG + b"MOCK:NOMATCH" + b"\xff\xd9")).json()["state"]
    assert st["status"] == "review" and st["statusText"] == "A person at Nm7 is checking this"
    assert st["review"]["kind"] == "tries" and st["review"]["reasonText"] == "The check didn’t pass after 3 tries."
    assert st["liveness"]["pass"] is True and st["match"] == {"pass": False, "score": 31}
    r = await check(c)
    assert (
        r.status_code == 409 and r.json()["error"]["code"] == "with_a_person"
    )  # waits for the person, nobody rejected
    u = await db[USERS].find_one({"_id": uid})
    assert not u.get("deleted_at") and not u.get("blocked")

    owner = await admin_client()
    q = (await owner.get("/api/admin/trust/face")).json()
    item = next(x for x in q["review"] if x["userId"] == uid)
    assert item["which"] == "identity" and item["userName"] == "Asha Rao" and item["review"]["kind"] == "tries"
    assert q["counts"]["review"] >= 1 and q["counts"]["failedToday"] >= 3
    # the person was called and verified them on a video call: recorded
    r = await owner.post(
        f"/api/admin/trust/face/{uid}/review",
        json={"which": "identity", "decision": "verified", "method": "video_call", "note": "Seen on a call"},
    )
    assert r.status_code == 200 and not any(x["userId"] == uid for x in r.json()["review"])
    st = (await c.get(URL)).json()["state"]
    assert st["status"] == "verified" and st["verifiedBy"] == "review"
    assert (
        st["review"]["status"] == "cleared"
        and st["review"]["methodText"] == "Video call with the Nm7 team"
        and st["review"]["decisionNote"] == "Seen on a call"
    )
    assert await db[AUDIT_LOG].find_one({"action": "trust.face_review", "target": uid})
    assert (
        await owner.post(f"/api/admin/trust/face/{uid}/review", json={"which": "identity", "decision": "same"})
    ).status_code == 400


async def test_manual_check_without_a_camera(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, db, "devi@example.com")
    out = (await c.post(f"{URL}/manual", json={"reason": "disability", "note": "I can't turn my head"})).json()
    assert out["state"]["status"] == "review" and out["state"]["review"]["kind"] == "manual"
    assert (
        out["state"]["review"]["reasonText"]
        == "You asked for a manual check: A disability makes the camera check hard for me."
    )
    owner = await admin_client()
    await owner.post(
        f"/api/admin/trust/face/{uid}/review",
        json={"which": "identity", "decision": "not_cleared", "method": "video_call", "note": "Missed the call"},
    )
    st = (await c.get(URL)).json()["state"]
    assert st["status"] == "not_cleared" and st["review"]["decisionNote"] == "Missed the call"
    # still never a dead end: ask again, a person looks again
    assert (await c.post(f"{URL}/manual", json={"reason": "other", "note": "Please call me again"})).json()["state"][
        "status"
    ] == "review"
    await owner.post(f"/api/admin/trust/face/{uid}/review", json={"which": "identity", "decision": "reset"})
    st = (await c.get(URL)).json()["state"]
    assert st["status"] == "none" and st["triesLeft"] == 3


async def _vetting_on(db, email):
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"vetting.testers": email}}, upsert=True)


async def test_gate_before_interview_and_skill_check(db, make_client, outbox, admin_client, monkeypatch):
    monkeypatch.setattr(P.Mock, "test", False)  # a real vendor connected: the gate asks first (test mode never blocks)
    c = await student(make_client, outbox, "esha@example.com", "Esha Rao")
    uid = (await db[USERS].find_one({"email": "esha@example.com"}))["_id"]
    await _vetting_on(db, "esha@example.com")
    t = now()
    await db[VETTING_VERIFIED].insert_one(
        {
            "user_id": uid,
            "test": "SQL",
            "band": "1-3",
            "score": 82,
            "task_score": 80,
            "at": t,
            "expires_at": t + timedelta(days=90),
        }
    )
    await c.post("/api/me/skill-checks/consent")
    # Trust hidden from this person: no gate at all
    r = await c.post("/api/me/skill-checks/start", json={"skill": "SQL"})
    assert r.status_code == 200, r.text
    await db["skill_attempts"].delete_many({"user_id": uid})

    # (Vetting Trust T9: Trust people also tick the honesty pledge, version 1)
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "esha@example.com"}})
    r = await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "face_check_needed"
    assert "driving licence or PAN card" in r.json()["error"]["message"] and r.json()["error"]["face"] == {
        "status": "none",
        "step": "skill_check",
    }
    r = await c.post("/api/me/interviews/start", json={"test": "SQL", "consent": True, "pledge": 1})
    assert (
        r.status_code == 409
        and r.json()["error"]["code"] == "face_check_needed"
        and r.json()["error"]["face"]["step"] == "interview"
    )
    assert (
        await db["skill_attempts"].count_documents({"user_id": uid}) == 0
        and await db["vetting_interviews"].count_documents({"user_id": uid}) == 0
    )

    # Admin: the interview doesn't need it any more, the skill check still does
    owner = await admin_client()
    d = (
        await owner.put(
            "/api/admin/trust/face", json={"provider": "mock", "require": {"interview": False, "skillCheck": True}}
        )
    ).json()
    assert d["require"] == {"interview": False, "skillCheck": True}
    assert (
        await c.post("/api/me/interviews/start", json={"test": "SQL", "consent": True, "pledge": 1})
    ).status_code == 200
    assert (await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1})).json()["error"][
        "code"
    ] == "face_check_needed"

    # verified → it starts
    await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})
    await c.post("/api/me/trust/consents/selfie_face")
    assert (await check(c, step="skill_check")).json()["state"]["status"] == "verified"
    assert (await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1})).status_code == 200
    # a person reviewing: told plainly, and nobody rejected
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"status": "review"}})
    await owner.put(
        "/api/admin/trust/face", json={"provider": "mock", "require": {"interview": True, "skillCheck": True}}
    )
    await db["vetting_interviews"].delete_many({"user_id": uid})
    r = await c.post("/api/me/interviews/start", json={"test": "SQL", "consent": True, "pledge": 1})
    assert (
        r.json()["error"]["code"] == "face_check_needed"
        and "A person at Nm7 is checking" in r.json()["error"]["message"]
    )


async def _offer(db, uid, join_in_days=0, status="accepted"):
    oid = ObjectId()
    day = (now().astimezone(IST).date() + timedelta(days=join_in_days)).isoformat()
    await db[HIRE_OFFERS].insert_one({"_id": oid, "user_id": uid, "company_id": "c1", "company_name": "Zoho", "title": "Analyst",
                                      "status": status, "join_date": day, "created_at": now()})  # fmt: skip
    return str(oid)


async def joining(c, oid, frames=None):
    ch = (await c.post(f"{URL}/challenge")).json()["key"]
    frames = frames or [jpeg(n=4), jpeg(n=5)]
    return await c.post(f"{URL}/joining/{oid}", json={"frames": [b64(f) for f in frames], "challenge": ch})


async def test_joining_day_same_person(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, db, "farah@example.com")
    far = await _offer(db, uid, join_in_days=20)
    oid = await _offer(db, uid, join_in_days=1)
    card = (await c.get(URL)).json()
    assert [o["offerId"] for o in card["joining"]] == [oid]  # opens a week before the join date
    assert (await joining(c, far)).json()["error"]["code"] == "not_joining"
    assert (await joining(c, oid)).json()["error"]["code"] == "no_reference"  # no earlier check yet
    await check(c)
    r = await joining(c, oid)
    st = r.json()["state"]
    assert (
        st["continuity"]["status"] == "same" and st["continuity"]["statusText"] == "Same person at joining: confirmed"
    )
    assert st["continuity"]["offerId"] == oid
    assert await db[TRUST_SELFIES].count_documents({"user_id": uid, "kind": "joining", "passed": True}) == 1

    # someone else in front of the camera: retry, then a person (never a rejection)
    g, guid = await person(make_client, outbox, db, "gopi@example.com")
    goid = await _offer(db, guid, join_in_days=0)
    await check(g)
    other = [jpeg(b"MOCKFACE:stranger"), jpeg(b"MOCKFACE:stranger", 2)]
    for left in (2, 1):
        c2 = (await joining(g, goid, other)).json()["state"]["continuity"]
        assert c2["status"] == "retry" and c2["triesLeft"] == left and "earlier check" in c2["lastReason"]
    c2 = (await joining(g, goid, other)).json()["state"]["continuity"]
    assert c2["status"] == "review" and c2["review"]["kind"] == "tries"
    owner = await admin_client()
    item = next(x for x in (await owner.get("/api/admin/trust/face")).json()["review"] if x["userId"] == guid)
    assert item["which"] == "joining"
    await owner.post(
        f"/api/admin/trust/face/{guid}/review",
        json={"which": "joining", "decision": "same", "method": "video_call", "note": "Twin brother joked"},
    )
    c2 = (await g.get(URL)).json()["state"]["continuity"]
    assert c2["status"] == "same" and c2["review"]["status"] == "cleared"


async def test_withdrawing_consent_deletes_everything_also_at_the_provider(db, make_client, outbox, monkeypatch):
    forgot = []

    async def forget(self, reference):
        forgot.append(reference)

    monkeypatch.setattr(P.Mock, "forget", forget)
    c, uid = await person(make_client, outbox, db, "hari@example.com")
    await check(c, frames=[jpeg(b"MOCK:NOLIVE"), jpeg()])
    await check(c)
    ref = decrypt((await db[TRUST_FACE].find_one({"_id": uid}))["reference_enc"])
    assert await db[TRUST_SELFIES].count_documents({"user_id": uid}) == 2
    out = (await c.delete("/api/me/trust/consents/selfie_face")).json()
    assert out["status"] == "withdrawn" and out["deleted"] == 3
    assert (
        await db[TRUST_FACE].count_documents({"_id": uid}) == 0
        and await db[TRUST_SELFIES].count_documents({"user_id": uid}) == 0
    )
    assert forgot == [ref]  # the provider's face data goes too
    r = await c.post(f"{URL}/challenge")
    assert r.status_code == 403  # consent needed again


async def test_retention_after_the_hiring_process_ends(db, make_client, outbox, monkeypatch):
    forgot = []

    async def forget(self, reference):
        forgot.append(reference)

    monkeypatch.setattr(P.Mock, "forget", forget)
    sched = {x["key"]: x for x in await R.schedule(db)}
    assert sched["face_check"]["days"] == 30 and sched["face_check"]["purpose"] == "selfie_face"
    assert "hiring process ends" in sched["face_check"]["note"]
    old = now() - timedelta(days=31)
    await db[TRUST_FACE].insert_many([{"_id": "u-old", "user_id": "u-old", "status": "verified", "vendor": "mock", "reference_enc": encrypt("mock:abc"), "process_at": old},
                                      {"_id": "u-offer", "user_id": "u-offer", "status": "verified", "process_at": old},
                                      {"_id": "u-new", "user_id": "u-new", "status": "verified", "process_at": now()}])  # fmt: skip
    await db[HIRE_OFFERS].insert_one(
        {"user_id": "u-offer", "status": "accepted", "join_date": "2099-01-01", "created_at": now()}
    )
    counts = await R.run_types(db, "trust")
    assert counts["face_check"] == 1 and forgot == ["mock:abc"]
    left = {d["_id"]: d for d in await db[TRUST_FACE].find({}).to_list(None)}
    assert set(left) == {"u-offer", "u-new"} and left["u-offer"]["process_at"] > now() - timedelta(
        minutes=1
    )  # still hiring


async def test_switch_off_hides_it(db, make_client, outbox):
    c, _ = await person(make_client, outbox, db, "indu@example.com", tester=False)
    for method, path, body in (("get", URL, None), ("post", f"{URL}/challenge", None), ("post", f"{URL}/check", {"docType": "dl"}),
                               ("post", f"{URL}/joining/x", {"frames": []}), ("post", f"{URL}/manual", {"reason": "other"})):  # fmt: skip
        r = await getattr(c, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 404, path


async def test_admin_settings_keys_and_production_gate(db, admin_client, monkeypatch):
    owner = await admin_client()
    d = (await owner.get("/api/admin/trust/face")).json()
    assert d["provider"] == "mock" and {p["key"] for p in d["providers"]} == {"mock", "rekognition"}
    assert d["livenessMin"] == 90 and d["matchMin"] == 90 and d["sameMin"] == 90 and d["maxTries"] == 3
    rk = next(p for p in d["providers"] if p["key"] == "rekognition")
    assert (
        rk["ready"] is False
        and rk["keys"]["REKOGNITION_ACCESS_KEY_ID"] is False
        and rk["keys"]["REKOGNITION_REGION"] is True
    )
    monkeypatch.setattr(get_settings(), "rekognition_access_key_id", "AKIAEXAMPLEKEY")
    monkeypatch.setattr(get_settings(), "rekognition_secret_access_key", "very-secret-value")
    r = await owner.put("/api/admin/trust/face", json={"provider": "rekognition", "livenessMin": 85, "matchMin": 92, "sameMin": 88, "maxTries": 2,
                                                         "require": {"interview": True, "skillCheck": False}})  # fmt: skip
    d = r.json()
    assert (
        d["provider"] == "rekognition" and next(p for p in d["providers"] if p["key"] == "rekognition")["ready"] is True
    )
    assert (d["livenessMin"], d["matchMin"], d["sameMin"], d["maxTries"]) == (85, 92, 88, 2) and d["require"][
        "skillCheck"
    ] is False
    assert "very-secret-value" not in r.text and "AKIAEXAMPLEKEY" not in r.text
    assert (await owner.put("/api/admin/trust/face", json={"provider": "other"})).status_code == 422
    assert (await owner.put("/api/admin/trust/face", json={"provider": "mock", "matchMin": 20})).status_code == 422
    assert (await (await admin_client("ops")).get("/api/admin/trust/face")).status_code == 403
    assert await db[AUDIT_LOG].find_one({"action": "trust.face_settings"})
    monkeypatch.setattr(get_settings(), "app_env", "prod")
    site = {"trust": {"face": {"provider": "mock"}}}
    assert await S.provider_for(db, {"email": "x@example.com"}, site, set()) is None
    assert await S.provider_for(db, {"email": "x@example.com"}, site, {"x@example.com"}) is not None
    assert await S.provider_for(db, {"demo": True}, site, set()) is not None
    monkeypatch.setattr(get_settings(), "rekognition_access_key_id", "")
    assert await S.provider_for(db, {"demo": True}, {"trust": {"face": {"provider": "rekognition"}}}, set()) is None


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
    t = now()
    await db[TRUST_FACE].insert_one({"_id": uid, "user_id": uid, "status": "verified", "verified_at": t, "test": True, "process_at": t,
                                     "liveness": {"pass": True, "score": 97}, "continuity": {"status": "same", "at": t}})  # fmt: skip

    async def views():
        apps = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
        one = (await client.get(f"/api/company/{cid}/applicants/{apps[0]['id']}", headers=H(session))).json()
        hire = (
            await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job["id"]}, headers=H(session))
        ).json()["items"]
        return apps[0], one, next(x for x in hire if x["key"] == uid)

    for row in await views():
        assert "face" not in row  # Trust hidden from this company
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "founder@gmail.com"}}, upsert=True)
    for row in await views():
        assert row["face"]["verifiedAt"] and row["face"]["samePersonAt"] and row["face"]["test"] is True
        assert set(row["face"]) == {"verifiedAt", "samePersonAt", "test"}  # never a photo, a score or a reason
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"status": "review"}})
    assert (await views())[0]["face"] is None


class FakeAws:
    def __init__(self):
        self.calls = []
        self.text = "INCOME TAX DEPARTMENT ABCDE1234F"
        self.yaws = [0.0, 22.0, 3.0]
        self.collection = False
        self.live = 0  # liveness DetectFaces calls (Attributes ALL) so far

    def __call__(self, req: httpx.Request) -> httpx.Response:
        action = req.headers["x-amz-target"].split(".")[-1]
        body = json.loads(req.content)
        self.calls.append((action, req.headers.get("authorization", "")))
        assert req.url.host == "rekognition.ap-south-1.amazonaws.com"
        h = {"x-amzn-RequestId": f"req-{len(self.calls)}"}
        if action == "DetectText":
            return httpx.Response(
                200, headers=h, json={"TextDetections": [{"Type": "LINE", "DetectedText": self.text}]}
            )
        if action == "DetectFaces":
            yaw = 0.0
            if body["Attributes"] == ["ALL"]:  # a selfie frame (the card is asked with DEFAULT)
                yaw = self.yaws[self.live % len(self.yaws)]
                self.live += 1
            return httpx.Response(
                200,
                headers=h,
                json={
                    "FaceDetails": [
                        {
                            "Confidence": 99.9,
                            "Pose": {"Yaw": yaw},
                            "FaceOccluded": {"Value": False},
                            "Smile": {"Value": False},
                        }
                    ]
                },
            )
        if action == "CompareFaces":
            return httpx.Response(200, headers=h, json={"FaceMatches": [{"Similarity": 97.5}], "UnmatchedFaces": []})
        if action == "IndexFaces":
            if not self.collection:
                return httpx.Response(
                    400, headers=h, json={"__type": "ResourceNotFoundException", "message": "no collection"}
                )
            assert body["ExternalImageId"] and len(body["ExternalImageId"]) <= 40 and body["MaxFaces"] == 1
            return httpx.Response(200, headers=h, json={"FaceRecords": [{"Face": {"FaceId": "face-123"}}]})
        if action == "CreateCollection":
            self.collection = True
            return httpx.Response(200, headers=h, json={"StatusCode": 200})
        if action == "SearchFacesByImage":
            return httpx.Response(
                200,
                headers=h,
                json={
                    "FaceMatches": [
                        {"Similarity": 96.0, "Face": {"FaceId": "face-123"}},
                        {"Similarity": 99.0, "Face": {"FaceId": "someone-else"}},
                    ]
                },
            )
        if action == "DeleteFaces":
            assert body["FaceIds"] == ["face-123"]
            return httpx.Response(200, headers=h, json={"DeletedFaces": ["face-123"]})
        return httpx.Response(400, json={"__type": "UnknownOperationException"})


@pytest.fixture
def fake_aws(monkeypatch):
    fake = FakeAws()
    monkeypatch.setattr(rekognition, "HTTP_CLIENT", httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    monkeypatch.setattr(get_settings(), "rekognition_access_key_id", "AKIDEXAMPLE")
    monkeypatch.setattr(get_settings(), "rekognition_secret_access_key", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY")
    return fake


def test_sigv4_signature():
    from datetime import UTC, datetime

    h = rekognition.sign("POST", "rekognition.ap-south-1.amazonaws.com", "ap-south-1", "RekognitionService.DetectFaces", b"{}",
                         "AKIDEXAMPLE", "secret", datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC))  # fmt: skip
    assert h["x-amz-date"] == "20260102T030405Z"
    assert h["authorization"].startswith(
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260102/ap-south-1/rekognition/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature="
    )
    again = rekognition.sign("POST", "rekognition.ap-south-1.amazonaws.com", "ap-south-1", "RekognitionService.DetectFaces", b"{}",
                             "AKIDEXAMPLE", "secret", datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC))  # fmt: skip
    assert again == h and len(h["authorization"].rsplit("=", 1)[-1]) == 64


async def test_rekognition_adapter(db, make_client, outbox, admin_client, fake_aws):
    owner = await admin_client()
    await owner.put("/api/admin/trust/face", json={"provider": "rekognition"})
    c, uid = await person(make_client, outbox, db, "jaya@example.com")
    ch = (await c.post(f"{URL}/challenge")).json()["key"]
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"challenge": "turn_left"}})  # the fake turns the head
    r = await check(c, challenge="turn_left", id_image=ID_CARD)
    assert ch and r.status_code == 200, r.text
    st = r.json()["state"]
    assert st["status"] == "verified" and st["liveness"]["pass"] and st["match"] == {"pass": True, "score": 97.5}
    actions = [a for a, _ in fake_aws.calls]
    assert (
        actions[:2] == ["DetectText", "DetectFaces"]
        and actions.count("CreateCollection") == 1
        and "IndexFaces" in actions
    )
    assert all(auth.startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/") for _, auth in fake_aws.calls)
    stt = await db[TRUST_FACE].find_one({"_id": uid})
    assert decrypt(stt["reference_enc"]) == "face-123" and "req-" in stt["vendor_ref"]
    assert b"wJalrXUtnFEMI" not in await everything(db)

    # the joining day: SearchFacesByImage finds the same FaceId
    oid = await _offer(db, uid, 0)
    await c.post(f"{URL}/challenge")
    await db[TRUST_FACE].update_one({"_id": uid}, {"$set": {"challenge": "turn_left"}})
    fake_aws.live = 0
    r = await c.post(f"{URL}/joining/{oid}", json={"frames": [b64(jpeg()), b64(jpeg(n=2))], "challenge": "turn_left"})
    assert r.json()["state"]["continuity"]["status"] == "same"

    # a head that didn't turn: liveness fails, a try is used
    p = rekognition.Rekognition()
    fake_aws.live = 0
    fake_aws.yaws = [0.0, 4.0, 2.0]
    s = await p.liveness([jpeg(), jpeg(), jpeg()], "turn_right")
    assert s.score < 90 and "movement" in s.reason
    # an Aadhaar card is recognised from its text and refused before anything else is asked
    fake_aws.text = "Government of India  1234 5678 9012"
    assert (await p.read_id(ID_CARD)).kind == "aadhaar"
    # withdrawing deletes the face at AWS
    await c.delete("/api/me/trust/consents/selfie_face")
    assert ("DeleteFaces" in [a for a, _ in fake_aws.calls]) and await db[TRUST_FACE].count_documents({"_id": uid}) == 0


async def test_gate_never_blocks_in_test_mode_or_without_a_camera(db, make_client, outbox, admin_client, monkeypatch):
    """Batch A (20 Nov live test): the selfie gate stopped people with no camera. With only the test provider (vendor
    keys missing) the test starts, marked "face check pending"; with a real vendor, "No camera right now" starts it too,
    flagged for a later check. Nobody is rejected for it."""
    c = await student(make_client, outbox, "gita@example.com", "Gita Rao")
    uid = (await db[USERS].find_one({"email": "gita@example.com"}))["_id"]
    await _vetting_on(db, "gita@example.com")
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "gita@example.com"}})
    await c.post("/api/me/skill-checks/consent")
    r = await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1})
    assert r.status_code == 200, r.text
    assert r.json()["facePending"] is True
    a = await db["skill_attempts"].find_one({"user_id": uid})
    assert a["face"]["status"] == "pending" and a["face"]["why"] == "test_mode"
    await db["skill_attempts"].delete_many({"user_id": uid})

    monkeypatch.setattr(P.Mock, "test", False)  # a real vendor: asked first, unless there is no camera
    r = await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "face_check_needed"
    r = await c.post("/api/me/skill-checks/start", json={"skill": "SQL", "pledge": 1, "noCamera": True})
    assert r.status_code == 200, r.text
    a = await db["skill_attempts"].find_one({"user_id": uid})
    assert a["face"]["why"] == "no_camera" and r.json()["facePending"] is True
    assert await db[AUDIT_LOG].count_documents({"action": "trust.face_pending", "actor_id": uid}) == 2
    # the face state itself is untouched: no rejection, nothing marked against the person
    assert ((await db[TRUST_FACE].find_one({"_id": uid})) or {}).get("status") in (None, "none")
