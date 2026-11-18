# ruff: noqa: E501
"""Vetting Trust T8: one integrity rating per candidate. The documented weighting (weights, 60-day half-life, caps,
confirmed 1.5×), cleared signals ignored, "Not enough data", signals from every source (V2 test, V3 interview, V5 fraud
scan + appeals, T2 documents, T3 face, T8 snapshots; a manual-check request never counts), High → a human review
(never a rejection, nobody hidden), the candidate's plain evidence view and explanation, the company seeing only the
label ("Under review by Nm7" while open, "Reviewed by Nm7" after), webcam snapshots only with their own consent
(encrypted, at most N, audited Admin access, deleted by retention and on withdrawal), multiple faces → a signal not a
rejection, switch OFF isolation and V5 unchanged."""

import base64
import json
from datetime import timedelta

from bson import ObjectId

from app.core.db import (
    AUDIT_LOG,
    SKILL_ATTEMPTS,
    TRUST_DOCUMENTS,
    TRUST_FACE,
    TRUST_INTEGRITY,
    TRUST_SNAPSHOTS,
    USERS,
    VETTING_INTERVIEWS,
    VETTING_QUEUE,
)
from app.core.time import now
from app.trust import retention as R
from app.trust.integrity import rating as RT
from app.trust.integrity import service as S
from app.trust.integrity.rating import Signal
from tests.conftest import signup
from tests.test_companies_apply import company_job, student
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY

URL = "/api/me/trust/integrity"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"


def jpeg(mark: bytes = b"") -> bytes:
    return JPEG + b"SNAPSHOTPIXELS" + mark + b"\xff\xd9"


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


