# ruff: noqa: E501
"""Vetting Trust T7: a job's description → 5–10 criteria (strict schema + rules fallback, cached per JD version,
editable, unfair ones refused), each candidate Met / Not met / Unknown with a quote that must be word for word in its
source (else Unknown), an anonymised AI prompt, instant re-sort without re-evaluating unchanged criteria, never an
automatic rejection, the AI allowance counted, consent + withdrawal + retention, the candidate's own view with evidence
they add (counted only after Nm7 checks it), and switch OFF isolation."""

from datetime import timedelta

from app.core import ai_quota, claude
from app.core.db import (
    APPLICATIONS,
    CERTIFICATES,
    TRUST_CRITERIA,
    TRUST_CRITERIA_CLAIMS,
    TRUST_CRITERIA_EVALS,
    TRUST_CRITERIA_QUEUE,
    VETTING_VERIFIED,
)
from app.core.time import now
from app.trust import retention as R
from app.trust.criteria import evaluate as EV
from app.trust.criteria import evidence as E
from app.trust.criteria import extract as X
from tests.conftest import signup
from tests.jobs_helpers import add_resume, mock_claude, reply, resume
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY
from tests.test_trust_t5 import make_tester

CRIT = "/api/company/{cid}/trust/criteria/{jid}"
ME = "/api/me/trust/criteria"
TALLY = resume(
    personal={
        "name": "Asha Rao",
        "headline": "Accountant · Tally · GST",
        "email": "asha.rao@example.com",
        "phone": "+91 98480 22338",
        "location": "Kukatpally, Hyderabad",
        "dob": "12/04/1999",
    },  # fmt: skip
    summary="Female accountant, born on 12/04/1999, aged 27. Asha Rao loves numbers. Mail asha.rao@example.com or call 9848022338.",
    exp=[
        {
            "company": "Sri Lakshmi Traders",
            "role": "Tally accountant",
            "from": "2022-01",
            "to": "",
            "current": True,
            "description": "Kept the books in Tally ERP 9 for 40 shops\nFiled monthly GST returns",
        }
    ],  # fmt: skip
    edu=[{"institution": "Osmania University College for Women", "degree": "B.Com", "field": "Commerce", "to": "2021"}],
    skillGroups=[{"id": "core", "label": "Core", "value": "Tally, GST, Excel"}],
    proj=[],
    certs=[],
    langs=[{"name": "Telugu"}, {"name": "English"}],
)
EXCEL = resume(
    personal={"name": "Bala Krishnan", "headline": "MIS executive", "email": "bala@example.com"},
    summary="MIS executive who builds Excel reports.",
    exp=[
        {
            "company": "Orbit Retail",
            "role": "MIS executive",
            "from": "2025-06",
            "to": "",
            "current": True,
            "description": "Built daily sales reports in Excel with pivot tables",
        }
    ],  # fmt: skip
    edu=[{"institution": "Govt Polytechnic Guntur", "degree": "Diploma", "field": "Commerce", "to": "2024"}],
    skillGroups=[{"id": "core", "label": "Core", "value": "Excel, MIS"}],
    proj=[],
    certs=[],
    langs=[{"name": "Hindi"}],
)
ACCT = {**JOB, "title": "Accountant", "experience": "1_3", "education": "graduate", "skills": ["Tally", "GST", "Excel"],
        "description": "Keep the books in Tally and file GST returns for our 40 shops. Telugu speakers preferred. "
                       "Must handle customer complaints calmly."}  # fmt: skip


async def company(client, outbox, db, tester=True, email="founder@gmail.com", site="acme.com"):
    session, cid = await verified(client, outbox, db, email=email, site=site)
    if tester:
        await make_tester(db, email)
    return session, cid


async def post_job(client, session, cid, **over):
    r = await client.post(f"/api/company/{cid}/jobs", json={"job": {**ACCT, **over}}, headers=H(session))
    assert r.status_code == 201, r.text
    return r.json()


async def candidate(make_client, outbox, db, email, name, data, tester=True, consent=True):
    c = make_client()
    me = await signup(c, outbox, email=email, name=name)
    await add_resume(c, data=data)
    if tester:
        await make_tester(db, email)
        assert (await c.post("/api/me/trust/age", json={"dob": "1999-04-12"})).status_code == 200
        if consent:
            r = await c.post(f"/api/me/trust/consents/{EV.PURPOSE}")
            assert r.json()["status"] == "granted", r.text
    return c, me["id"]


