"""Admin → Demo → "Reset and open as coordinator": a one-time link signs a browser in as the demo college's made-up
coordinator; that session reaches only the demo college (and its demo college group), never real organizations,
resumes, orders or payments; the link works once and expires."""

from datetime import timedelta

import pytest

from app.core.db import ORG_STAFF
from app.core.time import now
from app.orgs.demo import ORG_ID
from tests.test_orgs import setup_group


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def demo_browser(owner, make_client):
    r = await owner.post("/api/admin/demo-org/coordinator")
    assert r.status_code == 200, r.text
    path = r.json()["path"]
    assert path.startswith("/org/demo-login#t=")
    token = path.split("#t=")[1]
    c = make_client()
    r = await c.post("/api/public/demo-coordinator", json={"token": token})
    assert r.json() == {"orgId": ORG_ID}
    return c, token


async def test_opens_the_demo_college_only(owner, make_client, db):
    real, _ = await setup_group(owner)
    c, token = await demo_browser(owner, make_client)
    # the link works once
    assert (await make_client().post("/api/public/demo-coordinator", json={"token": token})).status_code == 400
    # the demo college: portal, every college feature, its demo college group
    me = (await c.get("/api/auth/me")).json()
    assert me["name"] == "Demo Coordinator (demo)" and me["role"] == "customer"
    home = (await c.get(f"/api/org/{ORG_ID}")).json()
    assert home["role"] == "coordinator" and home["demo"] is True
    for p in ("/drives", "/offers", "/offers/stats", "/alumni/summary", "/reviewers", "/placement", "/audit"):
        assert (await c.get(f"/api/org/{ORG_ID}{p}")).status_code == 200, p
    groups = (await c.get("/api/me/college-groups")).json()
    assert groups and (await c.get(f"/api/college-group/{groups[0]['id']}")).status_code == 200
    assert [o["orgId"] for o in (await c.get("/api/me/orgs")).json()] == [ORG_ID]
    # nothing else: a real organization, resumes, orders, payments, profile, admin
    for path in (f"/api/org/{real['id']}", "/api/me/state", "/api/me/resumes", "/api/orders", "/api/me/profile",
                 "/api/admin/orgs"):  # fmt: skip
        r = await c.get(path)
        assert r.status_code in (403, 404), path
    r = await c.post("/api/orders", json={"plan": "diy"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_only"


async def test_link_expires_and_admin_only(owner, make_client, db):
    r = await owner.post("/api/admin/demo-org/coordinator")
    token = r.json()["path"].split("#t=")[1]
    await db[ORG_STAFF].update_one(
        {"_id": "demo-staff-coordinator"}, {"$set": {"demo_login_exp": now() - timedelta(seconds=1)}}
    )
    assert (await make_client().post("/api/public/demo-coordinator", json={"token": token})).status_code == 400
    assert (await make_client().post("/api/admin/demo-org/coordinator")).status_code in (401, 403)
