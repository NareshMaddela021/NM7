"""Job Profile: owner-only storage, versions, validation, and privacy of salary / personal information."""

from app.core.db import ORDER_WORK
from tests.conftest import PASSWORD, approved_expert, buy, signup

PROFILE = {
    "personal": {"name": "Asha Rao", "headline": "Data Analyst", "email": "asha@example.com"},
    "summaries": [{"id": "s1", "name": "Analytics", "text": "I build dashboards."}],
    "exp": [{"pid": "p1", "company": "Acme", "role": "Analyst"}],
    "prefs": {"targetRoles": "Data Analyst", "cities": "Pune", "notice": "1 month", "salaryMin": "6", "salaryMax": "9"},
    "pinfo": {"father": "R. Rao", "dob": "2001-05-15"},
}


def err(r):
    return r.json()["error"]["code"]


async def test_save_and_read_back(client, outbox):
    await signup(client, outbox)
    r = await client.get("/api/me/job-profile")
    assert r.json() == {
        "data": {},
        "privacy": {"experts": False, "salary": False, "personal": False},
        "version": 0,
        "updated": None,
    }
    r = await client.put("/api/me/job-profile", json={"data": PROFILE, "version": 0})
    assert r.status_code == 200 and r.json()["version"] == 1 and r.json()["updated"]
    r = await client.put("/api/me/job-profile", json={"data": {**PROFILE, "hobbies": "Chess"}, "version": 1})
    assert r.json()["version"] == 2
    got = (await client.get("/api/me/job-profile")).json()
    assert got["data"]["hobbies"] == "Chess" and got["data"]["prefs"]["salaryMax"] == "9"  # the owner sees everything


async def test_stale_version_is_refused(client, outbox, make_client):
    await signup(client, outbox)
    await client.put("/api/me/job-profile", json={"data": PROFILE, "version": 0})
    other = make_client()  # the same person in another browser
    await other.post(
        "/api/auth/login",
        json={"email": "sai@example.com", "password": PASSWORD},
    )
    assert (
        await other.put("/api/me/job-profile", json={"data": {**PROFILE, "hobbies": "Tennis"}, "version": 1})
    ).status_code == 200
    r = await client.put("/api/me/job-profile", json={"data": PROFILE, "version": 1})
    assert r.status_code == 409 and err(r) == "profile_changed"
    assert (await client.get("/api/me/job-profile")).json()["data"]["hobbies"] == "Tennis"


async def test_owner_only(client, outbox, make_client, db):
    await signup(client, outbox)
    await client.put("/api/me/job-profile", json={"data": PROFILE})
    b = make_client()
    await signup(b, outbox, "b@example.com", name="Bala")
    assert (await b.get("/api/me/job-profile")).json()["data"] == {}
    await b.put("/api/me/job-profile", json={"data": {"personal": {"name": "Bala"}}})
    assert (await client.get("/api/me/job-profile")).json()["data"]["personal"]["name"] == "Asha Rao"
    assert (await make_client().get("/api/me/job-profile")).status_code == 401
    expert, _ = await approved_expert(make_client, outbox, db)
    assert (await expert.get("/api/me/job-profile")).status_code == 403


async def test_validation(client, outbox):
    await signup(client, outbox)
    assert (await client.put("/api/me/job-profile", json={"data": "nope"})).status_code == 422
    assert (await client.put("/api/me/job-profile", json={"data": {"x": "a" * 410_000}})).status_code == 422
    assert (await client.put("/api/me/job-profile", json={"data": {}, "version": -1})).status_code == 422


async def test_expert_sees_profile_only_with_consent_and_never_salary_by_default(
    client, outbox, make_client, db, razorpay, admin_client
):
    await signup(client, outbox)
    _, order = await buy(client)
    oid = order["id"]
    expert, expert_id = await approved_expert(make_client, outbox, db)
    admin = await admin_client("ops")
    await admin.post(f"/api/admin/orders/{oid}/assign", json={"expertId": expert_id})
    await client.put("/api/me/job-profile", json={"data": PROFILE})
    assert err(await expert.get(f"/api/work/{oid}/profile")) == "no_consent"
    await client.put("/api/me/job-profile", json={"data": PROFILE, "privacy": {"experts": True}})
    seen = (await expert.get(f"/api/work/{oid}/profile")).json()["data"]
    assert seen["exp"][0]["company"] == "Acme" and "prefs" not in seen and "pinfo" not in seen
    await client.put(
        "/api/me/job-profile", json={"data": PROFILE, "privacy": {"experts": True, "salary": True, "personal": True}}
    )
    seen = (await expert.get(f"/api/work/{oid}/profile")).json()["data"]
    # job preferences were removed: never shown, even with the old salary switch on
    assert "prefs" not in seen and seen["pinfo"]["father"] == "R. Rao"
    # strangers and the customer themselves can't use the expert route
    other, _ = await approved_expert(make_client, outbox, db, "e2@example.com", "Other")
    assert (await other.get(f"/api/work/{oid}/profile")).status_code == 404
    assert (await client.get(f"/api/work/{oid}/profile")).status_code == 403

    # the resume the customer ordered with: job preferences never reach the expert; personal info only if printed
    original = {
        "personal": {"name": "Asha"},
        "prefs": {"salary": "₹5–10 LPA", "notice": "1 month"},
        "pinfo": {"father": "R"},
        "hidden": {"pinfo": True},
    }
    await client.put("/api/me/job-profile", json={"data": PROFILE, "privacy": {"experts": True}})
    await client.patch(f"/api/work/{oid}", json={"original": original})
    got = (await expert.get(f"/api/work/{oid}")).json()["original"]
    assert "prefs" not in got and "pinfo" not in got
    await db[ORDER_WORK].update_one({"_id": oid}, {"$set": {"data.original.hidden": {}}})
    assert (await expert.get(f"/api/work/{oid}")).json()["original"]["pinfo"] == {"father": "R"}
    assert (await client.get(f"/api/work/{oid}")).json()["original"]["prefs"]["salary"] == "₹5–10 LPA"  # owner: all


async def test_share_link_never_sends_job_preferences_or_unprinted_personal_info(client, outbox, make_client):
    await signup(client, outbox, name="Asha Rao")
    data = {
        "personal": {"name": "Asha Rao"},
        "prefs": {"salary": "₹5–10 LPA"},
        "pinfo": {"father": "R"},
        "hidden": {"pinfo": True},
    }
    await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": data})
    await client.put("/api/me/share", json={"on": True, "slug": "asha-rao", "resumeId": "r1"})
    body = (await make_client().get("/api/public/resumes/asha-rao")).json()["data"]
    assert "prefs" not in body and "pinfo" not in body
