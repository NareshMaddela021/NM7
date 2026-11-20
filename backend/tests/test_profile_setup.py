"""Profile setup P1: each role's quick start. Saved at once and picked up where it stopped, validated and small,
mapped onto the fields the site already has without ever overwriting them, only name + contact + role required,
pre-filled (and skipped) from existing data, the under-18 parent step for students, hidden switches."""

from app.core.db import EXPERT_PROFILES, HIRE_PROFILES, JOB_PROFILES, MEMBERSHIPS, ORGANIZATIONS, USERS
from app.core.time import now
from app.setup import steps as S
from tests.conftest import signup


def err(r):
    return r.json()["error"]["code"]


async def person(client, outbox, roles=("jobseeker",), email="asha@example.com", **extra):
    me = await signup(client, outbox, email=email, name="Asha Rao", pickRoles=True)
    r = await client.post("/api/auth/roles", json={"add": list(roles), "expertTerms": "expert" in roles, **extra})
    assert r.status_code == 200, r.text
    return me


async def put(client, role, **body):
    r = await client.put(f"/api/me/setup/{role}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def trust_tester(db, email):
    await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email}}, upsert=True)


# ---------- the step rules ----------


def test_step_rules():
    assert S.steps_for("jobseeker", {}, {}) == ["job", "city", "experience", "faster"]
    assert S.steps_for("jobseeker", {"experience": "fresher"}, {}) == [
        "job",
        "city",
        "experience",
        "college",
        "course",
        "faster",
    ]
    assert S.steps_for("student", {}, {"trust": False}) == ["college", "course", "looking", "faster"]
    assert S.steps_for("student", {}, {"trust": True}) == ["college", "course", "looking", "age", "faster"]
    assert S.steps_for("expert", {}, {}) == ["expertise", "years", "services", "faster"]
    steps = S.steps_for("jobseeker", {}, {})
    assert S.resume(steps, {}, [], None, False) == "job"
    assert S.resume(steps, {"job": "Driver", "remote": True}, [], None, False) == "experience"
    assert S.resume(steps, {}, ["job"], "city", False) == "city"
    assert S.resume(steps, {"experience": "1_3"}, ["job", "city", "faster"], "job", False) == "results"
    assert S.resume(steps, {}, [], "city", True) == "results"


# ---------- save at once, resume ----------


async def test_save_and_resume(client, outbox, db):
    me = await person(client, outbox)
    st = (await client.get("/api/me/setup")).json()
    assert st["roles"] == ["jobseeker"] and st["setup"]["jobseeker"]["step"] == "job"
    s = await put(client, "jobseeker", answers={"job": "  Data   analyst "}, step="city")
    assert s["answers"]["job"] == "Data analyst" and s["step"] == "city" and s["startedAt"]
    # a reload (or coming back later) picks up at the same step
    s = (await client.get("/api/me/setup/jobseeker")).json()
    assert s["step"] == "city" and s["pending"] == 3
    s = await put(client, "jobseeker", skip=["city"], step="experience")
    assert s["skipped"] == ["city"] and s["step"] == "experience"
    s = await put(client, "jobseeker", answers={"experience": "3_5"}, step="faster")
    s = await put(client, "jobseeker", skip=["faster"], step="results", done=True)
    assert s["done"] and s["step"] == "results"
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["setup"]["jobseeker"]["done_at"] is not None
    # answering a skipped step later takes it off the skipped list
    s = await put(client, "jobseeker", answers={"cities": ["bangalore", "Hyderabad", "Bangalore"]})
    assert s["answers"]["cities"] == ["Bengaluru", "Hyderabad"] and "city" not in s["skipped"]


async def test_validation_and_size(client, outbox):
    await person(client, outbox, roles=("jobseeker", "student"))
    for body, code in [
        ({"answers": {"job": "x" * 81}}, 422),
        ({"answers": {"experience": "20_plus"}}, 422),
        ({"answers": {"cities": ["A", "B", "C", "D"]}}, 422),
        ({"answers": {"salary": 5}}, 422),  # not a question
        ({"answers": {"looking": ["internship"]}}, 400),  # a student question, not a job seeker one
        ({"skip": ["salary"]}, 400),
        ({"step": "nowhere"}, 400),
        ({"answers": {"year": 1900}}, 422),
    ]:
        r = await client.put("/api/me/setup/jobseeker", json=body)
        assert r.status_code == code, (body, r.text)
    r = await client.put("/api/me/setup/expert", json={})
    assert r.status_code == 400 and err(r) == "no_such_role"  # not one of their roles
    assert (await client.put("/api/me/setup/company", json={})).status_code == 404
    s = await put(client, "student", answers={"looking": ["internship", "learning", "internship"]})
    assert s["answers"]["looking"] == ["internship", "learning"]


