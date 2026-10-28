"""Skill gap course suggestions: free courses per missing skill from the admin-editable list, seeded once with free
official sources, no tracking / affiliate links, Owner-only admin."""

from app.core.db import AUDIT_LOG, COURSES
from app.courses.seed import SEED
from tests.conftest import signup


async def test_seeded_once_and_free_courses_per_skill(client, outbox, db):
    await signup(client, outbox)
    r = await client.get("/api/me/courses?skills=python,Excel,SQL,Underwater basket weaving")
    assert r.status_code == 200, r.text
    d = r.json()
    by = {s["skill"]: s["courses"] for s in d["skills"]}
    assert len(by["Python"]) == 3 and all(c["free"] for c in by["Python"])
    assert by["Microsoft Excel"][0]["provider"] == "GCFGlobal"
    assert [c["provider"] for c in by["SQL"]] == ["Kaggle Learn", "freeCodeCamp"]
    assert by["Underwater basket weaving"] == []
    assert [c["provider"] for c in d["catalogues"]] == ["NPTEL", "SWAYAM"]
    assert await db[COURSES].count_documents({}) == len(SEED)
    await client.get("/api/me/courses?skills=Python")
    assert await db[COURSES].count_documents({}) == len(SEED)  # not seeded twice
    assert all(row[3].startswith("https://") and "utm_" not in row[3] for row in SEED)


async def test_needs_sign_in(client):
    assert (await client.get("/api/me/courses?skills=Python")).status_code == 401


async def test_admin_edits_the_list_and_paid_or_paused_courses_never_show(client, outbox, admin_client, db):
    owner = await admin_client("owner")
    rows = (await owner.get("/api/admin/courses")).json()
    assert len(rows) == len(SEED)
    body = {
        "skill": "figma",
        "title": "Figma for beginners",
        "provider": "Figma",
        "url": "https://help.figma.com/hc/en-us",
        "language": "English",
        "hours": 2,
        "free": True,
        "active": True,
    }
    r = await owner.post("/api/admin/courses", json=body)
    assert r.status_code == 201 and r.json()["skill"] == "Figma"
    cid = r.json()["id"]
    bad = await owner.post("/api/admin/courses", json={**body, "url": "https://example.com/c?utm_source=nm7"})
    assert bad.status_code == 422
    assert (await owner.post("/api/admin/courses", json={**body, "url": "http://example.com/c"})).status_code == 422
    await owner.post("/api/admin/courses", json={**body, "title": "Paid course", "free": False})
    await owner.post("/api/admin/courses", json={**body, "title": "Old course", "active": False})
    await signup(client, outbox)
    shown = (await client.get("/api/me/courses?skills=Figma")).json()["skills"][0]["courses"]
    assert [c["title"] for c in shown] == ["Figma for beginners"]
    r = await owner.put(f"/api/admin/courses/{cid}", json={**body, "active": False})
    assert r.json()["active"] is False
    assert (await client.get("/api/me/courses?skills=Figma")).json()["skills"][0]["courses"] == []
    assert (await owner.delete(f"/api/admin/courses/{cid}")).status_code == 200
    acts = {a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^course"}})}
    assert acts == {"course.created", "course.edited", "course.deleted"}


async def test_only_the_owner_admin(client, outbox, admin_client):
    fin = await admin_client("finance", email="fin@nm7.example")
    await signup(client, outbox)
    for c in (client, fin):
        assert (await c.get("/api/admin/courses")).status_code == 403
        ok = {"skill": "SQL", "title": "SQL course", "provider": "X", "url": "https://example.com/sql"}
        assert (await c.post("/api/admin/courses", json=ok)).status_code == 403
        assert (await c.delete("/api/admin/courses/x")).status_code == 403
