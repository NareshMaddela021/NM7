# ruff: noqa: E501
"""Phase 6 S9: special filters (jobs by declared policies or immediate joining; Hire now by immediate / returners),
"hide me from my current employer" in Hire now and the applicant views, Admin removing a policy, the government-exam
backup, and honest gap-year / backlog wording (never hides a gap or invents dates)."""

from app.core.db import COMPANIES, JOBS
from app.core.time import now
from app.seek.guidance import Facts, problems, suggestions
from app.seek.support import hidden_from, immediate
from tests.conftest import signup
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import READY, ready  # noqa: F401


def test_hidden_from_and_immediate():
    c = {"details": {"legal_name": "Acme Analytics Pvt Ltd", "website": "https://www.acme.co.in"}}
    assert hidden_from({"hide_from": ["acme analytics"]}, c)
    assert hidden_from({"hide_from": ["acme.co.in"]}, c)
    assert hidden_from({"hide_from": ["https://acme.co.in/careers"]}, c)
    assert not hidden_from({"hide_from": ["zenith"]}, c) and not hidden_from({"hide_from": []}, c)
    assert not hidden_from({"hide_from": ["ac"]}, c)  # too short to match a name
    assert immediate({"notice_days": 0}) and not immediate({"notice_days": 30})


async def test_job_filters_and_policies(client, outbox, db, admin_client):
    session, cid = await verified(client, outbox, db)
    r = await client.put(
        f"/api/company/{cid}/page",
        json={
            "about": "We build tools.",
            "policies": {
                "inclusive": "Equal pay audit every year; women-led team.",
                "accessible": "",
                "returners": "Paid returnship for career-break returners.",
            },
        },
        headers=H(session),
    )
    assert r.status_code == 200 and r.json()["policies"]["inclusive"]["text"].startswith("Equal pay")
    j = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()
    await db[JOBS].insert_one(
        {
            "_id": "x1",
            "title": "Store helper - immediate joiners",
            "slug": "x1",
            "dedupe_key": "x1",
            "status": "active",
            "company": {"name": "Other"},
            "locations": ["Pune"],
            "remote": False,
            "experience": "fresher",
            "job_type": "full_time",
            "work_type": "onsite",
            "skills": [],
            "description": "",
            "created_at": now(),
            "posted_at": now(),
            "source": "admin",
            "apply": {"method": "link", "url": "https://x.example"},
        }
    )
    ids = lambda r: {x["id"] for x in r.json()["items"]}  # noqa: E731
    assert ids(await client.get("/api/jobs", params={"support": "inclusive"})) == {j["id"]}
    assert ids(await client.get("/api/jobs", params={"support": "returners"})) == {j["id"]}
    assert ids(await client.get("/api/jobs", params={"support": "accessible"})) == set()
    assert ids(await client.get("/api/jobs", params={"support": "immediate"})) == {"x1"}
    page = (await client.get(f"/api/jobs/{j['slug']}")).json()
    assert set(page["policies"]) == {"inclusive", "returners"}
    owner = await admin_client("owner")
    assert (await owner.post(f"/api/admin/companies/{cid}/policies/inclusive/remove")).status_code == 200
    assert ids(await client.get("/api/jobs", params={"support": "inclusive"})) == set()
    assert "inclusive" not in (await client.get(f"/api/jobs/{j['slug']}")).json()["policies"]
    # the same text again stays removed; new text shows again
    await client.put(
        f"/api/company/{cid}/page",
        json={"about": "x", "policies": {"inclusive": "Equal pay audit every year; women-led team."}},
        headers=H(session),
    )
    assert ids(await client.get("/api/jobs", params={"support": "inclusive"})) == set()
    await client.put(
        f"/api/company/{cid}/page",
        json={"about": "x", "policies": {"inclusive": "Creche at the office and flexible hours."}},
        headers=H(session),
    )
    assert ids(await client.get("/api/jobs", params={"support": "inclusive"})) == {j["id"]}


