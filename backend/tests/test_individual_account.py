"""One account for individuals: one sign-up with one consent tick, "What would you like to do?", add / switch roles,
the expert role still needing admin approval before paid work, older accounts' roles derived without a rewrite, and
the company sign-up left as it was."""

from app.auth.models import User
from app.core.db import AUDIT_LOG, TRUST_CONSENTS, TRUST_PARENTS, TRUST_PROFILES, USERS
from app.core.security import hash_password
from app.core.time import now
from tests.conftest import PASSWORD, approved_expert, buy, signup
from tests.test_google_auth import go, google_on, token  # noqa: F401  (google_on: Google sign-in on, autouse)


def err(r):
    return r.json()["error"]["code"]


async def new_individual(c, outbox, email="asha@example.com", name="Asha Rao"):
    return await signup(c, outbox, email=email, name=name, pickRoles=True)


# ---------- sign-up: one tick, the same T1 records as before ----------


async def test_single_tick_signup_keeps_t1_records_and_age_gate(client, outbox, db, make_client):
    # without the tick: refused, exactly as before
    body = {"name": "Asha Rao", "email": "asha@example.com", "password": PASSWORD, "passwordConfirm": PASSWORD}
    r = await client.post("/api/auth/signup", json={**body, "pickRoles": True})
    assert r.status_code == 400 and err(r) == "terms_required"

    me = await new_individual(client, outbox)
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["terms_accepted_at"] is not None and u["role"] == "customer" and u["roles_pending"] is True
    assert me["rolesPending"] is True and me["roles"] == ["jobseeker"] and me["activeRole"] == "jobseeker"

    # the same T1 state an account made on the old page had: no per-purpose consent given at sign-up (each purpose is
    # asked on its own, later), the age not yet checked, no parent link
    old = make_client()
    old_me = await signup(old, outbox, email="old@example.com", name="Old Page")
    for uid in (me["id"], old_me["id"]):
        assert await db[TRUST_CONSENTS].count_documents({"user_id": uid}) == 0
        assert await db[TRUST_PROFILES].find_one({"_id": uid}) is None
        assert await db[TRUST_PARENTS].count_documents({"user_id": uid}) == 0

    # the T1 age gate still applies after the one tick: date of birth first, a parent for under-18s
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": "asha@example.com"}}, upsert=True)
    r = await client.post("/api/me/trust/consents/ai_interview")
    assert r.status_code == 428 and err(r) == "age_check"
    dob = now().date().replace(year=now().year - 16)
    st = (await client.post("/api/me/trust/age", json={"dob": dob.isoformat()})).json()
    assert st["minor"] is True
    r = await client.post("/api/me/trust/consents/ai_interview")
    assert r.status_code == 403 and err(r) == "parent_needed"


async def test_old_page_signup_has_no_picker(client, outbox):
    me = await signup(client, outbox)
    assert me["rolesPending"] is False and me["roles"] == ["jobseeker"]


# ---------- the picker, adding and switching roles ----------


