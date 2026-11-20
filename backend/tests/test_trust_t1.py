# ruff: noqa: E501
"""Vetting Trust T1 (DPDP pack): the launch switch, consents per purpose with versions, the signed withdraw link,
withdrawal deleting data through the retention hooks, the age gate with parental consent, the 72-hour breach log, the
retention job and erase-after-inactivity (warning first, erase only after the notice)."""

import re
from dataclasses import replace
from datetime import timedelta

import pytest
from bson import ObjectId

from app.core.db import AUDIT_LOG, TRUST_CONSENTS, TRUST_PROFILES, TRUST_RUNS, TRUST_SELFIES, TRUST_VOICE, USERS
from app.core.time import now
from app.site import save_site
from app.trust import access, consent, inactivity
from app.trust import retention as R
from tests.conftest import signup

ADULT = {"dob": "1999-04-12"}


async def person(make_client, outbox, email, name="Asha Rao", tester=True, db=None):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    if tester:
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
    return c, me["id"]


async def test_switch_off_hides_everything_and_sends_no_mail(db, make_client, outbox, admin_client):
    assert await access.settings(db) == {"public": False, "testers": [], "retention": {},
                                         "inactivity": {"on": False, "months": 24, "notice_days": 30, "mode": "trust", "enabled_at": None}}  # fmt: skip
    c, uid = await person(make_client, outbox, "meena@example.com", tester=False, db=db)
    assert (await c.get("/api/me/trust/access")).json() == {"on": False}
    for method, path, body in (("get", "/api/me/trust/privacy", None), ("post", "/api/me/trust/age", ADULT),
                               ("post", "/api/me/trust/consents/voice", None), ("delete", "/api/me/trust/consents/voice", None),
                               ("post", "/api/me/trust/parent", {"email": "p@example.com"})):  # fmt: skip
        r = await getattr(c, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 404, path
    assert await access.mail_filter(db) is None
    # inactivity on, but Trust hidden with no testers: nobody is warned (so nobody can be erased)
    await db[TRUST_PROFILES].insert_one(
        {"_id": uid, "age_checked_at": now(), "adult_from": now() - timedelta(days=3000)}
    )
    await save_site(
        db,
        {
            "trust.inactivity": {
                "on": True,
                "months": 6,
                "notice_days": 14,
                "mode": "trust",
                "enabled_at": now() - timedelta(days=900),
            }
        },
    )
    await db[USERS].update_one(
        {"_id": uid},
        {"$set": {"last_active_at": now() - timedelta(days=800), "created_at": now() - timedelta(days=900)}},
    )
    await db["sessions"].update_many({"user_id": uid}, {"$set": {"last_seen_at": now() - timedelta(days=800)}})
    n = len(outbox.sent)
    assert await inactivity.run(db, outbox, force=True) == {"warned": 0, "erased": 0, "cleared": 0}
    assert len(outbox.sent) == n

    owner = await admin_client()
    r = (await owner.put("/api/admin/trust/switch", json={"public": False, "testers": [" Meena@Example.com "]})).json()
    assert r["public"] is False and r["testers"] == ["meena@example.com"]
    assert (await c.get("/api/me/trust/access")).json() == {"on": True}
    assert await access.mail_filter(db) == {"email_lc": {"$in": ["meena@example.com"]}}
    assert await db[AUDIT_LOG].find_one({"action": "trust.switch"})
    await owner.put("/api/admin/trust/switch", json={"public": True, "testers": []})
    assert await access.mail_filter(db) == {}
    # admin pages need the owner's "settings" permission
    ops = await admin_client("ops")
    assert (await ops.get("/api/admin/trust")).status_code == 403
    assert (await ops.get("/api/admin/trust/breaches")).status_code == 403


async def test_consent_grant_withdraw_and_versions(db, make_client, outbox, monkeypatch):
    c, uid = await person(make_client, outbox, "asha@example.com", db=db)
    r = await c.post("/api/me/trust/consents/ai_interview")
    assert r.status_code == 428 and r.json()["error"]["code"] == "age_check"  # the age gate comes first
    st = (await c.post("/api/me/trust/age", json=ADULT)).json()
    assert st["checked"] and not st["minor"]
    p = await db[TRUST_PROFILES].find_one({"_id": uid})
    assert "dob" not in p and p["adult_from"].year == 2017  # only the day they turned 18, never the birth date
    assert (
        await c.post("/api/me/trust/age", json={"dob": "2015-01-01"})
    ).status_code == 409  # can't be changed to dodge

    page = (await c.get("/api/me/trust/privacy")).json()
    keys = [x["purpose"] for x in page["consents"]]
    assert keys[:5] == ["profile_sharing", "ai_interview", "voice", "selfie_face", "documents"]
    ai = next(x for x in page["consents"] if x["purpose"] == "ai_interview")
    assert ai["status"] == "not_given" and "180 days" in ai["text"]
    assert "Aadhaar" in next(x for x in page["consents"] if x["purpose"] == "documents")["text"]

    assert (await c.post("/api/me/trust/consents/ai_interview")).json()["status"] == "granted"
    assert await consent.has(db, uid, "ai_interview") and not await consent.has(db, uid, "voice")
    await consent.require(db, uid, "ai_interview")
    with pytest.raises(Exception) as e:
        await consent.require(db, uid, "voice")
    assert getattr(e.value, "code", "") == "consent_needed"
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid, "purpose": "ai_interview"})
    assert row["version"] == 1 and row["channel"] == "settings" and row["withdrawn_at"] is None

    # a new text version: the old consent no longer counts until they agree again
    monkeypatch.setitem(consent.PURPOSES, "ai_interview", replace(consent.PURPOSES["ai_interview"], version=2))
    assert not await consent.has(db, uid, "ai_interview")
    page = (await c.get("/api/me/trust/privacy")).json()
    assert next(x for x in page["consents"] if x["purpose"] == "ai_interview")["status"] == "outdated"
    await c.post("/api/me/trust/consents/ai_interview")
    rows = (
        await db[TRUST_CONSENTS].find({"user_id": uid, "purpose": "ai_interview"}).sort("granted_at", 1).to_list(None)
    )
    assert (
        [r["version"] for r in rows] == [1, 2] and rows[0]["withdrawn_at"] and rows[1]["withdrawn_at"] is None
    )  # additive

    r = (await c.delete("/api/me/trust/consents/ai_interview")).json()
    assert r["status"] == "withdrawn" and not await consent.has(db, uid, "ai_interview")
    assert await db[AUDIT_LOG].find_one({"action": "trust.consent_withdrawn", "target": uid})
    hist = (await c.get("/api/me/trust/consents/export")).json()
    assert len(hist["consents"]) == 2 and hist["consents"][1]["withdraw_channel"] == "settings"
    assert (await c.post("/api/me/trust/consents/nonsense")).status_code == 404


