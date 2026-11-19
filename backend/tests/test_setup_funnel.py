# ruff: noqa: E501  (dense test data)
"""Profile setup P4: the setup funnel on the Daily report. Counts per step and role, the cumulative funnel and its
drop-off, freshers apart from experienced job seekers, demo / test / persona / admin accounts left out, switches that
are off for everyone hide their steps, the cap, and the section in the stored snapshot and the report."""

from datetime import timedelta

import pytest

from app.admin import daily_report as dr
from app.core.db import COMPANIES, DAILY_REPORTS, HIRE_PROFILES, JOB_PROFILES, ORGANIZATIONS, USERS
from app.core.time import now
from app.setup import funnel as F

ON = {"on": True, "public": True}
OFF = {"on": False, "public": False}


@pytest.fixture
def switches(monkeypatch):
    sw = {"vetting": OFF, "trust": OFF, "hire": ON, "payments": OFF, "autoapply2": OFF}

    async def fake(db):
        return sw

    monkeypatch.setattr(F, "public_switches", fake)
    return sw


@pytest.fixture
def scores(monkeypatch):
    """resume_score per user id (the real one scores a stored resume)."""
    table: dict[str, dict] = {}

    async def fake(db, uid):
        return table.get(uid)

    from app.hire.vetting import ladder

    monkeypatch.setattr(ladder, "resume_score", fake)
    return table


async def person(db, uid, *, role="customer", roles=None, minutes=0, **extra):
    doc = {"_id": uid, "role": role, "email": f"{uid}@example.com", "email_lc": f"{uid}@example.com", "name": f"Name {uid}",
           "created_at": now() - timedelta(minutes=minutes), **({"roles": roles} if roles is not None else {}), **extra}  # fmt: skip
    await db[USERS].insert_one(doc)


PREFS = {"salary": {"amount": 30000}, "notice_days": 30, "on": True, "cities": ["Pune"]}


def by_role(out):
    return {r["role"]: r for r in out["roles"]}


def step(r, sid):
    return next(s for s in r["steps"] if s["id"] == sid)


async def test_job_seeker_counts_funnel_and_drop_off(db, switches, scores):
    # 4 experienced job seekers: all reached sign-up; 3 preferences; 2 of those resume 60+; 1 of those Auto Apply
    for i in range(4):
        await person(db, f"js{i}", roles=["jobseeker"], level="3_5", minutes=i)
    for i in range(3):
        await db[HIRE_PROFILES].insert_one({"_id": f"js{i}", **PREFS})
    scores.update(
        {
            "js0": {"ats": 72, "complete": True},
            "js1": {"ats": 65, "complete": True},
            "js3": {"ats": 80, "complete": True},
        }
    )
    await db[USERS].update_one({"_id": "js0"}, {"$set": {"auto_apply": {"on": True}}})
    await db[USERS].update_one(
        {"_id": "js3"}, {"$set": {"auto_apply": {"on": True}, "setup.jobseeker.check_skipped": ["preferences"]}}
    )
    await db[USERS].update_one({"_id": "js1"}, {"$set": {"setup.jobseeker.done_at": now()}})

    r = by_role(await F.section(db))["jobseeker"]
    assert r["label"] == "Job seekers with experience"
    assert (r["total"], r["looked"], r["capped"], r["partial"]) == (4, 4, False, False)
    assert r["quickStart"] == 1
    assert [s["id"] for s in r["steps"]] == [
        "preferences",
        "resume",
        "autoapply",
    ]  # fresher steps and switched-off ones left out
    p, res, aa = (step(r, x) for x in ("preferences", "resume", "autoapply"))
    assert (p["done"], p["reached"], p["dropOff"], p["dropPct"], p["skipped"]) == (3, 3, 1, 25, 1)
    # js3 has a 60+ resume but no preferences: done in any order, but not "reached" in the funnel
    assert (res["done"], res["reached"], res["dropOff"], res["dropPct"]) == (3, 2, 1, 33)
    assert (aa["done"], aa["reached"], aa["dropOff"], aa["dropPct"]) == (2, 1, 1, 50)
    assert r["complete"] == 1
    assert p["shown"] == 4


