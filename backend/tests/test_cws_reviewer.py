"""The Chrome Web Store reviewer's demo account (app/autoapply/reviewer.py, app/core/reviewer.py): made by the owner in
Admin → Auto Apply, signs in with email and password, always starts with the same two jobs ready (kits whose apply
links are the practice pages), never sends anything on any channel, is left out of every number and company search,
can't change its password or email, delete itself, pay, upload ID documents or join Ready to join, and its password
is only ever shown to the owner (never in other answers, the audit log, emails or logs)."""

import logging

import pyotp
import pytest

from app.auth.admin_service import create_admin
from app.autoapply import emailing, engine, onetap
from app.autoapply import reviewer as account
from app.autoapply.ats import service as ats
from app.autoapply.forms import service as forms
from app.core import reviewer
from app.core.db import (
    APPLICATIONS,
    ATS_DELIVERIES,
    AUDIT_LOG,
    AUTO_COPIES,
    AUTO_ITEMS,
    CWS_REVIEWER,
    HELPER_TOKENS,
    HIRE_PROFILES,
    JOBS,
    RESUMES,
    SESSIONS,
    TRUST_CONSENTS,
    TRUST_PROFILES,
    USERS,
)
from app.core.email import Email, send_safely
from app.site import get_site
from tests.conftest import PASSWORD, signup
from tests.test_companies_apply import company_job
from tests.test_companies_signup import no_network  # noqa: F401

ADMIN = "/api/admin/auto-apply/cws-reviewer"
V2 = "/api/me/auto-apply/v2"


def ok(r):
    assert r.status_code == 200, r.text
    return r.json()


async def owner_with_account(admin_client):
    owner = await admin_client("owner")
    ok(await owner.post(f"{ADMIN}/password"))
    return owner, ok(await owner.get(f"{ADMIN}/password"))["password"]


async def reviewer_client(make_client, password):
    c = make_client()
    ok(await c.post("/api/auth/login", json={"email": reviewer.EMAIL, "password": password}))
    return c


async def test_owner_creates_it_and_only_the_owner_sees_the_password(admin_client, make_client, db, outbox, caplog):
    caplog.set_level(logging.DEBUG)
    ops = await admin_client("ops", "ops@nm7.si")
    for method, path in (("GET", ADMIN), ("GET", f"{ADMIN}/password"), ("POST", f"{ADMIN}/password")):
        assert (await ops.request(method, path)).status_code == 403  # the owner only ("settings")
    anon = make_client()
    assert (await anon.get(f"{ADMIN}/password")).status_code == 401
    owner = await admin_client("owner")
    first = ok(await owner.get(ADMIN))
    assert first["exists"] is False and first["email"] == "chrome-review@nm7.si" and "password" not in first
    assert (await owner.get(f"{ADMIN}/password")).status_code == 404
    made = ok(await owner.post(f"{ADMIN}/password"))
    assert made["exists"] is True and "password" not in made and made["passwordSetAt"]
    assert [p["url"] for p in made["practice"]] == [
        "https://nm7.si/demo/apply/customer-support-executive",
        "https://nm7.si/demo/apply/junior-data-analyst",
    ]
    pw = ok(await owner.get(f"{ADMIN}/password"))["password"]
    assert len(pw) >= 20 and any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw)
    # stored as the usual hash plus an encrypted copy: never in plain anywhere
    u = await db[USERS].find_one({"_id": reviewer.ID})
    assert u["demo"] is True and u["cws_reviewer"] is True and u["password_hash"].startswith("$argon2")
    k = await db[CWS_REVIEWER].find_one({})
    assert pw not in str(k) and pw not in str(u)
    # signs in with email and password (no two-step login), and the password is in no other answer
    c = await reviewer_client(make_client, pw)
    me = ok(await c.get("/api/auth/me"))
    assert me["email"] == "chrome-review@nm7.si" and me["name"] == "Priya Sharma (demo)"
    answers = [await c.get(p) for p in ("/api/auth/me", V2, f"{V2}/onetap", "/api/me/state", f"{V2}/helper")]
    assert all(pw not in r.text for r in answers)
    assert (await c.get(f"{ADMIN}/password")).status_code == 403
    # a new password: the old one stops working and its browsers are signed out
    ok(await owner.post(f"{ADMIN}/password"))
    pw2 = ok(await owner.get(f"{ADMIN}/password"))["password"]
    assert pw2 != pw
    assert (await c.get("/api/auth/me")).status_code == 401
    assert (
        await make_client().post("/api/auth/login", json={"email": reviewer.EMAIL, "password": pw})
    ).status_code == 401
    await reviewer_client(make_client, pw2)
    # the audit log says what happened in plain words, never the password; nor do the emails or the server log
    actions = [a["action"] async for a in db[AUDIT_LOG].find({"target": reviewer.ID})]
    assert {"auto_apply.cws_reviewer_created", "auto_apply.cws_reviewer_password",
            "auto_apply.cws_reviewer_password_shown"} <= set(actions)  # fmt: skip
    audit_text = str([a async for a in db[AUDIT_LOG].find({})])
    for secret in (pw, pw2):
        assert secret not in audit_text and secret not in caplog.text
        assert all(secret not in m.text and secret not in (m.html or "") for m in outbox.sent)
    assert not [m for m in outbox.sent if m.to.lower() == reviewer.EMAIL]


