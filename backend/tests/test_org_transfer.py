"""Transfer ownership: the Owner (or Nm7's admin, on request) starts it; the new owner confirms with an emailed
code while signed in with that address; the old Owner becomes a coordinator or leaves; billing follows the Owner;
every step in the Activity log; coordinators can't start it; one open transfer; wrong codes run out."""

import re

import pytest

from app.billing.subscription import owner_emails
from app.core.db import AUDIT_LOG, ORG_STAFF, ORG_TRANSFERS
from tests.conftest import signup
from tests.test_orgs import setup_group
from tests.test_orgs_phase2 import coordinator


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def org_with_owner(owner, make_client, outbox):
    org, _ = await setup_group(owner)
    own, s = await coordinator(owner, make_client, outbox, org["id"], email="head@example.com", role="owner")
    return org, own, s


async def test_owner_to_coordinator_old_owner_stays_as_coordinator(owner, make_client, outbox, db):
    org, own, own_row = await org_with_owner(owner, make_client, outbox)
    co, co_row = await coordinator(owner, make_client, outbox, org["id"], email="tpo@example.com")
    base = f"/api/org/{org['id']}/transfer"
    # a coordinator can't start or see it
    assert (await co.post(base, json={"toEmail": "tpo@example.com"})).status_code == 403
    assert (await own.post(base, json={"toEmail": "head@example.com"})).status_code == 400  # own address
    r = await own.post(base, json={"toEmail": "tpo@example.com", "oldOwner": "coordinator"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "pending" and t["emailSent"] is True and t["by"] == "owner"
    assert (await own.post(base, json={"toEmail": "x@example.com"})).status_code == 409  # one at a time
    assert (await own.get(base)).json()["toEmail"] == "tpo@example.com"
    mail = outbox.sent[-1]
    assert mail.to == "tpo@example.com" and "Owner" in mail.subject
    code = outbox.last_code("tpo@example.com")
    # someone else can't accept it, even with the code
    stranger = make_client()
    await signup(stranger, outbox, "other@example.com", name="Other")
    tid = (await co.get("/api/me/org-transfers")).json()[0]["id"]
    assert (await stranger.post(f"/api/me/org-transfers/{tid}/accept", json={"code": code})).status_code == 404
    assert (await stranger.get("/api/me/org-transfers")).json() == []
    # wrong code, then the right one
    wrong = "000000" if code != "000000" else "111111"
    assert (await co.post(f"/api/me/org-transfers/{tid}/accept", json={"code": wrong})).status_code == 400
    r = await co.post(f"/api/me/org-transfers/{tid}/accept", json={"code": code})
    assert r.json() == {"orgId": org["id"], "role": "owner"}
    assert (await co.post(f"/api/me/org-transfers/{tid}/accept", json={"code": code})).status_code == 404  # once
    roles = {s["email_lc"]: s["role"] async for s in db[ORG_STAFF].find({"org_id": org["id"], "status": "active"})}
    assert roles == {"tpo@example.com": "owner", "head@example.com": "coordinator"}
    # billing follows the Owner; the old Owner lost Owner-only pages
    assert [e for e, _ in await owner_emails(db, org["id"])] == ["tpo@example.com"]
    assert (await own.get(base)).status_code == 403
    assert (await co.get(base)).json() is None
    acts = [a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]}).sort("_id", 1)]
    assert acts[-2:] == ["owner_transfer_start", "owner_transfer_done"]
    log = (await co.get(f"/api/org/{org['id']}/audit")).json()
    assert {"owner_transfer_start", "owner_transfer_done"} <= {e["action"] for e in log}


async def test_to_a_new_email_old_owner_leaves_cancel_and_tries(owner, make_client, outbox, db):
    org, own, _ = await org_with_owner(owner, make_client, outbox)
    base = f"/api/org/{org['id']}/transfer"
    # cancel
    await own.post(base, json={"toEmail": "new@example.com"})
    assert (await own.delete(base)).status_code == 204
    assert (await own.get(base)).json() is None
    # five wrong codes stop it
    await own.post(base, json={"toEmail": "new@example.com", "oldOwner": "leave"})
    new = make_client()
    await signup(new, outbox, "new@example.com", name="New Head")
    tid = (await new.get("/api/me/org-transfers")).json()[0]["id"]
    t = await db[ORG_TRANSFERS].find_one({"_id": tid})
    assert "code" not in t and t["code_hash"]  # only a hash is stored
    for _ in range(5):
        await new.post(f"/api/me/org-transfers/{tid}/accept", json={"code": "123456"})
    code = next(m for m in reversed(outbox.sent) if "Owner of" in m.subject and m.to == "new@example.com")
    real = re.search(r"\b(\d{6})\b", code.text).group(1)
    assert (await new.post(f"/api/me/org-transfers/{tid}/accept", json={"code": real})).status_code in (400, 429)
    # start again; this time the old Owner leaves
    await own.delete(base)
    await own.post(base, json={"toEmail": "new@example.com", "oldOwner": "leave"})
    tid = (await new.get("/api/me/org-transfers")).json()[0]["id"]
    real = re.search(r"\b(\d{6})\b", outbox.sent[-1].text).group(1)
    assert (await new.post(f"/api/me/org-transfers/{tid}/accept", json={"code": real})).status_code == 200
    rows = {s["email_lc"]: (s["role"], s["status"]) async for s in db[ORG_STAFF].find({"org_id": org["id"]})}
    assert rows["new@example.com"] == ("owner", "active") and rows["head@example.com"][1] == "removed"
    assert (await own.get(f"/api/org/{org['id']}")).status_code == 404  # no access any more
    assert (await new.get(f"/api/org/{org['id']}")).json()["isOwner"] is True


async def test_admin_transfers_on_request(owner, make_client, outbox, db):
    org, own, own_row = await org_with_owner(owner, make_client, outbox)
    base = f"/api/admin/orgs/{org['id']}/transfer"
    r = await owner.post(base, json={"toEmail": "dean@example.com", "oldOwner": "coordinator"})
    assert r.status_code == 201 and r.json()["by"] == "admin"
    assert (await owner.get(base)).json()["toEmail"] == "dean@example.com"
    dean = make_client()
    await signup(dean, outbox, "dean@example.com", name="Dean")
    tid = (await dean.get("/api/me/org-transfers")).json()[0]["id"]
    code = next(m for m in reversed(outbox.sent) if "Owner of" in m.subject).text
    r = await dean.post(f"/api/me/org-transfers/{tid}/accept", json={"code": re.search(r"\b(\d{6})\b", code).group(1)})
    assert r.status_code == 200
    roles = {s["email_lc"]: s["role"] async for s in db[ORG_STAFF].find({"org_id": org["id"], "status": "active"})}
    assert roles == {"dean@example.com": "owner", "head@example.com": "coordinator"}
    # customers can't use the admin route
    assert (await own.post(base, json={"toEmail": "x@example.com"})).status_code in (401, 403)