async def person(make_client, outbox, db, email, name="Asha Rao", tester=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
    return c, me["id"]


async def attempt(db, uid, reasons, days=0, skill="SQL", submitted=True, **extra):
    t = now() - timedelta(days=days)
    a = {"_id": ObjectId(), "v": 2, "user_id": uid, "skill": skill, "started_at": t, "last_seen": t, "remaining_ms": 600_000,
         "submitted_at": t if submitted else None, "integrity": {"level": "retest" if reasons else "clean", "points": 2 * len(reasons), "reasons": reasons}, **extra}  # fmt: skip
    await db[SKILL_ATTEMPTS].insert_one(a)
    return a["_id"]


# --- the rating math ---------------------------------------------------------------------------------------------------


def test_rating_math_weights_decay_caps_confirmed_cleared():
    t = now()

    def sig(kind, days=0, status="open", key=None):
        return Signal(
            key=key or f"{kind}:{days}:{status}", kind=kind, at=t - timedelta(days=days), where="x", status=status
        )

    # a weight, fading by half every 60 days, gone after 365
    assert RT.score([sig("paste")], 1, t)["score"] == 1.5
    assert RT.score([sig("paste", 60)], 1, t)["score"] == 0.75
    assert RT.score([sig("paste", 120)], 1, t)["score"] == 0.38
    assert RT.score([sig("paste", 400)], 1, t)["score"] == 0
    assert RT.decay(0) == 1 and RT.decay(60) == 0.5 and RT.decay(366) == 0
    # a cap per kind: five paste signals never add more than 3
    many = [sig("paste", key=f"p{i}") for i in range(5)]
    r = RT.score(many, 1, t)
    assert r["score"] == 3.0 and r["byKind"] == {"paste": 3.0} and round(sum(s.weight for s in many), 2) == 3.0
    # cleared by a person: 0; confirmed: 1.5× and no fading
    assert RT.score([sig("doc_pan_dup", status="cleared")], 1, t)["score"] == 0
    assert RT.score([sig("doc_pan_dup", 200, status="confirmed")], 1, t)["score"] == 4.0  # capped at 4 (1.5 × 4 = 6)
    assert RT.score([sig("fraud_dates", 200, status="confirmed")], 1, t)["score"] == 1.0
    assert RT.score([sig("paste", 300, status="confirmed")], 1, t)["score"] == 2.25
    # levels: < 3 low, 3–6 medium, ≥ 6 high; nothing done and nothing noticed: not enough data
    assert RT.score([], 0, t)["level"] == "not_enough_data" and RT.score([], 0, t)["label"] == "Not enough data"
    assert RT.score([], 2, t)["level"] == "low"
    assert (
        RT.score([sig("cleared-only", status="cleared")], 0, t)["level"] == "not_enough_data"
    )  # a cleared signal counts for nothing
    assert RT.score([sig("doc_pan_dup")], 1, t)["level"] == "medium"
    assert RT.score([sig("doc_pan_dup"), sig("fraud_resume")], 1, t)["level"] == "high"
    assert RT.score([sig("tab_away"), sig("time_away")], 1, t)["level"] == "low"
    # the documented method is the code's own numbers
    m = RT.method()
    assert m["halfLifeDays"] == 60 and m["highAt"] == 6 and m["mediumAt"] == 3 and m["confirmedFactor"] == 1.5
    assert {k["kind"] for k in m["kinds"]} == set(RT.KINDS) and all(k["weight"] <= k["cap"] for k in m["kinds"])


# --- signals from every source ------------------------------------------------------------------------------------------


async def test_every_source_and_the_candidates_plain_view(db, make_client, outbox):
    c, uid = await person(make_client, outbox, db, "asha@example.com")
    _, other = await person(make_client, outbox, db, "bala@example.com", "Bala K", tester=False)
    d = (await c.get(URL)).json()
    assert d["level"] == "not_enough_data" and d["signals"] == [] and "never rejects you" in d["never"]
    assert d["snapshots"]["note"] == "No webcam snapshots (they are optional)."

    aid = await attempt(db, uid, ["paste", "too_fast"])
    await attempt(db, uid, [], skill="Excel")  # a clean attempt: an observation, no signal
    iv = ObjectId()
    await db[VETTING_INTERVIEWS].insert_one({"_id": iv, "user_id": uid, "test": "SQL", "status": "graded", "started_at": now(), "graded_at": now(),
                                             "signals": {"pasteAttempts": 4, "blurs": 2, "blurMs": 1000}})  # fmt: skip
    fq = (await db[VETTING_QUEUE].insert_one({"kind": "fraud", "key": "device:abc", "what": "Same device on several accounts", "users": [uid, other],
                                              "evidence": ["The same device took skill checks on 2 accounts in 30 days"], "status": "open",
                                              "created_at": now(), "updated_at": now()})).inserted_id  # fmt: skip
    await db[TRUST_DOCUMENTS].insert_one(
        {"user_id": uid, "kind": "pan", "fetched_at": now(), "review": {"status": "open", "reasons": ["pan_elsewhere"]}}
    )
    await db[TRUST_FACE].insert_one(
        {
            "_id": uid,
            "status": "review",
            "review": {"status": "open", "kind": "tries", "requested_at": now(), "last_reason": "No movement"},
        }
    )

    d = (await c.get(URL)).json()
    kinds = {s["key"].split(":")[0] for s in d["signals"]}
    assert kinds == {"attempt", "interview", "fraud", "doc", "face"}
    # 1.5 paste + 1.5 too fast + 1.5 iv paste + 2.5 device + 4 PAN + 2.5 selfie = 13.5 → High
    assert d["score"] == 13.5 and d["level"] == "high" and d["label"] == "High risk"
    assert d["review"]["status"] == "open" and "Nothing is decided automatically" in d["review"]["text"]
    paste = next(s for s in d["signals"] if s["key"] == f"attempt:{aid}:paste")
    assert paste == {"key": f"attempt:{aid}:paste", "what": "Text was pasted into an answer.", "where": "Skill check: SQL", "at": paste["at"],
                     "weight": 1.5, "status": "open", "statusText": "Open", "appeal": {"kind": "skill", "ref": str(aid)}}  # fmt: skip
    blob = json.dumps(d)
    assert (
        "Bala" not in blob and other not in blob and "device took" not in blob and "fraud" not in d["label"].lower()
    )  # plain words only

    # the sources' own human decisions count: an upheld V5 appeal clears the attempt, a V5 "clear" clears the scan item,
    # a T2 "cleared" review clears the document; a manual-check request (no camera) is never a signal
    await db[VETTING_QUEUE].insert_one(
        {
            "kind": "appeal",
            "what": "skill",
            "ref": aid,
            "user_id": uid,
            "skill": "SQL",
            "status": "done",
            "outcome": "retest",
            "created_at": now(),
        }
    )
    await db[VETTING_QUEUE].update_one({"_id": fq}, {"$set": {"status": "done", "decision": "clear"}})
    await db[TRUST_DOCUMENTS].update_one({"user_id": uid}, {"$set": {"review.status": "cleared"}})
    await db[TRUST_FACE].update_one(
        {"_id": uid},
        {"$set": {"review": {"status": "open", "kind": "manual", "reason": "disability", "requested_at": now()}}},
    )
    d = (await c.get(URL)).json()
    st = {s["key"]: s["status"] for s in d["signals"]}
    assert st[f"attempt:{aid}:paste"] == "cleared" and st[f"fraud:{fq}"] == "cleared" and "face:identity" not in st
    assert d["score"] == 1.5 and d["level"] == "low"  # only the interview paste is left
    # V5's own records are untouched by T8
    assert (await db[VETTING_QUEUE].find_one({"_id": fq}))["decision"] == "clear"


# --- High → a human review, never a rejection; the company sees the label only --------------------------------------------


async def test_review_flow_company_label_and_never_hidden(db, client, outbox, make_client, admin_client):
    session, cid, job = await company_job(client, outbox, db)
    asha = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await asha.put("/api/me/hire", json=READY)
    assert (
        await asha.post(
            f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {"q1": "yes", "q2": 12, "q3": "Day"}}
        )
    ).status_code == 201
    uid = (await db[USERS].find_one({"email": "asha@example.com"}))["_id"]

    async def views():
        apps = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
        one = (await client.get(f"/api/company/{cid}/applicants/{apps[0]['id']}", headers=H(session))).json()
        hire = (
            await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job["id"]}, headers=H(session))
        ).json()["items"]
        return apps[0], one, next(x for x in hire if x["key"] == uid)

    for row in await views():
        assert "integrity" not in row  # Trust hidden from this company
    await db["settings"].update_one(
        {"_id": "site"},
        {"$addToSet": {"trust.testers": {"$each": ["founder@gmail.com", "asha@example.com"]}}},
        upsert=True,
    )
    await asha.post("/api/me/trust/age", json={"dob": "1999-04-12"})
    for row in await views():
        assert row["integrity"]["label"] in ("Not enough data", "Low risk")

    a1 = await attempt(db, uid, ["pattern_match", "shared_device"])
    await db[TRUST_DOCUMENTS].insert_one(
        {"user_id": uid, "kind": "pan", "fetched_at": now(), "review": {"status": "open", "reasons": ["pan_elsewhere"]}}
    )
    owner = await admin_client()
    run = (await owner.post("/api/admin/trust/integrity/run")).json()
    assert run["done"]["rated"] >= 1 and run["done"]["high"] >= 1
    item = next(x for x in run["queue"] if x["userId"] == uid)
    assert (
        item["level"] == "high"
        and item["review"]["status"] == "open"
        and item["review"]["whyText"] == "High risk rating"
    )

    # while the review is open the company sees only "Under review by Nm7": never the signals, never "fraud"
    for row in await views():
        assert row["integrity"] == {
            "label": "Under review by Nm7",
            "level": None,
            "underReview": True,
            "reviewed": False,
        }
        assert "fraud" not in json.dumps(row).lower() and "pattern" not in json.dumps(row["integrity"])
    # never rejected or hidden: still in Applicants with the same status, still in Hire now
    app_row = (await views())[0]
    assert app_row["status"] not in ("rejected", "not_a_fit")
    assert (await db[USERS].find_one({"_id": uid})).get("deleted_at") is None

    # the evidence view (reviewers): weight, cap, status, detail
    ev = (await owner.get(f"/api/admin/trust/integrity/{uid}")).json()
    pan = next(s for s in ev["signals"] if s["kind"] == "doc_pan_dup")
    assert pan["weight"] == 4.0 and pan["cap"] == 4.0 and pan["status"] == "open" and pan["source"] == "T2 documents"
    assert ev["score"] == 9.0 and ev["level"] == "high"  # 3 + 2 + 4
    assert await db[AUDIT_LOG].find_one({"action": "trust.integrity_evidence_viewed", "target": uid})
    # clear one, confirm one (1.5×, capped), ask the candidate to explain (an email: Asha is a tester)
    ev = (
        await owner.post(
            f"/api/admin/trust/integrity/{uid}/signals",
            json={"key": f"attempt:{a1}:pattern_match", "decision": "clear", "note": "Common answers"},
        )
    ).json()
    assert next(s for s in ev["signals"] if s["kind"] == "pattern_match")["status"] == "cleared" and ev["score"] == 6.0
    ev = (
        await owner.post(
            f"/api/admin/trust/integrity/{uid}/signals",
            json={"key": f"attempt:{a1}:shared_device", "decision": "confirm"},
        )
    ).json()
    assert ev["score"] == 7.0  # 2 × 1.5 = 3, + 4
    outbox.sent.clear()
    ev = (await owner.post(f"/api/admin/trust/integrity/{uid}/ask", json={"note": "Who else used your laptop?"})).json()
    assert ev["review"]["status"] == "asked"
    mail = next(m for m in outbox.sent if m.to == "asha@example.com")
    assert "Nothing has been decided" in mail.text and "fraud" not in mail.text.lower()

    # the candidate is told plainly and explains
    mine = (await asha.get(URL)).json()
    assert mine["review"]["status"] == "asked" and mine["review"]["askNote"] == "Who else used your laptop?"
    mine = (
        await asha.post(f"{URL}/explain", json={"note": "My brother used the same laptop for his own test."})
    ).json()
    assert mine["review"]["status"] == "open" and mine["review"]["explanation"].startswith("My brother")
    # the reviewer finishes: companies see the label and "Reviewed by Nm7"
    ev = (
        await owner.post(f"/api/admin/trust/integrity/{uid}/close", json={"note": "Explained; PAN checked by phone."})
    ).json()
    assert ev["review"]["status"] == "closed" and ev["reviewedAt"]
    for row in await views():
        assert row["integrity"] == {"label": "High risk", "level": "high", "underReview": False, "reviewed": True}
    assert (await asha.get(URL)).json()["review"]["note"] == "Explained; PAN checked by phone."
    # a re-rating with no new signal doesn't open it again
    await S.pass_(db, force=True)
    assert (await db[TRUST_INTEGRITY].find_one({"_id": uid}))["review"]["status"] == "closed"
    for action in (
        "trust.integrity_signal",
        "trust.integrity_asked",
        "trust.integrity_explained",
        "trust.integrity_review_closed",
    ):
        assert await db[AUDIT_LOG].find_one({"action": action}), action


