"""Recruiter accounts (R1): one account per email across colleges (emailed code, no password), invites linking by
email (old ones too), My drives with counts and notes, access only while each college's invite is active (revoking
hides students at once), names on past drives only when the college allows, the plan switch (Drive and Campus), and
everything in the Activity log."""

from datetime import timedelta

from app.core.db import AUDIT_LOG, OFFERS, RECRUITER_INVITES, RECRUITERS
from app.core.time import now
from app.orgs import demo
from tests.test_org_recruiter_portal import campus, err, invite, owner, plan, resume, sign_in  # noqa: F401
from tests.test_orgs_phase2 import second_org
from tests.test_orgs_recruiter import opted_in

EMAIL = "ravi@acme.example"


async def account(rec, outbox, email=EMAIL):
    r = await rec.post("/api/recruiter-account/code", json={"email": email})
    assert r.status_code == 200 and r.json()["sent"] is True, r.text
    r = await rec.post("/api/recruiter-account/session", json={"email": email.upper(), "code": outbox.last_code(email)})
    assert r.status_code == 200, r.text
    return {"X-Recruiter-Account": r.json()["session"]}


async def test_one_account_across_colleges_and_my_drives(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=resume("Asha Rao", "asha@example.com"))
    bala = resume("Bala M", "bala@example.com")
    await opted_in(make_client, outbox, "bala@example.com", "Bala M", data=bala, roll="2")
    inv, token = await invite(owner, org["id"], [g["id"]])  # made before the recruiter ever had an account
    o2, g2 = await second_org(owner)
    await plan(owner, o2["id"], "drive")
    await owner.patch(f"/api/admin/groups/{g2['id']}", json={"settings": {"shareWithRecruiters": True}})
    inv2, _ = await invite(owner, o2["id"], [g2["id"]], company="Acme Analytics")
    rec = make_client()
    # an address nobody invited gets the same answer and no email
    sent = len(outbox.sent)
    r = await rec.post("/api/recruiter-account/code", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and r.json()["sent"] is True and len(outbox.sent) == sent
    assert await db[RECRUITERS].count_documents({}) == 0
    # wrong code, then the right one (any case of the address)
    await rec.post("/api/recruiter-account/code", json={"email": EMAIL})
    code = outbox.last_code(EMAIL)
    bad = "000000" if code != "000000" else "111111"
    assert err(await rec.post("/api/recruiter-account/session", json={"email": EMAIL, "code": bad})) == "wrong_code"
    r = await rec.post("/api/recruiter-account/session", json={"email": "Ravi@Acme.Example", "code": code})
    h = {"X-Recruiter-Account": r.json()["session"]}
    acc = await db[RECRUITERS].find_one({"email_lc": EMAIL})
    assert code not in str(acc) and h["X-Recruiter-Account"] not in str(acc)  # only hashes are stored
    page = (await rec.get("/api/recruiter-account/drives", headers=h)).json()
    assert page["name"] == "Ravi K" and page["emailHint"].startswith("ra")
    assert {d["orgName"] for d in page["drives"]} == {"JNTU Anantapur", "Skill Hub Kurnool"}
    d = next(x for x in page["drives"] if x["id"] == inv["id"])
    assert d["state"] == "active" and d["path"] == f"/recruiter/i.{inv['id']}"
    # the invite opens with the account session alone
    base = f"/api/recruiter/i.{inv['id']}"
    cands = (await rec.get(f"{base}/candidates", headers=h)).json()["candidates"]
    assert sorted(c["name"] for c in cands) == ["Asha Rao", "Bala M"]
    asha = next(c for c in cands if c["name"] == "Asha Rao")
    assert (await rec.get(f"{base}/candidates/{asha['id']}", headers=h)).status_code == 200
    r = await rec.put(f"{base}/board/{asha['id']}", headers=h, json={"stage": "selected", "note": "Sharp"})
    assert r.is_success
    await db[OFFERS].insert_one(
        {"_id": "o1", "org_id": org["id"], "membership_id": next(iter((await db[RECRUITER_INVITES].find_one(
            {"_id": inv["id"]}))["board"])), "company": "acme analytics", "type": "full_time", "status": "offered",
         "created_at": now()}
    )  # fmt: skip
    drives = (await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"]
    d = next(x for x in drives if x["id"] == inv["id"])
    assert d["counts"] == {"viewed": 1, "shortlisted": 1, "interviewed": 1, "selected": 1, "offers": 1}
    assert d["notes"] == [{"name": "Asha Rao", "stage": "selected", "note": "Sharp", "at": d["notes"][0]["at"]}]
    # another recruiter's account can't open this invite; no session at all: 401
    other = make_client()
    assert (await other.get(f"{base}/candidates")).status_code == 401
    assert (await other.get(f"{base}/candidates", headers={"X-Recruiter-Account": "x" * 43})).status_code == 401
    # the emailed invite link keeps working on its own, and its sign-in also gives an account session
    rec2 = make_client()
    hs = await sign_in(rec2, outbox, token)
    assert (await rec2.get(f"/api/recruiter/{token}/candidates", headers=hs)).status_code == 200
    r = await rec2.post(f"/api/recruiter/{token}/code")
    r = await rec2.post(f"/api/recruiter/{token}/session", json={"code": outbox.last_code(EMAIL)})
    assert r.json()["account"]
    ha = {"X-Recruiter-Account": r.json()["account"]}
    assert (await rec2.get("/api/recruiter-account/drives", headers=ha)).is_success
    # an invite session can't open the i.<id> path (that is for accounts)
    assert (await rec2.get(f"{base}/candidates", headers=hs)).status_code == 401
    # sign-ins and My drives are in each college's Activity log
    acts = [a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": o2["id"]})]
    assert "recruiter_account_login" in acts and "recruiter_drives" in acts
    # sign out ends the account session
    assert (await rec.post("/api/recruiter-account/sign-out", headers=h)).is_success
    assert (await rec.get("/api/recruiter-account/drives", headers=h)).status_code == 401


async def test_revoke_hides_students_at_once_and_past_drives_keep_counts(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=resume("Asha Rao", "asha@example.com"))
    inv, _ = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await account(rec, outbox)
    base = f"/api/recruiter/i.{inv['id']}"
    cid = (await rec.get(f"{base}/candidates", headers=h)).json()["candidates"][0]["id"]
    await rec.put(f"{base}/board/{cid}", headers=h, json={"stage": "interview", "note": "Call back"})
    # revoked: every request answers 410 straight away, the account session included
    r = await owner.post(f"/api/org/{org['id']}/recruiter-invites/{inv['id']}/revoke")
    assert r.json()["state"] == "revoked"
    for path in ("/candidates", f"/candidates/{cid}", ""):
        assert (await rec.get(f"{base}{path}", headers=h)).status_code == 410
    d = (await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"][0]
    assert d["state"] == "revoked" and d["path"] is None
    assert d["counts"]["shortlisted"] == 1 and d["counts"]["interviewed"] == 1
    assert d["notes"][0]["note"] == "Call back" and d["notes"][0]["name"] is None  # no names by default
    # the college allows names on past drives
    r = await owner.put(f"/api/org/{org['id']}/recruiter-settings", json={"showShortlist": False, "namesAfter": True})
    assert r.status_code == 200 and r.json()["namesAfter"] is True
    d = (await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"][0]
    assert d["notes"][0]["name"] == "Asha Rao"
    # an expired invite is the same
    inv2, _ = await invite(owner, org["id"], [g["id"]], company="Beta Labs")
    await db[RECRUITER_INVITES].update_one({"_id": inv2["id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    assert (await rec.get(f"/api/recruiter/i.{inv2['id']}/candidates", headers=h)).status_code == 410
    drives = (await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"]
    states = {x["company"]: x["state"] for x in drives}
    assert states == {"Acme Analytics": "revoked", "Beta Labs": "expired"}


async def test_plan_switch_free_and_override(owner, db, make_client, outbox):  # noqa: F811
    from tests.test_orgs import setup_group

    org, g = await setup_group(owner)
    await plan(owner, org["id"], "drive")  # on for Drive
    await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    inv, _ = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await account(rec, outbox)
    assert len((await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"]) == 1
    # Nm7 switches it off for this college: its invites leave My drives and the account path stops
    r = await owner.put(f"/api/admin/orgs/{org['id']}/features", json={"recruiterAccounts": False})
    assert r.status_code == 200, r.text
    assert (await rec.get("/api/recruiter-account/drives", headers=h)).json()["drives"] == []
    assert (await rec.get(f"/api/recruiter/i.{inv['id']}/candidates", headers=h)).status_code == 404
    # nothing invited at an allowed college: no code email
    sent = len(outbox.sent)
    await make_client().post("/api/recruiter-account/code", json={"email": EMAIL})
    assert len(outbox.sent) == sent


async def test_demo_recruiter_has_an_account_with_a_past_drive(owner, db, make_client):  # noqa: F811
    made = await demo.create_demo(db, None)
    account_session = made["recruiterPath"].split("&a=")[1]
    rec = make_client()
    drives = (await rec.get("/api/recruiter-account/drives", headers={"X-Recruiter-Account": account_session})).json()
    states = sorted(d["state"] for d in drives["drives"])
    assert states == ["active", "expired"]
    past = next(d for d in drives["drives"] if d["state"] == "expired")
    assert past["counts"]["selected"] == 1 and all(n["name"] is None for n in past["notes"])
    await demo.remove_demo(db)
    assert await db[RECRUITERS].count_documents({}) == 0