async def apply(c, job):
    r = await c.post(f"/api/jobs/{job['id']}/apply", json={"consent": True, "answers": {}})
    assert r.status_code == 201, r.text


async def put(client, session, cid, jid, items):
    return await client.put(CRIT.format(cid=cid, jid=jid), json={"items": items}, headers=H(session))


def by_text(strip):
    return {x["text"]: x for x in strip["items"]}


# --- extraction -------------------------------------------------------------------------------------------------------


def test_schemas_strict_rules_fallback_and_unfair_ones_dropped():
    assert claude.schema_problems(X.SCHEMA) == [] and claude.schema_problems(EV.SCHEMA) == []
    j = {**ACCT, "questions": [{"id": "q1", "text": "Are you willing to work night shifts?", "kind": "yesno", "want": "yes", "template": "night_shift"}],
         "description": ACCT["description"] + " A valid driving licence and a Tally Prime certification are a plus."}  # fmt: skip
    items = X.rules(j)
    got = {(x["kind"], x["text"], x["must"]) for x in items}
    assert ("experience", "At least 1 year of experience", True) in got and (
        "education",
        "A graduate degree or higher",
        True,
    ) in got
    assert ("skill", "Tally", True) in got and ("shift", "Willing to work night shifts", True) in got
    assert ("language", "Speaks Telugu", False) in got and ("licence", "A valid driving licence", True) in got
    assert (
        any(k == "certification" and "Tally Prime" in t for k, t, _ in got)
        and ("location", "Can work in Hyderabad", False) in got
    )
    assert 1 <= len(items) <= X.MAX_ITEMS and [x["id"] for x in items] == [f"c{i}" for i in range(1, len(items) + 1)]
    assert all(x["by"] == "rules" for x in items)
    raw = [{"kind": "skill", "text": "Tally", "must": True}, {"kind": "other", "text": "Female candidates only", "must": True},
           {"kind": "education", "text": "Graduate from a top college", "must": True}, {"kind": "other", "text": "Below 30 years of age", "must": True},
           {"kind": "other", "text": "Must be Hindu", "must": False}, {"kind": "other", "text": "Send a photo", "must": False},
           {"kind": "skill", "text": " tally ", "must": False}, {"kind": "nonsense", "text": "Speaks Telugu", "must": False}]  # fmt: skip
    clean = X.clean_items(raw, "ai")
    assert [(x["kind"], x["text"]) for x in clean] == [
        ("skill", "Tally"),
        ("other", "Speaks Telugu"),
    ]  # unfair + duplicate dropped
    for ok in (
        "Speaks Telugu",
        "A graduate degree",
        "3 years of Tally",
        "Can manage a team",
        "A valid two-wheeler licence",
    ):
        assert X.unfair(ok) is None, ok
    for bad, topic in (("Male candidates", "gender"), ("IIT graduates only", "college"), ("Unmarried", "marital"), ("Age under 30", "age"),
                       ("From a tier 1 college", "college"), ("Candidate's name must match", "name"), ("OBC candidates", "caste")):  # fmt: skip
        assert X.unfair(bad) == topic, bad