async def test_needs_sign_in_and_individual(client, admin_client):
    assert (await client.get("/api/me/setup")).status_code == 401
    admin = await admin_client("ops")
    r = await admin.get("/api/me/setup")
    assert r.status_code == 403 and err(r) == "not_individual"


# ---------- only name + contact + role are required ----------


async def test_only_name_contact_and_role_are_required(client, outbox, db):
    me = await person(client, outbox)
    # every step skipped, nothing answered: done, and the jobs page opens all the same
    s = await put(client, "jobseeker", skip=["job", "city", "experience", "faster"], step="results", done=True)
    assert s["done"] and s["answers"] == {} and s["pending"] == 0
    assert (await client.get("/api/jobs")).status_code == 200
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["target_role"] == "" and u["cities"] == "" and "job_alert" not in u


# ---------- mapping onto existing fields, never overwriting ----------


async def test_answers_fill_existing_fields(client, outbox, db):
    me = await person(client, outbox)
    await put(client, "jobseeker", answers={"job": "Data analyst"})
    await put(client, "jobseeker", answers={"cities": ["Pune"], "remote": False})
    await put(client, "jobseeker", answers={"experience": "8_plus"})
    u = await db[USERS].find_one({"_id": me["id"]})
    assert u["target_role"] == "Data analyst" and u["cities"] == "Pune" and u["level"] == "8+ years"
    a = u["job_alert"]
    assert a["roles"] == ["Data analyst"] and a["cities"] == ["Pune"] and a["remote"] is False
    assert a["experience"] == ["8_12", "12_15", "15_plus"]
    assert a["on"] is False  # email alerts stay the person's own choice
    alert = (await client.get("/api/me/job-alerts")).json()
    assert alert["roles"] == ["Data analyst"] and alert["on"] is False


async def test_never_overwrites_existing_data(client, outbox, db):
    me = await person(client, outbox)
    uid = me["id"]
    await db[USERS].update_one(
        {"_id": uid},
        {
            "$set": {
                "target_role": "Nurse",
                "cities": "Chennai",
                "level": "Senior",
                "job_alert": {
                    "on": True,
                    "roles": ["Nurse"],
                    "cities": ["Chennai"],
                    "remote": True,
                    "experience": ["5_8"],
                },
            }
        },
    )
    edu = [{"institution": "My Own College", "degree": "B.Sc", "to": "2019-05", "pid": "mine"}]
    await db[JOB_PROFILES].insert_one({"_id": uid, "data": {"edu": edu}, "version": 4, "updated_at": now()})
    s = (await client.get("/api/me/setup/jobseeker")).json()
    # pre-filled from what they have, so those steps are not asked again
    assert (
        s["answers"]["job"] == "Nurse" and s["answers"]["cities"] == ["Chennai"] and s["answers"]["experience"] == "5_8"
    )
    assert set(s["prefilled"]) >= {"job", "cities", "experience"} and s["step"] == "faster"
    await put(client, "jobseeker", answers={"job": "Data analyst", "cities": ["Pune"], "experience": "fresher"})
    await put(client, "jobseeker", answers={"college": "Another College", "course": "BCA", "year": 2026})
    u = await db[USERS].find_one({"_id": uid})
    assert (u["target_role"], u["cities"], u["level"]) == ("Nurse", "Chennai", "Senior")
    assert (
        u["job_alert"]["roles"] == ["Nurse"]
        and u["job_alert"]["cities"] == ["Chennai"]
        and u["job_alert"]["on"] is True
    )
    jp = await db[JOB_PROFILES].find_one({"_id": uid})
    assert jp["data"]["edu"] == edu
    # Batch C item 15: the empty Job Profile basics follow the account's own values, never the newer answers
    p = jp["data"]["personal"]
    assert (p["headline"], p["location"]) == ("Nurse", "Chennai") and "level" not in p


