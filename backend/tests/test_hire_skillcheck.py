"""Phase 5 H3: skill checks. The starting bank (IT and non-IT, original, inserted once), 10 random questions with the
options shuffled (the answer never sent), marking, one attempt per skill in 30 days (a reload returns the same test),
late answers not counted, the tab-switch count, up to 3 spoken answers kept as text with clarity feedback, the
candidate decides sharing, companies see shared results only with the feature on, and Admin edits the bank."""

from datetime import timedelta

from bson import ObjectId

from app.core.db import COMPANIES, SKILL_ATTEMPTS, SKILL_QUESTIONS
from app.core.time import now
from app.hire import skillcheck as sc
from app.hire.bank import SEED
from app.site import get_site, save_site
from tests.test_companies_apply import student
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import READY, post_job

URL = "/api/me/skill-checks"


def right_answers(paper, bank):
    """The shown index of the right option for each question (what a perfect candidate picks)."""
    by = {str(q["_id"]): q for q in bank}
    return {q["id"]: q["options"].index(by[q["id"]]["options"][by[q["id"]]["answer"]]) for q in paper["questions"]}


async def test_bank_seeded_once_with_it_and_non_it(db):
    assert await sc.ensure_bank(db) == len(SEED)
    assert await sc.ensure_bank(db) == 0  # never again
    have = await sc.skills(db)
    assert {"SQL", "Excel", "Python"} <= set(have) and {"Customer support", "Electrical", "Warehouse"} <= set(have)
    assert all(v["count"] >= 10 for v in have.values())


async def test_take_mark_once_a_month_and_late(client, outbox, db, make_client):
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    cat = (await c.get(URL)).json()
    assert cat["minutes"] == 10 and any(s["skill"] == "SQL" for s in cat["skills"])
    paper = (await c.post(f"{URL}/start", json={"skill": "SQL"})).json()
    assert len(paper["questions"]) == 10 and len(paper["spoken"]) == 3
    assert "answer" not in str(paper["questions"][0])  # the right answer never goes to the browser
    # a reload while it runs: the same test, not a new one
    again = (await c.post(f"{URL}/start", json={"skill": "SQL"})).json()
    assert again["id"] == paper["id"] and [q["id"] for q in again["questions"]] == [q["id"] for q in paper["questions"]]
    bank = await db[SKILL_QUESTIONS].find({"_id": {"$in": [ObjectId(q["id"]) for q in paper["questions"]]}}).to_list(20)
    good = right_answers(paper, bank)
    seven = dict(list(good.items())[:7])
    wrong = {k: (v + 1) % 4 for k, v in list(good.items())[7:]}
    spoken = [{"q": paper["spoken"][0], "text": "Um, I used SQL in my project, I made a sales report with 3 joins."}]
    r = (await c.post(f"{URL}/{paper['id']}/submit", json={"answers": {**seven, **wrong}, "tabSwitches": 2,
                                                             "spoken": spoken})).json()  # fmt: skip
    assert r["score"] == 70 and r["right"] == 7 and r["tabSwitches"] == 2 and not r["late"] and not r["share"]
    assert r["spoken"][0]["text"].startswith("Um, I used SQL") and r["spoken"][0]["feedback"]["length"]
    a = await db[SKILL_ATTEMPTS].find_one({"_id": ObjectId(paper["id"])})
    assert "audio" not in str(a)  # text only
    assert err(await c.post(f"{URL}/{paper['id']}/submit", json={"answers": good})) == "done"
    # once in 30 days
    r = await c.post(f"{URL}/start", json={"skill": "SQL"})
    assert r.status_code == 409 and err(r) == "too_soon"
    # another skill: late answers don't count
    p2 = (await c.post(f"{URL}/start", json={"skill": "Excel"})).json()
    await db[SKILL_ATTEMPTS].update_one(
        {"_id": ObjectId(p2["id"])}, {"$set": {"ends_at": now() - timedelta(minutes=2)}}
    )
    bank2 = await db[SKILL_QUESTIONS].find({"_id": {"$in": [ObjectId(q["id"]) for q in p2["questions"]]}}).to_list(20)
    late = (await c.post(f"{URL}/{p2['id']}/submit", json={"answers": right_answers(p2, bank2)})).json()
    assert late["late"] and late["score"] == 0
    # after 30 days: a new try
    await db[SKILL_ATTEMPTS].update_many({}, {"$set": {"started_at": now() - timedelta(days=31)}})
    assert (await c.post(f"{URL}/start", json={"skill": "SQL"})).status_code == 200


async def test_random_and_shuffled():
    pool = [{"_id": ObjectId(), "options": ["a", "b", "c", "d"], "answer": 0} for _ in range(30)]
    order = {str(q["_id"]): [2, 0, 3, 1] for q in pool}
    answers = {str(q["_id"]): 1 for q in pool}  # shown option 1 is the bank's option 0: right
    assert sc.mark(pool, order, answers) == (30, 30)
    assert sc.mark(pool, order, {k: 0 for k in answers}) == (0, 30)
    assert sc.mark(pool, order, {k: 9 for k in answers}) == (0, 30)  # out of range: not counted


async def test_sharing_and_company_view(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)  # skills: SQL, Power BI
    c = await student(make_client, outbox, "asha@example.com", "Asha Rao")
    await c.put("/api/me/hire", json=READY)
    paper = (await c.post(f"{URL}/start", json={"skill": "SQL"})).json()
    bank = await db[SKILL_QUESTIONS].find({"_id": {"$in": [ObjectId(q["id"]) for q in paper["questions"]]}}).to_list(20)
    await c.post(f"{URL}/{paper['id']}/submit", json={"answers": right_answers(paper, bank)})
    url = f"/api/company/{cid}/hire/shortlist"
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["skillCheck"] is None  # not shared yet
    assert (await c.put(f"{URL}/{paper['id']}/share", json={"share": True})).json()["share"] is True
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["skillCheck"]["skill"] == "SQL" and row["skillCheck"]["score"] == 100
    # the feature closed for everyone (Admin → Plans) and not turned on for this company: not shown
    site = await get_site(db)
    await save_site(db, {"hire": {**site["hire"], "open": {**site["hire"]["open"], "tests": False}}})
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["skillCheck"] is None
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"hire_features": ["tests"]}})
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["skillCheck"]["score"] == 100


async def test_admin_bank(db, admin_client):
    owner = await admin_client()
    out = (await owner.get("/api/admin/skill-tests", params={"skill": "Electrical"})).json()
    assert len(out["items"]) == 10 and any(s["skill"] == "Warehouse" and s["hasTest"] for s in out["skills"])
    q = "What do you check before you leave with an order?"
    body = {"role": "Delivery partner", "skill": "Delivery", "question": q,
            "options": ["The address and the items", "Only the bill", "Nothing", "The weather"], "answer": 0,
            "difficulty": "easy", "active": True}  # fmt: skip
    r = await owner.post("/api/admin/skill-tests", json=body)
    assert r.status_code == 201
    qid = r.json()["id"]
    bad = await owner.post("/api/admin/skill-tests", json={**body, "answer": 5})
    assert err(bad) == "answer"
    same = await owner.post("/api/admin/skill-tests", json={**body, "options": ["A", "a"]})
    assert same.status_code in (400, 422)
    r = await owner.put(f"/api/admin/skill-tests/{qid}", json={**body, "active": False})
    assert r.json()["active"] is False
    assert "Delivery" not in await sc.skills(db)  # fewer than 5 active questions: no test yet
