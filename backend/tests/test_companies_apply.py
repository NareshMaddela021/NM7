"""Phase 2 C5: apply on Nm7 into the company dashboard: knockout questions (rules never shown to students, "Not a fit"
is only a label, never deleted), consent on apply, ranked applicants with match reasons, contact details only after
shortlisting, stage changes the student sees, interviews with a calendar file, the talent pool, withdrawing, other
companies can't see them, and removal from the company's view after 12 months."""

from datetime import timedelta

from app.companies import applicants as apps_mod
from app.companies import questions
from app.core.db import APPLICATIONS, TALENT_POOL
from app.core.time import now
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401

QUESTIONS = [
    {"text": "Can you work from Hyderabad?", "kind": "yesno", "want": "yes"},
    {"text": "How many months have you used SQL?", "kind": "number", "min": 3},
    {
        "text": "Which shift suits you?",
        "kind": "choice",
        "options": ["Day", "Night", "Either"],
        "accept": ["Day", "Either"],
    },
]


def test_question_rules():
    qs, errors = questions.parse(QUESTIONS)
    assert not errors and [q["id"] for q in qs] == ["q1", "q2", "q3"]
    assert questions.public(qs)[2] == {
        "id": "q3",
        "text": "Which shift suits you?",
        "kind": "choice",
        "options": ["Day", "Night", "Either"],
    }
    assert "want" not in questions.public(qs)[0] and "min" not in questions.public(qs)[1]
    ok, problems = questions.answers_for(qs, {"q1": "Yes", "q2": "12", "q3": "either"})
    assert not problems and ok == {"q1": "yes", "q2": 12, "q3": "Either"}
    assert questions.knockout(qs, ok) == []
    bad, _ = questions.answers_for(qs, {"q1": "no", "q2": 1, "q3": "Night"})
    assert len(questions.knockout(qs, bad)) == 3
    assert questions.answers_for(qs, {"q1": "maybe"})[1][0] == "Answer: Can you work from Hyderabad?"
    assert questions.parse([{"text": "Pick one please", "kind": "choice", "options": ["A"]}])[1] == [
        "Question 1: A choice question needs at least 2 options."
    ]
    assert questions.parse([QUESTIONS[0]] * 6)[1] == ["Ask at most 5 questions."]


async def company_job(client, outbox, db, **over):
    session, cid = await verified(client, outbox, db)
    r = await client.post(
        f"/api/company/{cid}/jobs", json={"job": {**JOB, "questions": QUESTIONS, **over}}, headers=H(session)
    )
    assert r.status_code == 201, r.text
    return session, cid, r.json()


async def student(make_client, outbox, email, name, data=None):
    c = make_client()
    await signup(c, outbox, email=email, name=name)
    await add_resume(c, data=data)
    return c


async def test_questions_on_jobs(client, outbox, db):
    session, cid = await verified(client, outbox, db)
    url = f"/api/company/{cid}/jobs"
    bad = await client.post(
        url,
        json={"job": {**JOB, "questions": [{"text": "Pick one", "kind": "choice", "options": ["A"]}]}},
        headers=H(session),
    )
    assert err(bad) == "invalid" and "2 options" in bad.json()["error"]["message"]
    q = {"text": "Male preferred, are you okay with that?", "kind": "yesno", "want": "yes"}
    unfair = await client.post(url, json={"job": {**JOB, "questions": [q]}}, headers=H(session))
    assert err(unfair) == "unfair_wording"  # questions are checked like the description
    job = (
        await client.post(
            url, json={"job": {**JOB, "title": "SQL Analyst", "questions": QUESTIONS}}, headers=H(session)
        )
    ).json()
    assert job["questions"][1] == {
        "text": "How many months have you used SQL?",
        "kind": "number",
        "options": [],
        "want": "",
        "min": 3,
        "accept": [],
    }
    page = (await client.get(f"/api/jobs/{job['slug']}")).json()
    assert page["consent"] is True and [q["id"] for q in page["questions"]] == ["q1", "q2", "q3"]
    assert all("want" not in q and "min" not in q and "accept" not in q for q in page["questions"])