async def test_server_setting_password_is_used(admin_client, make_client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "cws_reviewer_password", "Review-Setting-2026-abc")
    owner = await admin_client("owner")
    assert ok(await owner.post(f"{ADMIN}/password"))["fromServer"] is True
    assert ok(await owner.get(f"{ADMIN}/password"))["password"] == "Review-Setting-2026-abc"
    await reviewer_client(make_client, "Review-Setting-2026-abc")


async def test_two_jobs_ready_with_kits_for_the_practice_pages_and_reset_on_sign_in(admin_client, make_client, db):
    _, pw = await owner_with_account(admin_client)
    c = await reviewer_client(make_client, pw)
    listing = ok(await c.get(f"{V2}/onetap"))
    assert listing["open"] == 2 and [x["applyHost"] for x in listing["items"]] == ["nm7.si", "nm7.si"]
    # the helper picks the first kit whose host matches the page: the one the test instructions open
    assert [x["job"]["title"] for x in listing["items"]] == ["Customer Support Executive", "Junior Data Analyst"]
    assert listing["items"][0]["applyUrl"] == "https://nm7.si/demo/apply/customer-support-executive"
    assert {x["applyUrl"] for x in listing["items"]} == {account.practice_url(s) for s, _, _ in reviewer.PRACTICE}
    # the helper pairs and reads the same kits (the shape background.js fetches)
    code = ok(await c.post(f"{V2}/helper/code"))["code"]
    ext = make_client()
    ext.headers.pop("Origin", None)
    tok = ok(await ext.post("/api/helper/pair", json={"code": code, "device": "Chrome"}))["token"]
    ext.headers["Authorization"] = f"Bearer {tok}"
    kits = ok(await ext.get("/api/helper/kits"))["items"]
    assert len(kits) == 2 and {k["job"]["company"] for k in kits} == {"Demo Tech Solutions"}
    kit = ok(await ext.get(f"/api/helper/kits/{kits[0]['id']}"))
    fields = {f["key"]: f["value"] for f in kit["fields"]}
    assert fields["full_name"] == "Priya Sharma (demo)" and fields["email"] == "chrome-review@nm7.si"
    for key in ("phone", "city", "linkedin", "notice", "degree"):
        assert fields.get(key), key
    assert kit["coverNote"] and kit["resume"]["name"].endswith(".pdf")
    pdf = await ext.get(f"/api/helper/kits/{kits[0]['id']}/resume.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    # "Mark as applied on Nm7": only her own tracker (a demo row, no company)
    ok(await ext.post(f"/api/helper/kits/{kits[0]['id']}/applied"))
    app = await db[APPLICATIONS].find_one({"user_id": reviewer.ID})
    assert app["demo"] is True and app["status"] == "applied" and not app.get("company_id")
    assert ok(await c.get(f"{V2}/onetap"))["open"] == 1
    # the next sign-in: the same two jobs ready again, nothing applied, no paired browser left over
    await reviewer_client(make_client, pw)
    assert ok(await c.get(f"{V2}/onetap"))["open"] == 2
    assert await db[APPLICATIONS].count_documents({"user_id": reviewer.ID}) == 0
    assert await db[HELPER_TOKENS].count_documents({"user_id": reviewer.ID}) == 0
    assert (await ext.get("/api/helper/kits")).status_code == 401
    assert await db[AUTO_ITEMS].count_documents({"user_id": reviewer.ID}) == 2
    assert await db[AUTO_COPIES].count_documents({"user_id": reviewer.ID}) == 2
    # the practice jobs are demo jobs: never on the job board
    assert await db[JOBS].count_documents({"_id": {"$regex": "^cws-review-"}, "demo": True}) == 2
    board = ok(await make_client().get("/api/jobs", params={"q": "Customer Support Executive"}))
    assert "cws-review" not in str(board)


async def test_cannot_change_password_or_email_delete_pay_id_documents_or_ready_to_join(
    admin_client, make_client, db, outbox
):
    _, pw = await owner_with_account(admin_client)
    c = await reviewer_client(make_client, pw)
    tries = [
        ("POST", "/api/auth/password/change", {"currentPassword": pw, "password": "Other-pass-1234",
                                               "passwordConfirm": "Other-pass-1234"}),
        ("POST", "/api/auth/google/link", {"credential": "x" * 40}),
        ("DELETE", "/api/auth/google", None),
        ("POST", "/api/me/account/deletion/code", {}),
        ("POST", "/api/me/account/deletion", {"code": "123456"}),
        ("POST", "/api/orders", {"planId": "pro"}),
        ("POST", "/api/payments/verify", {}),
        ("POST", "/api/me/codes/apply", {"code": "FREE", "item": "pro"}),
        ("PUT", "/api/me/hire", {"on": True}),
        ("POST", "/api/me/hire/confirm", {}),
        ("POST", "/api/me/trust/documents/sessions", {"kind": "aadhaar"}),
        ("POST", "/api/me/trust/face/check", {}),
    ]  # fmt: skip
    for method, path, body in tries:
        r = await c.request(method, path, json=body)
        assert r.status_code == 403, (path, r.text)
        assert r.json()["error"] == {"code": "review_account", "message": reviewer.MESSAGE}
    # the email is not in the profile form, and a name change can't touch it
    ok(await c.patch("/api/me/profile", json={"name": "Priya S", "email": "someone@else.com"}))
    assert (await db[USERS].find_one({"_id": reviewer.ID}))["email"] == reviewer.EMAIL
    # no password reset code is ever sent, and a reset is refused
    ok(await make_client().post("/api/auth/password/forgot", json={"email": reviewer.EMAIL}))
    assert not [m for m in outbox.sent if m.to.lower() == reviewer.EMAIL]
    r = await make_client().post(
        "/api/auth/password/reset",
        json={"email": reviewer.EMAIL, "code": "123456", "password": "Other-pass-1234",
              "passwordConfirm": "Other-pass-1234"},
    )  # fmt: skip
    assert r.status_code == 403 and r.json()["error"]["code"] == "review_account"
    await reviewer_client(make_client, pw)  # still the same password
    # reading stays allowed: the pages open
    assert (await c.get("/api/me/hire")).status_code == 200
    # another person is not touched by any of this
    other = make_client()
    await signup(other, outbox, email="sai@example.com")
    r = await other.post("/api/auth/password/change", json={"currentPassword": PASSWORD, "password": "Other-pass-1234",
                                                           "passwordConfirm": "Other-pass-1234"})  # fmt: skip
    assert r.status_code == 200, r.text


def test_blocked_routes_are_only_writes():
    assert reviewer.blocked("POST", "/api/orders") and reviewer.blocked("DELETE", "/api/me/account/deletion")
    assert not reviewer.blocked("GET", "/api/orders") and not reviewer.blocked(
        "POST", "/api/me/auto-apply/v2/helper/code"
    )
    assert not reviewer.blocked("POST", "/api/helper/kits/x/applied") and not reviewer.blocked(
        "PUT", "/api/me/hire/emails"
    )


async def test_never_sends_on_any_channel(admin_client, make_client, db, outbox):
    """Every send point refuses the account on its own, even if it weren't demo and the switch were public."""
    await owner_with_account(admin_client)
    await db[USERS].update_one({"_id": reviewer.ID}, {"$set": {"demo": False}})  # the second lock alone
    u = await db[USERS].find_one({"_id": reviewer.ID})
    it = await db[AUTO_ITEMS].find_one({"user_id": reviewer.ID})
    copy = await db[AUTO_COPIES].find_one({"_id": it["copy_id"]})
    site = await get_site(db)
    site["auto_apply_v2"] = {**site["auto_apply_v2"], "public": True}
    job = {"_id": "j-mail", "title": "Analyst", "company": {"name": "Real Co"}, "apply": {"method": "email",
           "email": "hr@realco.example"}, "status": "active"}  # fmt: skip
    # Auto Apply email (Resend, apply.nm7.si)
    assert await emailing.ready_reason(db, u, job, site) == "demo"
    assert await emailing.send(db, outbox, it, job, u, copy, []) is None
    sent = await emailing._send_one(
        db, outbox, u=u, j=job, item_id=it["_id"], kind="first", to="hr@realco.example", test=False, subject="s",
        text="t", html="h", attachments=[], source={},
    )  # fmt: skip
    assert sent is None and outbox.sent == []
    # a company's own form on its site
    assert (
        await forms.route(db, u, {**job, "apply": {"method": "link", "url": "https://realco.example/a"}}, site)
        == "demo"
    )
    # a partner hiring system (Zoho, Greenhouse, Lever, Darwinbox)
    partner_job = {**job, "company_id": "c1", "partner_job": {"partner": "greenhouse", "id": "1"}}
    assert await ats.queue(db, u, it, partner_job, site) is None
    d = {"_id": "d1", "app_id": "a1", "item_id": it["_id"], "user_id": reviewer.ID, "job_id": "j", "company_id": "c1",
         "partner": "greenhouse", "partner_name": "Greenhouse", "partner_job_id": "1", "state": "pending"}  # fmt: skip
    await db[ATS_DELIVERIES].insert_one(d)

    class Never:
        def __getattr__(self, name):
            raise AssertionError("no network for the review account")

    assert await ats.deliver_one(db, d, {"partner": "greenhouse"}, site, Never()) == "kept"
    assert (await db[ATS_DELIVERIES].find_one({"_id": "d1"}))["state"] == "failed"
    # an Nm7 application to a company
    assert await engine.apply_nm7(db, it, {**job, "company_id": "c1", "apply": {"method": "nm7"}}, u, copy, {}) is None
    # and no email ever goes to its address
    assert await send_safely(outbox, Email(to=reviewer.EMAIL, to_name="", subject="Hi", text="Hi", html="Hi"))
    assert outbox.sent == []


async def test_cannot_apply_to_a_company_job_on_nm7(client, admin_client, make_client, db, outbox):
    _, cid, job = await company_job(client, outbox, db)
    _, pw = await owner_with_account(admin_client)
    c = await reviewer_client(make_client, pw)
    r = await c.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "resumeId": "r1"})
    assert r.status_code == 409
    assert await db[APPLICATIONS].count_documents({"company_id": cid}) == 0


