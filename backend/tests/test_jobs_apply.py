"""Job board J5: Manual Apply (on Nm7 / company link / email), the application timeline (Applied → Viewed →
Shortlisted → Interview → Offer / Rejected), who may move it, and the 7-day follow-up reminder (in the app, one email
a day at most, never after "Stop these emails")."""

from datetime import timedelta

from app.core.db import APPLICATIONS, AUDIT_LOG, JOBS, USERS
from app.core.time import now
from app.jobs import apply as applymod
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_jobs_public import add


def err(r):
    return r.json()["error"]["code"]


async def jobs(db):
    nm7 = await add(db, title="QA Trainee", applyMethod="nm7", applyUrl="")
    link = await add(db, title="Data Analyst", applyUrl="https://acme.example/careers/9")
    mail = await add(db, title="Support Associate", applyMethod="email", applyUrl="", applyEmail="hr@acme.example")
    return nm7, link, mail


async def test_apply_three_ways_and_my_applications(client, db, outbox, admin_client):
    nm7, link, mail = await jobs(db)
    assert (await client.post(f"/api/jobs/{nm7['_id']}/apply", json={})).status_code == 401
    await signup(client, outbox)
    await add_resume(client, key="r1", name="Main")
    # on Nm7: one tap
    r = await client.post(f"/api/jobs/{nm7['_id']}/apply", json={})
    assert r.status_code == 201, r.text
    assert r.json()["method"] == "nm7" and r.json()["created"] is True
    again = await client.post(f"/api/jobs/{nm7['_id']}/apply", json={})
    assert again.json()["created"] is False  # applying twice keeps one application
    # company link: saved as applied outside Nm7, with the link to open
    r = (await client.post(f"/api/jobs/{link['_id']}/apply", json={"resumeId": "r1"})).json()
    assert r["method"] == "link" and r["url"] == "https://acme.example/careers/9"
    # email: the address (only now), a subject and a letter for the mailto draft
    r = (await client.post(f"/api/jobs/{mail['_id']}/apply", json={})).json()
    assert r["email"]["to"] == "hr@acme.example" and r["email"]["subject"] == "Application for Support Associate"
    assert "Support Associate role at Acme Analytics" in r["email"]["body"] and "Sai Varsha" in r["email"]["body"]
    assert (await client.post(f"/api/jobs/{mail['_id']}/apply", json={"resumeId": "nope"})).status_code == 404
    # they're all in My applications, with the resume used and the first step
    apps = {a["role"]: a for a in (await client.get("/api/me/state")).json()["apps"]}
    assert set(apps) == {"QA Trainee", "Data Analyst", "Support Associate"}
    a = apps["Data Analyst"]
    assert (a["status"], a["channel"], a["resumeId"], a["resumeName"]) == ("applied", "link", "r1", "Main")
    assert [s["status"] for s in a["timeline"]] == ["applied"] and a["jobId"] == link["_id"]
    assert a["url"] == f"https://nm7.si/jobs/{link['slug']}" and a["next"]  # follow-up date set
    # the person moves an outside application; not one sent on Nm7; never to "Viewed"
    key = a["id"]
    r = await client.patch(f"/api/me/applications/{key}", json={"status": "interview"})
    assert r.status_code == 200 and [s["status"] for s in r.json()["timeline"]] == ["applied", "interview"]
    assert err(await client.patch(f"/api/me/applications/{key}", json={"status": "viewed"})) == "bad_status"
    nm7_key = apps["QA Trainee"]["id"]
    assert err(await client.patch(f"/api/me/applications/{nm7_key}", json={"status": "offer"})) == "managed"
    assert (await client.patch(f"/api/me/applications/{nm7_key}", json={"notes": "Asked a friend"})).status_code == 200
    # closed and demo jobs can't be applied to
    await db[JOBS].update_one({"_id": link["_id"]}, {"$set": {"status": "closed"}})
    assert err(await client.post(f"/api/jobs/{link['_id']}/apply", json={})) == "closed"
    # the admin sees the Nm7 application (now Viewed), then moves it along; the person sees each step
    owner = await admin_client("owner")
    rows = (await owner.get(f"/api/admin/jobs/{nm7['_id']}/applications")).json()
    assert [(x["name"], x["status"], x["channel"], x["resume"]) for x in rows] == [
        ("Sai Varsha", "viewed", "nm7", "Main")
    ]
    user = rows[0]["user"]
    for st in ("shortlisted", "interview", "offer"):
        r = await owner.post(f"/api/admin/jobs/{nm7['_id']}/applications/{user}/status", json={"status": st})
        assert r.status_code == 200
    mine = next(a for a in (await client.get("/api/me/state")).json()["apps"] if a["role"] == "QA Trainee")
    assert [s["status"] for s in mine["timeline"]] == ["applied", "viewed", "shortlisted", "interview", "offer"]
    assert (await owner.post(f"/api/admin/jobs/{link['_id']}/applications/{user}/status",
                             json={"status": "offer"})).status_code == 404  # fmt: skip  # not an Nm7 application
    assert await db[AUDIT_LOG].count_documents({"action": "job.apply"}) == 3
    assert await db[AUDIT_LOG].count_documents({"action": "job.application_status"}) == 3
    support = await admin_client("support")
    assert (await support.get(f"/api/admin/jobs/{nm7['_id']}/applications")).status_code == 403