async def test_freshers_apart_with_their_own_steps(db, switches, scores):
    await person(db, "fr1", roles=["jobseeker"], level="Fresher")
    await person(db, "fr2", roles=["jobseeker"], setup={"jobseeker": {"answers": {"experience": "fresher"}}})
    await person(db, "ex1", roles=["jobseeker"], level="5_8")
    await db[JOB_PROFILES].insert_one(
        {"_id": "fr1", "data": {"edu": [{"institution": "JNTU", "degree": "B.Tech", "to": "2025"}]}}
    )
    await db[HIRE_PROFILES].insert_one({"_id": "fr1", **PREFS})
    out = by_role(await F.section(db))
    fr, ex = out["fresher"], out["jobseeker"]
    assert (fr["looked"], ex["looked"]) == (2, 1)
    assert (fr["total"], ex["total"]) == (2, 1)
    assert [s["id"] for s in fr["steps"]] == ["preferences", "education", "resume", "papers", "autoapply"]
    edu = step(fr, "education")
    assert (edu["done"], edu["reached"], edu["dropOff"]) == (1, 1, 0)
    papers = step(fr, "papers")
    assert papers["required"] is False and papers["reached"] is None and papers["dropOff"] is None
    assert step(ex, "preferences")["done"] == 0


async def test_demo_test_persona_admin_deleted_left_out(db, switches, scores):
    await person(db, "real", roles=["jobseeker"])
    await person(db, "demo", roles=["jobseeker"], demo=True)
    await person(db, "tester", roles=["jobseeker"], test_user=True)
    await person(db, "persona", roles=["jobseeker"], owner_admin_id="adm1")
    await person(db, "made-up", roles=["jobseeker"], email_lc="x@persona.nm7.invalid")
    await person(db, "gone", roles=["jobseeker"], deleted_at=now())
    await person(db, "off", roles=["jobseeker"], disabled_at=now())
    await person(db, "adm", role="admin", admin_role="owner")
    await db[COMPANIES].insert_many(
        [
            {"_id": "c1", "slug": "s-c1", "created_at": now(), "members": []},
            {"_id": "c2", "slug": "s-c2", "demo": True, "created_at": now()},
        ]
    )
    await db[ORGANIZATIONS].insert_many([{"_id": "o1", "slug": "s-o1", "type": "college", "name": "JNTU", "created_at": now()},
                                         {"_id": "o2", "slug": "s-o2", "type": "college", "name": "Demo", "demo": True, "created_at": now()},
                                         {"_id": "o3", "slug": "s-o3", "type": "company", "name": "Not a college", "created_at": now()}])  # fmt: skip
    out = by_role(await F.section(db))
    assert out["jobseeker"]["total"] == 1 and out["jobseeker"]["looked"] == 1
    assert out["fresher"]["total"] == 0
    assert out["company"]["total"] == 1 and out["company"]["looked"] == 1
    assert out["college"]["total"] == 1 and out["college"]["looked"] == 1
    # counts only: nothing that names a person or a company
    text = repr(out)
    for secret in ("real", "Name ", "@example.com", "JNTU", "c1", "o1"):
        assert secret not in text.replace("reached", "").replace("required", ""), secret


async def test_roles_students_experts_older_accounts(db, switches, scores):
    await person(db, "old")  # an older customer with no stored roles is a job seeker
    await person(db, "st", roles=["student"])
    await person(db, "both", roles=["jobseeker", "student"])
    await person(db, "ex", role="expert")
    out = by_role(await F.section(db))
    assert out["jobseeker"]["looked"] == 2  # old + both
    assert out["student"]["looked"] == 2  # st + both
    assert out["expert"]["looked"] == 1
    assert [s["id"] for s in out["student"]["steps"]] == ["skills", "resume", "practice", "group", "apply"]
    assert [s["id"] for s in out["expert"]["steps"]] == ["profile", "services", "availability", "submit"]
    assert out["expert"]["quickStart"] == 0 and out["company"]["quickStart"] is None
    assert [r["role"] for r in (await F.section(db))["roles"]] == list(F.ROLE_ORDER)


