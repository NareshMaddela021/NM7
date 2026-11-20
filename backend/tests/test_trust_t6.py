# ruff: noqa: E501
"""Vetting Trust T6: self-serve knock-out questions (up to 8, templates, number / choice too; questions about the
person rather than the work refused), answers saved once and never asked twice (apply form, Auto Apply's store, the
calling agent), "Not a fit for: <question>" as a label (never a rejection, never hidden), the verified non-tech
filters in Hire now (each with its source, combined, with counts; distance only rounded, never coordinates), Work
preferences with a location pin that needs its own consent (withdrawal deletes it), and switch OFF isolation."""

from datetime import timedelta

from app.autoapply import engine
from app.companies import questions as qmod
from app.core.db import APPLICATIONS, JOBS, TRUST_DOCUMENTS, TRUST_WORK_PREFS, USERS
from app.core.time import now
from app.trust import knockout as K
from app.trust import retention as R
from app.trust import screening as SC
from app.trust import workprefs as W
from app.trust.agent import providers as P
from app.trust.agent import service as S
from tests.conftest import signup
from tests.jobs_helpers import add_resume
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY
from tests.test_trust_t5 import at, convo_of, make_tester, no_kick, person, reply, toggle  # noqa: F401

KO = "/api/me/trust/work"
TPL = {t["key"]: t for t in K.TEMPLATES}
NIGHT = {"text": TPL["night_shift"]["text"], "kind": "yesno", "want": "yes", "template": "night_shift"}
SQL = {"text": "How many months have you used SQL?", "kind": "number", "min": 3}
SHIFT = {
    "text": "Which shift suits you?",
    "kind": "choice",
    "options": ["Day", "Night", "Rotational"],
    "accept": ["Night", "Rotational"],
    "template": "shift",
}


async def company(client, outbox, db, tester=True, email="founder@gmail.com", site="acme.com"):
    session, cid = await verified(client, outbox, db, email=email, site=site)
    if tester:
        await make_tester(db, email)
    return session, cid


async def post(client, session, cid, qs, **over):
    return await client.post(
        f"/api/company/{cid}/jobs", json={"job": {**JOB, "questions": qs, **over}}, headers=H(session)
    )


