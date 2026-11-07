"""Phase 4 E4: build a resume by talking. Each answer is saved at once into the person's normal resume (the one the
full builder opens), skip and back work, the email comes from the account, ID numbers never reach the resume, and
"This is what we wrote" only uses the answers: an AI line with a word that isn't in them is dropped and the rules
write the lines instead."""

import pytest

from app.core.db import AUDIT_LOG, CERTIFICATES, RESUMES, USERS
from app.simple.guided import STEPS, supported
from tests.conftest import signup
from tests.jobs_helpers import add_resume, mock_claude, reply

URL = "/api/me/simple/resume"


async def me(client, outbox, db, email="ravi@example.com"):
    await signup(client, outbox, email=email, name="Ravi Kumar")
    return (await db[USERS].find_one({"email": email}))["_id"]


async def data_of(db, uid):
    r = await db[RESUMES].find_one({"user_id": uid})
    return r["data"], r


def test_supported_words_only():
    a = {"built": "a website for our college fest", "tools": "HTML, CSS"}
    assert supported("Built a website for the college fest using HTML and CSS", a)
    assert not supported("Built a responsive website for the college fest using HTML and CSS", a)  # "responsive"
    assert not supported("Built an award-winning website for the fest", a)
    # Telugu answers are translated: the word check can't apply (numbers, tools and claims still are)
    assert supported("Built a website for the college fest", {"built": "కాలేజీ ఫెస్ట్ కోసం వెబ్‌సైట్ చేశాను"})


async def test_answers_write_into_the_same_resume(client, outbox, db):
    uid = await me(client, outbox, db)
    s = (await client.get(URL)).json()
    assert s["steps"] == list(STEPS) and len(STEPS) == 10 and s["step"] == 0
    assert s["account"] == {"name": "Ravi Kumar", "email": "ravi@example.com", "phone": ""}
    assert "B.Tech" in s["chips"]["degrees"] and "Telugu" in s["chips"]["langs"]
    # 1 of 10: name and phone; the email comes from the account
    assert (await client.put(f"{URL}/about", json={"value": {"name": ""}})).status_code == 400
    assert (await client.put(f"{URL}/about", json={"value": {"name": "Ravi", "phone": "call me"}})).status_code == 400
    s = (await client.put(f"{URL}/about", json={"value": {"name": "Ravi Kumar", "phone": "+91 98765 43210"}})).json()
    assert s["step"] == 1
    d, r = await data_of(db, uid)
    assert d["personal"] == {"name": "Ravi Kumar", "phone": "+91 98765 43210", "email": "ravi@example.com"}
    assert r["active"] is True  # a new resume, the one the builder opens
    await client.put(f"{URL}/studied", json={"value": {"degree": "B.Tech", "field": "Mechanical"}})
    await client.put(f"{URL}/college", json={"value": {"name": "JNTU Anantapur"}})
    assert (await client.put(f"{URL}/year", json={"value": {"year": "twenty"}})).status_code == 400
    await client.put(f"{URL}/year", json={"value": {"year": 2025}})
    s = (await client.put(f"{URL}/marks", json={"skip": True})).json()  # optional: skipped
    assert s["step"] == 5
    await client.put(f"{URL}/skills", json={"value": {"skills": ["AutoCAD", "MS Excel", "autocad"]}})
    d, _ = await data_of(db, uid)
    edu = {"institution": "JNTU Anantapur", "degree": "B.Tech", "field": "Mechanical", "from": "", "to": "2025"}
    assert d["edu"][0] == {**edu, "grade": ""}
    assert d["skillGroups"] == [{"id": "core", "label": "Skills", "value": "AutoCAD, MS Excel"}]
    # back works: answering an earlier step again changes it in place
    await client.put(f"{URL}/college", json={"value": {"name": "JNTUA College of Engineering"}})
    d, _ = await data_of(db, uid)
    assert len(d["edu"]) == 1 and d["edu"][0]["institution"] == "JNTUA College of Engineering"
    # certificates from the wallet, languages
    await db[CERTIFICATES].insert_one({"_id": "c1", "user_id": uid, "name": "NPTEL AutoCAD"})
    assert (await client.get(URL)).json()["wallet"] == ["NPTEL AutoCAD"]
    await client.put(f"{URL}/certs", json={"value": {"names": ["NPTEL AutoCAD"]}})
    await client.put(f"{URL}/langs", json={"value": {"names": ["Telugu", "English", "Telugu"]}})
    d, _ = await data_of(db, uid)
    assert [c["name"] for c in d["certs"]] == ["NPTEL AutoCAD"] and [x["name"] for x in d["langs"]] == [
        "Telugu",
        "English",
    ]
    # visible in the full builder: the normal resume API returns the same data
    rs = (await client.get("/api/me/resumes")).json()
    assert len(rs) == 1 and rs[0]["data"]["edu"][0]["degree"] == "B.Tech"
    out = (await client.post(f"{URL}/done")).json()
    assert out["path"] == "/me/simple"
    _, r = await data_of(db, uid)
    assert r["versions"][-1]["label"] == "Made by talking"
    assert (
        await db[AUDIT_LOG].count_documents({"action": "simple.resume_answer", "actor_id": uid}) == 9
    )  # the refused answers are not saved