async def test_withdrawal_deletes_that_purposes_data_through_hooks(db, make_client, outbox):
    c, uid = await person(make_client, outbox, "ravi@example.com", "Ravi K", db=db)
    await c.post("/api/me/trust/age", json=ADULT)
    await c.post("/api/me/trust/consents/voice")
    await c.post("/api/me/trust/consents/selfie_face")
    t = now()
    await db[TRUST_VOICE].insert_many(
        [
            {"user_id": uid, "created_at": t},
            {"user_id": uid, "created_at": t},
            {"user_id": "someone-else", "created_at": t},
        ]
    )
    await db[TRUST_SELFIES].insert_one({"user_id": uid, "created_at": t})
    calls = []

    async def forget_voice_files(db_, who):
        calls.append(who)
        return 3

    R.on_withdraw("voice")(forget_voice_files)
    try:
        r = (await c.delete("/api/me/trust/consents/voice")).json()
    finally:
        R.WITHDRAW_HOOKS["voice"].remove(forget_voice_files)
    assert r["deleted"] == 5 and calls == [uid]
    assert await db[TRUST_VOICE].count_documents({"user_id": uid}) == 0
    assert await db[TRUST_VOICE].count_documents({"user_id": "someone-else"}) == 1  # nobody else's
    assert await db[TRUST_SELFIES].count_documents({"user_id": uid}) == 1  # another purpose: kept
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid, "purpose": "voice"})
    assert row["deleted"] == 5