async def test_companies_and_colleges(db, switches):
    await db[COMPANIES].insert_many([
        {"_id": "c1", "slug": "s-c1", "created_at": now(), "kind": "company", "details": {"about": "We build"}, "trust": "basic", "members": [{"role": "main"}, {"role": "admin"}]},
        {"_id": "c2", "slug": "s-c2", "created_at": now() - timedelta(days=1), "kind": "individual", "members": [{"role": "main"}]},
    ])  # fmt: skip
    await db[ORGANIZATIONS].insert_one(
        {"_id": "o1", "slug": "s-o1", "type": "college", "name": "JNTU", "city": "Hyderabad", "created_at": now()}
    )
    out = by_role(await F.section(db))
    co, col = out["company"], out["college"]
    assert co["start"] == "Signed up" and co["looked"] == 2
    assert "connect" not in [s["id"] for s in co["steps"]]  # Auto Apply 2.0 is off for everyone
    biz = step(co, "business")
    assert biz["shown"] == 1  # individual recruiters have no business check
    team = step(co, "team")
    assert team["done"] == 1
    assert step(col, "basics")["done"] == 1 and step(col, "basics")["reached"] == 1
    assert step(col, "groups")["dropOff"] == 1


async def test_switch_off_hides_steps_and_says_so(db, scores):
    await person(db, "js", roles=["jobseeker"])
    out = await F.section(db)  # the real switches: vetting and trust are off by default
    ids = [s["id"] for s in by_role(out)["jobseeker"]["steps"]]
    assert "skill" not in ids and "interview" not in ids and "identity" not in ids
    assert any(h.startswith("Take the AI interview (Vetting is off)") for h in out["hidden"])


async def test_cap_newest_first(db, switches, scores, monkeypatch):
    monkeypatch.setattr(F, "CAP", 3)
    for i in range(5):
        await person(db, f"p{i}", roles=["student"], minutes=i)
    r = by_role(await F.section(db))["student"]
    assert (r["total"], r["looked"], r["capped"]) == (5, 3, True)


async def test_time_limit_marks_partial(db, switches, scores, monkeypatch):
    monkeypatch.setattr(F, "ROLE_SECONDS", -1.0)
    await person(db, "p", roles=["student"])
    r = by_role(await F.section(db))["student"]
    assert r["partial"] is True and r["looked"] == 0


async def test_in_the_snapshot_and_report(db, switches, scores, admin_client):
    await person(db, "js", roles=["jobseeker"])
    owner = await admin_client("owner")
    r = await owner.get("/api/admin/daily-report")
    assert r.status_code == 200, r.text
    fun = r.json()["today"]["setupFunnel"]
    assert {x["role"] for x in fun["roles"]} == set(F.ROLE_ORDER)
    stored = await db[DAILY_REPORTS].find_one({"_id": dr.ist_today().isoformat()})
    assert stored["setupFunnel"]["cap"] == F.CAP


async def test_a_failure_never_stops_the_snapshot(db, monkeypatch):
    async def boom(db, t=None):
        raise RuntimeError("x")

    monkeypatch.setattr(F, "section", boom)
    assert await dr._setup_funnel(db) is None


def test_easy_dashboard_has_simple_words_for_every_step():
    """The Easy dashboard words each individual step itself (frontend src/i18n/setup.json); a new step here needs them."""
    import json
    from pathlib import Path

    from app.setup import registry as R

    strings = json.loads((Path(__file__).parents[2] / "frontend/src/i18n/setup.json").read_text())
    for role in R.ROLES:
        for s in R.STEPS[role]:
            for lang in ("en", "te", "hi"):
                for part in ("title", "text"):
                    assert strings[lang].get(f"setup.s.{role}.{s.id}.{part}"), (lang, role, s.id, part)