async def test_picker_sets_roles_and_active_role(client, outbox, db):
    await new_individual(client, outbox)
    r = await client.post("/api/auth/roles", json={"add": ["student", "jobseeker"], "active": "student"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["roles"] == ["jobseeker", "student"] and me["activeRole"] == "student" and me["role"] == "customer"
    assert me["rolesPending"] is False
    assert (await client.get("/api/auth/me")).json()["activeRole"] == "student"
    assert await db[AUDIT_LOG].find_one({"action": "account.roles_added"})


async def test_picker_only_expert_replaces_the_placeholder(client, outbox, db):
    await new_individual(client, outbox)
    r = await client.post("/api/auth/roles", json={"add": ["expert"]})
    assert r.status_code == 400 and err(r) == "expert_terms"
    me = (await client.post("/api/auth/roles", json={"add": ["expert"], "expertTerms": True})).json()
    assert me["roles"] == ["expert"] and me["activeRole"] == "expert" and me["role"] == "expert"
    assert me["expertStatus"] == "draft"  # the application, waiting for an admin
    assert (await db[USERS].find_one({"_id": me["id"]}))["expert_terms_accepted_at"] is not None


async def test_empty_answer_keeps_the_account(client, outbox):
    await new_individual(client, outbox)
    me = (await client.post("/api/auth/roles", json={"add": []})).json()
    assert me["rolesPending"] is False and me["roles"] == ["jobseeker"]


async def test_add_another_role_and_switch(client, outbox):
    await new_individual(client, outbox)
    await client.post("/api/auth/roles", json={"add": ["jobseeker"]})
    me = (await client.post("/api/auth/roles", json={"add": ["expert"], "expertTerms": True})).json()
    assert me["roles"] == ["jobseeker", "expert"] and me["activeRole"] == "expert" and me["role"] == "expert"
    # roles are only ever added
    me = (await client.post("/api/auth/roles", json={"add": ["student"], "active": "jobseeker"})).json()
    assert me["roles"] == ["jobseeker", "student", "expert"] and me["activeRole"] == "jobseeker"
    assert me["role"] == "customer"

    me = (await client.post("/api/auth/roles/switch", json={"role": "expert"})).json()
    assert me["activeRole"] == "expert" and me["role"] == "expert"
    assert (await client.get("/api/expert/profile")).status_code == 200  # the expert side opens
    assert (await client.get("/api/me/state")).status_code == 403  # the job seeker side waits for a switch back
    me = (await client.post("/api/auth/roles/switch", json={"role": "student"})).json()
    assert me["activeRole"] == "student" and me["role"] == "customer"
    assert (await client.get("/api/me/state")).status_code == 200


async def test_switch_to_a_role_not_added_is_refused(client, outbox):
    await signup(client, outbox)
    r = await client.post("/api/auth/roles/switch", json={"role": "expert"})
    assert r.status_code == 400 and err(r) == "no_such_role"
    assert (await client.post("/api/auth/roles/switch", json={"role": "jobseeker"})).json()["activeRole"] == "jobseeker"


async def test_admins_have_no_individual_roles(admin_client):
    admin = await admin_client("ops")
    me = (await admin.get("/api/auth/me")).json()
    assert me["roles"] == [] and me["activeRole"] is None
    r = await admin.post("/api/auth/roles", json={"add": ["jobseeker"]})
    assert r.status_code == 403 and err(r) == "not_individual"


async def test_roles_need_sign_in(client):
    assert (await client.post("/api/auth/roles", json={"add": ["student"]})).status_code == 401
    assert (await client.post("/api/auth/roles/switch", json={"role": "student"})).status_code == 401


# ---------- the expert gate ----------


async def test_added_expert_role_needs_approval_before_paid_work(
    client, outbox, db, make_client, razorpay, admin_client
):
    # a job seeker buys an expert order
    await signup(client, outbox, email="buyer@example.com", name="Buyer")
    _, order = await buy(client)
    admin = await admin_client("ops")

    # someone else adds the expert role: Admin sees the application, but no order can go to them before approval
    ex = make_client()
    await new_individual(ex, outbox, email="kiran@example.com", name="Kiran")
    me = (await ex.post("/api/auth/roles", json={"add": ["jobseeker", "expert"], "expertTerms": True})).json()
    await ex.post("/api/auth/roles/switch", json={"role": "jobseeker"})  # job-hunting right now
    apps = (await admin.get("/api/admin/experts")).json()
    assert me["id"] in [a["id"] for a in apps]
    r = await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": me["id"]})
    assert r.status_code == 400 and err(r) == "bad_expert"
    assert (await ex.get("/api/work")).json() == []  # in the job seeker role: their own orders only (none)

    # after approval the order can be assigned, and they work on it in the expert role
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"expert_status": "approved"}})
    r = await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": me["id"]})
    assert r.status_code == 200, r.text
    await ex.post("/api/auth/roles/switch", json={"role": "expert"})
    assert [w["id"] for w in (await ex.get("/api/work")).json()] == [order["id"]]