async def candidate(make_client, outbox, db, email, name="Asha Rao", tester=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    await add_resume(c)
    if tester:
        await make_tester(db, email)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
    return c, me["id"]


# --- the model ----------------------------------------------------------------------------------------------------------


def test_knockout_model_number_choice_and_reading():
    j = {"questions": [{"id": "q1", **NIGHT}, {"id": "q2", **SQL}, {"id": "q3", **SHIFT},
                       {"id": "q4", "text": "Anything else?", "kind": "number", "min": None}]}  # fmt: skip
    kos = K.for_job(j)
    assert [(k.id, k.kind) for k in kos] == [("q1", "yesno"), ("q2", "number"), ("q3", "choice")]  # no rule: not asked
    assert K.parse_number("१२") == 12 and K.parse_number("about 6 months") == 6 and K.parse_number("౩") == 3
    assert K.parse_number("none") is None and K.parse_number(True) is None and K.parse_number(10**7) is None
    assert K.pick_option(("Day", "Night"), "2") == "Night" and K.pick_option(("Day", "Night"), "night") == "Night"
    assert K.pick_option(("Day", "Night"), "option 3") is None and K.pick_option(("Day", "Night"), "") is None
    assert (
        kos[1].fits("2") is False
        and kos[1].fits(5) is True
        and kos[2].fits("day") is False
        and kos[2].fits(1) is False
        and kos[2].fits("") is None
    )
    ans = {"q1": "no", "q2": 1, "q3": "Day"}
    assert K.not_met(kos, ans) == [NIGHT["text"], SQL["text"], SHIFT["text"]]
    assert K.reasons(kos, ans)[1] == "How many months have you used SQL? – answered 1 (needs at least 3)"
    assert qmod.not_met(qmod.parse([NIGHT, SQL])[0], {"q1": "no", "q2": 9}) == [NIGHT["text"]]
    assert {t["key"] for t in K.TEMPLATES} >= {"night_shift", "two_wheeler", "immediate", "relocate"}


def test_discriminatory_questions_refused():
    for bad in ["What is your gender?", "Male or female?", "Are you married?", "What is your religion?", "Which caste are you?",
                "What is your date of birth?", "How old are you?", "Are you pregnant?", "Planning a baby soon?",
                "Please send a photo", "Upload your selfie", "Are you a Hindu?", "Do you have a husband?"]:  # fmt: skip
        assert K.discriminatory(bad), bad
    assert K.discriminatory("Which do you prefer?", ["Boys", "Anyone"]) == "gender"  # options are checked too
    for ok in ["Can you work night shifts?", "Do you speak Telugu language?", "Can you manage a team?", "What wage do you expect?",
               "Single choice: Day or Night?", *[t["text"] for t in K.TEMPLATES]]:  # fmt: skip
        assert K.discriminatory(ok) is None, ok
    qs, errors = qmod.parse([{"text": "Are you married?", "kind": "yesno", "want": "no"}], fair=True)
    assert not qs and "marital status" in errors[0] and "aren't allowed" in errors[0]
    assert qmod.parse([{"text": "Are you married?", "kind": "yesno", "want": "no"}])[1] == []  # OFF: as before


# --- company: question CRUD ---------------------------------------------------------------------------------------------


async def test_question_crud_templates_and_limits(client, outbox, db):
    session, cid = await company(client, outbox, db)
    info = (await client.get(f"/api/company/{cid}/trust/knockouts", headers=H(session))).json()
    assert info["max"] == 8 and {t["key"] for t in info["templates"]} >= {
        "night_shift",
        "two_wheeler",
        "immediate",
        "relocate",
    }
    assert "gender" in info["patterns"] and info["labels"]["marital"] == "marital status"
    qs = [NIGHT, SQL, SHIFT] + [
        {"text": TPL[k]["text"], "kind": "yesno", "want": "yes", "template": k}
        for k in ("two_wheeler", "immediate", "relocate", "weekends", "licence")
    ]
    r = await post(client, session, cid, qs, geo={"lat": 17.4436789, "lng": 78.3779123})
    assert r.status_code == 201, r.text
    job = r.json()
    assert (
        len(job["questions"]) == 8
        and job["questions"][0]["template"] == "night_shift"
        and job["geo"] == {"lat": 17.44, "lng": 78.38}
    )
    assert job["questions"][2] == {"text": SHIFT["text"], "kind": "choice", "options": ["Day", "Night", "Rotational"], "want": "", "min": None,
                                   "accept": ["Night", "Rotational"], "template": "shift"}  # fmt: skip
    nine = await post(client, session, cid, [*qs, SQL], title="Other job")
    assert err(nine) == "invalid" and "at most 8" in nine.json()["error"]["message"]
    for bad in ({"text": "Are you married?", "kind": "yesno", "want": "no"},
                {"text": "Which suits you?", "kind": "choice", "options": ["Male", "Female"], "accept": ["Male"]},
                {"text": "Please share a recent photo", "kind": "yesno", "want": "yes"}):  # fmt: skip
        r = await post(client, session, cid, [bad], title="Another job")
        assert err(r) == "invalid" and "aren't allowed" in r.json()["error"]["message"], r.text
        chk = await client.post(
            f"/api/company/{cid}/jobs/check", json={"job": {**JOB, "questions": [bad]}}, headers=H(session)
        )
        assert "aren't allowed" in chk.json()["errors"][0]  # the Check button says it too
    # edit: change and remove questions; refused on edit as well
    url = f"/api/company/{cid}/jobs/{job['id']}"
    r = await client.put(
        url,
        json={"job": {**JOB, "questions": [SQL, {"text": "How old are you?", "kind": "number", "min": 18}]}},
        headers=H(session),
    )
    assert err(r) == "invalid" and "age" in r.json()["error"]["message"]
    r = await client.put(url, json={"job": {**JOB, "questions": [SQL], "geo": None}}, headers=H(session))
    assert (
        r.status_code == 200 and [q["text"] for q in r.json()["questions"]] == [SQL["text"]] and "geo" not in r.json()
    )
    stored = await db[JOBS].find_one({"_id": job["id"]})
    assert stored["questions"][0]["id"] == "q1" and "template" not in stored["questions"][0] and stored["geo"] is None
    bad_geo = await post(client, session, cid, [SQL], title="Far job", geo={"lat": 51.5, "lng": -0.12})
    assert err(bad_geo) == "invalid" and "India" in bad_geo.json()["error"]["message"]


async def test_switch_off_company_as_before(client, outbox, db):
    session, cid = await company(client, outbox, db, tester=False)
    assert (await client.get(f"/api/company/{cid}/trust/knockouts", headers=H(session))).status_code == 404
    six = await post(client, session, cid, [SQL] * 6)
    assert "at most 5" in six.json()["error"]["message"]
    r = await post(
        client,
        session,
        cid,
        [{"text": "Are you married?", "kind": "yesno", "want": "no"}],
        geo={"lat": 17.44, "lng": 78.38},
    )
    assert r.status_code == 201 and "geo" not in r.json()  # not refused, no pin: exactly as before while OFF
    assert "geo" not in await db[JOBS].find_one({"_id": r.json()["id"]})


# --- candidates: saved answers, never asked twice; "Not a fit for" --------------------------------------------------------


async def test_answers_reused_never_asked_twice_and_not_a_fit_label(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db)
    job = (await post(client, session, cid, [NIGHT, SQL, SHIFT])).json()
    c, uid = await candidate(make_client, outbox, db, "asha@example.com")
    r = await c.put(
        KO,
        json={
            "shifts": ["night"],
            "vehicles": ["two_wheeler"],
            "languages": ["telugu", "English", "Klingon"],
            "noticeDays": 30,
        },
    )
    assert r.status_code == 200, r.text
    p = r.json()["prefs"]
    assert p["nightShift"] is True and p["languages"] == ["Telugu", "English"] and p["vehicles"] == ["two_wheeler"]
    u = await db[USERS].find_one({"_id": uid})
    saved = u["auto_apply"]["answers"]
    assert saved[engine.norm(NIGHT["text"])] == "yes" and saved[engine.norm(TPL["two_wheeler"]["text"])] == "yes"
    assert saved[engine.norm(TPL["immediate"]["text"])] == "no" and saved[engine.norm(TPL["shift"]["text"])] == "Night"
    # the job page says what is already answered (from Work preferences): those are not asked again
    page = (await c.get(f"/api/jobs/{job['slug']}")).json()
    assert page["known"] == {"q1": "yes", "q3": "Night"}
    r = await c.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {"q2": 1}})  # only the new one
    assert r.status_code == 201, r.text
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": job["id"]})
    assert app["answers"] == {"q1": "yes", "q2": 1, "q3": "Night"} and app["status"] == "applied"
    assert app["fit"]["ok"] is False and app["fit"]["for"] == [SQL["text"]]  # a label, never a rejection
    # the SQL answer is saved too: a second job with the same question asks nothing
    job2 = (await post(client, session, cid, [{**SQL, "min": 1}, NIGHT], title="SQL Analyst")).json()
    assert (await c.get(f"/api/jobs/{job2['slug']}")).json()["known"] == {"q1": 1, "q2": "yes"}
    u = await db[USERS].find_one({"_id": uid})
    assert len((await engine.saved_answers(u, await db[JOBS].find_one({"_id": job2["id"]})))[1]) == 0  # Auto Apply too
    r = await c.post(f"/api/jobs/{job2['id']}/apply", json={"consent": True, "answers": {}})
    assert r.status_code == 201, r.text
    # changing an answer on the form wins, is saved, and updates Work preferences (night shifts)
    job3 = (await post(client, session, cid, [NIGHT], title="Night Analyst")).json()
    r = await c.post(f"/api/jobs/{job3['id']}/apply", json={"consent": True, "answers": {"q1": "no"}})
    assert r.status_code == 201
    assert (await db[TRUST_WORK_PREFS].find_one({"_id": uid}))["night_shift"] is False
    # the company sees everyone, with "Not a fit for: …"; nobody is hidden or rejected
    out = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert len(out) == 3 and all(a["status"] == "viewed" for a in out)
    by_job = {a["jobId"]: a for a in out}
    assert by_job[job["id"]]["fit"]["for"] == [SQL["text"]] and by_job[job3["id"]]["fit"]["for"] == [NIGHT["text"]]
    assert by_job[job2["id"]]["fit"]["ok"] and "for" not in by_job[job2["id"]]["fit"]
    one = (await client.get(f"/api/company/{cid}/applicants/{by_job[job['id']]['id']}", headers=H(session))).json()
    assert one["fit"]["for"] == [SQL["text"]]
    # the candidate sees their own answers (the questions, never the company's rules)
    mine = (await c.get(KO)).json()
    first = next(x for x in mine["answers"] if x["role"] == JOB["title"])
    assert {i["q"]: i["a"] for i in first["items"]} == {NIGHT["text"]: "yes", SQL["text"]: 1, SHIFT["text"]: "Night"}
    assert "min" not in str(mine["answers"]) and "accept" not in str(mine["answers"])
    # forgetting a saved answer: it is asked again
    key = engine.norm(SQL["text"])
    assert key in {s["key"] for s in mine["saved"]}
    assert key not in {s["key"] for s in (await c.delete(f"{KO}/saved/{key}")).json()["saved"]}
    for j in (job, job2, job3):  # 3 live jobs at most
        await client.post(f"/api/company/{cid}/jobs/{j['id']}/status", json={"status": "closed"}, headers=H(session))
    r = await post(client, session, cid, [SQL], title="BI Analyst")
    assert r.status_code == 201, r.text
    job4 = r.json()
    assert (await c.get(f"/api/jobs/{job4['slug']}")).json()["known"] == {}
    bad = await c.post(f"/api/jobs/{job4['id']}/apply", json={"consent": True, "answers": {}})
    assert err(bad) == "answers"


