"""Phase 2 C1: Admin → Companies trust queue (flags first; approve / reject / re-verify / block with emails; who may),
the 12-month re-check, company limits in Settings, and account security (2-step sign-in, devices, unusual sign-in)."""

import time
from datetime import timedelta

import pyotp

from app.companies.admin import recheck_reminders
from app.companies.limits import posting_room
from app.core.db import AUDIT_LOG, COMPANIES, JOBS, RECRUITERS
from app.core.security import decrypt
from app.core.time import now
from tests.test_companies_signup import H, err, no_network, sign_up  # noqa: F401  (no_network: no DNS / RDAP)


async def basic_company(client, outbox, email="founder@gmail.com", site="acme.com"):
    session, c = await sign_up(client, outbox, email=email)
    cid = c["id"]
    await client.post(f"/api/company/{cid}/company-email/code", json={"email": f"hr@{site}"}, headers=H(session))
    await client.post(
        f"/api/company/{cid}/company-email/verify", json={"code": outbox.last_code(f"hr@{site}")}, headers=H(session)
    )
    r = await client.post(f"/api/company/{cid}/submit", json={"acceptTerms": True}, headers=H(session))
    assert r.json()["review"]["state"] == "pending"
    return session, cid


async def test_queue_decisions_and_emails(client, outbox, db, admin_client):
    owner = await admin_client("owner")
    assert (await (await admin_client("support")).get("/api/admin/companies")).status_code == 403
    assert (await (await admin_client("ops")).get("/api/admin/companies")).status_code == 200
    session, cid = await basic_company(client, outbox)
    _, other = await sign_up(client, outbox, email="dup@gmail.com")  # same GSTIN + phone: flagged
    q = (await owner.get("/api/admin/companies")).json()
    assert [x["id"] for x in q["items"]] == [cid] and q["counts"]["pending"] == 1 and q["counts"]["draft"] == 1
    row = q["items"][0]
    assert row["registration"]["number"] == "27AAPFU0939F1ZV" and row["checkAt"].startswith(
        "https://services.gst.gov.in"
    )
    dup = (await owner.get(f"/api/admin/companies/{other['id']}")).json()
    assert {"duplicate_registration", "duplicate_phone"} <= {f["code"] for f in dup["flags"]}
    assert (await owner.get("/api/admin/companies", params={"state": "all", "q": "dup@gmail"})).json()["items"][0][
        "id"
    ] == other["id"]
    # approve: Verified for 12 months, the main admin is told
    assert (
        err(await owner.post(f"/api/admin/companies/{other['id']}/approve")) == "emails"
    )  # company email not confirmed
    r = await owner.post(f"/api/admin/companies/{cid}/approve")
    assert r.json()["trust"] == "verified" and r.json()["review"]["state"] == "approved"
    assert outbox.sent[-1].to == "founder@gmail.com" and "verified on Nm7" in outbox.sent[-1].subject
    doc = await db[COMPANIES].find_one({"_id": cid})
    assert timedelta(days=355) < doc["verified_until"] - now() < timedelta(days=365)
    assert (await posting_room(db, doc))["limit"] == 3
    # re-verify: back in the queue, Basic until checked
    assert err(await owner.post(f"/api/admin/companies/{cid}/reverify", json={"reason": ""})) == "invalid_input"
    r = await owner.post(f"/api/admin/companies/{cid}/reverify", json={"reason": "Website changed owner"})
    assert (r.json()["trust"], r.json()["review"]["state"]) == ("basic", "pending")
    assert "Website changed owner" in outbox.sent[-1].text
    # reject with a reason (emailed); editing sends it back to draft
    r = await owner.post(f"/api/admin/companies/{cid}/reject", json={"reason": "The GSTIN belongs to another business"})
    assert r.json()["review"] == {
        **r.json()["review"],
        "state": "rejected",
        "reason": "The GSTIN belongs to another business",
    }
    assert "The GSTIN belongs to another business" in outbox.sent[-1].text
    assert (await client.get(f"/api/company/{cid}", headers=H(session))).json()["review"]["state"] == "rejected"
    # block: its jobs pause, the team can't open it; unblock → back to the queue
    await db[JOBS].insert_one({"_id": "cj1", "company_id": cid, "status": "active", "created_at": now()})
    r = await owner.post(f"/api/admin/companies/{cid}/block", json={"reason": "Asked students for a deposit"})
    assert r.json()["trust"] == "blocked"
    assert (await db[JOBS].find_one({"_id": "cj1"}))["status"] == "paused"
    assert err(await client.get(f"/api/company/{cid}", headers=H(session))) == "blocked"
    assert err(await owner.post(f"/api/admin/companies/{cid}/approve")) == "blocked"
    r = await owner.post(f"/api/admin/companies/{cid}/unblock", json={})
    assert r.json()["review"]["state"] == "pending"
    actions = [
        a["action"]
        async for a in db[AUDIT_LOG].find(
            {"target": cid, "action": {"$regex": "^company\\.(approved|reverify|rejected|blocked)"}}
        )
    ]
    assert set(actions) == {"company.approved", "company.blocked", "company.rejected", "company.reverify"}
    detail = (await owner.get(f"/api/admin/companies/{cid}")).json()
    assert {"company.signup", "company.blocked"} <= {x["action"] for x in detail["log"]}


