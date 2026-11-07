"""Phase 4 E1 + E2 + E7: the Easy dashboard's next-step rules, the language chosen first (kept on the profile), the
Simple / Full switch with its defaults (Admin's Telugu / Hindi default, a college's "Simple by default", the global
off switch) and the activity log."""

from app.core.db import AUDIT_LOG, AUTO_ITEMS, USERS
from app.simple.router import next_step
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume, strong_resume
from tests.test_orgs import join, member, setup_group
from tests.test_orgs_phase2 import coordinator

URL = "/api/me/simple"
WEAK = resume(summary="", skillGroups=[], proj=[], exp=[], certs=[])


def doc(data):
    return {"key": "r1", "data": data}


def test_next_step_rules_in_order():
    on = {"on": True}
    assert next_step(None, {}, 0, 60)["key"] == "resume"
    assert next_step(doc({}), {}, 0, 60)["key"] == "resume"  # an empty starter resume counts as none
    assert next_step(doc(resume(edu=[])), {}, 0, 60)["key"] == "education"
    assert next_step(doc(resume(skillGroups=[])), {}, 0, 60)["key"] == "skills"
    assert next_step(doc(resume(proj=[], exp=[])), {}, 0, 60)["key"] == "projects"
    assert next_step(doc(resume(proj=[])), {}, 0, 60)["key"] != "projects"  # an internship is enough
    weak = next_step(doc(resume(summary="", certs=[])), {}, 0, 95)
    assert weak["key"] == "fix_score" and weak["need"] == 95 and weak["score"] < 95
    assert next_step(doc(strong_resume()), {}, 0, 60)["key"] == "auto_apply"
    assert next_step(doc(strong_resume()), {"on": False, "consent_at": 1}, 0, 60)["key"] == "auto_apply"  # paused
    assert next_step(doc(strong_resume()), {}, 0, 60, aa_site_on=False)["key"] == "jobs"  # Auto Apply off for all
    assert next_step(doc(strong_resume()), {"admin_paused": True}, 0, 60)["key"] == "jobs"
    ans = next_step(doc(strong_resume()), on, 2, 60)
    assert ans == {"key": "answer", "path": "/me/auto-apply#needs", "count": 2}
    assert next_step(doc(strong_resume()), on, 0, 60)["key"] == "jobs"


async def test_language_first_and_mode_defaults(client, outbox, db, admin_client):
    await signup(client, outbox, email="ravi@example.com", name="Ravi Kumar")
    r = (await client.get(URL)).json()
    assert r["on"] is True and r["lang"] is None and r["mode"] == "full" and r["modeChosen"] is False
    assert r["next"]["key"] == "resume" and r["name"] == "Ravi"
    assert (await client.get(URL, params={"hint": "te"})).json()["mode"] == "simple"  # picked Telugu on the site
    assert (await client.get(URL, params={"hint": "xx"})).json()["mode"] == "full"
    # the language is saved to the profile; Telugu / Hindi → simple by default
    r = (await client.put(f"{URL}/prefs", json={"lang": "te"})).json()
    assert r["lang"] == "te" and r["mode"] == "simple"
    assert (await client.put(f"{URL}/prefs", json={"lang": "ta"})).status_code == 422
    uid = (await db[USERS].find_one({"email": "ravi@example.com"}))["_id"]
    assert (await db[USERS].find_one({"_id": uid}))["simple"]["lang"] == "te"
    # the person's own choice wins and is remembered
    r = (await client.put(f"{URL}/prefs", json={"mode": "full", "autoRead": True})).json()
    assert r["mode"] == "full" and r["modeChosen"] is True and r["autoRead"] is True and r["lang"] == "te"
    assert await db[AUDIT_LOG].count_documents({"action": "simple.prefs", "actor_id": uid}) == 2
    # Admin: the default is editable, and the global switch turns the simple dashboard off for everyone
    owner = await admin_client("owner")
    s = (await owner.get("/api/admin/settings")).json()["simple"]
    assert s == {"on": True, "defaultTeHi": "simple", "defaultOther": "full"}
    await client.put(f"{URL}/prefs", json={"lang": "en"})
    await db[USERS].update_one({"_id": uid}, {"$unset": {"simple.mode": ""}})
    assert (await client.get(URL)).json()["mode"] == "full"
    r = await owner.put(
        "/api/admin/settings", json={"simple": {"on": True, "defaultTeHi": "simple", "defaultOther": "simple"}}
    )
    assert r.json()["simple"]["defaultOther"] == "simple"
    assert (await client.get(URL)).json()["mode"] == "simple"
    bad = {"simple": {"on": True, "defaultTeHi": "big", "defaultOther": "full"}}
    assert (await owner.put("/api/admin/settings", json=bad)).status_code == 422
    await owner.put("/api/admin/settings", json={"simple": {"on": False}})
    await client.put(f"{URL}/prefs", json={"mode": "simple"})
    r = (await client.get(URL)).json()
    assert r["on"] is False and r["mode"] == "full"  # off wins over the person's choice
    assert await db[AUDIT_LOG].count_documents({"action": "settings.changed", "data.simple": {"$exists": True}}) == 2


async def test_college_simple_by_default(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    org, _ = await setup_group(owner)
    c, _ = await member(make_client, outbox)
    assert (await join(c)).status_code == 201
    assert (await c.get(URL)).json()["mode"] == "full"
    coord, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/simple"
    assert (await coord.get(base)).json() == {"simpleDefault": False}
    assert (await coord.put(base, json={"simpleDefault": True})).json() == {"simpleDefault": True}
    assert (await c.get(URL)).json()["mode"] == "simple"
    # students can still switch
    assert (await c.put(f"{URL}/prefs", json={"mode": "full"})).json()["mode"] == "full"
    viewer, _ = await coordinator(owner, make_client, outbox, org["id"], email="v@example.com", role="viewer")
    assert (await viewer.put(base, json={"simpleDefault": False})).status_code == 403
    assert (await c.get(base)).status_code in (401, 403, 404)  # a student is not staff
    assert await db[AUDIT_LOG].count_documents({"action": "org_simple_default"}) == 1


async def test_counts_and_next_step_from_the_real_resume(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=WEAK)
    nxt = (await client.get(URL)).json()["next"]
    assert nxt["key"] == "skills" and nxt["path"]
    await add_resume(client, key="r2", data=strong_resume(), active=True)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.on": True, "auto_apply.consent_at": 1}})
    await db[AUTO_ITEMS].insert_one({"_id": "i1", "user_id": uid, "job_id": "j1", "state": "needs_answer"})
    r = (await client.get(URL)).json()
    assert r["next"]["key"] == "answer" and r["counts"] == {"needs": 1, "ready": 0, "autoOn": True}