async def test_switch_off_candidate_apply_unchanged(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db, tester=False)
    job = (await post(client, session, cid, [{**NIGHT, "template": ""}, SQL])).json()
    c, uid = await candidate(make_client, outbox, db, "real@example.com", tester=False)
    assert (await c.get(KO)).status_code == 404 and (await c.put(KO, json={"shifts": ["night"]})).status_code == 404
    await db[USERS].update_one({"_id": uid}, {"$set": {f"auto_apply.answers.{engine.norm(NIGHT['text'])}": "yes"}})
    page = (await c.get(f"/api/jobs/{job['slug']}")).json()
    assert "known" not in page and len(page["questions"]) == 2
    r = await c.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {"q2": 5}})
    assert err(r) == "answers"  # asked as before: nothing filled in while OFF
    r = await c.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {"q1": "no", "q2": 5}})
    assert r.status_code == 201
    app = await db[APPLICATIONS].find_one({"user_id": uid})
    assert app["fit"] == {"ok": False, "reasons": [f"{NIGHT['text']} – answered no"]}  # no "for" while OFF
    out = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert "for" not in out[0]["fit"]


# --- the calling agent asks number / choice questions and skips what it knows ------------------------------------------------


async def test_agent_asks_number_and_choice_and_skips_known(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db)
    job = (await post(client, session, cid, [NIGHT, SQL, SHIFT])).json()
    jid = job["id"]
    await db["settings"].update_one({"_id": "site"}, {"$set": {"trust.agent.min_score": 0}}, upsert=True)
    c, uid = await person(make_client, outbox, db, "asha@example.com", "98765 43210")
    assert (await c.put(KO, json={"nightShift": True})).status_code == 200  # answers q1 for every job
    await toggle(client, session, cid, jid)
    await S.run(db, t=at(), force=True)
    cv = await convo_of(db, uid, jid)
    phone = "919876543210"
    assert await reply(client, phone, payload=f"nm7:{cv['_id']}:interested", text="Interested") == ["interested"]
    q = P.SENT[-1]
    assert (
        "Question 2 of 3" in q["text"] and "SQL" in q["text"] and "number" in q["text"] and not q.get("buttons")
    )  # q1 skipped
    assert (await convo_of(db, uid, jid))["answers"] == {"q1": "yes"}
    assert await reply(client, phone, text="no idea") == ["unclear"]
    assert await reply(client, phone, text="about १२ months") == ["answered"]
    q = P.SENT[-1]
    assert "Question 3 of 3" in q["text"] and "1. Day" in q["text"]
    assert [b[1] for b in q["buttons"]] == ["Day", "Night", "Rotational"] and q["buttons"][1][
        0
    ] == f"nm7:{cv['_id']}:opt:2"
    assert await reply(client, phone, payload=f"nm7:{cv['_id']}:opt:1", text="Day") == ["answered"]
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jid})
    assert app["origin"] == "agent" and app["answers"] == {"q1": "yes", "q2": 12, "q3": "Day"}
    assert app["fit"]["ok"] is False and app["fit"]["for"] == [SHIFT["text"]] and app["status"] == "applied"
    assert (await convo_of(db, uid, jid))["state"] == "not_fit"
    u = await db[USERS].find_one({"_id": uid})
    assert u["auto_apply"]["answers"][engine.norm(SQL["text"])] == 12  # saved for later jobs
    assert (await db[TRUST_WORK_PREFS].find_one({"_id": uid}))["shifts"] == ["day"]  # the template answer updates prefs
    # the call script leaves out what is known and says the choices
    j = await db[JOBS].find_one({"_id": jid})
    script = S.call_script(cv, j, u, {}, [], set(await W.known_answers(db, uid, j)))
    assert script["question_ids"] == []  # all three are known now: a call would ask none of them
    full = S.call_script(cv, j, u, {}, [])
    assert full["question_kinds"] == ["yesno", "number", "choice"] and "Day, Night, Rotational" in full["questions"][2]
    assert "a number" in full["questions"][1]


