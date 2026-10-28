"""Resume health alerts: the seven rules, fix links, dismiss, the opt-out (settings + signed unsubscribe link), and
the daily email batch (at most one every 14 days, never to an opted-out or bounced address)."""

from datetime import timedelta

from app.core.db import ATS_CHECKS, HEALTH, JOB_MATCHES, JOB_PROFILES, LOCKS, RESUMES, USERS
from app.core.time import now
from app.health import alerts
from app.health.service import daily_batch, unsub_token
from tests.conftest import signup

RESUME = {
    "personal": {"name": "Asha Rao", "email": "asha@example.com", "phone": "+91 90000 12345"},
    "links": {"linkedin": ""},
    "exp": [{"company": "Acme", "role": "Intern", "from": "2024-01", "to": "2024-06"}],
    "edu": [{"institution": "JNTU", "degree": "B.Tech", "from": "2019", "to": "2023", "current": True}],
    "certs": [],
}


async def make(client, db, outbox, data=None, days_old=0):
    me = await signup(client, outbox)
    r = await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": data or RESUME, "active": True})
    assert r.status_code in (200, 201), r.text
    if days_old:
        await db[RESUMES].update_one({"user_id": me["id"]}, {"$set": {"updated_at": now() - timedelta(days=days_old)}})
    return me


async def test_every_rule_with_its_fix_link(client, outbox, db):
    me = await make(client, db, outbox, days_old=120)
    uid = me["id"]
    await db[ATS_CHECKS].insert_one({"user_id": uid, "score": 48, "at": now()})
    await db[JOB_MATCHES].insert_one(
        {
            "_id": "m1",
            "user_id": uid,
            "title": "Data Analyst",
            "company": "Zoho",
            "tailored_key": None,
            "created_at": now(),
        }  # fmt: skip
    )
    profile_exp = [{"company": "Acme", "role": "Intern"}, {"company": "Infosys", "role": "Trainee"}]
    await db[JOB_PROFILES].insert_one({"_id": uid, "data": {"exp": profile_exp}})
    r = await client.get("/api/me/health")
    assert r.status_code == 200
    got = {a["kind"]: a for a in r.json()["alerts"]}
    assert set(got) == set(alerts.KINDS)
    assert got["stale"]["fix"]["path"] == "/builder?start=section&sec=personal"
    assert got["ats_low"]["title"] == "ATS score 48 - aim for 60+"
    assert got["untailored"]["fix"]["path"] == "/me/ats?match=m1"
    assert "Data Analyst at Zoho" in got["untailored"]["title"]
    assert got["profile_new"]["title"] == "Add Infosys to your resume"  # Acme is already on the resume
    assert got["no_certs"]["fix"]["path"].endswith("sec=certs")
    assert got["graduated"]["fix"]["path"].endswith("sec=edu")
    assert r.json()["emails"] is True


async def test_a_healthy_resume_has_no_alerts(client, outbox, db):
    good = {
        **RESUME,
        "links": {"linkedin": "linkedin.com/in/asha"},
        "certs": [{"name": "SQL basics"}],
        "edu": [{"institution": "JNTU", "degree": "B.Tech", "to": "2023", "current": False}],
    }
    await make(client, db, outbox, good)
    assert (await client.get("/api/me/health")).json()["alerts"] == []


async def test_dismiss_keeps_it_away(client, outbox, db):
    await make(client, db, outbox)
    first = (await client.get("/api/me/health")).json()["alerts"]
    li = next(a for a in first if a["kind"] == "no_linkedin")
    r = await client.post("/api/me/health/dismiss", json={"id": li["id"]})
    assert li["id"] not in [a["id"] for a in r.json()["alerts"]]
    assert "no_linkedin" not in [a["kind"] for a in (await client.get("/api/me/health")).json()["alerts"]]


async def test_needs_sign_in(client):
    assert (await client.get("/api/me/health")).status_code == 401


async def again(db):
    await db[LOCKS].delete_one({"_id": "health-batch"})


async def test_daily_email_at_most_every_two_weeks_with_unsubscribe(client, outbox, db):
    me = await make(client, db, outbox)
    before = len(outbox.sent)
    assert await daily_batch(db, outbox) == 1
    msg = outbox.sent[before]
    assert msg.subject == "Your resume: a few quick fixes"
    assert "Add your LinkedIn link" in msg.text and "/stop-alerts#t=" in msg.text
    assert "/builder?start=section&sec=personal" in msg.text
    assert await daily_batch(db, outbox) == 0  # the day's pass is done
    await again(db)
    assert await daily_batch(db, outbox) == 0  # under 14 days since the last one
    await db[HEALTH].update_one({"_id": me["id"]}, {"$set": {"last_email_at": now() - timedelta(days=15)}})
    await again(db)
    assert await daily_batch(db, outbox) == 1
    # the signed link turns them off
    r = await client.post("/api/public/health/unsubscribe", json={"token": unsub_token(me["id"])})
    assert r.status_code == 200
    bad = await client.post("/api/public/health/unsubscribe", json={"token": me["id"] + ".bad0000000"})
    assert bad.status_code == 404
    await db[HEALTH].update_one({"_id": me["id"]}, {"$set": {"last_email_at": now() - timedelta(days=30)}})
    await again(db)
    assert await daily_batch(db, outbox) == 0
    assert (await client.get("/api/me/health")).json()["emails"] is False


async def test_settings_toggle_and_bounced_addresses(client, outbox, db):
    me = await make(client, db, outbox)
    r = await client.put("/api/me/health/emails", json={"on": False})
    assert r.json() == {"emails": False}
    assert await daily_batch(db, outbox) == 0
    await client.put("/api/me/health/emails", json={"on": True})
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"email_bounced": True}})
    await again(db)
    assert await daily_batch(db, outbox) == 0


async def test_erased_with_the_account(client, outbox, db):
    from app.me.erase import erase_user_data

    me = await make(client, db, outbox)
    first = (await client.get("/api/me/health")).json()["alerts"]
    await client.post("/api/me/health/dismiss", json={"id": first[0]["id"]})
    assert await db[HEALTH].count_documents({"_id": me["id"]}) == 1
    out = await erase_user_data(db, me["id"])
    assert out["resume_health"] == 1 and await db[HEALTH].count_documents({"_id": me["id"]}) == 0
