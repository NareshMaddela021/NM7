"""Delete my account: email code, 7-day undo window (public link off at once), Owners transfer first, the erase
removes everything personal, paid orders stay for GST but anonymised, the address can sign up again, admin sees
the requests."""

from datetime import timedelta

import pytest

from app.automation import run_rules
from app.core.db import (
    CERTIFICATES,
    DELETION_REQUESTS,
    JOB_MATCHES,
    MEMBERSHIPS,
    ORDERS,
    RATE_EVENTS,
    RESUMES,
    SESSIONS,
    SHARES,
    USERS,
)
from app.core.time import now
from app.me.delete import erase_due
from tests.conftest import PASSWORD, signup
from tests.test_orgs import setup_group
from tests.test_orgs_phase2 import coordinator

RESUME = {"personal": {"name": "Asha Rao", "email": "asha@example.com", "phone": "+91 98765 43210"}}


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def asha(client, outbox):
    await signup(client, outbox, "asha@example.com", name="Asha Rao")
    assert (await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": RESUME})).status_code == 201
    await client.put("/api/me/share", json={"on": True, "slug": "asha-rao", "resumeId": "r1"})
    return (await client.get("/api/auth/me")).json()["id"]


async def test_code_window_undo(client, outbox, db, make_client):
    uid = await asha(client, outbox)
    base = "/api/me/account/deletion"
    assert (await client.get(base)).json() == {"requested": False, "eraseAt": None, "ownerOf": []}
    assert (await client.post(base, json={"code": "123456"})).status_code == 400  # no code asked for yet
    assert (await client.post(f"{base}/code")).json() == {"sent": True}
    code = outbox.last_code("asha@example.com")
    r = await client.post(base, json={"code": code})
    assert r.status_code == 200 and r.json()["requested"] is True
    assert "deleted on" in outbox.sent[-1].text
    # the public link stops at once; everything else waits 7 days
    assert (await make_client().get("/api/public/resumes/asha-rao")).status_code == 404
    assert await db[RESUMES].count_documents({"user_id": uid}) == 1
    assert await erase_due(db) == 0
    # undo
    assert (await client.delete(base)).status_code == 204
    assert (await client.get(base)).json()["requested"] is False
    assert (await client.delete(base)).status_code == 404
    req = await db[DELETION_REQUESTS].find_one({"_id": uid})
    assert req["status"] == "undone" and req["email"] == ""


async def test_owner_must_transfer_first(owner, make_client, outbox):
    org, _ = await setup_group(owner)
    own, _ = await coordinator(owner, make_client, outbox, org["id"], email="head@example.com", role="owner")
    assert len((await own.get("/api/me/account/deletion")).json()["ownerOf"]) == 1
    r = await own.post("/api/me/account/deletion/code")
    assert r.status_code == 409 and r.json()["error"]["code"] == "owner_first"


async def test_erase_after_seven_days(client, outbox, db, make_client, owner):
    uid = await asha(client, outbox)
    org, g = await setup_group(owner)
    r = await client.post(
        "/api/me/groups/join",
        json={"code": g["code"], "consent": True, "fields": {"roll": "21A01", "branch": "CSE"}, "resumeId": "r1"},
    )
    assert r.status_code == 201, r.text
    await db[JOB_MATCHES].insert_one({"_id": "jm1", "user_id": uid, "text": "Data analyst post"})
    await db[CERTIFICATES].insert_one({"_id": "c1", "user_id": uid, "name": "SQL"})
    t = now()
    await db[ORDERS].insert_many(
        [
            {"_id": "NM7-1", "customer_id": uid, "plan": "diy", "status": "paid", "amount": 9900, "paid_at": t,
             "created_at": t, "kind": "customer", "target_role": "Data Analyst"},
            {"_id": "NM7-2", "customer_id": uid, "plan": "diy", "status": "pending_payment", "amount": 9900,
             "paid_at": None, "created_at": t, "kind": "customer"},
        ]
    )  # fmt: skip
    await client.post("/api/me/account/deletion/code")
    await client.post("/api/me/account/deletion", json={"code": outbox.last_code("asha@example.com")})
    await db[USERS].update_one({"_id": uid}, {"$set": {"deletion.erase_at": now() - timedelta(minutes=1)}})
    done = await run_rules(db)
    assert done["accounts_erased"] == 1
    for coll, q in (
        (RESUMES, {"user_id": uid}),
        (SHARES, {"_id": uid}),
        (JOB_MATCHES, {"user_id": uid}),
        (CERTIFICATES, {"user_id": uid}),
        (MEMBERSHIPS, {"user_id": uid}),
        (SESSIONS, {"user_id": uid}),
        (ORDERS, {"customer_id": uid}),
    ):
        assert await db[coll].count_documents(q) == 0, coll
    paid = await db[ORDERS].find_one({"_id": "NM7-1"})
    assert paid["amount"] == 9900 and paid["customer_id"].startswith("deleted-") and paid["target_role"] is None
    assert await db[ORDERS].find_one({"_id": "NM7-2"}) is None
    u = await db[USERS].find_one({"_id": uid})
    assert u["name"] == "Deleted user" and "asha" not in u["email"] and u["phone"] is None and u["disabled_at"]
    # can't sign in; the address can sign up again
    r = await make_client().post("/api/auth/login", json={"email": "asha@example.com", "password": PASSWORD})
    assert r.status_code in (400, 401)
    await db[RATE_EVENTS].delete_many({})  # sign-up codes: one a minute per address
    await signup(make_client(), outbox, "asha@example.com", name="Asha Again")
    # admin sees the request, without the name and email once erased
    rows = (await owner.get("/api/admin/deletion-requests")).json()
    assert rows[0]["status"] == "erased" and rows[0]["email"] == "" and rows[0]["items"] > 0