async def test_unapproved_expert_cannot_work_on_an_assigned_order(
    client, outbox, db, make_client, razorpay, admin_client
):
    await signup(client, outbox, email="buyer2@example.com", name="Buyer")
    _, order = await buy(client)
    expert, expert_id = await approved_expert(make_client, outbox, db)
    admin = await admin_client("ops")
    assert (
        await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": expert_id})
    ).status_code == 200
    await db[USERS].update_one({"_id": expert_id}, {"$set": {"expert_status": "review"}})  # e.g. approval taken back
    r = await expert.patch(f"/api/work/{order['id']}", json={"status": "progress"})
    assert r.status_code == 403 and err(r) == "not_approved"


async def test_an_expert_is_never_assigned_their_own_order(client, outbox, db, razorpay, admin_client):
    me = await signup(client, outbox, email="both@example.com", name="Both Roles")
    _, order = await buy(client)
    await client.post("/api/auth/roles", json={"add": ["expert"], "expertTerms": True})
    await db[USERS].update_one({"_id": me["id"]}, {"$set": {"expert_status": "approved"}})
    admin = await admin_client("ops")
    r = await admin.post(f"/api/admin/orders/{order['id']}/assign", json={"expertId": me["id"]})
    assert r.status_code == 400 and err(r) == "own_order"


# ---------- older accounts ----------


async def _old_account(db, email, role, **extra):
    t = now()
    u = User(email=email, name="Old One", role=role, password_hash=await hash_password(PASSWORD),
             email_verified_at=t, terms_accepted_at=t, **extra)  # fmt: skip
    raw = u.to_mongo()
    for k in ("roles", "active_role", "roles_pending", "expert_terms_accepted_at"):
        raw.pop(k)  # stored before roles existed
    await db[USERS].insert_one(raw)
    return u.id


async def test_older_accounts_roles_are_derived_without_a_rewrite(db, make_client):
    cid = await _old_account(db, "oldc@example.com", "customer")
    eid = await _old_account(db, "olde@example.com", "expert", expert_status="approved")
    c, e = make_client(), make_client()
    me = (await c.post("/api/auth/login", json={"email": "oldc@example.com", "password": PASSWORD})).json()
    assert me["roles"] == ["jobseeker"] and me["activeRole"] == "jobseeker" and me["rolesPending"] is False
    me = (await e.post("/api/auth/login", json={"email": "olde@example.com", "password": PASSWORD})).json()
    assert me["roles"] == ["expert"] and me["activeRole"] == "expert" and me["expertStatus"] == "approved"
    for uid in (cid, eid):  # reading did not write anything
        assert "roles" not in await db[USERS].find_one({"_id": uid})

    # an approved expert adds the job seeker role and keeps the approval
    me = (await e.post("/api/auth/roles", json={"add": ["jobseeker"]})).json()
    assert (
        me["roles"] == ["jobseeker", "expert"] and me["activeRole"] == "jobseeker" and me["expertStatus"] == "approved"
    )
    me = (await e.post("/api/auth/roles/switch", json={"role": "expert"})).json()
    assert me["role"] == "expert" and me["expertStatus"] == "approved"


# ---------- companies stay separate ----------


async def test_company_signup_endpoints_unchanged(client, outbox, db):
    from tests.test_companies_signup import sign_up

    session, company = await sign_up(client, outbox, email="hr-indiv@gmail.com")
    assert session and company["id"]
    # a company admin gets no individual account or roles from it
    assert await db[USERS].find_one({"email_lc": "hr-indiv@gmail.com"}) is None
    assert (await client.get("/api/auth/me")).status_code == 401


# ---------- Google: a new account lands on the same step as email sign-up ----------


async def test_new_google_account_gets_the_role_question(client, db):
    me = (await go(client, token(sub="g-indiv", email="gita@gmail.com"), role="customer")).json()
    assert me["isNew"] and me["rolesPending"] is True and me["roles"] == ["jobseeker"]
    me = (await client.post("/api/auth/roles", json={"add": ["student"]})).json()
    assert me["rolesPending"] is False and me["roles"] == ["student"] and me["activeRole"] == "student"
    again = (await go(client, token(sub="g-indiv", email="gita@gmail.com"))).json()
    assert again["isNew"] is False and again["rolesPending"] is False and again["activeRole"] == "student"