# --- webcam snapshots ---------------------------------------------------------------------------------------------------


async def test_snapshots_only_with_consent_encrypted_capped_audited_deleted(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, db, "chitra@example.com")
    aid = str(await attempt(db, uid, [], submitted=False))
    off = (await c.get(f"{URL}/snapshots")).json()
    assert off["offer"] is True and off["consent"] is False and off["perSession"] == 4
    assert "No video and no sound" in off["text"] and "30 days" in off["text"] and "Saying no is fine" in off["text"]
    # no consent: the test works normally, nothing is taken, the rating says "no snapshots"
    p = (await c.post(f"{URL}/snapshots/plan", json={"kind": "skill", "ref": aid})).json()
    assert p["on"] is False and "No webcam snapshots" in p["note"]
    r = await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg())})
    assert r.status_code == 403
    assert await db[TRUST_SNAPSHOTS].count_documents({}) == 0
    assert (await c.get(URL)).json()["snapshots"]["note"] == "No webcam snapshots (they are optional)."

    assert (await c.post("/api/me/trust/consents/webcam_snapshots")).json()["status"] == "granted"
    p = (await c.post(f"{URL}/snapshots/plan", json={"kind": "skill", "ref": aid})).json()
    assert p["on"] is True and p["n"] == 4 and len(p["dueInMs"]) == 4 and 1000 <= p["dueInMs"][0] <= 25_000
    assert p["dueInMs"] == sorted(p["dueInMs"])
    marks = [b"SNAP-ONE-UNIQUE", b"SNAP-TWO-UNIQUE"]
    t0 = now()
    for i, m in enumerate(marks):
        if i:
            await db[TRUST_SNAPSHOTS].update_one(
                {"_id": f"{uid}:skill:{aid}"}, {"$set": {"last_at": t0 - timedelta(seconds=10)}}
            )
        r = await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg(m))})
        assert r.status_code == 200, r.text
    assert r.json() == {"taken": 2, "left": 2}
    r = await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg(b"TOO-SOON"))})
    assert r.status_code == 409  # 3 seconds at least between two photos
    # stored encrypted: neither the bytes nor the base64 nor a marker are readable in the database
    rows = await db[TRUST_SNAPSHOTS].find({"kind": "photo"}).to_list(10)
    assert len(rows) == 2 and all(x["check"]["faces"] == 1 for x in rows)
    blob = json.dumps(rows, default=str).encode()
    for m in marks:
        assert m not in blob and b64(jpeg(m)).encode() not in blob and m.hex().encode() not in blob
    assert b"SNAPSHOTPIXELS" not in blob and b"/9j/" not in blob
    # at most N per session
    for i in range(2):
        await db[TRUST_SNAPSHOTS].update_one(
            {"_id": f"{uid}:skill:{aid}"}, {"$set": {"last_at": now() - timedelta(seconds=10)}}
        )
        assert (
            await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg(b"%d" % i))})
        ).status_code == 200
    await db[TRUST_SNAPSHOTS].update_one(
        {"_id": f"{uid}:skill:{aid}"}, {"$set": {"last_at": now() - timedelta(seconds=10)}}
    )
    assert (await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg(b"five"))})).json()[
        "error"
    ]["code"] == "enough"
    # not a photo of someone else's test, and not a GIF
    _, bob = await person(make_client, outbox, db, "bob@example.com", "Bob")
    bob_aid = str(await attempt(db, bob, [], submitted=False))
    assert (await c.post(f"{URL}/snapshots/plan", json={"kind": "skill", "ref": bob_aid})).status_code == 404
    assert (
        await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(b"GIF89a-not-a-jpeg-photo")})
    ).json()["error"]["code"] == "bad_image"
    assert (await c.get(URL)).json()["snapshots"]["note"].startswith("4 webcam snapshots")

    # only reviewers see a photo, and each look is recorded
    owner = await admin_client()
    ev = (await owner.get(f"/api/admin/trust/integrity/{uid}")).json()
    assert len(ev["snapshots"]) == 4 and "image" not in json.dumps(ev["snapshots"]) and ev["snapshotConsent"] is True
    one = (await owner.get(f"/api/admin/trust/integrity/{uid}/snapshots/{ev['snapshots'][0]['id']}")).json()
    assert one["image"].startswith("data:image/jpeg;base64,") and base64.b64decode(
        one["image"].split(",")[1]
    ).startswith(JPEG)
    assert await db[AUDIT_LOG].find_one({"action": "trust.snapshot_viewed", "target": uid})
    assert len((await db[TRUST_SNAPSHOTS].find_one({"_id": ObjectId(ev["snapshots"][0]["id"])}))["views"]) == 1
    assert (await c.get(f"/api/admin/trust/integrity/{uid}/snapshots/{ev['snapshots'][0]['id']}")).status_code in (
        401,
        403,
    )

    # retention: the T1 schedule (30 days by default, Admin 1–60) deletes them
    dt = R.TYPES["webcam_snapshots"]
    assert dt.days == 30 and dt.min_days == 1 and dt.max_days == 60 and dt.purpose == "webcam_snapshots"
    await db[TRUST_SNAPSHOTS].update_many({"kind": "photo"}, {"$set": {"created_at": now() - timedelta(days=31)}})
    assert await R.clean_type(db, dt, 30, now()) == 4
    assert await db[TRUST_SNAPSHOTS].count_documents({"kind": "photo"}) == 0
    # taking the consent back deletes the rest now
    await db[TRUST_SNAPSHOTS].insert_one(
        {"_id": ObjectId(), "kind": "photo", "user_id": uid, "created_at": now(), "img_enc": "x", "check": {}}
    )
    assert (await c.delete("/api/me/trust/consents/webcam_snapshots")).json()["deleted"] >= 1
    assert await db[TRUST_SNAPSHOTS].count_documents({"user_id": uid}) == 0


