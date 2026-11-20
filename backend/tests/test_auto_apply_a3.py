"""Auto Apply 2.0, phase A3 (email applications): only addresses the company published itself (source recorded,
otherwise refused); the candidate's own apply address as From / Reply-To; the message (cover note, tailored resume PDF,
profile link, the honest footer, the one-click opt-out; no pixels, no tracked links); every limit (one email per job
ever, one opt-in follow-up after 7 days only without a reply, 10 a day per candidate, 20 a day per company domain);
bounces and complaints block; the employer's signed opt-out and Admin's undo; the Resend webhook's signature; an
inbound reply stored, forwarded and shown as "Replied"; while the 2.0 switch is OFF a company address is never
emailed; without the server settings the channel is off and the job is "Ready"."""

import base64
import io
import json
import re
import time
import uuid
from datetime import timedelta
from html import unescape

import pypdf
import pytest

from app.autoapply import emailing, engine, inbound
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    AUTO_ITEMS,
    AUTO_MAIL,
    AUTO_MAIL_EVENTS,
    AUTO_REPLIES,
    EMAIL_BLOCKS,
    JOBS,
    SHARES,
    USERS,
)
from app.core.time import now
from app.site import get_site, save_site
from tests.conftest import signup
from tests.test_auto_apply_engine import no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, V2, run, tester
from tests.test_companies_signup import no_network  # noqa: F401
from tests.test_jobs_public import add

SECRET = "whsec_" + base64.b64encode(b"a3-test-signing-secret").decode()
COMPANY = "hr@orbit.example"
DESC = "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given."


@pytest.fixture
def email_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "email_provider", "resend")
    monkeypatch.setattr(s, "resend_api_key", "re_test_key")
    monkeypatch.setattr(s, "resend_inbound_secret", SECRET)
    monkeypatch.setattr(s, "autoapply_email_domain", "apply.nm7.si")
    return s


async def email_job(db, title="Junior Data Analyst", to=COMPANY, source="https://orbit.example/careers/42", **over):
    return await add(
        db,
        title=title,
        company={"name": "Orbit Labs", "website": "orbit.example"},
        applyMethod="email",
        applyEmail=to,
        applyUrl="",
        applyEmailSource=source,
        locations=["Hyderabad"],
        skills=["SQL", "Power BI"],
        description=DESC,
        **over,
    )


def to_company(outbox, addr=COMPANY):
    return [m for m in outbox.sent if m.to.lower() == addr]


async def hook(client, event, secret=SECRET, sid=None, ts=None, sig=None):
    body = json.dumps(event).encode()
    sid = sid or f"msg_{uuid.uuid4().hex}"
    ts = ts or int(time.time())
    headers = {
        "svix-id": sid,
        "svix-timestamp": str(ts),
        "svix-signature": sig or inbound.sign(secret, sid, ts, body),
        "content-type": "application/json",
    }
    return await client.post("/api/webhooks/resend", content=body, headers=headers)


async def sent_setup(client, outbox, db, public=False, **over):
    """A tester on full auto, the channel on, one company-published email job, sent (to the tester's own inbox)."""
    uid = await tester(client, outbox, db, mode="full_auto", **over)
    if public:
        await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": True}})
    j = await email_job(db)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    return uid, j, it


# ---------- where the address came from ----------


def test_only_addresses_the_company_published():
    base = {"source": "admin", "company": {"name": "Orbit", "website": "https://orbit.example"}}

    def src(email, url="", **extra):
        return emailing.address_source({**base, **extra, "apply": {"email": email, "email_source": url}})

    ok = src(COMPANY, "https://careers.orbit.example/jobs/42")
    assert ok["ok"] and ok["kind"] == "careers_page" and ok["url"].startswith("https://careers.orbit.example")
    assert src("jobs@orbit.co.in", "https://www.orbit.co.in/careers")["ok"]  # the page's own domain
    assert src(COMPANY, "https://jobs.lever-like.example/orbit")["ok"]  # off the page's domain, on the company's site
    assert src(COMPANY)["reason"] == "source_unknown"  # never guessed
    assert src(COMPANY, "https://www.linkedin.com/jobs/view/1")["reason"] == "job_board"
    assert src(COMPANY, "https://www.naukri.com/job-listings-x")["reason"] == "job_board"
    assert src("hr@naukri.com", "https://orbit.example/careers")["reason"] == "job_board"
    assert src(COMPANY, "https://forms.gle/abc")["reason"] == "job_board"
    assert src(COMPANY, "https://orbit.example/our-team/priya")["reason"] == "people_page"
    assert src("orbit.hr@gmail.com", "https://orbit.example/careers")["reason"] == "free_mail"
    assert src("hr@other.example", "https://orbit.example/careers")["reason"] == "domain_mismatch"
    assert src("")["reason"] == "no_address"
    # a job the company posted on Nm7 itself, from its own account: its own words, any address
    own = emailing.address_source({"source": "company", "company_id": "c1", "slug": "x", "apply": {"email": "a@b.in"}})
    assert own["ok"] and own["kind"] == "company_account"