# --- Hire now: verified non-tech filters -----------------------------------------------------------------------------------


async def ready_person(make_client, outbox, db, email, name, prefs=None, pin=None, **over):
    c, uid = await candidate(make_client, outbox, db, email, name)
    r = await c.put("/api/me/hire", json={**READY, **over})
    assert r.status_code == 200, r.text
    if prefs is not None:
        assert (await c.put(KO, json=prefs)).status_code == 200
    if pin:
        assert (await c.post(f"/api/me/trust/consents/{W.PURPOSE}")).json()["status"] == "granted"
        r = await c.put(f"{KO}/location", json=pin)
        assert r.status_code == 200, r.text
    return c, uid


async def dl(db, uid, classes, test=False, review="none"):
    await db[TRUST_DOCUMENTS].insert_one({"user_id": uid, "kind": "dl", "doc_type": "DRVLC", "fields": {"classes": classes, "valid_until": ""},
                                          "review": {"status": review, "reasons": []}, "verify_until": now() + timedelta(days=200),
                                          "fetched_at": now(), "created_at": now(), "test": test, "name_match": "match"})  # fmt: skip


async def test_hire_now_non_tech_filters_sources_counts_and_no_coordinates(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db)
    job = (await post(client, session, cid, [], geo={"lat": 17.4483, "lng": 78.3915})).json()["id"]  # Hitech City
    _, asha = await ready_person(
        make_client,
        outbox,
        db,
        "asha@example.com",
        "Asha Rao",
        {"shifts": ["night"], "vehicles": ["two_wheeler"], "languages": ["Telugu", "English"], "availableNow": True},
        {"lat": 17.4612345, "lng": 78.3654321},
    )  # ~2 km away (both rounded)
    _, bala = await ready_person(
        make_client,
        outbox,
        db,
        "bala@example.com",
        "Bala Krishnan",
        {"shifts": ["day"], "vehicles": [], "languages": ["Hindi"], "noticeDays": 30},
        {"city": "Secunderabad"},
        noticeDays=30,
    )
    _, chitra = await ready_person(
        make_client, outbox, db, "chitra@example.com", "Chitra M", joinDate=""
    )  # no preferences, no notice
    await dl(db, asha, ["MCWG", "LMV"])
    await dl(db, bala, ["LMV-NT"])
    await dl(db, chitra, ["MCWG"], review="open")  # under review: no verified badge

    async def get(**q):
        r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job, **q}, headers=H(session))
        assert r.status_code == 200, r.text
        return r.json()

    out = await get()
    assert out["available"] == 3 and out["nonTech"]["counts"]["licence"] == 2
    rows = {x["key"]: x["nonTech"] for x in out["items"]}
    a, b, ch = rows[asha], rows[bala], rows[chitra]
    assert (
        a["licence"]["source"] == "verified"
        and a["licence"]["kinds"] == ["two-wheeler", "LMV (car)"]
        and a["licence"]["via"] == "DigiLocker"
    )
    assert b["licence"]["kinds"] == ["LMV (car)"] and ch["licence"] is None
    assert (
        a["vehicles"] == {"value": ["two_wheeler"], "source": "self-declared"}
        and b["vehicles"]["value"] == []
        and ch["vehicles"] is None
    )
    assert (
        a["shifts"]["nightShift"] is True
        and a["shifts"]["source"] == "self-declared"
        and b["shifts"]["nightShift"] is False
    )
    assert a["distance"]["text"] == "~2 km" and a["distance"]["source"] == "self-declared" and ch["distance"] is None
    assert b["distance"]["km"] >= 10 and b["distance"]["text"].startswith("~")
    assert a["languages"] == [
        {"name": "Telugu", "source": "self-declared"},
        {"name": "English", "source": "self-declared"},
    ]
    assert a["immediate"] == {"value": True, "source": "self-declared"} and b["immediate"]["value"] is False
    assert ch["immediate"]["value"] is True  # no preference: the Ready to join notice (0 days in READY)
    blob = str(out)
    assert (
        "17.46" not in blob and "78.36" not in blob and "17.44" not in blob and "lat" not in blob
    )  # never coordinates
    # each filter
    keys = lambda o: sorted(x["key"] for x in o["items"])  # noqa: E731
    assert keys(await get(licence="two_wheeler")) == [asha]
    assert keys(await get(licence="lmv")) == sorted([asha, bala])
    assert keys(await get(licence="any")) == sorted([asha, bala])
    assert keys(await get(vehicle="two_wheeler")) == [asha] and keys(await get(vehicle="any")) == [asha]
    assert keys(await get(nightShift="true")) == [asha] and keys(await get(shift="day")) == [bala]
    assert keys(await get(maxKm=5)) == [asha] and keys(await get(maxKm=50)) == sorted([asha, bala])
    assert keys(await get(lang="hindi")) == [bala] and keys(await get(lang="Telugu")) == [asha]
    assert keys(await get(immediate="true")) == sorted([asha, chitra])
    # combined, and the counts follow the other filters
    both = await get(licence="lmv", immediate="true")
    assert keys(both) == [asha] and both["available"] == 1
    cnt = both["nonTech"]["counts"]
    assert cnt["licence"] == 1 and cnt["immediate"] == 1 and cnt["maxKm"] == 1 and cnt["lang"] is None
    assert keys(await get(licence="lmv", lang="Hindi", maxKm=5)) == []
    only = (await get(immediate="true"))["nonTech"]["counts"]
    assert (
        only["licence"] == 1 and only["vehicle"] == 1 and only["immediate"] == 2
    )  # with the licence filter on: 1 of 2
    assert (await get(lang="Hindi"))["nonTech"]["counts"]["lang"] == 1