async def test_withdraw_link_signed_and_expiring(db, make_client, outbox, client):
    c, uid = await person(make_client, outbox, "devi@example.com", "Devi R", db=db)
    await c.post("/api/me/trust/age", json=ADULT)
    for p in ("voice", "documents"):
        await c.post(f"/api/me/trust/consents/{p}")
    good = consent.withdraw_token(uid, "all")
    assert consent.read_token(good) == (uid, "all")
    assert "/stop-alerts#k=consent&t=" in consent.withdraw_link(uid)
    tampered = good[:-3] + ("aaa" if not good.endswith("aaa") else "bbb")
    expired = consent.withdraw_token(uid, "voice", days=30, at=now().timestamp() - 31 * 86400)
    other = consent.withdraw_token(uid, "voice").replace(f"{uid}.voice", f"{uid}.documents")
    for bad in (tampered, expired, other):
        assert (await client.post("/api/public/trust/withdraw/check", json={"token": bad})).status_code == 404
    items = (await client.post("/api/public/trust/withdraw/check", json={"token": good})).json()["items"]
    assert {i["purpose"]: i["status"] for i in items}["voice"] == "granted"
    # a single-purpose link only withdraws that purpose
    one = consent.withdraw_token(uid, "voice")
    r = (
        await client.post("/api/public/trust/withdraw", json={"token": one, "purposes": ["documents", "voice"]})
    ).json()
    assert r["withdrawn"] == ["voice"] and await consent.has(db, uid, "documents")
    r = (await client.post("/api/public/trust/withdraw", json={"token": good})).json()
    assert r["withdrawn"] == ["documents"]
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid, "purpose": "documents"})
    assert row["withdraw_channel"] == "link"


async def test_age_gate_minor_blocked_until_parent_confirms(db, make_client, outbox, client):
    c, uid = await person(make_client, outbox, "kid@example.com", "Chintu S", db=db)
    dob = now().date().replace(year=now().year - 15)
    st = (await c.post("/api/me/trust/age", json={"dob": dob.isoformat()})).json()
    assert st["checked"] and st["minor"] and st["parent"] is None
    r = await c.post("/api/me/trust/consents/ai_interview")
    assert r.status_code == 403 and r.json()["error"]["code"] == "parent_needed"
    assert (await c.post("/api/me/trust/parent", json={"email": "kid@example.com"})).status_code == 400  # not their own
    st = (await c.post("/api/me/trust/parent", json={"email": "Amma@Example.com", "name": "Lakshmi"})).json()
    assert st["parent"]["status"] == "pending" and st["parent"]["sentTo"].endswith("@example.com")
    mail = outbox.sent[-1]
    assert mail.to.lower() == "amma@example.com" and "Chintu" in mail.text
    token = re.search(r"#k=parent&t=([A-Za-z0-9_-]+)", mail.text).group(1)
    # still blocked while the parent hasn't answered
    assert (await c.post("/api/me/trust/consents/voice")).status_code == 403
    chk = (await client.post("/api/public/trust/parent/check", json={"token": token})).json()
    assert chk["child"] == "Chintu" and len(chk["purposes"]) >= 5
    bad = await client.post(
        "/api/public/trust/parent/confirm",
        json={"token": token, "parentName": "Lakshmi S", "relation": "mother", "agree": False},
    )
    assert bad.status_code == 400
    ok = await client.post(
        "/api/public/trust/parent/confirm",
        json={"token": token, "parentName": "Lakshmi S", "relation": "mother", "agree": True},
    )
    assert ok.status_code == 200
    again = await client.post(
        "/api/public/trust/parent/confirm",
        json={"token": token, "parentName": "Lakshmi S", "relation": "mother", "agree": True},
    )
    assert again.status_code == 404  # one-time
    st = (await c.get("/api/me/trust/privacy")).json()["age"]
    assert st["parentOk"] and st["parent"]["status"] == "confirmed"
    assert (await c.post("/api/me/trust/consents/ai_interview")).json()["status"] == "granted"
    assert await db[AUDIT_LOG].find_one({"action": "trust.parent_confirmed", "target": uid})
    a = await db[AUDIT_LOG].find_one({"action": "trust.age_checked", "target": uid})
    assert a["data"] == {"minor": True}  # the audit never holds the birth date


async def test_parent_can_decline_and_adult_needs_no_parent(db, make_client, outbox, client):
    c, uid = await person(make_client, outbox, "teen@example.com", "Teja M", db=db)
    await c.post("/api/me/trust/age", json={"dob": now().date().replace(year=now().year - 16).isoformat()})
    await c.post("/api/me/trust/parent", json={"email": "dad@example.com"})
    token = re.search(r"#k=parent&t=([A-Za-z0-9_-]+)", outbox.sent[-1].text).group(1)
    assert (await client.post("/api/public/trust/parent/decline", json={"token": token})).status_code == 200
    st = (await c.get("/api/me/trust/privacy")).json()["age"]
    assert st["parent"]["status"] == "declined" and not st["parentOk"]
    assert (await c.post("/api/me/trust/consents/voice")).status_code == 403
    a, _ = await person(make_client, outbox, "grown@example.com", "Grown Up", db=db)
    await a.post("/api/me/trust/age", json=ADULT)
    assert (await a.post("/api/me/trust/parent", json={"email": "x@example.com"})).status_code == 409