def test_base_domain_and_first_name():
    assert emailing.base_domain("careers.acme.co.in") == "acme.co.in"
    assert emailing.base_domain("jobs.acme.com") == "acme.com"
    assert emailing._first_name("Sai Varsha") == "sai"
    assert emailing._first_name("సాయి") == "candidate"


async def test_unpublished_address_is_refused_and_ready(client, outbox, db, email_on):
    uid = await tester(client, outbox, db, mode="full_auto")
    j = await email_job(db, source="")  # nobody knows where this address came from
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "ready" and it["reason"] == "address_source_unknown" and it["apply_to"] == COMPANY
    assert await db[AUTO_MAIL].count_documents({}) == 0 and not to_company(outbox)
    row = next(x for x in (await client.get(f"{V2}/tracker")).json()["items"] if x["job"]["id"] == j["_id"])
    assert row["stage"] == "ready" and row["channel"] == "email" and row["applyTo"] == COMPANY


# ---------- the channel is off without the server settings ----------


async def test_channel_off_without_env_falls_back_to_ready(client, outbox, db, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", "re_test_key")
    monkeypatch.setattr(s, "resend_inbound_secret", "")  # no webhook secret: replies can't come back → off
    assert emailing.channel_off() == "no_inbound_secret"
    uid = await tester(client, outbox, db, mode="full_auto")
    j = await email_job(db)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "ready" and it["reason"] == "no_inbound_secret"
    assert await db[AUTO_MAIL].count_documents({}) == 0
    st = (await client.get(f"{V2}/email")).json()
    assert st["channel"]["on"] is False and "Replies" in st["channel"]["reason"]
    monkeypatch.setattr(s, "resend_api_key", "")
    assert emailing.channel_off() == "no_resend_key"
    # the webhook is off too
    assert (await hook(client, {"type": "email.bounced", "data": {}})).status_code == 404


# ---------- switch OFF: never a company address ----------


async def test_switch_off_never_emails_a_company(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db)
    assert it["state"] == "sent" and it["sent"]["test"] is True
    assert not to_company(outbox)  # the company got nothing
    msg = next(m for m in outbox.sent if m.subject.startswith("[Test"))
    assert msg.to == EMAIL and COMPANY in msg.subject  # the tester's own inbox, told where it would go
    m = await db[AUTO_MAIL].find_one({"user_id": uid})
    assert m["to"] == COMPANY and m["sent_to"] == EMAIL and m["test"] and m["domain"] == "orbit.example"
    assert m["source"] == {"kind": "careers_page", "url": "https://orbit.example/careers/42"}
    # Admin's test inbox wins over the tester's own
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "test_inbox": "qa@nm7test.example"}})
    j2 = await email_job(db, title="Data Analyst Trainee")
    await run(db, outbox)
    assert any(x.to == "qa@nm7test.example" for x in outbox.sent) and not to_company(outbox)
    it2 = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j2["_id"]})
    assert it2["sent"]["sent_to"] == "qa@nm7test.example"
    # a test inbox that is the company's own address is refused, never sent
    v2 = (await get_site(db))["auto_apply_v2"]
    assert emailing.recipient({"email": EMAIL}, COMPANY, {**v2, "test_inbox": COMPANY}) is None
    assert emailing.recipient({"email": EMAIL}, COMPANY, {**v2, "public": True}) == (COMPANY, False)
    # a real user (not a tester) while OFF: no 2.0 at all, so no 2.0 email either
    assert await db[AUTO_MAIL].count_documents({"to": COMPANY, "test": False}) == 0