async def test_left_out_of_numbers_reports_funnels_and_company_searches(admin_client, make_client, db):
    from app.admin import daily_report
    from app.setup import funnel

    owner, pw = await owner_with_account(admin_client)
    await reviewer_client(make_client, pw)
    assert ok(await owner.get("/api/admin/stats"))["customers"] == 0
    assert ok(await owner.get("/api/admin/customers"))["total"] == 0
    m, _ = await daily_report.counts(db, daily_report.ist_today())
    assert m["signupSeekers"] == 0 and m["autoApplications"] == 0
    f = await funnel.section(db)
    assert all(r["total"] == 0 for r in f["roles"] if r["role"] == "jobseeker")
    # Ready to join / Hire now: even a profile written straight into the database never reaches a company's
    # shortlist, while another made-up person with the same profile does reach the demo company's
    from app.core.time import now
    from app.hire import shortlist

    t = now()
    await db[USERS].insert_one({"_id": "demo-control", "email": "c@demo.nm7.invalid", "name": "Control (demo)",
                                "role": "customer", "demo": True, "deleted_at": None, "disabled_at": None})  # fmt: skip
    for uid in (reviewer.ID, "demo-control"):
        await db[HIRE_PROFILES].insert_one({"_id": uid, "on": True, "consent_at": t, "paused_at": None,
                                            "confirmed_at": t, "cities": ["Pune"], "remote": True,
                                            "available_now": True, "notice_days": 0})  # fmt: skip
    job = {"_id": "j1", "title": "Data Analyst", "locations": ["Pune"], "job_type": "full_time", "status": "active",
           "skills": ["SQL"], "experience": "fresher"}  # fmt: skip
    await db[RESUMES].insert_one({"key": "r1", "user_id": "demo-control", "name": "r", "data": account.RESUME,
                                  "active": True, "versions": []})  # fmt: skip
    for vetting in (True, False):
        got = [x["key"] for x in await shortlist.candidates(db, {"_id": "demo-co", "demo": True}, job, vetting=vetting)]
        assert "demo-control" in got and reviewer.ID not in got
    # its consent records are marked demo, and a reset clears them
    from app.trust import consent

    await db[TRUST_PROFILES].insert_one({"_id": reviewer.ID, "age_checked_at": t})
    await consent.grant(db, reviewer.ID, "profile_sharing")
    assert await db[TRUST_CONSENTS].count_documents({"user_id": reviewer.ID, "demo": True}) == 1
    assert await db[TRUST_CONSENTS].count_documents({"user_id": reviewer.ID, "demo": {"$ne": True}}) == 0
    await account.reset(db)
    assert await db[TRUST_CONSENTS].count_documents({"user_id": reviewer.ID}) == 0
    assert await db[HIRE_PROFILES].count_documents({"_id": reviewer.ID}) == 0
    assert await db[TRUST_PROFILES].count_documents({"_id": reviewer.ID}) == 0