async def test_breach_log_with_72_hour_deadline(db, admin_client):
    owner = await admin_client()
    found = now() - timedelta(hours=10)
    b = (await owner.post("/api/admin/trust/breaches", json={"title": "Selfie bucket was public", "detectedAt": int(found.timestamp() * 1000),
                                                             "dataTypes": ["selfies"], "people": 42, "summary": "Found by a researcher"})).json()  # fmt: skip
    assert b["status"] == "open" and b["people"] == 42
    assert (
        b["deadlineAt"] - b["detectedAt"] == 72 * 3600 * 1000 and b["certinDueAt"] - b["detectedAt"] == 6 * 3600 * 1000
    )
    assert 61 * 3600 < b["secondsLeft"] <= 62 * 3600 and not b["overdue"] and b["certinOverdue"]
    b = (
        await owner.post(
            f"/api/admin/trust/breaches/{b['id']}/notifications", json={"to": "certin", "note": "Ticket 123"}
        )
    ).json()
    assert not b["certinOverdue"] and b["notifications"][0]["label"] == "CERT-In"
    b = (await owner.put(f"/api/admin/trust/breaches/{b['id']}", json={"status": "contained", "people": 40})).json()
    assert b["status"] == "contained" and b["people"] == 40
    old = (
        await owner.post(
            "/api/admin/trust/breaches",
            json={"title": "Old one", "detectedAt": int((now() - timedelta(hours=80)).timestamp() * 1000)},
        )
    ).json()
    assert old["overdue"] and old["secondsLeft"] < 0
    future = await owner.post(
        "/api/admin/trust/breaches",
        json={"title": "Later", "detectedAt": int((now() + timedelta(hours=2)).timestamp() * 1000)},
    )
    assert future.status_code == 400
    items = (await owner.get("/api/admin/trust/breaches")).json()["items"]
    assert [i["title"] for i in items] == ["Selfie bucket was public", "Old one"]
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^trust.breach"}})}
    assert actions == {"trust.breach_created", "trust.breach_updated", "trust.breach_notified"}


async def test_retention_job_deletes_only_expired_with_counts(db, admin_client):
    t = now()
    await db[TRUST_SELFIES].insert_many([{"user_id": "a", "created_at": t - timedelta(days=31)}, {"user_id": "b", "created_at": t - timedelta(days=45)},
                                         {"user_id": "c", "created_at": t - timedelta(days=29)}])  # fmt: skip
    await db[TRUST_VOICE].insert_many(
        [{"user_id": "a", "created_at": t - timedelta(days=60)}, {"user_id": "a", "created_at": t - timedelta(days=91)}]
    )
    out = await R.run(db)
    assert out["selfie_face"] == 2 and out["voice"] == 1 and "audit_ips" not in out  # vetting types run elsewhere
    assert await db[TRUST_SELFIES].count_documents({}) == 1 and await db[TRUST_VOICE].count_documents({}) == 1
    assert await R.run(db) == {}  # once a day
    owner = await admin_client()
    sched = {x["key"]: x for x in (await owner.get("/api/admin/trust")).json()["retention"]}
    assert (
        sched["selfie_face"]["lastDeleted"] == 2
        and sched["selfie_face"]["days"] == 30
        and sched["selfie_face"]["totalDeleted"] == 2
    )
    assert sched["interview_transcripts"]["maxDays"] == 180  # can't outlive the database expiry index
    # Admin shortens voice to 30 days within bounds; outside the bounds is refused
    assert (await owner.put("/api/admin/trust/retention", json={"days": {"voice": 3}})).status_code == 400
    assert (await owner.put("/api/admin/trust/retention", json={"days": {"nope": 30}})).status_code == 400
    r = (await owner.put("/api/admin/trust/retention", json={"days": {"voice": 30}})).json()
    assert {x["key"]: x["days"] for x in r["retention"]}["voice"] == 30
    r = (await owner.post("/api/admin/trust/retention/run")).json()
    assert r["deleted"]["voice"] == 1 and await db[TRUST_VOICE].count_documents({}) == 0
    assert await db[AUDIT_LOG].find_one({"action": "trust.retention"})
    # the vetting types (raw IPs, device hashes) are cleared by the vetting pass through the same schedule
    from app.hire.vetting import trust as T

    await db[AUDIT_LOG].insert_one(
        {"_id": ObjectId(), "action": "x", "ip": "203.0.113.9", "at": t - timedelta(days=31)}
    )
    assert (await T.retention(db))["ips"] >= 1
    runs = await db[TRUST_RUNS].find_one({"_id": "retention"})
    assert runs["types"]["audit_ips"]["deleted"] >= 1