async def test_public_switch_emails_the_company(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db, public=True)
    sent = to_company(outbox)
    assert len(sent) == 1 and not sent[0].subject.startswith("[Test")
    assert it["sent"]["test"] is False
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert app["channel"] == "email" and app["v2"] and app["channel_v2"] == "email" and app["origin"] == "auto"


async def test_demo_accounts_never_send(db, email_on):
    site = await get_site(db)
    u = {"_id": "d", "demo": True, "email": "kavya@demo.nm7.invalid", "auto_apply": {}}
    j = {"_id": "j", "source": "company", "company_id": "c", "slug": "s", "apply": {"email": COMPANY}}
    assert await emailing.ready_reason(db, u, j, site) == "demo"


# ---------- the message ----------


async def test_message_from_apply_address_with_pdf_profile_and_opt_out(client, outbox, db, email_on):
    uid = await tester(client, outbox, db, mode="full_auto")
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": True}})
    await db[SHARES].insert_one({"_id": uid, "on": True, "slug": "sai-varsha"})
    await email_job(db)
    await run(db, outbox)
    msg = to_company(outbox)[0]
    alias = (await client.get(f"{V2}/email")).json()["address"]
    assert re.fullmatch(r"sai\.[a-z2-9]{4}@apply\.nm7\.si", alias)
    assert msg.from_addr == f"Sai Varsha via Nm7 <{alias}>" and msg.reply_to == alias
    assert msg.subject == "Application for Junior Data Analyst – Sai Varsha"
    # the tailored resume attached
    ((fname, mime, pdf_bytes),) = msg.attachments
    assert mime == "application/pdf" and fname.endswith(".pdf")
    assert "Sai" in pypdf.PdfReader(io.BytesIO(pdf_bytes)).pages[0].extract_text()
    # the cover note, the profile link, the honest footer and the opt-out
    it = await db[AUTO_ITEMS].find_one({"user_id": uid})
    from app.core.db import AUTO_COPIES

    cover = (await db[AUTO_COPIES].find_one({"_id": it["copy_id"]}))["cover_note"]
    assert 5 <= len(cover) <= 6 and all(line in msg.text for line in cover)
    assert "https://nm7.si/r/sai-varsha" in msg.text
    assert "Sent via Nm7 Auto Apply on Sai Varsha's behalf" in msg.text
    optout = re.search(r"https://nm7\.si/stop-alerts#k=employer&t=(\S+)", msg.text)
    assert optout and emailing.optout_read(optout.group(1))["address"] == COMPANY
    assert msg.headers["List-Unsubscribe"] == f"<{optout.group(0)}>"
    # no open tracking, no pixels, no tracked links: only the two plain links, in text and html alike
    for body in (msg.text, unescape(msg.html)):
        assert "<img" not in body.lower() and "pixel" not in body.lower() and "utm_" not in body
        assert set(re.findall(r"https?://[^\s<\"]+", body)) == {"https://nm7.si/r/sai-varsha", optout.group(0)}
    # "What was sent" shows the exact email and the attachment
    sent = (await client.get(f"{V2}/sent/{it['_id']}")).json()
    assert sent["email"]["text"] == msg.text and sent["email"]["attachment"] == fname
    assert sent["email"]["from"] == alias and sent["email"]["source"]["kind"] == "careers_page"
    assert sent["channel"] == "email"


# ---------- limits ----------


async def test_one_email_per_job_ever(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db)
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid})
    again = await emailing.send_v2(db, outbox, it, j, u, {"data": {}, "cover_note": []}, site)
    assert again == {"state": "skipped", "reason": "already_emailed"}
    # even a second item for the same job (a race) can't send: the unique row in auto_mail
    got = await emailing._send_one(
        db, outbox, u=u, j=j, item_id="other", kind="first", to=EMAIL, test=True, subject="s", text="t", html="h",
        attachments=[], source={},
    )  # fmt: skip
    assert got is None and await db[AUTO_MAIL].count_documents({"user_id": uid, "job_id": j["_id"]}) == 1


