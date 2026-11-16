"""Phase 5 H3: skill checks. The starting bank (IT and non-IT, original, inserted once), marking, and Admin edits the
bank. Taking a test is Vetting V2 now (tests/test_vetting.py)."""

from datetime import timedelta

from bson import ObjectId

from app.core.db import SKILL_QUESTIONS
from app.core.time import now
from app.hire import skillcheck as sc
from app.hire.bank import SEED
from app.hire.bank2 import SEED_2
from tests.test_companies_posting import JOB, no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401

URL = "/api/me/skill-checks"


def right_answers(paper, bank):
    """The shown index of the right option for each question (what a perfect candidate picks)."""
    by = {str(q["_id"]): q for q in bank}
    return {q["id"]: q["options"].index(by[q["id"]]["options"][by[q["id"]]["answer"]]) for q in paper["questions"]}


async def test_bank_seeded_once_with_it_and_non_it(db):
    assert await sc.ensure_bank(db) == len(SEED) + len(SEED_2)
    assert await sc.ensure_bank(db) == 0  # never again
    have = await sc.skills(db)
    assert {"SQL", "Excel", "Python"} <= set(have) and {"Customer support", "Electrical", "Warehouse"} <= set(have)
    # 13 Nov live test: at least 20 questions per test (10 drawn at random), and the ten new tests
    new = {"Java", "Web basics", "Software testing", "Spoken English", "Nursing basics", "Mechanical basics",
           "Delivery and logistics", "Tally and GST", "Data entry", "Retail"}  # fmt: skip
    assert new <= set(have) and len(have) >= 18
    assert all(v["count"] >= 20 for v in have.values())


def test_second_batch_is_well_formed():
    seen = set()
    for skill, role, diff, q, opts, a in SEED + SEED_2:
        assert skill and role and diff in ("easy", "medium", "hard") and q.strip()
        assert len(opts) == 4 and len({o.strip() for o in opts}) == 4 and 0 <= a < 4, q
        assert (skill, q) not in seen, f"repeated question: {q}"  # the id comes from it
        seen.add((skill, q))


async def test_second_batch_added_to_a_bank_already_in_use(db):
    """Production already has the first batch (maybe edited by Admin): the second is added once, never twice, and
    Admin's edits and turned-off questions stay as they are."""
    from app.core.db import LEARN_PATHS
    from app.seek.paths import ensure_paths

    t = now()
    first = [{"skill": s, "role": r, "difficulty": d, "question": q, "options": o, "answer": a, "active": True,
              "seed": True, "created_at": t, "updated_at": t} for s, r, d, q, o, a in SEED]  # fmt: skip
    await db[SKILL_QUESTIONS].insert_many(first)
    edited = await db[SKILL_QUESTIONS].find_one({"skill": "SQL"})
    await db[SKILL_QUESTIONS].update_one(
        {"_id": edited["_id"]}, {"$set": {"question": "Edited by Admin", "active": False}}
    )
    await ensure_paths(db)
    await db[LEARN_PATHS].update_many({"_id": {"$in": ["web-developer", "staff-nurse"]}}, {"$set": {"test": ""}})
    await db[LEARN_PATHS].update_one(
        {"_id": "staff-nurse"}, {"$set": {"updated_at": t + timedelta(minutes=1)}}
    )  # Admin
    assert await sc.ensure_bank(db) == len(SEED_2)
    assert await sc.ensure_bank(db) == 0
    assert await db[SKILL_QUESTIONS].count_documents({}) == len(SEED) + len(SEED_2)
    assert (await db[SKILL_QUESTIONS].find_one({"_id": edited["_id"]}))["question"] == "Edited by Admin"
    first = await db[SKILL_QUESTIONS].find_one({"_id": sc.seed_id(SEED_2[0])})
    await db[SKILL_QUESTIONS].update_one({"_id": first["_id"]}, {"$set": {"active": False}})  # Admin turns one off
    assert await sc.ensure_bank(db) == 0 and not (await db[SKILL_QUESTIONS].find_one({"_id": first["_id"]}))["active"]
    paths = {
        p["_id"]: p["test"] async for p in db[LEARN_PATHS].find({"_id": {"$in": ["web-developer", "staff-nurse"]}})
    }
    assert paths == {"web-developer": "Web basics", "staff-nurse": ""}  # an edited path is left alone


async def test_random_and_shuffled():
    pool = [{"_id": ObjectId(), "options": ["a", "b", "c", "d"], "answer": 0} for _ in range(30)]
    order = {str(q["_id"]): [2, 0, 3, 1] for q in pool}
    answers = {str(q["_id"]): 1 for q in pool}  # shown option 1 is the bank's option 0: right
    assert sc.mark(pool, order, answers) == (30, 30)
    assert sc.mark(pool, order, {k: 0 for k in answers}) == (0, 30)
    assert sc.mark(pool, order, {k: 9 for k in answers}) == (0, 30)  # out of range: not counted


async def test_admin_bank(db, admin_client):
    owner = await admin_client()
    out = (await owner.get("/api/admin/skill-tests", params={"skill": "Electrical"})).json()
    assert len(out["items"]) >= 40 and any(s["skill"] == "Warehouse" and s["hasTest"] for s in out["skills"])  # V2 bank
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
