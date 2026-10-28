"""Customer dashboard API: owner-only data, share links, tickets, referrals, profile and password change."""

import logging

import pytest

from app.core.db import COVER_LETTERS, RESUMES, SESSIONS, SHARES
from tests.conftest import PASSWORD, signup

RESUME = {"personal": {"name": "Sai Varsha", "phone": "+91 98765 43210", "email": "sai@example.com"}, "summary": "Hi"}


def err(r):
    return r.json()["error"]["code"]


async def two_customers(client, outbox, make_client):
    await signup(client, outbox, "a@example.com", name="Asha Rao")
    b = make_client()
    await signup(b, outbox, "b@example.com", name="Bala K")
    return client, b


async def add_resume(c, key="r1", **extra):
    r = await c.post("/api/me/resumes", json={"id": key, "name": "Main", "data": RESUME, **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def test_needs_a_signed_in_customer(client, outbox, make_client):
    assert (await client.get("/api/me/state")).status_code == 401
    expert = make_client()
    await signup(expert, outbox, "ex@example.com", role="expert", name="Ravi")
    r = await expert.get("/api/me/state")
    assert r.status_code == 403 and err(r) == "wrong_role"
    assert r.json()["error"]["message"] == "This needs a customer account."
    assert (await expert.post("/api/me/tickets", json={"topic": "x", "text": "y"})).status_code == 403


async def test_state_starts_empty_with_profile(client, outbox):
    await signup(client, outbox, name="Asha Rao")
    s = (await client.get("/api/me/state")).json()
    assert s["profile"]["name"] == "Asha Rao" and s["profile"]["email"] == "sai@example.com"
    assert s["resumes"] == [] and s["apps"] == [] and s["covers"] == [] and s["tickets"] == []
    assert s["share"]["on"] is False and s["share"]["slug"] == "asha-rao"
    assert s["referral"]["code"].startswith("ASHA") and s["referral"]["referrals"] == []


async def test_resumes_crud_and_active(client, outbox):
    await signup(client, outbox)
    first = await add_resume(client, "r1")
    assert first["active"] is True  # the first one is the builder's draft
    second = await add_resume(client, "r2")
    assert second["active"] is False
    assert (await client.post("/api/me/resumes", json={"id": "r2", "name": "x", "data": {}})).status_code == 409

    r = await client.patch("/api/me/resumes/r2", json={"active": True, "data": {"summary": "new"}, "name": "Two"})
    assert r.status_code == 200 and r.json()["active"] and r.json()["data"] == {"summary": "new"}
    rs = (await client.get("/api/me/resumes")).json()
    assert [x["active"] for x in rs] == [False, True]

    assert (await client.delete("/api/me/resumes/r2")).status_code == 204
    rs = (await client.get("/api/me/resumes")).json()
    assert [(x["id"], x["active"]) for x in rs] == [("r1", True)]
    r = await client.delete("/api/me/resumes/r1")
    assert r.status_code == 400 and err(r) == "last_resume"


async def test_aadhaar_pan_in_resume_text_are_removed_on_save(client, outbox, db, caplog):
    await signup(client, outbox)
    caplog.set_level(logging.WARNING, logger="nm7.me")
    data = {
        **RESUME,
        "summary": "Clerk with 3 years of experience. Aadhaar 2345 6789 0123, PAN ABCPE1234F. Call 9876543210.",
        "exp": [{"company": "Infosys", "role": "Clerk", "desc": "Handled A/c no 123456789012 and 2019-2023 audits"}],
        "pinfo": {"dob": "2003-05-15", "address": "H.No 4-12, Ameerpet, Hyderabad 500016"},
    }
    r = await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": data})
    assert r.status_code == 201, r.text
    saved = r.json()["data"]
    assert saved["summary"] == "Clerk with 3 years of experience. Aadhaar, PAN. Call 9876543210."
    assert saved["exp"][0]["desc"] == "Handled A/c no and 2019-2023 audits"
    assert saved["pinfo"] == data["pinfo"] and saved["personal"] == RESUME["personal"]
    stored = await db[RESUMES].find_one({"key": "r1"})
    assert stored["data"] == saved and "2345" not in str(stored) and "ABCPE" not in str(stored)
    assert (await client.get("/api/me/resumes/r1")).json()["data"] == saved
    # the log says how many, never what
    assert caplog.messages == ["resume save: removed 3 ID-like number(s) from the text"]
    # an edit, and the version snapshots the builder keeps
    r = await client.patch(
        "/api/me/resumes/r1",
        json={
            "data": {**saved, "summary": "Passport A1234567, DL AP09 20120001234"},
            "versions": [{"at": 1, "label": "v1", "data": {"summary": "VID 1234 5678 9012 3456"}}],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["summary"] == "Passport, DL"
    assert (await db[RESUMES].find_one({"key": "r1"}))["versions"][0]["data"] == {"summary": "VID"}
    assert caplog.messages[-1] == "resume save: removed 3 ID-like number(s) from the text"
    # a save without any is not logged
    caplog.clear()
    assert (await client.patch("/api/me/resumes/r1", json={"data": RESUME})).status_code == 200
    assert caplog.messages == []


async def test_resume_limits(client, outbox):
    await signup(client, outbox)
    big = {"x": "a" * 210_000}
    assert (await client.post("/api/me/resumes", json={"id": "r1", "name": "x", "data": big})).status_code == 422
    assert (await client.post("/api/me/resumes", json={"id": "bad id!", "name": "x", "data": {}})).status_code == 422
    versions = [{"at": 1, "label": "v", "data": {}}] * 21
    r = await client.post("/api/me/resumes", json={"id": "r1", "name": "x", "data": {}, "versions": versions})
    assert r.status_code == 422


async def test_other_customers_cannot_see_or_change_items(client, outbox, make_client):
    a, b = await two_customers(client, outbox, make_client)
    await add_resume(a, "r1")
    assert (
        await a.post("/api/me/cover-letters", json={"id": "c1", "company": "Zoho", "body": "Dear"})
    ).status_code == 201
    assert (await a.post("/api/me/applications", json={"id": "a1", "company": "Zoho"})).status_code == 201
    assert (await a.post("/api/me/tickets", json={"topic": "Payment", "text": "Help"})).status_code == 201

    for path in ("/api/me/resumes/r1", "/api/me/cover-letters/c1", "/api/me/applications/a1"):
        if path.startswith("/api/me/resumes"):
            assert (await b.get(path)).status_code == 404
        assert (await b.patch(path, json={"company": "Hacked", "name": "Hacked"})).status_code == 404
        assert (await b.delete(path)).status_code == 404
    # B can't publish A's resume through the share link either
    r = await b.put("/api/me/share", json={"on": True, "slug": "bala-k", "resumeId": "r1"})
    assert r.status_code == 404

    s = (await b.get("/api/me/state")).json()
    assert s["resumes"] == [] and s["covers"] == [] and s["apps"] == [] and s["tickets"] == []
    assert (await b.get("/api/me/tickets")).json() == []
    # B using the same browser ids makes B's own items; A's are untouched
    await add_resume(b, "r1")
    a_resume = (await a.get("/api/me/resumes/r1")).json()
    assert a_resume["data"] == RESUME
    a_state = (await a.get("/api/me/state")).json()
    assert a_state["covers"][0]["company"] == "Zoho" and a_state["apps"][0]["company"] == "Zoho"


async def test_cover_letters_and_applications(client, outbox):
    await signup(client, outbox)
    r = await client.post("/api/me/cover-letters", json={"id": "c1", "company": "Zoho", "role": "Analyst"})
    assert r.status_code == 201 and r.json()["at"] > 0
    r = await client.patch("/api/me/cover-letters/c1", json={"body": "Dear team"})
    assert r.json()["body"] == "Dear team" and r.json()["company"] == "Zoho"
    assert (await client.delete("/api/me/cover-letters/c1")).status_code == 204
    assert (await client.delete("/api/me/cover-letters/c1")).status_code == 404

    app = {"id": "a1", "company": "Swiggy", "role": "BA", "status": "applied", "date": 1_700_000_000_000}
    assert (await client.post("/api/me/applications", json=app)).status_code == 201
    r = await client.patch("/api/me/applications/a1", json={"status": "interview", "notes": "HR round"})
    assert r.json()["status"] == "interview" and r.json()["date"] == 1_700_000_000_000
    assert (await client.patch("/api/me/applications/a1", json={"status": "hired"})).status_code == 422


async def test_profile_save_keeps_email(client, outbox):
    await signup(client, outbox)
    body = {
        "name": " Sai  V ",
        "phone": "98765 43210",
        "targetRole": "Data Analyst",
        "email": "evil@example.com",
        "notify": {"email": {"order": True, "tips": False}},
        "ui": {"calls": {"picked": "mon"}},
    }
    r = await client.patch("/api/me/profile", json=body)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "Sai V" and p["email"] == "sai@example.com" and p["targetRole"] == "Data Analyst"
    assert p["phone"] == "+91 98765 43210" and p["notify"]["email"]["order"] is True
    assert (await client.get("/api/auth/me")).json()["email"] == "sai@example.com"
    assert (await client.patch("/api/me/profile", json={"notify": {"pigeon": {"order": True}}})).status_code == 422


async def test_share_link_public_view_and_counts(client, outbox, make_client, db):
    await signup(client, outbox, name="Asha Rao")
    await add_resume(client, "r1")
    viewer = make_client()
    assert (await viewer.get("/api/public/resumes/asha-rao")).status_code == 404  # not published yet

    r = await client.put("/api/me/share", json={"on": True, "slug": "asha-rao", "resumeId": "r1", "hidePhone": True})
    assert r.status_code == 200 and r.json()["on"]
    r = await viewer.get("/api/public/resumes/asha-rao")
    assert r.status_code == 200
    assert r.json()["data"]["personal"]["phone"] == "" and r.json()["data"]["summary"] == "Hi"
    await viewer.get("/api/public/resumes/asha-rao")  # same visitor within the hour: counted once
    await client.get("/api/public/resumes/asha-rao")  # the owner looking: not counted
    share = (await client.get("/api/me/share")).json()
    assert share["viewCount"] == 1 and len(share["views"]) == 1

    await client.put("/api/me/share", json={"on": True, "slug": "asha-rao", "resumeId": "r1", "hidePhone": False})
    assert (await viewer.get("/api/public/resumes/asha-rao")).json()["data"]["personal"]["phone"].startswith("+91")

    other = make_client()
    await signup(other, outbox, "b@example.com", name="Bala")
    r = await other.put("/api/me/share", json={"on": True, "slug": "asha-rao"})
    assert r.status_code == 409 and err(r) == "slug_taken"
    assert (await other.put("/api/me/share", json={"on": True, "slug": "Bad Slug"})).status_code == 422

    await client.put("/api/me/share", json={"on": False, "slug": "asha-rao", "resumeId": "r1"})
    assert (await viewer.get("/api/public/resumes/asha-rao")).status_code == 404
    assert (await db[SHARES].find_one({"slug": "asha-rao"}))["view_count"] == 1


async def test_ticket_is_stored_and_emailed_to_support(client, outbox):
    await signup(client, outbox, name="Asha Rao")
    r = await client.post("/api/me/tickets", json={"topic": "Payment", "orderId": "RS-1001", "text": "Charged twice"})
    assert r.status_code == 201
    t = r.json()
    assert t["id"].startswith("T-") and t["status"] == "open" and t["emailed"] is True
    mail = outbox.sent[-1]
    assert mail.to == "info@nm7.si" and mail.reply_to == "sai@example.com"
    assert "Charged twice" in mail.text and t["id"] in mail.subject
    assert [x["id"] for x in (await client.get("/api/me/tickets")).json()] == [t["id"]]


async def test_ticket_rate_limit(client, outbox):
    await signup(client, outbox)
    for _ in range(5):
        assert (await client.post("/api/me/tickets", json={"topic": "x", "text": "y"})).status_code == 201
    assert (await client.post("/api/me/tickets", json={"topic": "x", "text": "y"})).status_code == 429


async def test_referral_signup(client, outbox, make_client):
    await signup(client, outbox, name="Asha Rao")
    code = (await client.get("/api/me/referral")).json()["code"]
    friend = make_client()
    await signup(friend, outbox, "f@example.com", name="Kiran Kumar", ref=code.lower())
    refs = (await client.get("/api/me/referral")).json()["referrals"]
    # both test browsers share one network address, so this friend wouldn't count towards a referral reward
    assert refs == [{"name": "Kiran", "at": refs[0]["at"], "status": "joined", "counts": False, "why": "not_eligible"}]


async def test_ats_checks_are_kept(client, outbox):
    await signup(client, outbox)
    for score in (40, 62):
        assert (await client.post("/api/me/ats-checks", json={"score": score, "resumeId": "r1"})).status_code == 201
    assert [c["score"] for c in (await client.get("/api/me/state")).json()["checks"]] == [40, 62]
    assert (await client.post("/api/me/ats-checks", json={"score": 101})).status_code == 422


@pytest.mark.parametrize("wrong", [True, False])
async def test_change_password_signs_out_other_browsers(client, outbox, make_client, db, wrong):
    await signup(client, outbox)
    other = make_client()
    assert (
        await other.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    ).status_code == 200
    new = "Brand-new#Pass9"
    if wrong:
        r = await client.post(
            "/api/auth/password/change", json={"currentPassword": "nope", "password": new, "passwordConfirm": new}
        )
        assert r.status_code == 400 and err(r) == "wrong_password"
        assert (await other.get("/api/auth/me")).status_code == 200
        return
    r = await client.post(
        "/api/auth/password/change", json={"currentPassword": PASSWORD, "password": new, "passwordConfirm": new + "x"}
    )
    assert r.status_code == 400
    r = await client.post(
        "/api/auth/password/change", json={"currentPassword": PASSWORD, "password": new, "passwordConfirm": new}
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/auth/me")).status_code == 200  # this browser stays signed in
    assert (await other.get("/api/auth/me")).status_code == 401  # the other one is signed out
    assert await db[SESSIONS].count_documents({"revoked_at": None}) == 1
    fresh = make_client()
    assert (
        await fresh.post("/api/auth/login", json={"email": "sai@example.com", "password": PASSWORD})
    ).status_code == 401
    assert (await fresh.post("/api/auth/login", json={"email": "sai@example.com", "password": new})).status_code == 200


async def test_public_link_leaves_out_switched_off_entries(client, outbox, make_client):
    await signup(client, outbox, name="Asha Rao")
    data = {
        "personal": {"name": "Asha Rao"},
        "edu": [{"institution": "DAV School"}, {"institution": "IIT Madras", "off": True}],
        "custom": [
            {
                "id": "c_x",
                "title": "Extracurricular",
                "items": [{"title": "NSS"}, {"title": "Secret club", "off": True}],
            }
        ],
        "skillGroups": [{"id": "core", "value": "SQL"}, {"id": "x", "value": "Hidden skill", "off": True}],
        "hobbies": "Reading\nChess",
        "offLines": {"hobbies": ["Chess"]},
    }
    await add_resume(client, "r1", data=data)
    await client.put("/api/me/share", json={"on": True, "slug": "asha-rao", "resumeId": "r1"})
    body = (await make_client().get("/api/public/resumes/asha-rao")).json()
    text = str(body)
    assert "IIT Madras" not in text and "Secret club" not in text and "Hidden skill" not in text and "Chess" not in text
    assert [e["institution"] for e in body["data"]["edu"]] == ["DAV School"] and body["data"]["hobbies"] == "Reading"
    # the owner's own copy keeps everything
    own = (await client.get("/api/me/resumes/r1")).json()["data"]
    assert own["edu"][1] == {"institution": "IIT Madras", "off": True} and own["offLines"] == {"hobbies": ["Chess"]}


@pytest.mark.parametrize(
    "bad",
    [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,hi",
        "ftp://x.com/a",
        "//evil.com",
        "not a link",
        "https://",
    ],
)
async def test_job_links_are_web_links_only(client, outbox, bad):
    await signup(client, outbox)
    r = await client.post("/api/me/applications", json={"id": "a1", "company": "Zoho", "url": bad})
    assert r.status_code == 422, bad
    ok = await client.post(
        "/api/me/applications", json={"id": "a2", "company": "Zoho", "url": "careers.zoho.com/jobs/1"}
    )
    assert ok.json()["url"] == "https://careers.zoho.com/jobs/1"
    assert (await client.patch("/api/me/applications/a2", json={"url": bad})).status_code == 422
    r = await client.patch("/api/me/applications/a2", json={"url": "http://zoho.com/x"})
    assert r.json()["url"] == "http://zoho.com/x"


async def test_unsafe_links_saved_before_the_check_are_not_sent_back(client, outbox, db):
    from app.core.db import APPLICATIONS

    await signup(client, outbox)
    await client.post("/api/me/applications", json={"id": "a1", "company": "Zoho", "url": "zoho.com"})
    await db[APPLICATIONS].update_many({}, {"$set": {"url": "javascript:alert(1)"}})
    apps = (await client.get("/api/me/state")).json()["apps"]
    assert apps[0]["url"] == ""


async def test_resume_patch_with_a_stale_stamp_is_409(client, outbox):
    """`ifUpdated` is the `updated` stamp the browser last saw: an edit on top of an older copy is refused."""
    await signup(client, outbox)
    r = await add_resume(client, "r1")
    stamp = r["updated"]
    ok = await client.patch("/api/me/resumes/r1", json={"data": {"summary": "one"}, "ifUpdated": stamp})
    assert ok.status_code == 200
    newer = ok.json()["updated"]
    assert newer >= stamp
    # another tab still holds the old stamp
    stale = await client.patch("/api/me/resumes/r1", json={"data": {"summary": "two"}, "ifUpdated": stamp})
    if newer == stamp:  # same millisecond: not distinguishable, the edit is taken
        assert stale.status_code == 200
    else:
        assert stale.status_code == 409 and err(stale) == "stale"
        assert (await client.get("/api/me/resumes")).json()[0]["data"] == {"summary": "one"}
    # a page count alone never conflicts, and no stamp means no check
    assert (await client.patch("/api/me/resumes/r1", json={"pages": 2, "ifUpdated": stamp})).status_code == 200
    assert (await client.patch("/api/me/resumes/r1", json={"data": {"summary": "three"}})).status_code == 200


async def test_cover_letters_and_the_public_link_never_carry_id_numbers(client, outbox, make_client, db):
    """The scrub also covers cover letters (saved text) and the public share link (a second lock)."""
    await signup(client, outbox)
    body = "Dear team, my Aadhaar is 2345 6789 0123 and PAN ABCDE1234F. I built 12 dashboards."
    cover = {"id": "c9", "company": "Zoho", "role": "Analyst", "body": body}
    assert (await client.post("/api/me/cover-letters", json=cover)).status_code == 201
    saved = await db[COVER_LETTERS].find_one({"key": "c9"})
    assert "2345 6789 0123" not in saved["body"] and "ABCDE1234F" not in saved["body"]
    assert "12 dashboards" in saved["body"]
    r = await client.patch("/api/me/cover-letters/c9", json={"jd": "Send your PAN ABCDE1234F with the application"})
    assert r.status_code == 200
    assert "ABCDE1234F" not in (await db[COVER_LETTERS].find_one({"key": "c9"}))["jd"]

    # an ID written straight into the stored resume (saved before the scrub existed) never reaches a public viewer
    await add_resume(client, "r9")
    await db[RESUMES].update_one({"key": "r9"}, {"$set": {"data.summary": "Analyst. Aadhaar 2345 6789 0123."}})
    r = await client.put("/api/me/share", json={"on": True, "slug": "asha-rao-9", "resumeId": "r9", "hidePhone": False})
    assert r.status_code == 200
    page = (await make_client().get("/api/public/resumes/asha-rao-9")).json()
    text = str(page)
    assert "2345 6789 0123" not in text and "234567890123" not in text and "Analyst." in text


async def test_resume_text_keeps_bold_markers_and_drops_other_markup_on_save(client, outbox, db):
    await signup(client, outbox)
    data = {
        **RESUME,
        "summary": "Analyst who built **Power BI** dashboards <span style='color:red'>fast</span>",
        "exp": [
            {"company": "Zoho", "role": "Analyst", "description": "Cut costs by <b>20%</b><br>Built <Button> parts"}
        ],
        "proj": [{"title": "Sales", "description": "<p>Used <strong>SQL</strong></p>"}],
        "custom": [
            {"id": "c1", "title": "Volunteering", "items": [{"title": "NSS", "description": "<i>Led</i> **12** camps"}]}
        ],
        "personal": {**RESUME["personal"], "headline": "Data <b>Analyst</b>"},  # not a rich field: left as typed
    }
    r = await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": data})
    assert r.status_code == 201, r.text
    saved = r.json()["data"]
    assert saved["summary"] == "Analyst who built **Power BI** dashboards fast"
    assert saved["exp"][0]["description"] == "Cut costs by **20%**\nBuilt <Button> parts"
    assert saved["proj"][0]["description"] == "Used **SQL**"
    assert saved["custom"][0]["items"][0]["description"] == "Led **12** camps"
    assert saved["personal"]["headline"] == "Data <b>Analyst</b>"
    # old resumes (no markup) are saved exactly as sent
    r = await client.patch("/api/me/resumes/r1", json={"data": RESUME})
    assert r.json()["data"] == RESUME