async def test_ten_a_day_per_candidate_and_twenty_per_domain(client, outbox, db, email_on):
    uid = await tester(client, outbox, db, mode="full_auto")
    day = engine.today()
    rows = [{"_id": f"m{i}", "user_id": uid, "job_id": f"old{i}", "kind": "first", "domain": "else.example",
             "day": day, "at": now()} for i in range(10)]  # fmt: skip
    await db[AUTO_MAIL].insert_many(rows)
    j = await email_job(db)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "queued" and it["reason"] == "candidate_daily" and "counted_day" not in it
    assert await emailing.limit_reason(db, uid, "orbit.example", day) == "candidate_daily"
    # 20 a day to one company domain, all candidates together
    await db[AUTO_MAIL].delete_many({})
    rows = [{"_id": f"d{i}", "user_id": f"u{i}", "job_id": "jx", "kind": "first", "domain": "orbit.example",
             "day": day, "at": now()} for i in range(20)]  # fmt: skip
    await db[AUTO_MAIL].insert_many(rows)
    assert await emailing.limit_reason(db, uid, "orbit.example", day) == "domain_daily"
    assert await emailing.limit_reason(db, uid, "other.example", day) is None
    await run(db, outbox)  # the queued one tries again first: still the domain's limit
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "queued" and it["reason"] == "domain_daily"
    # the next day: sent
    await db[AUTO_MAIL].update_many({}, {"$set": {"day": "2000-01-01"}})
    await run(db, outbox)
    assert (await db[AUTO_ITEMS].find_one({"_id": it["_id"]}))["state"] == "sent"
    assert emailing.PER_CANDIDATE_DAY == 10 and emailing.PER_DOMAIN_DAY == 20


async def test_follow_up_opt_in_once_after_seven_days_only_without_reply(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db)
    site = await get_site(db)
    week = now() - timedelta(days=8)
    await db[AUTO_MAIL].update_many({"user_id": uid}, {"$set": {"at": week}})
    assert await emailing.follow_ups(db, outbox, site) == 0  # off by default
    st = (await client.put(f"{V2}/email", json={"emailOn": True, "followUp": True})).json()
    assert st["followUp"] is True
    await db[AUTO_MAIL].update_many({"user_id": uid}, {"$set": {"at": now() - timedelta(days=3)}})
    assert await emailing.follow_ups(db, outbox, site) == 0  # not before 7 days
    await db[AUTO_MAIL].update_many({"user_id": uid}, {"$set": {"at": week}})
    n_before = len(outbox.sent)
    assert await emailing.follow_ups(db, outbox, site) == 1
    fu = outbox.sent[n_before]
    assert fu.to == EMAIL and "Following up: Junior Data Analyst" in fu.subject and not fu.attachments
    assert "Sent via Nm7 Auto Apply" in fu.text and "stop-alerts#k=employer&t=" in fu.text
    assert await emailing.follow_ups(db, outbox, site) == 0  # only one, ever
    assert await db[AUTO_MAIL].count_documents({"user_id": uid, "kind": "follow_up"}) == 1
    sent = (await client.get(f"{V2}/sent/{it['_id']}")).json()
    assert sent["followUp"]["subject"].endswith("Following up: Junior Data Analyst – Sai Varsha")
    # a reply before day 7: no follow-up
    j2 = await email_job(db, title="Data Analyst Trainee")
    await run(db, outbox)
    await db[AUTO_MAIL].update_many({"job_id": j2["_id"]}, {"$set": {"at": week, "replied_at": now()}})
    assert await emailing.follow_ups(db, outbox, site) == 0
    # a test email's follow-up never reaches the company after launch
    await db[AUTO_MAIL].update_many({"job_id": j2["_id"]}, {"$set": {"replied_at": None}})
    await save_site(db, {"auto_apply_v2": {"public": True}})
    assert await emailing.follow_ups(db, outbox, await get_site(db)) == 0 and not to_company(outbox)


# ---------- the webhook ----------


async def test_webhook_signature_is_verified(client, db, email_on):
    ev = {"type": "email.delivered", "data": {"email_id": "x"}}
    assert (await hook(client, ev)).status_code == 200
    assert (await hook(client, ev, secret="whsec_" + base64.b64encode(b"wrong").decode())).status_code == 401
    assert (await hook(client, ev, sig="v1,AAAA")).status_code == 401
    assert (await hook(client, ev, ts=int(time.time()) - 3600)).status_code == 401  # an old replay
    r = await client.post("/api/webhooks/resend", content=b"{}", headers={"content-type": "application/json"})
    assert r.status_code == 401
    # the same event twice is handled once
    sid = "msg_once"
    assert (await hook(client, ev, sid=sid)).json().get("duplicate") is None
    assert (await hook(client, ev, sid=sid)).json()["duplicate"] is True
    assert await db[AUTO_MAIL_EVENTS].count_documents({"_id": sid}) == 1
    assert inbound.signature_ok(SECRET, {}, b"{}") is False