async def test_apply_rank_stage_interview_pool_withdraw_and_removal(client, outbox, db, make_client):
    session, cid, job = await company_job(client, outbox, db)
    url = f"/api/jobs/{job['id']}/apply"
    good = await student(
        make_client,
        outbox,
        "asha@example.com",
        "Asha Rao",
        resume(
            personal={
                "name": "Asha Rao",
                "email": "asha@example.com",
                "phone": "+91 90000 11111",
                "location": "Hyderabad",
            }
        ),
    )
    weak = await student(
        make_client,
        outbox,
        "bala@example.com",
        "Bala K",
        resume(
            skillGroups=[{"id": "c", "label": "Core", "value": "Excel"}],
            proj=[],
            exp=[],
            personal={"name": "Bala K", "email": "bala@example.com", "location": "Pune"},
        ),
    )
    # consent and every answer are needed
    assert err(await good.post(url, json={"answers": {"q1": "yes", "q2": 12, "q3": "Day"}})) == "consent"
    r = await good.post(url, json={"consent": True, "answers": {"q1": "yes"}})
    assert err(r) == "answers" and len(r.json()["error"]["problems"]) == 2
    assert (
        await good.post(url, json={"consent": True, "answers": {"q1": "yes", "q2": 12, "q3": "Day"}})
    ).status_code == 201
    assert (
        await weak.post(url, json={"consent": True, "answers": {"q1": "no", "q2": 0, "q3": "Night"}})
    ).status_code == 201
    # ranked: the fit first; "Not a fit" is a label with the reasons, never removed; contact hidden until shortlisted
    out = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()
    assert [x["name"] for x in out["items"]] == ["Asha Rao", "Bala K"]
    first, last = out["items"]
    assert first["fit"]["ok"] and first["match"]["score"] > (last["match"] or {}).get("score", 0)
    assert "SQL" in first["match"]["found"]
    assert last["fit"]["ok"] is False and len(last["fit"]["reasons"]) == 3
    assert {"q": "Which shift suits you?", "a": "Night"} in last["answers"]
    assert first["contact"] is None and first["status"] == "viewed"
    assert out["jobs"][0]["count"] == 2 and out["keepMonths"] == 12
    st = (await good.get("/api/me/state")).json()["apps"]
    assert [a["status"] for a in st if a.get("jobId") == job["id"]] == ["viewed"]
    one = (await client.get(f"/api/company/{cid}/applicants/{first['id']}", headers=H(session))).json()
    assert one["data"]["personal"]["email"] == "" and one["data"]["personal"]["phone"] == ""
    # shortlist: contact details show; the student sees it
    r = await client.post(
        f"/api/company/{cid}/applicants/{first['id']}/status", json={"status": "shortlisted"}, headers=H(session)
    )
    assert r.json() == {"status": "shortlisted"}
    one = (await client.get(f"/api/company/{cid}/applicants/{first['id']}", headers=H(session))).json()
    assert one["contact"] == {"email": "asha@example.com", "phone": "+91 90000 11111"}
    assert one["data"]["personal"]["phone"] == "+91 90000 11111"
    st = (await good.get("/api/me/state")).json()["apps"]
    assert [a["status"] for a in st if a.get("jobId") == job["id"]] == ["shortlisted"]
    # interview: the student is emailed a calendar file
    day = (now() + timedelta(days=3)).date().isoformat()
    r = await client.post(
        f"/api/company/{cid}/applicants/{first['id']}/interview",
        json={"date": day, "time": "11:00", "minutes": 45, "link": "https://meet.example.com/x"},
        headers=H(session),
    )
    assert r.json()["status"] == "interview" and r.json()["emailed"] is True
    mail = outbox.sent[-1]
    assert mail.to == "asha@example.com" and mail.attachments[0][0] == "interview.ics"
    assert b"BEGIN:VEVENT" in mail.attachments[0][2]
    assert (
        err(
            await client.post(
                f"/api/company/{cid}/applicants/{first['id']}/interview",
                json={"date": day, "time": "11:00"},
                headers=H(session),
            )
        )
        == "where"
    )
    # the talent pool
    await client.put(
        f"/api/company/{cid}/applicants/{first['id']}/pool", json={"on": True, "note": "Strong SQL"}, headers=H(session)
    )
    pool = (await client.get(f"/api/company/{cid}/pool", headers=H(session))).json()
    assert pool[0]["name"] == "Asha Rao" and pool[0]["note"] == "Strong SQL"
    # another company can't see them
    other, ocid = await verified(client, outbox, db, email="priya@gmail.com")  # a second company
    assert (await client.get(f"/api/company/{ocid}/applicants", headers=H(other))).json()["items"] == []
    assert (await client.get(f"/api/company/{ocid}/applicants/{first['id']}", headers=H(other))).status_code == 404
    assert (await client.get(f"/api/company/{cid}/applicants", headers=H(other))).status_code in (403, 404)
    # the student withdraws: gone from the company's view
    key = [a for a in (await weak.get("/api/me/state")).json()["apps"] if a.get("jobId") == job["id"]][0]["id"]
    assert (await weak.post(f"/api/me/applications/{key}/withdraw")).json() == {"withdrawn": True}
    assert [
        x["name"] for x in (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    ] == ["Asha Rao"]
    # 12 months on: removed from the company's view, with the pool entry; the student keeps their record
    await db[APPLICATIONS].update_many({"job_id": job["id"]}, {"$set": {"created_at": now() - timedelta(days=380)}})
    assert await apps_mod.remove_old(db) == 1
    assert (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"] == []
    assert await db[TALENT_POOL].count_documents({"company_id": cid}) == 0
    assert any(a.get("jobId") == job["id"] for a in (await good.get("/api/me/state")).json()["apps"])