async def test_ai_extraction_counted_cached_per_jd_version_edit_and_stale(client, outbox, db, monkeypatch):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    api = mock_claude(monkeypatch, X)
    calls = []

    def answer(body):
        calls.append(body)
        assert body["output_config"]["format"]["schema"]["additionalProperties"] is False  # strict
        return reply({"criteria": [{"kind": "skill", "text": "Tally ERP 9", "must": True}, {"kind": "experience", "text": "1+ years as an accountant", "must": True},
                                   {"kind": "other", "text": "Female candidates preferred", "must": False}, {"kind": "language", "text": "Speaks Telugu", "must": False},
                                   {"kind": "other", "text": "Handles customer complaints calmly", "must": False}]})  # fmt: skip

    api.replies["claude-haiku-5-5"] = answer
    url = CRIT.format(cid=cid, jid=job["id"])
    r = await client.get(url, headers=H(session))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["by"] == "ai" and [x["text"] for x in d["items"]] == [
        "Tally ERP 9",
        "1+ years as an accountant",
        "Speaks Telugu",
        "Handles customer complaints calmly",
    ]
    assert (
        "JOB>>>" in calls[0]["messages"][0]["content"][0]["text"]
        and "Keep the books in Tally" in calls[0]["messages"][0]["content"][0]["text"]
    )
    assert (await ai_quota.usage(db, 1))["days"][0]["criteria"]["calls"] == 1
    await client.get(url, headers=H(session))
    assert len(calls) == 1  # cached: the same JD
    r = await client.put(
        f"/api/company/{cid}/jobs/{job['id']}",
        json={"job": {**ACCT, "description": ACCT["description"] + " Weekend work sometimes."}},
        headers=H(session),
    )
    assert r.status_code == 200, r.text
    await client.get(url, headers=H(session))
    assert len(calls) == 2  # the JD changed: read again
    r = await put(
        client,
        session,
        cid,
        job["id"],
        [
            {"kind": "skill", "text": "Tally ERP 9", "must": False},
            {"kind": "other", "text": "Owns a laptop", "must": True},
        ],
    )
    assert r.status_code == 200, r.text
    assert r.json()["edited"] and [(x["text"], x["by"], x["must"]) for x in r.json()["items"]] == [
        ("Tally ERP 9", "ai", False),
        ("Owns a laptop", "company", True),
    ]
    r = await client.put(
        f"/api/company/{cid}/jobs/{job['id']}",
        json={"job": {**ACCT, "description": "Something else entirely about Tally."}},
        headers=H(session),
    )
    d = (await client.get(url, headers=H(session))).json()
    assert (
        len(calls) == 2 and d["stale"] and d["edited"] and len(d["items"]) == 2
    )  # the edited list is the source of truth
    api.replies["claude-haiku-5-5"] = 500  # the AI fails: the rules
    api.replies["claude-sonnet-5-5"] = 500
    d = (await client.post(f"{url}/reextract", headers=H(session))).json()
    assert d["by"] == "rules" and not d["edited"] and not d["stale"] and any(x["text"] == "Tally" for x in d["items"])
    assert (await ai_quota.usage(db, 1))["days"][0]["criteria"]["failed"] == 1