async def test_bounce_and_complaint_block_and_pause(client, outbox, db, email_on, admin_client):
    uid, j, it = await sent_setup(client, outbox, db)
    await db[AUTO_MAIL].update_one({"user_id": uid}, {"$set": {"provider_id": "em_1"}})
    r = await hook(client, {"type": "email.bounced", "data": {"email_id": "em_1", "to": [EMAIL]}})
    assert r.json()["blocked"] == EMAIL
    assert (await db[EMAIL_BLOCKS].find_one({"_id": EMAIL}))["reason"] == "bounce"
    assert await emailing.blocked(db, EMAIL)
    # a complaint: that domain (here a free-mail inbox: only the address) and the candidate's channel paused
    await db[EMAIL_BLOCKS].delete_many({})
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "test_inbox": "qa@nm7test.example"}})
    j2 = await email_job(db, title="Data Analyst Trainee")
    await run(db, outbox)
    await db[AUTO_MAIL].update_one({"job_id": j2["_id"]}, {"$set": {"provider_id": "em_2"}})
    r = await hook(client, {"type": "email.complained", "data": {"email_id": "em_2"}})
    assert r.json()["blocked"] == "@nm7test.example"
    u = await db[USERS].find_one({"_id": uid})
    assert u["auto_apply"]["email_paused_at"] and u["auto_apply"]["email_paused_reason"] == "complaint"
    st = (await client.get(f"{V2}/email")).json()
    assert st["paused"]["reason"] == "complaint"
    # paused: the next email job is Ready, not sent
    j3 = await email_job(db, title="Reporting Data Analyst")
    await run(db, outbox)
    it3 = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j3["_id"]})
    assert it3["state"] == "ready" and it3["reason"] == "candidate_paused"
    # Admin sees the rates and the paused candidate, and turns the channel back on
    owner = await admin_client("owner")
    h = (await owner.get("/api/admin/auto-apply/v2/email")).json()
    assert h["sent30"] == 2 and h["complaints30"] == 1 and h["complaintRate"] == 50.0
    assert h["paused"][0]["id"] == uid and h["channel"]["on"] is True and h["sentToday"] == 2
    assert any(b["id"] == "@nm7test.example" and b["reason"] == "complaint" for b in h["blocks"])
    assert (await owner.post(f"/api/admin/auto-apply/v2/email/paused/{uid}/resume")).status_code == 200
    assert not (await db[USERS].find_one({"_id": uid}))["auto_apply"]["email_paused_at"]


async def test_inbound_reply_stored_forwarded_and_replied(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db)
    alias = (await client.get(f"{V2}/email")).json()["address"]
    n = len(outbox.sent)
    ev = {
        "type": "email.received",
        "data": {
            "email_id": "in_1",
            "from": "Priya (Orbit HR) <priya@orbit.example>",
            "to": [alias],
            "subject": "Re: Application for Junior Data Analyst – Sai Varsha",
            "text": "Hi Sai, thanks for applying. Are you free for a call on Monday?",
        },
    }
    r = (await hook(client, ev)).json()
    assert r["stored"] and r["forwarded"] and r["item"] == it["_id"]
    rep = await db[AUTO_REPLIES].find_one({"user_id": uid})
    assert rep["from"] == "priya@orbit.example" and "call on Monday" in rep["text"] and rep["company"] == "Orbit Labs"
    fwd = outbox.sent[n]
    assert fwd.to == EMAIL and fwd.reply_to == "priya@orbit.example" and "call on Monday" in fwd.text
    assert alias in fwd.text
    # the tracker: Replied, with the reply listed for that application
    row = next(x for x in (await client.get(f"{V2}/tracker")).json()["items"] if x["id"] == it["_id"])
    # A7: "Are you free for a call" is read as an interview invite (the rules), so the row says Interview
    assert row["stage"] == "replied" and row["outcome"] == "interview" and row["replies"] == 1
    assert row["notice"]["text"] == "Orbit Labs replied by email."
    sent = (await client.get(f"{V2}/sent/{it['_id']}")).json()
    assert sent["replies"][0]["subject"].startswith("Re: Application") and sent["replies"][0]["forwarded"]
    assert (await client.get(f"{V2}/replies")).json()[0]["fromName"] == "Priya (Orbit HR)"
    assert (await db[AUTO_MAIL].find_one({"user_id": uid}))["replied_at"]
    # an unknown apply address, or our own domain, is not stored
    bad = {**ev, "data": {**ev["data"], "to": ["nobody.zz99@apply.nm7.si"]}}
    assert (await hook(client, bad)).json()["stored"] is False
    loop = {**ev, "data": {**ev["data"], "from": "x.ab12@apply.nm7.si"}}
    assert (await hook(client, loop)).json()["stored"] is False