async def test_multiple_faces_or_another_person_is_a_signal_not_a_rejection(db, make_client, outbox, admin_client):
    c, uid = await person(
        make_client, outbox, db, "devi@example.com", "Devi Twofaces"
    )  # the test provider: 2 faces for "twofaces"
    await c.post("/api/me/trust/consents/webcam_snapshots")
    aid = str(await attempt(db, uid, [], submitted=False))
    await c.post(f"{URL}/snapshots/plan", json={"kind": "skill", "ref": aid})
    assert (
        await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg())})
    ).status_code == 200
    await db[TRUST_SNAPSHOTS].update_one(
        {"_id": f"{uid}:skill:{aid}"}, {"$set": {"last_at": now() - timedelta(seconds=10)}}
    )
    await c.post(f"{URL}/snapshots", json={"kind": "skill", "ref": aid, "image": b64(jpeg(b"MOCK:NOFACE"))})
    d = (await c.get(URL)).json()
    whats = sorted(s["what"] for s in d["signals"])
    assert whats == ["More than one face was in a webcam photo.", "No face could be seen in a webcam photo."]
    assert d["score"] == 2.0 and d["level"] == "low"
    # the test itself is untouched (still running, no integrity change), nothing is rejected
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(aid)})
    assert a["submitted_at"] is None and a["integrity"]["level"] == "clean"

    # same person as the ID + selfie check (T3's provider and reference)
    _, uid2 = await person(make_client, outbox, db, "esha@example.com", "Esha Otherface")
    from app.core.security import encrypt
    from app.trust.face import providers as P

    ref = await P.Mock().enroll(uid2, jpeg(), hint="")  # enrolled as "self"; the name now says "otherface"
    await db[TRUST_FACE].insert_one(
        {"_id": uid2, "status": "verified", "vendor": "mock", "reference_enc": encrypt(ref), "test": True}
    )
    chk = await S._check(db, uid2, jpeg())
    assert chk["faces"] == 1 and chk["same"] is False and chk["score"] < 90