async def test_no_google_sign_in_and_admins_untouched(admin_client, make_client, db):
    _, pw = await owner_with_account(admin_client)
    # admin sign-in still needs email, password and the authenticator
    _, secret, _ = await create_admin(db, "second@nm7.si", "Second", "owner", PASSWORD)
    a = make_client()
    r = await a.post("/api/auth/admin/login", json={"email": "second@nm7.si", "password": PASSWORD})
    assert r.status_code == 200
    assert (await a.get(ADMIN)).status_code in (401, 403)  # not until the authenticator code
    ok(await a.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()}))
    assert ok(await a.get(ADMIN))["exists"] is True
    # and the review account is refused by Google sign-in (made-up accounts never use it)
    c = await reviewer_client(make_client, pw)
    assert (await c.post("/api/auth/google/link", json={"credential": "x" * 40})).status_code == 403


@pytest.mark.parametrize("who", [reviewer.ID, {"_id": "x", "email": "Chrome-Review@nm7.si"}, {"_id": reviewer.ID}])
def test_is_reviewer(who):
    assert reviewer.is_reviewer(who)
    assert not reviewer.is_reviewer("someone") and not reviewer.is_reviewer({"_id": "a", "email": "a@nm7.si"})


async def test_reset_is_quick_and_needs_no_ai(admin_client, db, monkeypatch):
    import time

    from app.autoapply import tailoring

    async def no_ai(*a, **k):
        raise AssertionError("the review account never calls the AI")

    monkeypatch.setattr(tailoring, "_ai", no_ai)
    await owner_with_account(admin_client)
    t = time.monotonic()
    assert (await account.reset(db)) == {"items": 2}
    assert time.monotonic() - t < 5
    assert await db[SESSIONS].count_documents({"user_id": reviewer.ID}) == 0
    assert onetap.closed_reason(await db[JOBS].find_one({"_id": "cws-review-junior-data-analyst"})) is None