async def test_reply_not_forwarded_to_non_testers_while_off(client, outbox, db, email_on):
    uid, j, it = await sent_setup(client, outbox, db)
    alias = (await client.get(f"{V2}/email")).json()["address"]
    await save_site(db, {"auto_apply_v2": {"testers": []}})  # no longer a tester: may_mail says no while OFF
    n = len(outbox.sent)
    ev = {"type": "email.received", "data": {"from": "hr@orbit.example", "to": [alias], "subject": "Re", "text": "Hi"}}
    r = (await hook(client, ev)).json()
    assert r["stored"] and r["forwarded"] is False and len(outbox.sent) == n
    assert (await db[AUTO_REPLIES].find_one({"user_id": uid}))["forward"] == "switch_off"


async def test_reply_body_fetched_from_resend_when_not_in_event(client, outbox, db, email_on, monkeypatch):
    import httpx

    uid, j, it = await sent_setup(client, outbox, db)
    alias = (await client.get(f"{V2}/email")).json()["address"]

    def handler(req):
        assert req.url.path == "/emails/receiving/in_9" and req.headers["authorization"] == "Bearer re_test_key"
        return httpx.Response(200, json={"html": "<p>Hello <b>Sai</b></p><p>Next step</p>", "subject": "Re: hi"})

    monkeypatch.setattr(inbound, "HTTP_CLIENT", httpx.MockTransport(handler))
    ev = {"type": "email.received", "data": {"email_id": "in_9", "from": "hr@orbit.example", "to": [alias]}}
    assert (await hook(client, ev)).json()["stored"]
    rep = await db[AUTO_REPLIES].find_one({"user_id": uid})
    assert rep["text"] == "Hello Sai\nNext step" and rep["subject"] == "Re: hi"


# ---------- the employer's opt-out ----------


async def test_opt_out_signed_blocks_and_admin_undoes(client, db, admin_client):
    token = emailing.optout_token(COMPANY)
    info = (await client.get("/api/public/auto-apply/opt-out", params={"t": token})).json()
    assert info == {"address": COMPANY, "domain": "orbit.example", "test": False, "blocked": False}
    # a changed token is refused
    payload, sig = token.split(".")
    forged = emailing._b64("ceo@orbit.example|r") + "." + sig
    assert (await client.get("/api/public/auto-apply/opt-out", params={"t": forged})).status_code == 400
    assert (await client.post("/api/public/auto-apply/opt-out", json={"token": token[:-2]})).status_code == 400
    # one click: the whole domain
    r = (await client.post("/api/public/auto-apply/opt-out", json={"token": token})).json()
    assert r["blocked"] == "@orbit.example" and r["scope"] == "domain"
    assert await emailing.blocked(db, "jobs@orbit.example")
    # or only that address (the domain block this link made goes)
    r = (await client.post("/api/public/auto-apply/opt-out", json={"token": token, "scope": "address"})).json()
    assert r["blocked"] == COMPANY and not await emailing.blocked(db, "jobs@orbit.example")
    assert await emailing.blocked(db, COMPANY)
    # a test email's link (sent while 2.0 is tested) blocks nothing
    t2 = emailing.optout_token("hr@tcs-like.example", test=True)
    r = (await client.post("/api/public/auto-apply/opt-out", json={"token": t2})).json()
    assert r["test"] is True and not await emailing.blocked(db, "hr@tcs-like.example")
    # Admin sees the opt-out and undoes it
    owner = await admin_client("owner")
    h = (await owner.get("/api/admin/auto-apply/v2/email")).json()
    assert h["optOuts"] == 1 and h["blocks"][0] == {**h["blocks"][0], "id": COMPANY, "reason": "opt_out"}
    assert (await owner.delete(f"/api/admin/auto-apply/v2/email/blocks/{COMPANY}")).status_code == 200
    assert not await emailing.blocked(db, COMPANY)
    assert (await owner.delete(f"/api/admin/auto-apply/v2/email/blocks/{COMPANY}")).status_code == 404