async def test_unfair_criteria_refused(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    for bad in (
        "Female candidates only",
        "Graduate from a top college",
        "Under 30 years of age",
        "Must be a Hindu",
        "Send your photo",
    ):
        r = await put(client, session, cid, job["id"], [{"kind": "other", "text": bad, "must": True}])
        assert r.status_code == 400 and r.json()["error"]["code"] == "unfair", bad
    r = await put(
        client,
        session,
        cid,
        job["id"],
        [
            {"kind": "language", "text": "Speaks Telugu", "must": True},
            {"kind": "education", "text": "A graduate degree", "must": True},
        ],
    )
    assert r.status_code == 200, r.text


async def test_switch_off_isolation(client, outbox, db, make_client):
    """A company and a candidate the switch doesn't let in: nothing new anywhere."""
    s2, cid2 = await company(client, outbox, db, tester=False)
    job2 = await post_job(client, s2, cid2, title="Accountant II")
    assert (await client.get(CRIT.format(cid=cid2, jid=job2["id"]), headers=H(s2))).status_code == 404
    c, uid = await candidate(make_client, outbox, db, "asha@example.com", "Asha Rao", TALLY, tester=False)
    await apply(c, job2)
    out = (await client.get(f"/api/company/{cid2}/applicants", params={"job": job2["id"]}, headers=H(s2))).json()
    assert "criteria" not in out and "criteria" not in out["items"][0]
    assert (await c.get(ME)).status_code == 404  # the candidate side too
    assert (
        await db[TRUST_CRITERIA].count_documents({"_id": job2["id"]}) == 0
        and await db[TRUST_CRITERIA_EVALS].count_documents({}) == 0
    )
    r = await client.post(f"{CRIT.format(cid=cid2, jid=job2['id'])}/evaluate", json={"people": [uid]}, headers=H(s2))
    assert r.status_code == 404


# --- evaluation -----------------------------------------------------------------------------------------------------------


async def test_rules_quotes_resort_without_reevaluating_and_never_reject(client, outbox, db, make_client):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    ca, asha = await candidate(make_client, outbox, db, "asha@example.com", "Asha Rao", TALLY)
    cb, bala = await candidate(make_client, outbox, db, "bala@example.com", "Bala Krishnan", EXCEL)
    await apply(cb, job)
    await apply(ca, job)
    await db[VETTING_VERIFIED].insert_one({"user_id": bala, "test": "Excel", "role": "MIS", "band": "1-3", "score": 84, "task_score": 80,
                                           "at": now(), "expires_at": now() + timedelta(days=60)})  # fmt: skip
    items = [{"kind": "skill", "text": "Tally", "must": True}, {"kind": "experience", "text": "At least 2 years of experience", "must": True},
             {"kind": "skill", "text": "Excel", "must": False}, {"kind": "education", "text": "A graduate degree", "must": False},
             {"kind": "language", "text": "Speaks Telugu", "must": False}, {"kind": "other", "text": "Handles customer complaints calmly", "must": False}]  # fmt: skip
    assert (await put(client, session, cid, job["id"], items)).status_code == 200
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    assert [x["userId"] for x in out["items"]] == [asha, bala]  # 2 must-haves met beat 0
    assert len(out["criteria"]["items"]) == 6
    a, b = (by_text(x["criteria"]) for x in out["items"])
    assert a["Tally"]["status"] == "met" and a["Tally"]["source"] == "resume" and a["Tally"]["sourceLabel"] == "Resume"
    assert "Tally" in a["Tally"]["quote"]
    assert a["At least 2 years of experience"]["status"] == "met" and a["At least 2 years of experience"][
        "quote"
    ].startswith("Tally accountant at")
    assert (
        a["A graduate degree"]["status"] == "met"
        and a["A graduate degree"]["quote"] == "Education: B.Com, Commerce, 2021"
    )  # never the college
    assert (
        a["Speaks Telugu"]["status"] == "met" and a["Handles customer complaints calmly"]["status"] == "unknown"
    )  # no evidence → Unknown
    assert b["Tally"]["status"] == "unknown" and b["Excel"]["status"] == "met" and b["Excel"]["source"] == "skill_check"
    assert b["Excel"]["quote"].startswith("Excel: Skill verified · 1–3 years · test 84/100 · practical task 80/100 on ")
    assert (
        b["At least 2 years of experience"]["status"] == "not_met"
        and "years in total" in b["At least 2 years of experience"]["note"]
    )
    assert (
        b["A graduate degree"]["status"] == "not_met"
        and b["A graduate degree"]["quote"] == "Education: Diploma, Commerce, 2024"
    )
    strip = out["items"][0]["criteria"]
    assert strip["mustMet"] == 2 and strip["mustTotal"] == 2 and strip["niceMet"] == 3 and strip["consent"]
    n = await db[TRUST_CRITERIA_EVALS].count_documents({})
    stamps = {e["_id"]: e["at"] async for e in db[TRUST_CRITERIA_EVALS].find({})}
    assert n == 12
    # the company makes Excel a must-have and Tally nice: re-sorted at once, nothing evaluated again
    items2 = [{**x, "must": x["text"] in ("Excel", "Handles customer complaints calmly")} for x in items]
    assert (await put(client, session, cid, job["id"], items2)).status_code == 200
    r = await client.post(
        f"{CRIT.format(cid=cid, jid=job['id'])}/evaluate", json={"people": [asha, bala, "nobody"]}, headers=H(session)
    )
    assert r.status_code == 200, r.text
    got = r.json()["items"]
    assert set(got) == {asha, bala}  # only people the company can see for this job
    assert got[bala]["mustMet"] == 1 and got[asha]["mustMet"] == 1 and got[asha]["niceMet"] > got[bala]["niceMet"]
    assert {e["_id"]: e["at"] async for e in db[TRUST_CRITERIA_EVALS].find({})} == stamps  # re-used, not re-evaluated
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    assert [x["userId"] for x in out["items"]] == [asha, bala]
    # a new criterion: only that one is evaluated (once per candidate)
    items3 = [*items2, {"kind": "skill", "text": "GST", "must": True}]
    assert (await put(client, session, cid, job["id"], items3)).status_code == 200
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    assert await db[TRUST_CRITERIA_EVALS].count_documents({}) == 14
    assert {e["_id"]: e["at"] async for e in db[TRUST_CRITERIA_EVALS].find({"_id": {"$in": list(stamps)}})} == stamps
    assert [x["userId"] for x in out["items"]] == [asha, bala]  # Asha: Excel + GST
    # Not met is only a label: nobody rejected, hidden or moved
    apps = [a async for a in db[APPLICATIONS].find({"job_id": job["id"]})]
    assert len(apps) == 2 and {a["status"] for a in apps} == {"viewed"} and len(out["items"]) == 2


async def test_quotes_verified_verbatim_else_unknown_and_anonymised_prompt(
    client, outbox, db, make_client, monkeypatch
):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    ca, asha = await candidate(make_client, outbox, db, "asha@example.com", "Asha Rao", TALLY)
    await apply(ca, job)
    api = mock_claude(monkeypatch, X, EV)
    prompts = []

    def answer(body):
        text = body["messages"][0]["content"][0]["text"]
        if "JOB>>>" in text:
            return reply({"criteria": [{"kind": "other", "text": "Handles customer complaints calmly", "must": True},
                                       {"kind": "other", "text": "Has worked with 40 shops", "must": False},
                                       {"kind": "other", "text": "Has managed a team of five", "must": False},
                                       {"kind": "skill", "text": "Tally", "must": True}]})  # fmt: skip
        prompts.append(text)
        return reply({"results": [
            {"id": "r1", "status": "met", "source": "resume", "quote": "3 years handling angry customers calmly"},  # made up
            {"id": "r2", "status": "met", "source": "resume", "quote": "Kept the books in Tally ERP 9 for 40 shops"},  # real
            {"id": "r3", "status": "met", "source": "interview", "quote": "Kept the books in Tally ERP 9 for 40 shops"},  # wrong source
        ]})  # fmt: skip

    api.replies["claude-haiku-5-5"] = answer
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    s = by_text(out["items"][0]["criteria"])
    assert s["Tally"]["status"] == "met" and s["Tally"]["by"] == "rules"  # the rules answered: no AI
    assert all(
        s[t]["pending"]
        for t in ("Handles customer complaints calmly", "Has worked with 40 shops", "Has managed a team of five")
    )
    assert out["items"][0]["criteria"]["pending"] == 3 and await db[TRUST_CRITERIA_QUEUE].count_documents({}) == 3
    r = await client.post(f"{CRIT.format(cid=cid, jid=job['id'])}/run", headers=H(session))
    assert (
        r.status_code == 200 and r.json()["calls"] == 1 and r.json()["pending"] == 0
    )  # one call for the candidate's 3
    assert (await ai_quota.usage(db, 1))["days"][0]["criteria"]["calls"] == 2  # the extraction and one evaluation
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    s = by_text(out["items"][0]["criteria"])
    assert (
        s["Handles customer complaints calmly"]["status"] == "unknown"
        and s["Handles customer complaints calmly"]["note"] == "No exact quote found"
    )
    assert s["Has worked with 40 shops"]["status"] == "met" and s["Has worked with 40 shops"]["by"] == "ai"
    assert s["Has worked with 40 shops"]["quote"] == "Kept the books in Tally ERP 9 for 40 shops"
    assert s["Has managed a team of five"]["status"] == "unknown"  # the quote isn't in the interview (there is none)
    assert not any(x["pending"] for x in s.values()) and len(prompts) == 1
    # the AI never saw the person's name, email, phone, address, date of birth, age, gender or college
    p = prompts[0]
    for secret in (
        "Asha",
        "Rao",
        "asha.rao@example.com",
        "98480",
        "9848022338",
        "Kukatpally",
        "12/04/1999",
        "1999",
        "aged 27",
        "Female",
        "Osmania",
        "College for Women",
    ):
        assert secret.lower() not in p.lower(), secret
    assert (
        "Kept the books in Tally ERP 9 for 40 shops" in p
        and "Education: B.Com, Commerce, 2021" in p
        and "[removed]" in p
    )
    # unit: verify
    b = E.Bundle("u", lines={"resume": ["3 years as a Tally accountant at Sri Lakshmi Traders"]})
    assert (
        EV.verify({"status": "met", "source": "resume", "quote": "3 years as a Tally accountant"}, b)["status"] == "met"
    )
    assert (
        EV.verify({"status": "met", "source": "resume", "quote": "“3  years as a Tally accountant”"}, b)["status"]
        == "met"
    )
    assert (
        EV.verify({"status": "met", "source": "resume", "quote": "4 years as a Tally accountant"}, b)["status"]
        == "unknown"
    )
    assert (
        EV.verify({"status": "not_met", "source": "prefs", "quote": "3 years as a Tally accountant"}, b)["status"]
        == "unknown"
    )
    assert EV.verify({"status": "met", "source": "resume", "quote": ""}, b)["status"] == "unknown"
    assert EV.verify({"status": "met", "source": "made_up", "quote": "3 years"}, b)["status"] == "unknown"


def test_anonymiser_best_effort():
    scrub = E.anonymiser("Asha Rani Rao", "asha@x.in", "+91 98480 22338", ["Osmania University", "Kukatpally"])
    s = scrub("Mrs Asha R. Rao (asha@x.in, 98480-22338), born on 12 April 1999, 27 years old, female, married, Hindu. "
              "Studied at St. Joseph's College of Commerce and IIT Madras. Lives in Kukatpally. https://linkedin.com/in/asha-rao "
              "Uses MS Excel and Tally.")  # fmt: skip
    for gone in (
        "Asha",
        "Rao",
        "asha@x.in",
        "98480",
        "1999",
        "27 years old",
        "female",
        "married",
        "Hindu",
        "Joseph",
        "IIT",
        "Kukatpally",
        "linkedin",
        "Mrs",
    ):
        assert gone.lower() not in s.lower(), (gone, s)
    assert "MS Excel and Tally" in s


async def test_consent_withdraw_retention_candidate_view_and_added_evidence(
    client, outbox, db, make_client, admin_client
):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    ca, asha = await candidate(make_client, outbox, db, "asha@example.com", "Asha Rao", TALLY)
    cn, nina = await candidate(make_client, outbox, db, "nina@example.com", "Nina Shah", EXCEL, consent=False)
    await apply(ca, job)
    await apply(cn, job)
    items = [
        {"kind": "certification", "text": "Tally Prime certification", "must": True},
        {"kind": "skill", "text": "Tally", "must": True},
    ]
    assert (await put(client, session, cid, job["id"], items)).status_code == 200
    out = (await client.get(f"/api/company/{cid}/applicants", params={"job": job["id"]}, headers=H(session))).json()
    rows = {x["userId"]: x["criteria"] for x in out["items"]}
    assert rows[nina]["consent"] is False and {x["status"] for x in rows[nina]["items"]} == {"unknown"}
    assert rows[nina]["items"][0]["note"] == "Not agreed to matching yet"
    assert await db[TRUST_CRITERIA_EVALS].count_documents({"user_id": nina}) == 0  # nothing stored without consent
    # the candidate sees what they were checked on, with their own evidence only
    d = (await ca.get(ME)).json()
    assert d["consent"] and len(d["applications"]) == 1 and d["applications"][0]["jobId"] == job["id"]
    mine = by_text(d["applications"][0])
    assert mine["Tally"]["status"] == "met" and mine["Tally Prime certification"]["status"] == "unknown"
    assert "Nina" not in str(d) and "Excel reports" not in str(d)
    # adding evidence: a certificate from the wallet; it counts only after Nm7 checks it
    cert_id = "cert-t7-1"
    await db[CERTIFICATES].insert_one({"_id": cert_id, "user_id": asha, "title": "Tally Prime certification", "issuer": "Tally Education",
                                       "mime": "application/pdf", "size": 10, "file": b"%PDF-1.4", "created_at": now()})  # fmt: skip
    cid_tp = mine["Tally Prime certification"]["id"]
    r = await ca.post(
        f"{ME}/claims", json={"jobId": job["id"], "criterionId": cid_tp, "certId": cert_id, "note": "Passed in 2024"}
    )
    assert r.status_code == 201 and r.json()["status"] == "pending", r.text
    assert (
        await ca.post(f"{ME}/claims", json={"jobId": job["id"], "criterionId": cid_tp, "certId": cert_id})
    ).status_code == 409
    assert (
        await cn.post(f"{ME}/claims", json={"jobId": job["id"], "criterionId": cid_tp, "certId": cert_id})
    ).status_code == 403  # no consent
    assert by_text((await ca.get(ME)).json()["applications"][0])["Tally Prime certification"]["status"] == "unknown"
    admin = await admin_client()
    q = (await admin.get("/api/admin/trust/criteria")).json()
    assert q["counts"]["pending"] == 1 and q["pending"][0]["userName"] == "Asha Rao"
    f = await admin.get(f"/api/admin/trust/criteria/claims/{q['pending'][0]['id']}/file")
    assert f.status_code == 200 and f.headers["x-content-type-options"] == "nosniff"
    r = await admin.post(
        f"/api/admin/trust/criteria/claims/{q['pending'][0]['id']}/review", json={"decision": "verify"}
    )
    assert r.status_code == 200 and r.json()["status"] == "verified"
    mine = by_text((await ca.get(ME)).json()["applications"][0])
    assert (
        mine["Tally Prime certification"]["status"] == "met"
        and mine["Tally Prime certification"]["source"] == "certificate"
    )
    assert mine["Tally Prime certification"]["quote"].startswith(
        "Tally Prime certification – Tally Education (checked by Nm7 on "
    )
    r = await client.post(
        f"{CRIT.format(cid=cid, jid=job['id'])}/evaluate", json={"people": [asha]}, headers=H(session)
    )
    assert r.json()["items"][asha]["mustMet"] == 2
    # retention: old checks are deleted by the daily job; withdrawal deletes them now
    assert R.TYPES["criteria_evals"].purpose == EV.PURPOSE and R.TYPES["criteria_evals"].days == 180
    await db[TRUST_CRITERIA_EVALS].update_many({"user_id": asha}, {"$set": {"at": now() - timedelta(days=181)}})
    res = await R.run_types(db, "trust")
    assert await db[TRUST_CRITERIA_EVALS].count_documents({"user_id": asha}) == 0, res
    await client.post(f"{CRIT.format(cid=cid, jid=job['id'])}/evaluate", json={"people": [asha]}, headers=H(session))
    assert await db[TRUST_CRITERIA_EVALS].count_documents({"user_id": asha}) == 2
    r = await ca.delete(f"/api/me/trust/consents/{EV.PURPOSE}")
    assert r.status_code == 200, r.text
    assert (
        await db[TRUST_CRITERIA_EVALS].count_documents({"user_id": asha}) == 0
        and await db[TRUST_CRITERIA_CLAIMS].count_documents({"user_id": asha}) == 0
    )
    r = await client.post(
        f"{CRIT.format(cid=cid, jid=job['id'])}/evaluate", json={"people": [asha]}, headers=H(session)
    )
    assert r.json()["items"][asha]["consent"] is False


async def test_hire_now_sorted_by_criteria_and_quota_limit(client, outbox, db, make_client, monkeypatch):
    session, cid = await company(client, outbox, db)
    job = await post_job(client, session, cid)
    ca, asha = await candidate(make_client, outbox, db, "asha@example.com", "Asha Rao", TALLY)
    cb, bala = await candidate(make_client, outbox, db, "bala@example.com", "Bala Krishnan", EXCEL)
    for c in (ca, cb):
        assert (await c.put("/api/me/hire", json=READY)).status_code == 200
    assert (
        await put(
            client,
            session,
            cid,
            job["id"],
            [
                {"kind": "language", "text": "Speaks Hindi", "must": True},
                {"kind": "skill", "text": "Tally", "must": False},
            ],
        )
    ).status_code == 200
    r = await client.get(f"/api/company/{cid}/hire/shortlist", params={"job": job["id"]}, headers=H(session))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["criteria"]["items"][0]["text"] == "Speaks Hindi" and all("criteria" in x for x in d["items"])
    keys = [x["key"] for x in d["items"]]
    scores = {x["key"]: x["match"]["score"] for x in d["items"]}
    assert set(keys) == {asha, bala} and scores[asha] > scores[bala]
    assert keys == [bala, asha]  # the must-have (Hindi) first, though Asha's match score is higher
    # the AI allowance: a company at its daily limit leaves the rest queued
    mock_claude(monkeypatch, X, EV)
    await db[TRUST_CRITERIA_QUEUE].insert_one({"_id": f"{asha}:x", "user_id": asha, "chash": "x", "kind": "other", "text": "Owns a laptop",
                                               "job_id": job["id"], "who": f"company:{cid}", "at": now()})  # fmt: skip
    for _ in range(ai_quota.PER_PERSON["criteria"]):
        await ai_quota.take(db, "criteria", f"company:{cid}")
    res = await EV.run_queue(db, job_id=job["id"])
    assert res["limited"] == 1 and res["calls"] == 0 and await db[TRUST_CRITERIA_QUEUE].count_documents({}) == 1