async def test_hire_now_off_unchanged_and_test_documents(client, outbox, db, make_client, monkeypatch):
    session, cid = await company(client, outbox, db, tester=False)
    job = (await post(client, session, cid, [])).json()["id"]
    _, asha = await ready_person(make_client, outbox, db, "asha@example.com", "Asha Rao", {"vehicles": ["two_wheeler"]})
    await dl(db, asha, ["MCWG"], test=True)
    out = (
        await client.get(
            f"/api/company/{cid}/hire/shortlist", params={"job": job, "licence": "lmv"}, headers=H(session)
        )
    ).json()
    assert (
        "nonTech" not in out and "nonTech" not in out["items"][0] and out["available"] == 1
    )  # filters ignored while OFF
    assert SC.vehicle_kinds(["MCWOG", "HGMV"]) == {"twoWheeler": True, "lmv": False, "heavy": True}
    # on production a test-provider licence is never shown to a real company
    from app.core.config import get_settings

    await make_tester(db, "founder@gmail.com")
    monkeypatch.setattr(type(get_settings()), "is_prod", property(lambda s: True))
    rows = [{"key": asha, "availability": {}}]
    await SC.attach(db, rows, await db[JOBS].find_one({"_id": job}), {"_id": cid})
    assert rows[0]["nonTech"]["licence"] is None
    await SC.attach(db, rows, await db[JOBS].find_one({"_id": job}), {"_id": cid, "demo": True})
    assert rows[0]["nonTech"]["licence"]["test"] is True