async def test_hide_from_employer_in_hire_now_and_applicants(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    c = await db[COMPANIES].find_one({"_id": cid})
    job = (await client.post(f"/api/company/{cid}/jobs", json={"job": JOB}, headers=H(session))).json()["id"]
    asha = await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    url = f"/api/company/{cid}/hire/shortlist"
    assert [x["name"] for x in (await client.get(url, params={"job": job}, headers=H(session))).json()["items"]] == [
        "Asha R."
    ]
    await asha.put(
        "/api/me/hire", json={**READY, "returner": True, "hideFrom": [c["details"]["legal_name"].split()[0]]}
    )
    assert (await asha.get("/api/me/hire")).json()["hideFrom"]
    assert (await client.get(url, params={"job": job}, headers=H(session))).json()["items"] == []
    # filters: returners / immediate
    await asha.put("/api/me/hire", json={**READY, "returner": True, "hideFrom": []})
    assert (
        len((await client.get(url, params={"job": job, "support": "returners"}, headers=H(session))).json()["items"])
        == 1
    )
    await asha.put("/api/me/hire", json={**READY, "returner": False})
    assert (await client.get(url, params={"job": job, "support": "returners"}, headers=H(session))).json()[
        "items"
    ] == []
    # applicant views
    s = await student(make_client, outbox, "kiran@example.com", "Kiran")
    assert (await s.post(f"/api/jobs/{job}/apply", json={"consent": True, "answers": {}})).status_code == 201
    first = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert [x["name"] for x in first] == ["Kiran"]
    await s.put("/api/me/hire", json={**READY, "on": False, "consent": False, "hideFrom": [c["details"]["website"]]})
    assert (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"] == []
    assert (await client.get(f"/api/company/{cid}/applicants/{first[0]['id']}", headers=H(session))).status_code == 404


async def test_exam_backup(client, db):
    d = (await client.get("/api/public/guidance/exams")).json()
    assert {e["id"] for e in d} == {"ssc", "banking", "railways", "state_psc"}
    rail = next(e for e in d if e["id"] == "railways")
    assert "Electrician" in [r["title"] for r in rail["roles"]] and all("liveJobs" in r for r in rail["roles"])


def test_honest_wording_never_hides_or_invents():
    gap = Facts(kind="gap", **{"from": "2023-06"}, to="2024-05", reason="exam_prep", did="completed a free SQL course")
    s = suggestions(gap)
    assert s and "Jun 2023 – May 2024" in s[0] and "exams" in s[0] and all(not problems(x, gap) for x in s)
    assert problems("Worked continuously from 2022 to 2024.", gap)  # hides the gap and shows 2022
    assert any("2022" in p for p in problems("Studied in 2022.", gap))
    assert problems("Career break (Jun 2023 – May 2024) preparing for exams.", gap) == []
    bl = Facts(kind="backlog", backlogs=2, cleared=False)
    assert all(not problems(x, bl) for x in suggestions(bl)) and "2 subjects to clear" in suggestions(bl)[0]
    assert problems("B.Tech, first attempt, no backlogs.", bl)
    assert problems("All backlogs cleared.", bl)  # not true yet
    done = Facts(kind="backlog", backlogs=2, cleared=True, cleared_on="2025-11")
    assert "Nov 2025" in suggestions(done)[0]


async def test_wording_endpoints(client, outbox):
    await signup(client, outbox)
    r = (
        await client.post(
            "/api/me/guidance/wording", json={"kind": "gap", "from": "2023-06", "to": "2024-05", "reason": "family"}
        )
    ).json()
    assert r["suggestions"] and "family" in r["suggestions"][0]
    c = (
        await client.post(
            "/api/me/guidance/check",
            json={"kind": "gap", "from": "2023-06", "to": "2024-05", "text": "No gap, worked 2021-2024"},
        )
    ).json()
    assert c["honest"] is False and len(c["problems"]) >= 2
