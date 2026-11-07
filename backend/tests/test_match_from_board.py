"""Fix round (7 Nov) items 7 and 8: "Make my resume fit" from a job on the board uses that job's own skills (never
words of its title: "QA" is not "Quality assurance"), shows the same score as the job's card, and opening it again
reuses the match instead of using another free one."""

from app.core.db import JOB_MATCHES
from app.jobs.fit import job_skills
from tests.conftest import signup
from tests.jobs_helpers import add_resume, resume
from tests.test_jobs_public import add

URL = "/api/me/jobs/match"


def test_title_words_are_never_skills():
    assert job_skills({"title": "QA Engineer Trainee", "skills": []}) == []
    assert job_skills({"title": "QA Engineer Trainee", "skills": ["Manual Testing", "SQL"]}) == [
        "Manual Testing",
        "SQL",
    ]


async def test_board_match_same_number_listed_skills_and_reused(client, outbox, db):
    await signup(client, outbox)
    await add_resume(client, data=resume())
    j = await add(db, title="QA Engineer Trainee", skills=["SQL", "Excel"], applyUrl="https://acme.example/qa",
                  description="Test our dashboards and write SQL checks. Data visualization is a plus.")  # fmt: skip
    card = (await client.get(f"/api/jobs/{j['slug']}")).json()["match"]
    body = {
        "text": f"{j['title']}\nAcme\n{j['description']}",
        "title": j["title"],
        "company": "Acme",
        "jobId": j["_id"],
    }
    r = await client.post(URL, json=body)
    assert r.status_code == 201, r.text
    m = r.json()
    full = (await client.get(f"/api/me/jobs/matches/{m['id']}")).json()
    names = {i["name"] for i in full["items"]}
    assert names == {"SQL", "Microsoft Excel"}  # the job's own skills (dictionary names): no "Quality assurance"
    assert m["score"] == card["score"] == full["board"]["score"]  # the same number as the card
    assert m["jobId"] == j["_id"]
    # opening it again reuses the match: no free match used (3 a day), even many times
    for _ in range(4):
        again = await client.post(URL, json=body)
        assert again.status_code == 201 and again.json()["id"] == m["id"]
    assert await db[JOB_MATCHES].count_documents({"job_id": j["_id"]}) == 1
    # a pasted post (no job) still uses the free matches as before
    for _ in range(2):
        assert (await client.post(URL, json={"text": body["text"] + " Python"})).status_code == 201
