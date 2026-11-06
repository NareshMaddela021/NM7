"""Phase 3 A4 + A5: email applications and "Ready to apply".

Email: the tailored resume attached as a PDF, Reply-To the student, a short letter from their own facts, one email per
job, within the daily limit and the site's daily email cap (the rest wait for the next run), bounces stop that
address and complaints that domain (checked through Resend's API with the same key), recorded as "Sent by email" with
a copy. Other websites: never submitted by a bot; "Ready to apply" with the tailored resume, one tap saves Applied
(outside Nm7) and opens the company link; it doesn't use up the daily auto applications."""

import io
from datetime import timedelta

import httpx
import pypdf
import pytest

from app.autoapply import emailing, engine
from app.core.config import get_settings
from app.core.db import APPLICATIONS, AUTO_ITEMS, AUTO_RUNS, EMAIL_BLOCKS, USERS
from app.core.time import now
from app.site import save_site
from tests.conftest import signup
from tests.jobs_helpers import add_resume, strong_resume
from tests.test_jobs_public import add

URL = "/api/me/auto-apply"
RULES = {
    "roles": ["Data Analyst"],
    "cities": ["Hyderabad"],
    "remote": True,
    "minScore": 60,
    "dailyLimit": 5,
    "consent": True,
}
DESC = "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given."


@pytest.fixture(autouse=True)
async def roomy(db):
    await save_site(db, {"auto_apply": {"company_cap": 10}})


async def student(client, outbox, db, **rules):
    await signup(client, outbox, email="sai@example.com", name="Sai Varsha")
    await add_resume(client, data=strong_resume())
    assert (await client.put(URL, json={**RULES, **rules})).status_code == 200
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await db[USERS].update_one({"_id": uid}, {"$set": {"auto_apply.started_at": now() - timedelta(days=5)}})
    return uid


async def email_job(db, title, to="hr@orbit.example", company="Orbit Labs"):
    return await add(
        db,
        title=title,
        company={"name": company},
        applyMethod="email",
        applyEmail=to,
        applyUrl="",
        locations=["Hyderabad"],
        skills=["SQL", "Power BI"],
        description=DESC,
        salary=None,
    )


async def link_job(db, title, company="Acme Analytics"):
    return await add(
        db,
        title=title,
        company={"name": company},
        locations=["Hyderabad"],
        skills=["SQL", "Power BI"],
        description=DESC,
    )


async def again(db, outbox, uid):
    await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
    await db[AUTO_ITEMS].update_many(
        {"user_id": uid}, {"$set": {"counted_day": "2000-01-01", "sent_day": "2000-01-01"}}
    )
    return await engine.run(db, outbox, force=True)


async def test_email_application(client, outbox, db):
    j = await email_job(db, "Junior Data Analyst")
    uid = await student(client, outbox, db)
    out = await engine.run(db, outbox, force=True)
    assert out["sent"] == 1
    to_company = [m for m in outbox.sent if m.to == "hr@orbit.example"]
    assert len(to_company) == 1
    mail = to_company[0]
    assert mail.to == "hr@orbit.example" and mail.reply_to == "sai@example.com"
    assert mail.subject == "Application for Junior Data Analyst – Sai Varsha"
    assert "I would like to apply for the Junior Data Analyst role at Orbit Labs" in mail.text
    assert "My resume is attached. You can reply to this email to reach me directly." in mail.text
    assert "Sent through Nm7 (nm7.si) at Sai Varsha's request." in mail.text
    name, mime, data = mail.attachments[0]
    assert name == "Sai_Varsha_Resume.pdf" and mime == "application/pdf" and data[:5] == b"%PDF-"
    text = pypdf.PdfReader(io.BytesIO(data)).pages[0].extract_text()
    assert "Sai Varsha" in text and "Northwind Retail" in text
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert app["channel"] == "email" and app["origin"] == "auto" and app["sent_email"]["to"] == "hr@orbit.example"
    st = [x for x in (await client.get("/api/me/state")).json()["apps"] if x.get("jobId") == j["_id"]][0]
    assert (
        st["origin"] == "auto" and st["sentEmail"]["subject"] == mail.subject and st["sentEmail"]["text"] == mail.text
    )
    # one email per job, whatever happens later
    assert (await again(db, outbox, uid)).get("sent", 0) == 0
    assert len([m for m in outbox.sent if m.to == "hr@orbit.example"]) == 1


async def test_letter_keeps_to_the_facts():
    data = strong_resume(summary="Data analyst with 10 years at Google, expert in AWS. Second sentence.")
    j = {"title": "Junior Data Analyst", "company": {"name": "Orbit Labs"}, "locations": ["Hyderabad"]}
    _, text, _ = emailing.letter("Sai Varsha", data, j, ["SQL", "Power BI"], "https://nm7.si/jobs/x")
    # the summary is the student's own words (it is their resume), the skills line only names skills they have
    assert "My resume shows SQL, Power BI, which this role asks for." in text
    _, text2, _ = emailing.letter("Sai Varsha", strong_resume(), j, ["Kubernetes"], "")
    assert "Kubernetes" not in text2  # a skill not on the resume is never claimed


