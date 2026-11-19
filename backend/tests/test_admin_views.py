"""Admin "Switch to" views and "View as this user (read-only)" (app/auth/views.py, app/admin/views.py,
app/core/readonly.py): the admin session stays the only sign-in and is never replaced; Back to Admin is one click;
personas are the admin's own, demo, uncounted, unmailable and can't reach a real company; the read-only view refuses
every change, masks private data, writes nothing and is audit-logged with a reason; owner only."""

import pyotp
import pytest

from app.admin.views import persona_id
from app.auth.admin_service import create_admin
from app.companies.demo import COMPANY_ID
from app.core.db import ADMIN_VIEWS, APPLICATIONS, AUDIT_LOG, EXPERT_PROFILES, SESSIONS, USERS, get_database
from app.core.email import Email, send_safely
from app.core.readonly import READ_ONLY, _Masker, mask
from app.orgs.demo import COORDINATOR_ID, ORG_ID
from app.orgs.recruiter_account import account_for
from tests.conftest import PASSWORD, signup
from tests.jobs_helpers import add_resume, resume
from tests.test_companies_apply import company_job
from tests.test_companies_posting import no_ai  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401

V = "/api/admin/views"


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def me(c):
    r = await c.get("/api/auth/me")
    return r.json() if r.status_code == 200 else None


async def switch(c, role):
    r = await c.post(f"{V}/switch", json={"role": role})
    assert r.status_code == 200, r.text
    return r.json()


async def back(c):
    r = await c.post(f"{V}/stop")
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "/admin"


async def test_switch_keeps_the_admin_signed_in_and_back_to_admin(owner, db):
    admin = await me(owner)
    assert admin["role"] == "admin" and admin["view"] is None
    menu = (await owner.get(V)).json()
    assert [v["role"] for v in menu["views"]] == ["jobseeker", "student", "expert", "company", "college"]
    assert menu["view"] is None and menu["canViewAsUser"] is True
    sessions = await db[SESSIONS].count_documents({"user_id": admin["id"]})

    for role, label, path, kind in (("jobseeker", "Job seeker", "/me", "customer"),
                                    ("student", "Student", "/me", "customer"),
                                    ("expert", "Expert", "/expert", "expert")):  # fmt: skip
        out = await switch(owner, role)
        assert out["path"] == path and out["view"]["label"] == label and out["view"]["readOnly"] is False
        now_me = await me(owner)
        assert now_me["id"] == persona_id(admin["id"], role) and now_me["role"] == kind
        assert now_me["view"]["role"] == role and now_me["view"]["mode"] == "persona"
        assert (await owner.get("/api/admin/stats")).status_code == 403  # admin pages are the admin's, not the view's
        assert (await owner.get(V)).json()["view"]["role"] == role  # the menu still sees the admin underneath
        await back(owner)
        again = await me(owner)
        assert again["id"] == admin["id"] and again["view"] is None
        assert (await owner.get("/api/admin/stats")).status_code == 200  # no new sign-in needed
    # the admin session itself was never replaced: no new sessions, the same one still valid
    assert await db[SESSIONS].count_documents({"user_id": admin["id"]}) == sessions
    assert await db[SESSIONS].count_documents({"user_id": {"$ne": admin["id"]}}) == 0  # personas have none
    # switching straight from one view to another closes the first
    await switch(owner, "student")
    await switch(owner, "expert")
    assert await db[ADMIN_VIEWS].count_documents({"ended_at": None}) == 1
    # "Sign out" inside a view only ends the view
    assert (await owner.post("/api/auth/logout")).status_code == 200
    assert (await me(owner))["id"] == admin["id"]