async def test_opted_out_company_falls_back_to_ready(client, outbox, db, email_on):
    await emailing.block(db, "@orbit.example", "opt_out")
    uid = await tester(client, outbox, db, mode="full_auto")
    j = await email_job(db)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "ready" and it["reason"] == "blocked"


# ---------- the candidate's settings and Admin ----------


async def test_candidate_email_settings_and_admin_test_inbox(client, outbox, db, email_on, admin_client):
    uid = await tester(client, outbox, db, mode="full_auto")
    st = (await client.get(f"{V2}/email")).json()
    assert st["channel"]["on"] and st["emailOn"] is True and st["followUp"] is False and st["testMode"] is True
    assert st["perDay"] == 10 and st["address"] == (await client.get(f"{V2}/email")).json()["address"]  # kept
    st = (await client.put(f"{V2}/email", json={"emailOn": False, "followUp": False})).json()
    assert st["emailOn"] is False
    j = await email_job(db)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert it["state"] == "ready" and it["reason"] == "candidate_off"
    owner = await admin_client("owner")
    o = (await owner.get("/api/admin/auto-apply/v2")).json()["settings"]
    assert o["testInbox"] == ""
    r = await owner.put("/api/admin/auto-apply/v2/settings", json={**o, "testInbox": "QA@Nm7test.example"})
    assert r.status_code == 200 and r.json()["testInbox"] == "qa@nm7test.example"
    assert (await owner.put("/api/admin/auto-apply/v2/settings", json={**o, "testInbox": "nope"})).status_code == 422
    h = (await owner.get("/api/admin/auto-apply/v2/email")).json()
    assert h["testInbox"] == "qa@nm7test.example" and h["limits"] == {"perCandidateDay": 10, "perDomainDay": 20}


async def test_admin_health_shows_missing_settings(db, admin_client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "resend_api_key", "")
    monkeypatch.setattr(s, "resend_inbound_secret", "")
    owner = await admin_client("owner")
    h = (await owner.get("/api/admin/auto-apply/v2/email")).json()
    assert h["channel"]["on"] is False and set(h["channel"]["missing"]) == {"RESEND_API_KEY", "RESEND_INBOUND_SECRET"}


async def test_job_model_keeps_the_address_source(db):
    j = await email_job(db)
    assert (await db[JOBS].find_one({"_id": j["_id"]}))["apply"]["email_source"] == "https://orbit.example/careers/42"
    from pydantic import ValidationError

    from app.jobs.model import JobIn
    from tests.test_jobs_admin import JOB

    with pytest.raises(ValidationError):
        JobIn.model_validate({**JOB, "applyMethod": "email", "applyEmail": COMPANY, "applyEmailSource": "not a url"})


async def test_account_erase_removes_replies_and_address(client, outbox, db, email_on):
    from app.core.db import AUTO_ALIASES
    from app.me.erase import erase_user_data

    uid, j, it = await sent_setup(client, outbox, db)
    await db[AUTO_REPLIES].insert_one({"_id": "r1", "user_id": uid})
    await erase_user_data(db, uid)
    for coll in (AUTO_REPLIES, AUTO_MAIL, AUTO_ALIASES):
        assert await db[coll].count_documents({"user_id": uid}) == 0


async def test_signup_of_other_user_not_affected(client, outbox, db):
    """Today's Auto Apply email (not 2.0) is unchanged: no apply address is made for it."""
    from app.core.db import AUTO_ALIASES

    await signup(client, outbox, email="ravi@example.com", name="Ravi")
    assert await db[AUTO_ALIASES].count_documents({}) == 0
