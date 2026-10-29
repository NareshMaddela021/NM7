"""Student stories: consent required, no contact details, admin approves (typo fixes only) or rejects, public list
shows approved non-demo stories only, the student withdraws and it is gone, erased with the account."""

import base64

import pytest

from app.core.db import STORIES
from app.me.erase import erase_user_data
from tests.conftest import signup

STORY = "Nm7 helped me fix my resume before the campus drive. I got shortlisted by two companies in one week."
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def body(**kw):
    return {"story": STORY, "displayName": "Asha R.", "company": "Infosys", "role": "Systems Engineer",
            "consent": True, **kw}  # fmt: skip


async def test_submit_approve_public_withdraw(client, outbox, owner, make_client, db):
    await signup(client, outbox, "asha@example.com", name="Asha Rao")
    assert (await client.post("/api/me/stories", json=body(consent=False))).status_code == 422  # consent needed
    for bad in ("Call me on 9876543210 any time, I can help you with your resume too!",
                "Write to asha@example.com and I will share my resume template with everyone."):  # fmt: skip
        r = await client.post("/api/me/stories", json=body(story=bad))
        assert r.status_code == 400 and r.json()["error"]["code"] == "contact_details"
    assert (
        await client.post("/api/me/stories", json=body(photo="data:image/svg+xml;base64,PHN2Zz4="))
    ).status_code == 400
    r = await client.post("/api/me/stories", json=body(photo=PNG))
    assert r.status_code == 201 and r.json()["status"] == "pending"
    sid = r.json()["id"]
    anon = make_client()
    assert (await anon.get("/api/public/stories")).json() == []  # not before approval
    # admin: a bigger rewrite is refused, a typo fix is fine
    r = await owner.put(
        f"/api/admin/stories/{sid}",
        json={"action": "approve", "story": "Nm7 is the best site ever made for students and you must use it now ok."},
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_a_typo"
    fixed = STORY.replace("one week", "one week!")
    r = await owner.put(f"/api/admin/stories/{sid}", json={"action": "approve", "story": fixed})
    assert r.status_code == 200 and r.json()["edited"] is True and r.json()["original"] == STORY
    pub = (await anon.get("/api/public/stories")).json()
    assert len(pub) == 1 and pub[0]["story"] == fixed and pub[0]["displayName"] == "Asha R." and pub[0]["photo"] == PNG
    assert "@" not in str(pub) and "user" not in str(pub).lower()
    # the student withdraws: gone at once
    assert (await make_client().delete(f"/api/me/stories/{sid}")).status_code in (401, 403)
    assert (await client.delete(f"/api/me/stories/{sid}")).status_code == 204
    assert (await anon.get("/api/public/stories")).json() == []
    assert await db[STORIES].count_documents({}) == 0
    # rejected stories don't show; customers can't use the admin list
    sid = (await client.post("/api/me/stories", json=body())).json()["id"]
    await owner.put(f"/api/admin/stories/{sid}", json={"action": "reject"})
    assert (await anon.get("/api/public/stories")).json() == []
    assert (await client.get("/api/admin/stories")).status_code in (401, 403)
    uid = (await db[STORIES].find_one({"_id": sid}))["user_id"]
    assert (await erase_user_data(db, uid))["stories"] == 1


async def test_demo_stories_never_public(owner, make_client, db):
    assert (await owner.post("/api/admin/demo-org")).status_code == 200
    demo = await db[STORIES].count_documents({"demo": True})
    assert demo >= 2
    rows = (await owner.get("/api/admin/stories?status=approved")).json()
    assert all(r["demo"] for r in rows) and all("(demo)" in r["displayName"] for r in rows)
    assert (await make_client().get("/api/public/stories")).json() == []