# --- switch OFF: nothing new for real users; V5 exactly as before -------------------------------------------------------------


async def test_switch_off_isolation_and_v5_unchanged(db, make_client, outbox, admin_client):
    from app.hire.vetting import trust as V5

    c, uid = await person(make_client, outbox, db, "ravi@example.com", "Ravi Off", tester=False)
    for method, path, body in (("get", URL, None), ("post", f"{URL}/explain", {"note": "hello there"}), ("get", f"{URL}/snapshots", None),
                               ("post", f"{URL}/snapshots/plan", {"kind": "skill", "ref": "x" * 24})):  # fmt: skip
        r = await getattr(c, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 404, path
    # a real user with strong signals: the automation pass rates nobody while the switch is off, no queue, no email
    await attempt(db, uid, ["pattern_match", "text_match", "shared_device"])
    await db[TRUST_DOCUMENTS].insert_one(
        {"user_id": uid, "kind": "pan", "fetched_at": now(), "review": {"status": "open", "reasons": ["pan_elsewhere"]}}
    )
    outbox.sent.clear()
    out = await S.pass_(db, force=True)
    assert out["rated"] == 0 and await db[TRUST_INTEGRITY].count_documents({}) == 0 and outbox.sent == []
    # V5 behaves exactly as before: the fraud scan finds the same items and its decisions work as they did
    owner = await admin_client()
    before = await db[VETTING_QUEUE].count_documents({})
    await db[SKILL_ATTEMPTS].update_one({"user_id": uid}, {"$set": {"fp": {"device": "dev-1"}, "started_at": now()}})
    _, uid2 = await person(make_client, outbox, db, "sam@example.com", "Sam", tester=False)
    await attempt(db, uid2, [], fp={"device": "dev-1"})
    found = await V5.fraud_scan(db)
    assert found.get("device") == 1 and await db[VETTING_QUEUE].count_documents({}) == before + 1
    item = await db[VETTING_QUEUE].find_one({"kind": "fraud", "key": "device:dev-1"})
    r = await owner.post(f"/api/admin/vetting/fraud/{item['_id']}", json={"decision": "clear", "note": "Family laptop"})
    assert r.json() == {"decision": "clear"}
    assert set(await db[VETTING_QUEUE].find_one({"_id": item["_id"]})) == {"_id", "kind", "key", "what", "users", "evidence", "updated_at", "status",
                                                                            "created_at", "user_id", "skill", "decision", "note", "by", "done_at"}  # fmt: skip
    # Admin always sees the T8 pages (admins are never behind the switch); the person turned on as a tester sees theirs
    assert (await owner.get("/api/admin/trust/integrity")).status_code == 200
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "ravi@example.com"}}, upsert=True)
    await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})
    assert (await c.get(URL)).json()["level"] == "high"