async def test_switching_needs_an_admin_with_two_step(client, outbox, db, make_client):
    assert (await make_client().post(f"{V}/switch", json={"role": "student"})).status_code == 401
    await signup(client, outbox)
    r = await client.post(f"{V}/switch", json={"role": "student"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "admin_only"
    # password done, authenticator code not yet: not signed in, so no view
    await create_admin(db, "half@nm7.si", "Half", "owner", PASSWORD)
    half = make_client()
    assert (await half.post("/api/auth/admin/login", json={"email": "half@nm7.si", "password": PASSWORD})).json()[
        "status"
    ] == "code_required"
    assert (await half.post(f"{V}/switch", json={"role": "student"})).status_code == 401
    # a two-step admin session that wasn't two-step (an old row) can't either
    _, secret, _ = await create_admin(db, "ops@nm7.si", "Ops", "ops", PASSWORD)
    ops = make_client()
    await ops.post("/api/auth/admin/login", json={"email": "ops@nm7.si", "password": PASSWORD})
    await ops.post("/api/auth/admin/verify", json={"code": pyotp.TOTP(secret).now()})
    await db[SESSIONS].update_many({}, {"$set": {"two_step": False}})
    assert (await ops.post(f"{V}/switch", json={"role": "student"})).status_code == 403


async def test_a_view_ends_with_the_admin_session(owner, db):
    await switch(owner, "student")
    admin = await db[USERS].find_one({"role": "admin"})
    await db[SESSIONS].update_many({"user_id": admin["_id"]}, {"$currentDate": {"revoked_at": True}})
    assert await me(owner) is None  # the admin signed out (or expired): the view is gone with it


async def test_personas_once_per_admin_per_role_demo_and_uncounted(owner, admin_client, db):
    admin = await me(owner)
    for _ in range(2):
        await switch(owner, "student")
        await back(owner)
    await switch(owner, "jobseeker")
    await switch(owner, "expert")
    await back(owner)
    mine = await db[USERS].find({"owner_admin_id": admin["id"]}).to_list(None)
    assert sorted(u["persona"] for u in mine) == ["expert", "jobseeker", "student"]  # one each, made once
    for u in mine:
        assert u["demo"] is True and u["email"].endswith("@persona.nm7.invalid") and u["password_hash"] == ""
    assert await db[EXPERT_PROFILES].count_documents({"_id": persona_id(admin["id"], "expert"), "demo": True}) == 1
    # another admin gets their own
    ops = await admin_client("ops")
    await switch(ops, "student")
    ops_id = (await db[USERS].find_one({"email_lc": "ops@nm7.si"}))["_id"]
    assert persona_id(ops_id, "student") != persona_id(admin["id"], "student")
    assert await db[USERS].count_documents({"persona": "student"}) == 2
    # left out of every number: customers, new customers, experts, the customers and experts lists
    stats = (await owner.get("/api/admin/stats")).json()
    assert stats["customers"] == 0 and stats["newCustomers"] == 0 and stats["experts"] == 0
    assert (await owner.get("/api/admin/customers")).json()["total"] == 0
    assert (await owner.get("/api/admin/experts")).json() == []
    # company / college views need those sections (ops has companies, not organizations)
    assert [v["role"] for v in (await ops.get(V)).json()["views"]] == ["jobseeker", "student", "expert", "company"]
    assert (await ops.post(f"{V}/switch", json={"role": "college"})).status_code == 403


async def test_personas_never_reach_a_real_company_or_inbox(owner, make_client, outbox, db):
    _, cid, job = await company_job(make_client(), outbox, db)
    await switch(owner, "jobseeker")
    await add_resume(owner)
    no = await owner.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "resumeId": "r1"})
    assert no.status_code == 409 and no.json()["error"]["code"] == "test_user"
    assert await db[APPLICATIONS].count_documents({"company_id": cid}) == 0
    # their address is made-up: nothing is ever sent there
    u = await me(owner)
    outbox.sent.clear()
    msg = Email(to=u["email"], to_name=u["name"], subject="Hi", text="Hi", html="<p>Hi</p>")
    assert await send_safely(outbox, msg) is True and outbox.sent == []