async def test_follow_up_reminders(client, db, outbox):
    nm7, link, mail = await jobs(db)
    await signup(client, outbox)
    for j in (nm7, link, mail):
        await client.post(f"/api/jobs/{j['_id']}/apply", json={})
    # not yet: a week hasn't passed
    assert await applymod.followups(db, outbox) == 0
    week_ago = now() - timedelta(days=7, minutes=1)
    await db[APPLICATIONS].update_many({}, {"$set": {"created_at": week_ago}})
    await db[APPLICATIONS].update_one({"role": "Support Associate"}, {"$set": {"status": "interview"}})  # moved on
    before = len(outbox.sent)
    assert await applymod.followups(db, outbox) == 1  # one email for both
    msg = outbox.sent[-1]
    assert len(outbox.sent) == before + 1 and msg.subject == "Time to follow up on your applications"
    assert "QA Trainee at Acme Analytics" in msg.text and "Data Analyst at Acme Analytics" in msg.text
    assert "Support Associate" not in msg.text and "/stop-alerts#t=" in msg.text and "&k=followups" in msg.text
    apps = {a["role"]: a for a in (await client.get("/api/me/state")).json()["apps"]}
    assert apps["QA Trainee"]["followUp"] and not apps["Support Associate"]["followUp"]  # in the app too
    assert await applymod.followups(db, outbox) == 0  # each one reminded once
    # stop these emails (the signed link): in the app still, no email
    token = msg.text.split("#t=")[1].split("&")[0]
    assert (await client.post("/api/public/jobs/stop-followups", json={"token": token})).json() == {"ok": True}
    assert (await client.post("/api/public/jobs/stop-followups", json={"token": token + "x"})).status_code == 404
    assert (await client.get("/api/me/job-followups")).json() == {"on": False}
    await db[APPLICATIONS].update_many({}, {"$set": {"reminded_at": None, "status": "applied"}})
    await db[USERS].update_many({}, {"$unset": {"followup_email_day": ""}})
    n = len(outbox.sent)
    assert await applymod.followups(db, outbox) == 0 and len(outbox.sent) == n
    assert await db[APPLICATIONS].count_documents({"follow_up": True}) == 3
    # back on in settings; at most one email a day
    assert (await client.put("/api/me/job-followups", json={"on": True})).json() == {"on": True}
    await db[APPLICATIONS].update_many({}, {"$set": {"reminded_at": None}})
    assert await applymod.followups(db, outbox) == 1
    await db[APPLICATIONS].update_many({}, {"$set": {"reminded_at": None}})
    assert await applymod.followups(db, outbox) == 0  # already emailed today
