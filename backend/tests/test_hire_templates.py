"""Phase 5 H8: all domains. Job templates across IT and non-IT (skills from the dictionary, salary always blank, the
linked skill check only when the bank has it, each can be posted as it is); non-IT skills found in resumes; the
lowest qualification (10th, 12th, ITI, diploma …) counts in the match score, never zero when a resume doesn't say."""

from app.hire.templates import TEMPLATES
from app.jobs import fit as fitmod
from app.jobsearch import skills
from tests.jobs_helpers import resume
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401


async def test_templates_list_and_post_each(client, outbox, db):
    out = (await client.get("/api/hire/templates")).json()
    assert len(out) == len(TEMPLATES) >= 12
    domains = {t["domain"] for t in out}
    assert "IT" in domains and len(domains - {"IT"}) >= 6  # non-IT: customer service, sales, accounts, technician …
    assert all(t["salary"] is None for t in out)
    assert all(skills.canonical(s) == s for t in out for s in t["skills"])  # dictionary names
    by = {t["id"]: t for t in out}
    assert by["electrician"]["test"] == "Electrical" and by["electrician"]["education"] == "iti"
    assert by["web-developer"]["test"] == "Web basics" and by["nurse"]["test"] == "Nursing basics"  # 13 Nov batch
    assert by["office-assistant"]["test"] == "Excel"  # the bank's own name (was "Microsoft Excel": never linked)
    assert by["it-support"]["test"] == ""  # no test in the bank: no link
    session, cid = await verified(client, outbox, db)
    from app.site import get_site, save_site

    site = await get_site(db)
    await save_site(db, {"companies": {**site["companies"], "verified_live_jobs": 50}})
    for t in out:  # a template posts as it is (safe-posting checks pass)
        job = {k: t[k] for k in ("title", "jobType", "experience", "education", "skills", "description")}
        r = await client.post(f"/api/company/{cid}/jobs", json={"job": {**job, "locations": ["Hyderabad"]}},
                              headers=H(session))  # fmt: skip
        assert r.status_code == 201, (t["id"], r.text)
        assert r.json()["education"] == t["education"]


def test_non_it_skills_found():
    text = ("ITI Electrician. Worked as a delivery partner, did pick and pack and forklift work, billing counter, "
            "follows PPE and safety procedures, uses a digital multimeter, Tally and GST.")  # fmt: skip
    found = set(skills.find(text))
    assert {"Last-mile delivery", "Picking and packing", "Forklift operation", "Billing counter", "Workplace safety",
            "Multimeter", "Tally", "GST"} <= found  # fmt: skip


def person(edu):
    return fitmod.Person({"_id": "r", "data": resume(edu=edu)})


def test_education_in_the_match():
    job = {"skills": ["SQL"], "experience": "fresher", "remote": True}
    btech = [{"degree": "B.Tech", "field": "Computer Science", "institution": "X"}]
    iti = [{"degree": "ITI Electrician", "institution": "Govt ITI"}]
    tenth = [{"degree": "SSC (10th)", "institution": "ZP School"}]
    no_level = [{"degree": "", "institution": "Some school"}]
    any_edu = fitmod.fit(job, person(btech))
    assert any_edu["education"] == "" and any_edu["educationNeed"] == ""
    assert fitmod.fit({**job, "education": "diploma"}, person(btech))["education"] == "ok"
    assert fitmod.fit({**job, "education": "12th"}, person(iti))["education"] == "ok"  # ITI and 12th side by side
    assert fitmod.fit({**job, "education": "iti"}, person(tenth))["education"] == "below"
    assert fitmod.fit({**job, "education": "12th"}, person(tenth))["education"] == "near"
    unknown = fitmod.fit({**job, "education": "12th"}, person(no_level))
    assert unknown["education"] == "unknown" and unknown["score"] > 0
    ok = fitmod.fit({**job, "education": "10th"}, person(btech))["score"]
    low = fitmod.fit({**job, "education": "graduate"}, person(tenth))["score"]
    assert ok > low