async def test_answers_fill_the_job_profile_and_ready_to_join(client, outbox, db):
    """Batch C item 15: role, cities and experience land in the Job Profile and in Ready to join (switched off)."""
    me = await person(client, outbox)
    uid = me["id"]
    await put(client, "jobseeker", answers={"job": "Data analyst", "cities": ["Pune", "Hyderabad"], "remote": False})
    await put(client, "jobseeker", answers={"experience": "1_3"})
    p = (await db[JOB_PROFILES].find_one({"_id": uid}))["data"]["personal"]
    assert (p["headline"], p["location"], p["level"]) == ("Data analyst", "Pune", "Junior (1–3 yrs)")
    h = (await client.get("/api/me/hire")).json()
    assert h["cities"] == ["Pune", "Hyderabad"] and h["on"] is False and h["available"] is False
    # their own edits win: nothing is overwritten later
    await db[JOB_PROFILES].update_one({"_id": uid}, {"$set": {"data.personal.headline": "BI developer"}})
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"cities": ["Chennai"]}})
    await put(client, "jobseeker", answers={"job": "Analyst", "cities": ["Delhi"]})
    assert (await db[JOB_PROFILES].find_one({"_id": uid}))["data"]["personal"]["headline"] == "BI developer"
    assert (await db[HIRE_PROFILES].find_one({"_id": uid}))["cities"] == ["Chennai"]


async def test_fresher_education_goes_to_the_job_profile(client, outbox, db):
    me = await person(client, outbox)
    s = await put(client, "jobseeker", answers={"experience": "fresher"}, step="college")
    assert s["steps"] == ["job", "city", "experience", "college", "course", "faster"] and s["step"] == "college"
    await put(client, "jobseeker", answers={"college": "Lakeview Institute"}, step="course")
    jp = await db[JOB_PROFILES].find_one({"_id": me["id"]})
    # version 1 is the experience level the first answer filled in (Batch C item 15)
    assert jp["version"] == 2 and jp["data"]["edu"][0]["institution"] == "Lakeview Institute"
    await put(client, "jobseeker", answers={"course": "B.Tech CSE", "year": 2026}, step="faster")
    jp = await db[JOB_PROFILES].find_one({"_id": me["id"]})
    e = jp["data"]["edu"][0]
    assert (e["institution"], e["degree"], e["to"]) == ("Lakeview Institute", "B.Tech CSE", "2026-05")
    assert jp["version"] == 3 and len(jp["data"]["edu"]) == 1
    # the Job Profile API reads it like any other entry
    data = (await client.get("/api/me/job-profile")).json()["data"]
    assert data["edu"][0]["degree"] == "B.Tech CSE"
    # changing their mind about the course never overwrites what is in the profile now
    await put(client, "jobseeker", answers={"course": "MCA"})
    assert (await db[JOB_PROFILES].find_one({"_id": me["id"]}))["data"]["edu"][0]["degree"] == "B.Tech CSE"


async def test_expert_expertise_goes_to_the_application(client, outbox, db):
    me = await person(client, outbox, roles=("expert",))
    s = (await client.get("/api/me/setup/expert")).json()
    assert s["steps"] == ["expertise", "years", "services", "faster"] and s["step"] == "expertise"
    await put(client, "expert", answers={"expertise": ["Finance", "Sales"]}, step="years")
    await put(client, "expert", answers={"years": "8_12"}, step="services")
    s = await put(client, "expert", answers={"services": ["resume_review", "l4_reviewer"]}, step="faster")
    assert s["answers"]["services"] == ["resume_review"]  # the L4 reviewer choice is hidden while vetting is off
    doc = await db[EXPERT_PROFILES].find_one({"_id": me["id"]})
    assert doc["status"] == "draft" and doc["profile"]["expertise"]["domains"] == ["Finance", "Sales"]
    prof = (await client.get("/api/expert/profile")).json()
    assert prof["status"] == "draft" and prof["expertise"]["domains"] == ["Finance", "Sales"]
    # their own choice later is never overwritten
    await db[EXPERT_PROFILES].update_one({"_id": me["id"]}, {"$set": {"profile.expertise.domains": ["Design"]}})
    await put(client, "expert", answers={"expertise": ["Product"]})
    assert (await db[EXPERT_PROFILES].find_one({"_id": me["id"]}))["profile"]["expertise"]["domains"] == ["Design"]
    r = await client.put("/api/me/setup/expert", json={"answers": {"expertise": ["Astrology"]}})
    assert r.status_code == 422


async def test_l4_reviewer_shown_to_vetting_testers(client, outbox, db):
    await person(client, outbox, roles=("expert",))
    await db["settings"].update_one(
        {"_id": "site"}, {"$addToSet": {"vetting.testers": "asha@example.com"}}, upsert=True
    )
    s = await put(client, "expert", answers={"services": ["l4_reviewer"]})
    assert s["answers"]["services"] == ["l4_reviewer"] and s["switches"]["vetting"] is True


