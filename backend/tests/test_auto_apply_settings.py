"""Phase 3 A1: Auto Apply settings. Validation, the ATS gate (score 60+, else what to fix), the consent tick, on by
default once set up, the big Pause / Resume, the admin's daily-limit maximum and role suggestions."""

from app.core.db import AUDIT_LOG, RESUMES, USERS
from app.orgs.ats import ats_score
from app.site import save_site
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume, strong_resume
from tests.test_jobs_public import add

URL = "/api/me/auto-apply"
GOOD = {
    "roles": ["Data Analyst"],
    "cities": ["Hyderabad"],
    "remote": True,
    "experience": ["fresher"],
    "minScore": 70,
    "dailyLimit": 5,
    "avoid": ["Spam Corp"],
    "jobTypes": ["full_time"],
    "consent": True,
}


def err(r):
    return r.json()["error"]["code"]


async def test_gate_consent_and_pause(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    r = (await client.get(URL)).json()
    assert r["settings"]["setUp"] is False and r["settings"]["minScore"] == 70 and r["settings"]["dailyLimit"] == 5
    assert r["gate"]["ok"] is False and r["gate"]["fixes"][0]["key"] == "resume"  # no resume yet
    # a weak resume: the gate says what to fix
    weak = resume(summary="", skillGroups=[], proj=[], exp=[], certs=[])
    await add_resume(client, data=weak)
    g = (await client.get(URL)).json()["gate"]
    assert g["ok"] is False and g["score"] == ats_score(weak)["score"] < 60 and g["need"] == 60
    assert {f["key"] for f in g["fixes"]} >= {"summary", "experience"}
    # items 5 and 14: each fix opens the exact builder section, not the builder's start
    paths = {f["key"]: f["path"] for f in g["fixes"]}
    assert paths["summary"] == "/builder?start=section&sec=summary"
    assert paths["experience"] == "/builder?start=section&sec=proj"
    r = await client.put(URL, json=GOOD)
    assert r.status_code == 409 and err(r) == "gate" and r.json()["error"]["gate"]["fixes"]
    # a good resume: consent needed, then on by default
    await add_resume(client, key="r2", data=strong_resume(), active=True)
    assert (await client.get(URL)).json()["gate"]["ok"] is True
    assert err(await client.put(URL, json={**GOOD, "consent": False})) == "consent"
    assert err(await client.put(URL, json={**GOOD, "roles": []})) == "roles"
    assert (await client.put(URL, json={**GOOD, "minScore": 30})).status_code == 422
    assert (await client.put(URL, json={**GOOD, "experience": ["guru"]})).status_code == 422
    assert err(await client.put(URL, json={**GOOD, "dailyLimit": 11})) == "daily_limit"  # admin maximum 10
    out = (await client.put(URL, json=GOOD)).json()
    s = out["settings"]
    assert s["setUp"] and s["on"] and s["roles"] == ["Data Analyst"] and s["avoid"] == ["Spam Corp"]
    assert out["previewLeft"] == 3 and out["siteOn"] is True
    # later saves don't need the tick again
    out = (await client.put(URL, json={**GOOD, "consent": False, "dailyLimit": 3})).json()
    assert out["settings"]["dailyLimit"] == 3 and out["settings"]["on"]
    # pause / resume
    assert (await client.post(f"{URL}/pause", json={"paused": True})).json()["settings"]["on"] is False
    assert (await client.post(f"{URL}/pause", json={"paused": False})).json()["settings"]["on"] is True
    actions = {a["action"] async for a in db[AUDIT_LOG].find({"action": {"$regex": "^auto_apply"}})}
    assert actions == {"auto_apply.setup", "auto_apply.settings", "auto_apply.pause", "auto_apply.resume"}
    # a resume that drops below the bar (or a higher bar in Admin) blocks resuming
    await db[RESUMES].update_many({"key": "r2"}, {"$set": {"active": False}})
    await db[RESUMES].update_many({"key": "r1"}, {"$set": {"active": True}})
    await client.post(f"{URL}/pause", json={"paused": True})
    assert err(await client.post(f"{URL}/pause", json={"paused": False})) == "gate"
    # deleting the account removes the settings
    from app.me.erase import erase_account

    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await erase_account(db, uid)
    assert "auto_apply" not in (await db[USERS].find_one({"_id": uid}))


async def test_admin_bar(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=strong_resume())
    assert (await client.get(URL)).json()["gate"]["ok"] is True
    await save_site(db, {"auto_apply": {"ats_min": 100, "max_daily_limit": 3}})
    g = (await client.get(URL)).json()
    assert g["gate"]["need"] == 100 and g["limits"]["maxDailyLimit"] == 3 and g["settings"]["dailyLimit"] == 3
    assert err(await client.put(URL, json=GOOD)) == "daily_limit"


async def test_pause_before_setup_and_suggestions(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    assert err(await client.post(f"{URL}/pause", json={"paused": True})) == "not_set_up"
    await add_resume(client)
    await add(db)
    await add(db, title="Java Developer", skills=["Java"], locations=["Chennai"])
    s = (await client.get(f"{URL}/suggest")).json()
    assert "Junior Data Analyst" in s["roles"] and "Java Developer" in s["roles"]
    assert "SQL" in s["skills"] and "Power BI" in s["skills"]
    assert (await client.get(URL.replace("/auto-apply", "/auto-apply/suggest"))).status_code == 200