async def test_daily_cap_queues_for_next_run(client, outbox, db):
    await email_job(db, "Data Analyst One", to="a@one.example", company="One")
    await email_job(db, "Data Analyst Two", to="b@two.example", company="Two")
    uid = await student(client, outbox, db)
    await save_site(db, {"auto_apply": {"email_daily_cap": 1, "company_cap": 10}})
    out = await engine.run(db, outbox, force=True)
    assert out["sent"] == 1 and out["queued"] == 1
    q = await db[AUTO_ITEMS].find_one({"user_id": uid, "state": "queued"})
    assert q["reason"] == "email_cap" and "counted_day" not in q  # not counted against the student's limit
    assert (await db[AUTO_RUNS].find_one({"_id": engine.today()}))["counts"]["queued"] == 1
    # the next run (the cap is free again): sent first
    out = await again(db, outbox, uid)
    assert out["sent"] == 1 and await db[APPLICATIONS].count_documents({"user_id": uid, "channel": "email"}) == 2


async def test_bounce_and_complaint_stop_sending(client, outbox, db, monkeypatch):
    j1 = await email_job(db, "Data Analyst Bounce", to="hr@bounce.example", company="Bounce")
    uid = await student(client, outbox, db)
    await engine.run(db, outbox, force=True)
    it = await db[AUTO_ITEMS].find_one({"job_id": j1["_id"]})
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"sent.provider_id": "em_1"}})
    events = {"em_1": "bounced", "em_2": "complained"}

    def handler(request: httpx.Request):
        assert request.headers["authorization"] == "Bearer re_test"
        return httpx.Response(
            200,
            json={"id": request.url.path.rsplit("/", 1)[-1], "last_event": events[request.url.path.rsplit("/", 1)[-1]]},
        )

    monkeypatch.setattr(get_settings(), "resend_api_key", "re_test")
    monkeypatch.setattr(get_settings(), "email_provider", "resend")
    monkeypatch.setattr(emailing, "HTTP_CLIENT", httpx.MockTransport(handler))
    assert (await emailing.check_deliveries(db))["bounced"] == 1
    assert await db[EMAIL_BLOCKS].find_one({"_id": "hr@bounce.example", "reason": "bounce"})
    # a new job at the bounced address: never emailed
    await email_job(db, "Data Analyst Bounce Two", to="hr@bounce.example", company="Bounce Two")
    n = len(outbox.sent)
    out = await again(db, outbox, uid)
    assert out.get("sent", 0) == 0 and len(outbox.sent) == n
    # a complaint stops the whole domain
    j3 = await email_job(db, "Data Analyst Complaint", to="jobs@complain.example", company="Complain")
    await again(db, outbox, uid)
    it3 = await db[AUTO_ITEMS].find_one({"job_id": j3["_id"]})
    await db[AUTO_ITEMS].update_one({"_id": it3["_id"]}, {"$set": {"sent.provider_id": "em_2"}})
    assert (await emailing.check_deliveries(db))["complained"] == 1
    assert await emailing.blocked(db, "careers@complain.example")


async def test_ready_to_apply_never_by_bot(client, outbox, db):
    j = await link_job(db, "Junior Data Analyst")
    nm7 = await add(
        db,
        title="Data Analyst Nm7",
        company={"name": "Beta"},
        applyMethod="nm7",
        applyUrl="",
        locations=["Hyderabad"],
        skills=["SQL", "Power BI"],
        description=DESC,
    )
    uid = await student(client, outbox, db, dailyLimit=1)
    out = await engine.run(db, outbox, force=True)
    # the Nm7 job used the one auto application; the website job is ready for one tap (not an auto application)
    assert out["applied"] == 1 and out["ready"] == 1
    assert not await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})  # nothing submitted anywhere
    assert await db[APPLICATIONS].find_one({"user_id": uid, "job_id": nm7["_id"], "origin": "auto"})
    items = (await client.get(f"{URL}/items")).json()
    ready = items["ready"][0]
    assert ready["job"]["id"] == j["_id"] and ready["hasCopy"]
    r = await client.get(f"{URL}/items/{ready['id']}/resume.pdf")
    assert r.status_code == 200 and r.content[:5] == b"%PDF-" and "attachment" in r.headers["content-disposition"]
    r = await client.post(f"{URL}/items/{ready['id']}/opened")
    assert r.json() == {"url": "https://acme.example/careers/123"}
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert app["channel"] == "link" and app["origin"] == "manual" and app["copy_id"]
    assert (await client.post(f"{URL}/items/{ready['id']}/opened")).status_code == 404
    st = [x for x in (await client.get("/api/me/state")).json()["apps"] if x.get("jobId") == j["_id"]][0]
    assert st["channel"] == "link" and st["status"] == "applied"