async def test_college_view_is_the_demo_college_only(owner, db):
    out = await switch(owner, "college")
    assert out["path"] == f"/org/{ORG_ID}"
    c = await me(owner)
    assert c["id"] == COORDINATOR_ID and c["view"]["label"] == "College"
    assert (await owner.get(f"/api/org/{ORG_ID}")).status_code == 200
    assert (await owner.get("/api/me/resumes")).status_code == 403  # held to the demo college (demo_allowed)
    r = await owner.post("/api/orders", json={"plan": "diy"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_only"
    await back(owner)
    assert (await me(owner))["role"] == "admin"


async def test_company_view_is_the_demo_company_and_ends_with_back(owner, db, no_network):  # noqa: F811
    out = await switch(owner, "company")
    assert out["path"] == "/company" and out["session"]
    assert (await me(owner))["view"]["role"] == "company"  # the admin stays the cookie's person; the banner shows
    acc = await account_for(db, out["session"])
    assert acc and acc["email_lc"].endswith("demo.nm7.invalid")
    assert (await owner.get(f"/api/company/{COMPANY_ID}/overview", headers=H(out["session"]))).status_code == 200
    await back(owner)
    assert await account_for(db, out["session"]) is None  # the company sign-in made for the view is gone


async def test_old_demo_links_no_longer_sign_the_admin_out(owner, db):
    admin = await me(owner)
    # Admin → Organizations → Demo → "Reset and open as coordinator", opened in the same browser
    token = (await owner.post("/api/admin/demo-org/coordinator")).json()["path"].split("#t=")[1]
    assert (await owner.post("/api/public/demo-coordinator", json={"token": token})).json() == {"orgId": ORG_ID}
    now_me = await me(owner)
    assert now_me["id"] == COORDINATOR_ID and now_me["view"]["role"] == "college"
    await back(owner)
    assert (await me(owner))["id"] == admin["id"]
    # Admin → Settings → Test users → open
    await owner.post("/api/admin/test-users")
    token = (await owner.post("/api/admin/test-users/2/open")).json()["path"].split("#t=")[1]
    assert (await owner.post("/api/public/demo-student", json={"token": token})).json() == {"path": "/me"}
    assert (await me(owner))["view"]["role"] == "jobseeker"
    await back(owner)
    assert (await me(owner))["id"] == admin["id"]
    assert await db[SESSIONS].count_documents({"user_id": {"$ne": admin["id"]}}) == 0


# ---------- read-only "View as this user" ----------


async def customer(make_client, outbox, db):
    c = make_client()
    u = await signup(c, outbox, email="real.person@example.com", name="Real Person", phone="+91 98765 43210")
    data = resume()
    data["personal"] = {**data.get("personal", {}), "email": "real.person@example.com", "phone": "+91 98765 43210"}
    await add_resume(c, data=data)
    return c, u


async def test_read_only_view_owner_only_with_reason(owner, admin_client, make_client, outbox, db):
    _, u = await customer(make_client, outbox, db)
    support = await admin_client("support")
    r = await support.post(f"{V}/user", json={"userId": u["id"], "reason": "Ticket 41: resume not saving"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "owner_only"
    assert (await support.get(V)).json()["canViewAsUser"] is False
    r = await owner.post(f"{V}/user", json={"userId": u["id"], "reason": " "})
    assert r.status_code in (400, 422)
    r = await owner.post(f"{V}/user", json={"userId": u["id"], "reason": "hi"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "reason_required"
    assert await db[AUDIT_LOG].count_documents({"action": "admin.view_as_user"}) == 0


async def test_read_only_view_masks_refuses_and_audits(app, owner, make_client, outbox, db):
    real, u = await customer(make_client, outbox, db)
    before = await db[USERS].find_one({"_id": u["id"]})
    r = await owner.post(f"{V}/user", json={"userId": u["id"], "reason": "Ticket 41: resume not saving"})
    assert r.status_code == 200, r.text
    assert r.json()["view"] == {**r.json()["view"], "mode": "readonly", "readOnly": True, "label": "Real Person"}
    # the person's screens, with private data masked
    seen = await me(owner)
    assert seen["id"] == u["id"] and seen["view"]["readOnly"] is True
    assert seen["email"] == "r**********@example.com" and seen["phone"].endswith("10") and "98765" not in seen["phone"]
    assert (await owner.get("/api/me/state")).status_code == 200  # made-on-first-look things (referral code) work
    resumes = (await owner.get("/api/me/resumes")).json()
    personal = resumes[0]["data"]["personal"]
    assert "real.person@" not in str(resumes) and "98765" not in str(resumes)
    assert personal["email"].startswith("r*") and personal["name"]
    # every change is refused, on every route the API has
    paths = app.openapi()["paths"]  # every route of every router
    writes = [(m.upper(), p) for p, ops in paths.items() for m in ops if m.upper() not in ("GET", "HEAD")]
    assert len(writes) > 300
    for method, path in writes:
        if (method, path) == ("POST", f"{V}/stop"):
            continue
        res = await owner.request(method, path.replace("{", "").replace("}", ""), json={})
        assert res.status_code == 403 and res.json()["error"]["code"] == "read_only", (method, path)
    # nothing about the person changed while looking (no last seen, no sessions, nothing written)
    after = await db[USERS].find_one({"_id": u["id"]})
    assert after == before
    assert await db[SESSIONS].count_documents({"user_id": u["id"]}) == 1  # only their own browser's
    # the audit entry: admin, person, reason, start; the end once Back to Admin is pressed
    entry = await db[AUDIT_LOG].find_one({"action": "admin.view_as_user"})
    admin_id = (await db[USERS].find_one({"role": "admin"}))["_id"]
    assert entry["actor_id"] == admin_id and entry["target"] == u["id"]
    assert entry["data"]["reason"] == "Ticket 41: resume not saving" and entry["data"]["started_at"]
    assert entry["data"]["ended_at"] is None
    await back(owner)
    entry = await db[AUDIT_LOG].find_one({"action": "admin.view_as_user"})
    assert entry["data"]["ended_at"] is not None
    assert (await me(owner))["role"] == "admin"
    log = (await owner.get("/api/admin/audit-log?action=admin.view_as_user")).json()
    assert log[0]["data"]["reason"] == "Ticket 41: resume not saving"
    # the person's own browser was never touched
    assert (await me(real))["email"] == "real.person@example.com"


async def test_read_only_view_refuses_files():
    sent = []

    async def send(m):
        sent.append(m)

    m = _Masker(send)
    await m({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/pdf")]})
    await m({"type": "http.response.body", "body": b"%PDF-1.7 ...", "more_body": True})
    await m({"type": "http.response.body", "body": b"more"})
    assert sent[0]["status"] == 403 and b"read_only_file" in sent[1]["body"] and b"PDF" not in sent[1]["body"]


async def test_read_only_database_and_mail_while_viewing(outbox):
    db = get_database()
    token = READ_ONLY.set(True)
    try:
        ro = get_database()
        assert (await ro["users"].insert_one({"_id": "ro-test"})).inserted_id == "ro-test"  # as if, not stored
        await ro["users"].update_one({"_id": "x"}, {"$set": {"a": 1}}, upsert=True)
        assert await ro["users"].find_one_and_update({"_id": "x"}, {"$set": {"a": 1}}, upsert=True) is None
        msg = Email(to="someone@example.com", to_name="S", subject="Hi", text="Hi", html="<p>Hi</p>")
        assert await send_safely(outbox, msg) is True
    finally:
        READ_ONLY.reset(token)
    assert await db["users"].count_documents({"_id": {"$in": ["ro-test", "x"]}}) == 0
    assert outbox.sent == []


def test_mask_hides_private_fields():
    out = mask({
        "email": "sai.varsha@gmail.com", "phone": "+91 98765 43210", "name": "Sai",
        "selfie": {"score": 0.97, "url": "https://x/s.jpg"}, "faceMatch": 0.93, "digilocker": {"aadhaar": "1234"},
        "documents": [{"kind": "aadhaar"}], "integrity": {"evidence": ["tab switch"]}, "dob": "2001-02-03",
        "pan": "ABCDE1234F", "verified": True, "company": "Acme", "groupId": "g1",
        "items": [{"contactEmail": "hr@acme.com", "title": "Analyst"}],
    })  # fmt: skip
    assert out["email"] == "s*********@gmail.com" and out["phone"] == "•••••• 10" and out["name"] == "Sai"
    assert out["selfie"] == {} and out["faceMatch"] is None and out["digilocker"] == {} and out["documents"] == []
    assert out["integrity"] == {} and out["dob"] != "2001-02-03" and out["pan"] != "ABCDE1234F"
    assert out["verified"] is True and out["company"] == "Acme" and out["groupId"] == "g1"
    assert out["items"][0] == {"contactEmail": "h**@acme.com", "title": "Analyst"}


async def test_reset_and_open_as_company_shows_the_banner(owner, db, no_network):  # noqa: F811
    admin = await me(owner)
    out = (await owner.post("/api/admin/demo-company/open")).json()
    assert out["session"]
    now_me = await me(owner)
    assert now_me["id"] == admin["id"] and now_me["view"]["role"] == "company"
    await back(owner)
    assert await account_for(db, out["session"]) is None and (await me(owner))["view"] is None