# ---------- students: college, and the under-18 parent check ----------


async def test_student_college_from_a_group_joined(client, outbox, db):
    me = await person(client, outbox, roles=("student",))
    await db[ORGANIZATIONS].insert_one(
        {"_id": "o1", "name": "Sunrise Engineering College", "type": "college", "status": "active"}
    )
    await db[MEMBERSHIPS].insert_one(
        {"_id": "m1", "user_id": me["id"], "org_id": "o1", "group_id": "g1", "left_at": None, "joined_at": now()}
    )
    s = (await client.get("/api/me/setup/student")).json()
    assert s["answers"]["college"] == "Sunrise Engineering College" and s["step"] == "course"
    items = (await client.get("/api/me/setup/suggest", params={"kind": "college", "q": "sunrise"})).json()["items"]
    assert items == ["Sunrise Engineering College"]


async def test_student_under_18_parent_step(client, outbox, db):
    await person(client, outbox, roles=("student",))
    s = (await client.get("/api/me/setup/student")).json()
    assert "age" not in s["steps"]  # hidden: Vetting Trust is off for this person
    await trust_tester(db, "asha@example.com")
    s = (await client.get("/api/me/setup/student")).json()
    assert s["steps"] == ["college", "course", "looking", "age", "faster"]
    await put(client, "student", answers={"college": "Govt Junior College", "course": "Intermediate MPC", "year": 2027})
    s = await put(client, "student", answers={"looking": ["internship"]}, step="age")
    assert s["step"] == "age"
    dob = now().date().replace(year=now().year - 16)
    assert (await client.post("/api/me/trust/age", json={"dob": dob.isoformat()})).json()["minor"] is True
    s = (await client.get("/api/me/setup/student")).json()
    assert s["answers"]["age"] == "minor" and s["step"] == "age"  # a parent still has to be asked
    r = await client.post("/api/me/trust/parent", json={"email": "parent@example.com"})
    assert r.status_code == 200, r.text
    s = (await client.get("/api/me/setup/student")).json()
    assert s["answers"]["age"] == "parent_asked" and s["step"] == "faster"
    # the age itself is never a quick-start answer
    assert (await client.put("/api/me/setup/student", json={"answers": {"age": "adult"}})).status_code == 422


async def test_adult_student_passes_the_age_step(client, outbox, db):
    await person(client, outbox, roles=("student",))
    await trust_tester(db, "asha@example.com")
    dob = now().date().replace(year=now().year - 20)
    await client.post("/api/me/trust/age", json={"dob": dob.isoformat()})
    s = (await client.get("/api/me/setup/student")).json()
    assert s["answers"]["age"] == "adult" and "age" not in [x for x in s["steps"] if not S.answered(x, s["answers"])]


# ---------- helpers ----------


async def test_nearest_city_stores_nothing(client, outbox, db):
    me = await person(client, outbox)
    r = await client.post("/api/me/setup/nearest-city", json={"lat": 17.41, "lng": 78.47})
    assert r.json()["city"] == "Hyderabad"
    r = await client.post("/api/me/setup/nearest-city", json={"lat": 12.95, "lng": 77.6})
    assert r.json()["city"] == "Bengaluru"
    r = await client.post("/api/me/setup/nearest-city", json={"lat": 51.5, "lng": -0.12})
    assert r.status_code == 400 and err(r) == "outside_india"
    u = await db[USERS].find_one({"_id": me["id"]})
    assert "setup" not in u and u["cities"] == ""


async def test_job_suggestions(client, outbox):
    await person(client, outbox)
    items = (await client.get("/api/me/setup/suggest", params={"kind": "job", "q": "data"})).json()["items"]
    assert "Data analyst" in items
    assert len((await client.get("/api/me/setup/suggest", params={"kind": "job"})).json()["items"]) == 8


async def test_each_role_has_its_own_quick_start(client, outbox):
    await person(client, outbox, roles=("jobseeker", "student"))
    await put(client, "jobseeker", skip=["job", "city", "experience", "faster"], step="results", done=True)
    st = (await client.get("/api/me/setup")).json()["setup"]
    assert st["jobseeker"]["done"] is True and st["student"]["done"] is False and st["student"]["step"] == "college"


async def test_deleting_the_account_removes_setup(client, outbox, db):
    me = await person(client, outbox)
    await put(client, "jobseeker", answers={"job": "Driver"})
    from app.me.erase import erase_account

    await erase_account(db, me["id"])
    assert "setup" not in await db[USERS].find_one({"_id": me["id"]})