async def test_writes_into_an_existing_resume_and_never_keeps_id_numbers(client, outbox, db):
    uid = await me(client, outbox, db)
    await add_resume(client, data={"personal": {"name": "Ravi", "email": "ravi@work.example"}, "summary": "Keep me"})
    await client.put(f"{URL}/about", json={"value": {"name": "Ravi Kumar", "phone": "9876543210"}})
    await client.put(f"{URL}/college", json={"value": {"name": "JNTU Aadhaar 2345 6789 0123"}})
    d, _ = await data_of(db, uid)
    assert await db[RESUMES].count_documents({"user_id": uid}) == 1
    assert d["summary"] == "Keep me" and d["personal"]["email"] == "ravi@work.example"  # kept, not replaced
    assert "2345 6789 0123" not in d["edu"][0]["institution"]


async def test_this_is_what_we_wrote_rules_without_ai(client, outbox, db):
    uid = await me(client, outbox, db)
    a = {"built": "a website for our college fest", "tools": "HTML, CSS", "does": "shows the event timings"}
    w = (await client.post(f"{URL}/write", json={"kind": "projects", "answers": a})).json()
    assert w["source"] == "rules" and w["lines"][0] == "Built a website for our college fest using HTML and CSS"
    s = (await client.post(f"{URL}/accept", json={"kind": "projects", "answers": a, "lines": w["lines"]})).json()
    assert s["answers"]["projects"][0]["lines"] == w["lines"]
    d, _ = await data_of(db, uid)
    assert d["proj"][0]["title"] == "a website for our college fest" and d["proj"][0]["tech"] == "HTML, CSS"
    assert d["proj"][0]["description"].split("\n") == w["lines"]
    work = {"company": "Sri Sai Motors", "role": "Service intern", "built": "checked bikes and wrote job cards"}
    w = (await client.post(f"{URL}/write", json={"kind": "work", "answers": work})).json()
    await client.post(f"{URL}/accept", json={"kind": "work", "answers": work, "lines": w["lines"]})
    d, _ = await data_of(db, uid)
    assert d["exp"][0]["company"] == "Sri Sai Motors" and d["exp"][0]["employmentType"] == "Internship"
    assert (await client.post(f"{URL}/write", json={"kind": "projects", "answers": {}})).status_code == 400


@pytest.mark.parametrize(
    "ai_lines,source",
    [
        (["Built a website for our college fest using HTML and CSS", "Website shows the event timings"], "ai"),
        # item 6: plain resume verbs and word forms are fine ("Developed", "Displayed", "showed")
        (["Developed a website for our college fest using HTML and CSS", "Displayed the event timings"], "ai"),
        # an invented word ("responsive", "1000 users") → dropped → the rules' lines
        (
            ["Built a responsive website for our college fest using HTML and CSS", "Used by 1000 users at the fest"],
            "rules",
        ),
        (["Built a website for our college fest using React", "Website shows the event timings"], "rules"),
    ],
)
async def test_fact_check_rejects_invented_words(client, outbox, db, monkeypatch, ai_lines, source):
    from app.projects import helper

    api = mock_claude(monkeypatch, helper)
    api.replies["claude-haiku-5-5"] = reply({"bullets": ai_lines})
    await me(client, outbox, db)
    a = {"built": "a website for our college fest", "tools": "HTML, CSS", "does": "shows the event timings"}
    w = (await client.post(f"{URL}/write", json={"kind": "projects", "answers": a})).json()
    assert w["source"] == source
    if source == "ai":
        assert w["lines"] == ai_lines
    else:
        assert all("responsive" not in x and "1000" not in x and "React" not in x for x in w["lines"])


async def test_account_contact_on_the_resume_whichever_question_comes_first(client, outbox, db):
    """Item 15: the account's email and phone go on the resume even when "About you" is never answered; a typed
    name, a LinkedIn link."""
    uid = await me(client, outbox, db)
    await db[USERS].update_one({"_id": uid}, {"$set": {"phone": "+919876543210"}})
    assert (await client.get(URL)).json()["account"]["phone"] == "+919876543210"
    await client.put(f"{URL}/skills", json={"value": {"skills": ["AutoCAD"]}})
    d, _ = await data_of(db, uid)
    assert d["personal"] == {"name": "Ravi Kumar", "email": "ravi@example.com", "phone": "+919876543210"}
    r = await client.put(f"{URL}/about", json={"value": {"name": "Ravi K", "linkedin": "not a link"}})
    assert r.status_code == 400
    await client.put(f"{URL}/about", json={"value": {"name": "Ravi K", "linkedin": "linkedin.com/in/ravi-k"}})
    d, _ = await data_of(db, uid)
    assert d["personal"]["name"] == "Ravi K" and d["links"]["linkedin"] == "linkedin.com/in/ravi-k"
    assert d["personal"]["email"] == "ravi@example.com"