async def test_admin_settings_bounds_and_audit(db, admin_client):
    owner = await admin_client()
    d = (await owner.get("/api/admin/trust/integrity")).json()
    assert d["snapshots"] is True and d["perSession"] == 4 and d["checkFaces"] is True and d["snapshotDays"] == 30
    assert d["method"]["halfLifeDays"] == 60
    assert (
        await owner.put(
            "/api/admin/trust/integrity",
            json={"snapshots": True, "perSession": 9, "checkFaces": True, "windowMinutes": 12},
        )
    ).status_code == 422
    d = (
        await owner.put(
            "/api/admin/trust/integrity",
            json={"snapshots": False, "perSession": 3, "checkFaces": False, "windowMinutes": 5},
        )
    ).json()
    assert d["snapshots"] is False and d["perSession"] == 3 and d["windowMinutes"] == 5
    assert await db[AUDIT_LOG].find_one({"action": "trust.integrity_settings"})
    assert (await owner.put("/api/admin/trust/retention", json={"days": {"webcam_snapshots": 61}})).status_code == 400
    assert (await owner.put("/api/admin/trust/retention", json={"days": {"webcam_snapshots": 14}})).status_code == 200
    assert (await owner.get("/api/admin/trust/integrity")).json()["snapshotDays"] == 14
    # an integrity record goes with the account (erase_user) and after its retention time
    await db[TRUST_INTEGRITY].insert_one({"_id": "u-old", "user_id": "u-old", "at": now() - timedelta(days=400)})
    assert await R.clean_type(db, R.TYPES["integrity"], 365, now()) == 1
    await db[TRUST_INTEGRITY].insert_one({"_id": "u-gone", "user_id": "u-gone", "at": now()})
    assert (await R.erase_user(db, "u-gone"))["integrity"] == 1
