"""Phase 2 C6: job alerts. Settings (roles needed to turn on), matching (roles in title or skills, cities or remote,
experience, only new jobs), the email (top matches with links and WhatsApp share links, in English / Telugu / Hindi),
email limits (once a day, confirmed addresses only, nothing without matches), weekly timing, and unsubscribe."""

from datetime import timedelta

from app.core.db import JOBS, USERS
from app.core.time import now
from app.jobs import alerts
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_jobs_public import add


async def setup(client, outbox, db, **alert):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    body = {
        "on": True,
        "roles": ["data analyst", "SQL"],
        "cities": ["Hyderabad"],
        "remote": True,
        "experience": ["fresher"],
        "frequency": "daily",
        "lang": "en",
        **alert,
    }
    r = await client.put("/api/me/job-alerts", json=body)
    assert r.status_code == 200, r.text
    return (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]


async def test_settings(client, outbox, db):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    assert (await client.get("/api/me/job-alerts")).json()["on"] is False
    r = await client.put("/api/me/job-alerts", json={"on": True, "roles": []})
    assert r.json()["error"]["code"] == "roles"
    r = await client.put(
        "/api/me/job-alerts",
        json={
            "on": True,
            "roles": [" Data  Analyst ", "data analyst", "Java"],
            "cities": ["Pune"],
            "frequency": "weekly",
            "lang": "te",
        },
    )
    assert r.json() == {
        "on": True,
        "roles": ["Data Analyst", "Java"],
        "cities": ["Pune"],
        "remote": True,
        "experience": [],
        "frequency": "weekly",
        "lang": "te",
    }
    assert (
        await client.put("/api/me/job-alerts", json={"on": True, "roles": ["x"], "experience": ["guru"]})
    ).status_code == 422


async def test_matching_email_limits_and_unsubscribe(client, outbox, db):
    uid = await setup(client, outbox, db)
    await add_resume(client)
    await add(db)  # Junior Data Analyst: fresher, Hyderabad + Pune
    await add(db, title="Remote SQL Intern", experience="fresher", skills=["SQL"], locations=[], workType="remote")
    await add(db, title="Java Developer", experience="1_3", skills=["Java"], locations=["Chennai"], workType="onsite")
    await add(db, title="Senior Data Analyst", experience="3_plus", skills=["SQL"], locations=["Hyderabad"])
    await add(
        db,
        title="Data Analyst Bengaluru",
        experience="fresher",
        skills=["SQL"],
        locations=["Bengaluru"],
        workType="onsite",
    )
    old = await add(db, title="Old Data Analyst", experience="fresher", skills=["SQL"], locations=["Hyderabad"])
    await db[JOBS].update_one({"_id": old["_id"]}, {"$set": {"posted_at": now() - timedelta(days=3)}})
    before = len(outbox.sent)
    assert await alerts.send_alerts(db, outbox) == 1
    mail = outbox.sent[-1]
    assert len(outbox.sent) == before + 1 and mail.to == "sai@example.com"
    assert mail.subject == "2 new jobs for you on Nm7"
    assert "Junior Data Analyst" in mail.text and "Remote SQL Intern" in mail.text
    for absent in ("Java Developer", "Senior Data Analyst", "Bengaluru", "Old Data Analyst"):
        assert absent not in mail.text
    assert "https://wa.me/?text=" in mail.text and "/jobs/" in mail.text and "Match " in mail.text
    assert "Stop these emails: " in mail.text and "/stop-alerts#t=" in mail.text
    # once a day: a second run sends nothing, even with a new job
    await add(db, title="Data Analyst Trainee", experience="fresher", skills=["SQL"], locations=["Hyderabad"])
    assert await alerts.send_alerts(db, outbox) == 0
    # the next day: only the new job
    day_ago = now() - timedelta(days=2)
    await db[JOBS].update_many({"title": {"$ne": "Data Analyst Trainee"}}, {"$set": {"posted_at": day_ago}})
    await db[USERS].update_one(
        {"_id": uid},
        {"$set": {"job_alert_ran_at": now() - timedelta(days=1, minutes=5), "job_alert_sent_day": "2000-01-01"}},
    )
    assert await alerts.send_alerts(db, outbox) == 1
    assert outbox.sent[-1].subject == "1 new job for you on Nm7" and "Data Analyst Trainee" in outbox.sent[-1].text
    # nothing new: no email
    await db[JOBS].update_many({}, {"$set": {"posted_at": day_ago}})
    await db[USERS].update_one(
        {"_id": uid},
        {"$set": {"job_alert_ran_at": now() - timedelta(days=1, minutes=5), "job_alert_sent_day": "2000-01-01"}},
    )
    assert await alerts.send_alerts(db, outbox) == 0
    # stop these emails
    token = alerts.unsub_token(uid)
    assert (await client.post("/api/public/jobs/stop-alerts", json={"token": token + "x"})).status_code == 404
    assert (await client.post("/api/public/jobs/stop-alerts", json={"token": token})).json() == {"ok": True}
    assert (await client.get("/api/me/job-alerts")).json()["on"] is False


async def test_languages_weekly_and_unconfirmed(client, outbox, db):
    uid = await setup(client, outbox, db, lang="hi", frequency="weekly", cities=[], experience=[])
    await add(db)
    assert await alerts.send_alerts(db, outbox) == 1
    assert outbox.sent[-1].subject == "Nm7 पर आपके लिए 1 नई नौकरी" and "WhatsApp पर शेयर करें" in outbox.sent[-1].text
    # weekly: not again after a day
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"job_alert_ran_at": now() - timedelta(days=2), "job_alert_sent_day": "2000-01-01"}}
    )
    await add(db, title="Data Analyst II", experience="fresher", skills=["SQL"], locations=["Pune"])
    assert await alerts.send_alerts(db, outbox) == 0
    await db[USERS].update_one({"_id": uid}, {"$set": {"job_alert_ran_at": now() - timedelta(days=8)}})
    await client.put(
        "/api/me/job-alerts", json={"on": True, "roles": ["data analyst"], "frequency": "weekly", "lang": "te"}
    )
    assert await alerts.send_alerts(db, outbox) == 1
    assert outbox.sent[-1].subject.startswith("Nm7లో మీకోసం")
    # an unconfirmed address never gets alerts
    await db[USERS].update_one(
        {"_id": uid}, {"$set": {"email_verified_at": None, "job_alert_ran_at": None, "job_alert_sent_day": None}}
    )
    assert await alerts.send_alerts(db, outbox) == 0