async def test_recheck_and_settings(client, outbox, db, admin_client):
    owner = await admin_client("owner")
    _, cid = await basic_company(client, outbox)
    await owner.post(f"/api/admin/companies/{cid}/approve")
    assert await recheck_reminders(db, outbox) == 0  # 12 months away
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"verified_until": now() + timedelta(days=20)}})
    assert await recheck_reminders(db, outbox) == 1
    assert "verification due" in outbox.sent[-1].subject
    assert await recheck_reminders(db, outbox) == 0  # once
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"verified_until": now() - timedelta(minutes=1)}})
    await recheck_reminders(db, outbox)
    doc = await db[COMPANIES].find_one({"_id": cid})
    assert (doc["review"]["state"], doc["review"]["reason"], doc["verified_until"]) == (
        "pending",
        "12-month re-check",
        None,
    )
    # limits are settings
    r = await owner.put(
        "/api/admin/settings",
        json={
            "companies": {
                "basicJobsPerWeek": 2,
                "verifiedLiveJobs": 5,
                "verifiedMonths": 6,
                "ipBurst": 4,
                "noReplyDays": 21,
            }
        },
    )
    assert r.json()["companies"] == {
        "basicJobsPerWeek": 2,
        "verifiedLiveJobs": 5,
        "verifiedMonths": 6,
        "ipBurst": 4,
        "noReplyDays": 21,
        "applicantMonths": 12,
    }
    assert (await posting_room(db, doc))["limit"] == 2
    await owner.post(f"/api/admin/companies/{cid}/approve")
    doc = await db[COMPANIES].find_one({"_id": cid})
    assert timedelta(days=170) < doc["verified_until"] - now() < timedelta(days=185)
    assert (await posting_room(db, doc))["limit"] == 5
    assert await db[AUDIT_LOG].count_documents({"action": "settings.changed"}) == 1


async def code_sign_in(client, outbox, email, ua="Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", totp=None):
    await client.post("/api/recruiter-account/code", json={"email": email})
    body = {"email": email, "code": outbox.last_code(email), **({"totp": totp} if totp else {})}
    return await client.post("/api/recruiter-account/session", json=body, headers={"User-Agent": ua})


async def test_two_step_devices_and_unusual_sign_in(client, outbox, db, admin_client):
    session, cid = await basic_company(client, outbox)
    sec = (await client.get("/api/company-account/security", headers=H(session))).json()
    assert sec["twoStep"] is False and len(sec["devices"]) == 1 and sec["devices"][0]["current"]
    # turn on 2-step
    setup = (await client.post("/api/company-account/2fa/setup", headers=H(session))).json()
    assert setup["uri"].startswith("otpauth://totp/") and "founder" in setup["uri"]
    totp = pyotp.TOTP(setup["secret"])
    assert (
        err(await client.post("/api/company-account/2fa/enable", json={"code": "000000"}, headers=H(session)))
        == "wrong_code"
    )
    assert (
        await client.post("/api/company-account/2fa/enable", json={"code": totp.now()}, headers=H(session))
    ).json() == {"twoStep": True}
    acc = await db[RECRUITERS].find_one({"email_lc": "founder@gmail.com"})
    assert decrypt(acc["totp_secret_enc"]) == setup["secret"] and "secret" not in str(acc.get("sessions"))
    # sign-in now needs the app code too (a used code can't be used again)
    r = await code_sign_in(client, outbox, "founder@gmail.com")
    assert err(r) == "totp_required"
    r = await client.post(
        "/api/recruiter-account/session",
        json={"email": "founder@gmail.com", "code": outbox.last_code("founder@gmail.com"), "totp": "123456"},
    )
    assert err(r) == "wrong_totp"
    next_code = totp.at(time.time() + 30)  # the next step (the current one was used to turn it on)
    r = await client.post(
        "/api/recruiter-account/session",
        json={"email": "founder@gmail.com", "code": outbox.last_code("founder@gmail.com"), "totp": next_code},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0"},
    )
    assert r.status_code == 200, r.text
    # a new device + network: the person and the main admin are emailed; the queue shows it
    before = len(outbox.sent)
    await db[RECRUITERS].update_one({"email_lc": "founder@gmail.com"}, {"$set": {"totp_on": False}})
    r = await code_sign_in(
        client, outbox, "founder@gmail.com", ua="Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1"
    )
    s3 = r.json()["session"]
    alerts = [m for m in outbox.sent[before:] if m.subject == "New sign-in to your Nm7 company account"]
    assert len(alerts) == 1 and "Safari on iPhone" in alerts[0].text
    doc = await db[COMPANIES].find_one({"_id": cid})
    assert "unusual_login" in {f["code"] for f in doc.get("login_flags", [])}
    owner = await admin_client("owner")
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"updated_at": now()}})
    await client.put(
        f"/api/company/{cid}/team/x@acme.com", json={"role": "view"}, headers=H(s3)
    )  # any save refreshes flags
    q = (await owner.get(f"/api/admin/companies/{cid}")).json()
    assert "unusual_login" in {f["code"] for f in q["flags"]}
    # the same device again: no alert
    n = len(outbox.sent)
    await code_sign_in(client, outbox, "founder@gmail.com", ua="Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604.1")
    assert not [m for m in outbox.sent[n:] if m.subject.startswith("New sign-in")]
    # devices: sign another one out
    devices = (await client.get("/api/company-account/security", headers=H(s3))).json()["devices"]
    assert len(devices) >= 3 and sum(d["current"] for d in devices) == 1
    first = next(d for d in devices if not d["current"])
    assert (await client.delete(f"/api/company-account/devices/{first['id']}", headers=H(s3))).json() == {"ok": True}
    assert err(await client.delete(f"/api/company-account/devices/{first['id']}", headers=H(s3))) == "not_found"
    # turn 2-step off (needs a code)
    await db[RECRUITERS].update_one(
        {"email_lc": "founder@gmail.com"}, {"$set": {"totp_on": True, "totp_last_step": None}}
    )
    r = await client.post("/api/company-account/2fa/disable", json={"code": totp.now()}, headers=H(s3))
    assert r.json() == {"twoStep": False}