# --- distance and the location consent ---------------------------------------------------------------------------------------


def test_distance_rounding_and_points():
    assert W.coarse(17.4612345, 78.3654321) == (17.46, 78.37)
    for lat, lng in ((51.5, -0.1), (40.7, -74.0)):
        try:
            W.coarse(lat, lng)
            raise AssertionError("outside India must be refused")
        except ValueError:
            pass
    assert [W.rounded_km(x) for x in (0.2, 3.4, 9.6, 12, 23, 48, 51, 137)] == [1, 3, 10, 10, 25, 50, 50, 140]
    assert W.distance_text(4.2) == "~4 km"
    hyd, sec = W.city_point("Hyderabad"), W.city_point("secunderabad")
    assert hyd and sec and 4 < W.distance_km(hyd, sec) < 8
    assert W.city_point("Bangalore") == W.CITY_COORDS["Bengaluru"] and W.city_point("Atlantis") is None
    assert W.job_point({"remote": True, "locations": ["Pune"]}) is None
    assert W.job_point({"locations": ["Pune, Maharashtra"]}) == W.CITY_COORDS["Pune"]
    assert W.job_point({"locations": ["Pune"], "geo": {"lat": 18.5, "lng": 73.9}}) == (18.5, 73.9)


async def test_location_consent_required_withdrawal_and_retention(client, outbox, db, make_client):
    c, uid = await candidate(make_client, outbox, db, "asha@example.com")
    r = await c.put(f"{KO}/location", json={"lat": 17.4612345, "lng": 78.3654321})
    assert r.status_code == 403 and err(r) == "consent_needed"
    state = (await c.get(KO)).json()
    assert (
        state["locationConsent"] is False
        and "rounded to about 1 km" in state["consentText"]
        and "365 days" in state["consentText"]
    )
    assert (await c.post(f"/api/me/trust/consents/{W.PURPOSE}")).json()["status"] == "granted"
    assert err(await c.put(f"{KO}/location", json={"lat": 51.5, "lng": -0.12})) == "outside"
    assert err(await c.put(f"{KO}/location", json={"city": "Atlantis"})) == "unknown_city"
    r = await c.put(f"{KO}/location", json={"lat": 17.4612345, "lng": 78.3654321})
    assert (
        r.status_code == 200
        and r.json()["prefs"]["location"]["label"].startswith("Near ")
        and "lat" not in str(r.json())
    )
    row = await db[TRUST_WORK_PREFS].find_one({"_id": uid})
    assert row["location"]["lat"] == 17.46 and row["location"]["lng"] == 78.37  # only the rounded pin is stored
    # withdrawing the consent deletes the pin now (the preferences stay)
    await c.put(KO, json={"languages": ["Hindi"]})
    out = (await c.delete(f"/api/me/trust/consents/{W.PURPOSE}")).json()
    assert out["status"] == "withdrawn" and out["deleted"] == 1
    row = await db[TRUST_WORK_PREFS].find_one({"_id": uid})
    assert "location" not in row and row["languages"] == ["Hindi"]
    assert err(await c.put(f"{KO}/location", json={"city": "Hyderabad"})) == "consent_needed"
    # removing it by hand, and the retention job after 365 days
    await c.post(f"/api/me/trust/consents/{W.PURPOSE}")
    await c.put(f"{KO}/location", json={"city": "Hyderabad"})
    assert (await c.delete(f"{KO}/location")).json()["prefs"]["location"] is None
    await c.put(f"{KO}/location", json={"city": "Hyderabad"})
    assert R.TYPES["location"].purpose == W.PURPOSE and R.TYPES["location"].days == 365
    n = await R.clean_type(db, R.TYPES["location"], 365, now() + timedelta(days=366))
    assert n == 1 and "location" not in await db[TRUST_WORK_PREFS].find_one({"_id": uid})
    # the account erase removes the preferences
    await R.erase_user(db, uid)
    assert await db[TRUST_WORK_PREFS].find_one({"_id": uid}) is None
