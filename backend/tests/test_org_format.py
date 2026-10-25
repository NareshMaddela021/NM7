"""Official placement template (colleges, Phase 2): college name, header style, footer and 1-3 allowed templates
(one on Drive), section order and rules on Campus only; students of the group see the format; the export job carries
what the cover page needs; org-side copies keep the member's content and section switches exactly as they are."""

import pytest

from tests.test_org_placement import plan
from tests.test_orgs import RESUME, join, member, setup_group
from tests.test_orgs_phase2 import coordinator

FORMAT = {
    "color": "#1F3A8A",
    "header": "Training & Placement Cell",
    "footer": "Placement resume · Batch 2026 · Verified by T&P Cell",
    "template": "fresher",
    "collegeName": "JNTU Anantapur",
    "headerStyle": "center",
    "templates": ["campus"],
}
RULES = {"order": ["edu", "proj", "skills"], "required": ["edu", "skills"], "requireCgpa": True,
         "optional": ["certs", "langs"], "maxPages": 1, "photo": False, "showRoll": True}  # fmt: skip


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def test_drive_logo_format_campus_rules(owner, make_client, outbox):
    org, g = await setup_group(owner)
    await plan(owner, org["id"], "drive")
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/branding"
    r = await c.put(base, json=FORMAT)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["collegeName"] == "JNTU Anantapur" and b["headerStyle"] == "center" and b["templates"] == ["campus"]
    assert b["template"] == "campus" and b["rules"] is None and b["rulesAllowed"] is False
    # Drive: one template, no rules
    r = await c.put(base, json={**FORMAT, "templates": ["campus", "academic"]})
    assert r.status_code == 402 and err(r) == "plan_feature"
    r = await c.put(base, json={**FORMAT, "rules": RULES})
    assert r.status_code == 402
    # an older page that doesn't send the new fields keeps them
    r = await c.put(base, json={"color": "#1F3A8A", "header": "T&P Cell", "footer": "", "template": "fresher"})
    assert r.json()["collegeName"] == "JNTU Anantapur" and r.json()["templates"] == ["campus"]
    # Campus: up to three templates and the rules
    await plan(owner, org["id"], "campus")
    r = await c.put(base, json={**FORMAT, "templates": ["campus", "academic", "classic"], "rules": RULES})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["templates"] == ["campus", "academic", "classic"] and b["rulesAllowed"] is True
    assert b["rules"] == RULES
    assert (await c.put(base, json={**FORMAT, "templates": ["a", "b"]})).status_code == 422
    assert (await c.put(base, json={**FORMAT, "templates": ["campus"] * 4})).status_code == 422
    assert (await c.put(base, json={**FORMAT, "rules": {**RULES, "order": ["nope"]}})).status_code == 422
    # back on Drive the rules stop applying (kept, not deleted) and one template is used
    await plan(owner, org["id"], "drive")
    b = (await c.get(base)).json()
    assert b["rules"] is None and b["templates"] == ["campus"]
    # a viewer can't change it
    v, _ = await coordinator(owner, make_client, outbox, org["id"], email="v@example.com", role="viewer")
    assert (await v.put(base, json=FORMAT)).status_code == 403


async def test_students_see_the_format_and_exports_carry_the_cover(owner, make_client, outbox):
    org, g = await setup_group(owner)
    await plan(owner, org["id"], "campus")
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    await c.put(f"/api/org/{org['id']}/branding", json={**FORMAT, "rules": RULES})
    data = {**RESUME, "hidden": {"langs": True}, "order": ["skills", "edu", "exp"]}
    m, _ = await member(make_client, outbox, data=data)
    assert (await join(m)).status_code == 201
    # not printing in the college format yet: nothing for the student
    assert (await m.get("/api/me/groups")).json()[0]["format"] is None
    r = await c.patch(f"/api/org/{org['id']}/groups/{g['id']}", json={"settings": {"printBranded": True}})
    assert r.status_code == 200, r.text
    fmt = (await m.get("/api/me/groups")).json()[0]["format"]
    assert fmt["collegeName"] == "JNTU Anantapur" and fmt["rules"]["requireCgpa"] is True
    # the org-side copy: the member's own content and switches, untouched (the layout is applied when drawing)
    mid = (await m.get("/api/me/groups")).json()[0]["id"]
    v = (await c.get(f"/api/org/{org['id']}/shared-resumes/{mid}")).json()
    assert v["data"]["order"] == ["skills", "edu", "exp"] and v["data"]["hidden"] == {"langs": True}
    assert v["data"]["exp"] == [RESUME["exp"][0]]  # the switched-off entry stays out, nothing else changes
    assert v["brand"]["rules"]["order"] == ["edu", "proj", "skills"] and v["roll"] == "21A01"
    # combined PDF / ZIP: one college → its brand and the batch / branch for the cover page
    job = (await c.post(f"/api/org/{org['id']}/shared-resumes/exports", json={"kind": "print_bulk"})).json()
    assert job["cover"]["brand"] == g["id"] and job["cover"]["batches"] == ["B.Tech 2026 placements"]
    assert job["cover"]["branches"] == ["CSE"] and job["items"][0]["roll"] == "21A01"
    assert job["brands"][g["id"]]["collegeName"] == "JNTU Anantapur"