async def test_inactivity_warns_then_erases_only_after_notice(db, make_client, outbox, admin_client):
    c, uid = await person(make_client, outbox, "lalitha@example.com", "Lalitha N", db=db)
    await c.post("/api/me/trust/age", json=ADULT)
    await c.post("/api/me/trust/consents/selfie_face")
    await db[TRUST_SELFIES].insert_one({"user_id": uid, "created_at": now()})
    b, buid = await person(make_client, outbox, "bhanu@example.com", "Bhanu P", db=db)
    await b.post("/api/me/trust/age", json=ADULT)
    assert await inactivity.run(db, outbox, force=True) == {}  # OFF by itself
    owner = await admin_client()
    r = (
        await owner.put(
            "/api/admin/trust/inactivity", json={"on": True, "months": 24, "noticeDays": 30, "mode": "trust"}
        )
    ).json()
    assert r["inactivity"]["on"] and r["inactivity"]["enabledAt"]
    assert await inactivity.run(db, outbox, force=True) == {"warned": 0, "erased": 0, "cleared": 0}  # everyone active

    later = now() + timedelta(days=25 * 30)  # 25 months on
    n = len(outbox.sent)
    out = await inactivity.run(db, outbox, t=later, force=True)
    assert out["warned"] == 2 and out["erased"] == 0
    mails = outbox.sent[n:]
    assert {m.to for m in mails} == {"lalitha@example.com", "bhanu@example.com"}
    assert "sign in before" in mails[0].text.lower() and "#k=consent&t=" in mails[0].text
    # inside the notice: nothing erased, nobody warned twice
    out = await inactivity.run(db, outbox, t=later + timedelta(days=29), force=True)
    assert out == {"warned": 0, "erased": 0, "cleared": 0} and len(outbox.sent) == n + 2
    # Bhanu signs in again after the warning: the warning goes
    await db[USERS].update_one({"_id": buid}, {"$set": {"last_active_at": later + timedelta(days=2)}})
    out = await inactivity.run(db, outbox, t=later + timedelta(days=31), force=True)
    assert out == {"warned": 0, "erased": 1, "cleared": 1}
    assert await db[TRUST_SELFIES].count_documents({"user_id": uid}) == 0
    assert not await consent.has(db, uid, "selfie_face")
    row = await db[TRUST_CONSENTS].find_one({"user_id": uid})
    assert row["withdraw_channel"] == "inactivity"  # the history stays as the record
    p = await db[TRUST_PROFILES].find_one({"_id": uid})
    assert p["erased_at"] and "adult_from" not in p
    assert (await db[TRUST_PROFILES].find_one({"_id": buid})).get("adult_from")  # Bhanu kept
    assert await db[USERS].find_one({"_id": uid, "deleted_at": None})  # mode "trust": the account stays
    assert await db[AUDIT_LOG].find_one({"action": "trust.inactivity_erased", "target": uid})


async def test_inactivity_account_mode_uses_the_account_erase_path(db, make_client, outbox, admin_client):
    from app.me.delete import erase_due

    c, uid = await person(make_client, outbox, "gopi@example.com", "Gopi V", db=db)
    await c.post("/api/me/trust/age", json=ADULT)
    await c.post("/api/me/trust/consents/voice")
    owner = await admin_client()
    await owner.put("/api/admin/trust/inactivity", json={"on": True, "months": 6, "noticeDays": 14, "mode": "account"})
    later = now() + timedelta(days=7 * 30)
    assert (await inactivity.run(db, outbox, t=later, force=True))["warned"] == 1
    assert (await inactivity.run(db, outbox, t=later + timedelta(days=15), force=True))["erased"] == 1
    u = await db[USERS].find_one({"_id": uid})
    assert u["deletion"]["reason"] == "inactivity"
    assert await erase_due(db) == 1
    assert (await db[USERS].find_one({"_id": uid}))["deleted_at"]
    assert await db[TRUST_CONSENTS].count_documents({"user_id": uid}) == 0
    assert await db[TRUST_PROFILES].count_documents({"_id": uid}) == 0
