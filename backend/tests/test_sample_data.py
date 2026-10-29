"""The example person ("Sai Varsha") in saved resumes: found by exact markers, removed value by value (nothing
else touched), never saved into a new resume, flagged in shared-resume lists, and cleaned only by the owner after a
dry run."""

import copy
import json
from pathlib import Path

from app.core.db import AUDIT_LOG, RESUMES
from app.maintenance.sample_data import S, has_sample, strip_sample
from tests.test_orgs import join, member, setup_group

# what a resume seeded from the old sample looked like (plus the person's own edits)
SEEDED = {
    "personal": {
        "name": "Anjali K",
        "headline": "",
        "email": "anjali@example.com",
        "phone": "",
        "location": "Chennai, Tamil Nadu",
        "level": "Fresher (0–1 yr)",
    },
    "links": {"linkedin": S["links"]["linkedin"], "github": S["links"]["github"], "portfolio": "anjali.dev"},
    "pinfo": {
        "father": "R. Raman",
        "mother": "S. Lakshmi",
        "dob": "2003-05-15",
        "nationality": "Indian",
        "languages": "English, Tamil, Hindi",
    },
    "hobbies": S["hobbies"],
    "strengths": S["strengths"],
    "edu": [
        {**S["edu"], "current": False},
        {
            "institution": "Lakeview Institute of Technology",
            "degree": "M.Tech",
            "field": "AI",
            "from": "2025-08",
            "to": "",
            "grade": "",
        },
    ],
    "exp": [
        {**S["exp"], "description": "x"},
        {"company": "Zoho", "role": "Intern", "from": "2024-05", "to": "2024-07"},
    ],
    "proj": [{**S["proj"], "tech": "Power BI"}, {"title": "My own app", "tagline": ""}],
    "certs": [{**S["cert"], "noExpiry": True}],
    "langs": [
        {"name": "English", "level": "Fluent"},
        {"name": "Tamil", "level": "Native"},
        {"name": "Hindi", "level": "Professional"},
    ],
    "skillGroups": [
        {"id": "core", "label": "Core", "value": S["skillGroups"]["core"]},
        {"id": "frameworks", "label": "Frameworks", "value": "React, Pandas"},
        {"id": "tools", "label": "Tools", "value": S["skillGroups"]["tools"]},
    ],
    "prefs": copy.deepcopy(S["prefs"]),
    "summary": "My own summary.",
}


def test_values_file_matches_the_frontend_list():
    v = json.loads((Path(__file__).parents[1] / "app/maintenance/sample_values.json").read_text(encoding="utf-8"))
    assert v["personal"]["name"] == "Sai Varsha" and v["links"]["github"] == "github.com/sai-varsha-example"


def test_strip_removes_only_the_exact_sample_values():
    out, fields = strip_sample(SEEDED)
    assert has_sample(SEEDED) and not has_sample(out)
    assert out["links"] == {"linkedin": "", "github": "", "portfolio": "anjali.dev"}
    assert out["pinfo"] == {"father": "", "mother": "", "dob": "", "nationality": "Indian", "languages": ""}
    assert out["hobbies"] == "" and out["strengths"] == ""
    assert out["personal"]["name"] == "Anjali K" and out["personal"]["email"] == "anjali@example.com"
    assert out["personal"]["location"] == ""  # the sample's "Chennai, Tamil Nadu"
    assert out["personal"]["level"] == "Fresher (0–1 yr)"  # a level the person may have picked: kept
    assert [e["degree"] for e in out["edu"]] == ["M.Tech"]  # a real Lakeview entry stays
    assert [e["company"] for e in out["exp"]] == ["Zoho"]
    assert [p["title"] for p in out["proj"]] == ["My own app"]
    assert out["certs"] == [] and out["langs"] == []
    assert [g["value"] for g in out["skillGroups"]] == ["", "React, Pandas", ""]
    assert out["prefs"]["jobTypes"] == [] and out["summary"] == "My own summary."
    assert "links.github" in fields and "edu" in fields
    assert SEEDED["links"]["github"] == S["links"]["github"]  # the input is not changed


def test_a_real_lakeview_college_alone_is_kept():
    d = {
        "personal": {"name": "Ravi", "location": "Chennai, Tamil Nadu"},
        "edu": [{"institution": "Lakeview Institute of Technology", "degree": "B.Tech", "field": "Civil"}],
        "langs": [
            {"name": "English", "level": "Fluent"},
            {"name": "Tamil", "level": "Native"},
            {"name": "Hindi", "level": "Professional"},
        ],
        "skillGroups": [{"id": "core", "value": S["skillGroups"]["core"]}],
        "hobbies": S["hobbies"],
    }
    assert not has_sample(d)
    assert strip_sample(d) == (d, [])  # no marker: nothing changes, even values that happen to match


async def test_a_new_resume_never_keeps_the_sample(client, outbox, db):
    from tests.conftest import signup

    await signup(client, outbox, "anjali@example.com", name="Anjali K")
    r = await client.post("/api/me/resumes", json={"id": "r9", "name": "Mine", "data": SEEDED})
    assert r.status_code == 201, r.text
    saved = (await db[RESUMES].find_one({"key": "r9"}))["data"]
    assert not has_sample(saved) and "sai-varsha" not in json.dumps(saved) and "R. Raman" not in json.dumps(saved)
    assert saved["personal"]["name"] == "Anjali K"


async def _legacy(db, user_id, key, data):
    await db[RESUMES].update_one({"user_id": user_id, "key": key}, {"$set": {"data": data}})


async def test_badge_dry_run_and_owner_cleanup(admin_client, make_client, outbox, db):
    owner = await admin_client("owner")
    await setup_group(owner)
    a, me_a = await member(make_client, outbox)
    b, me_b = await member(make_client, outbox, email="ravi@example.com", name="Ravi")
    assert (await join(a)).status_code == 201
    assert (await join(b, roll="21A02")).status_code == 201
    await _legacy(db, me_a["id"], "r1", SEEDED)  # saved by an older version, before the fix

    rows = {r["email"]: r for r in (await owner.get("/api/admin/shared-resumes")).json()["rows"]}
    assert rows["asha@example.com"]["sample"] is True and rows["ravi@example.com"]["sample"] is False

    # only the owner
    ops = await admin_client("ops", email="ops@example.com")
    assert (await ops.post("/api/admin/maintenance/sample-cleanup", json={"dryRun": True})).status_code == 403
    assert (await a.post("/api/admin/maintenance/sample-cleanup", json={"dryRun": True})).status_code == 403

    before = await db[RESUMES].find_one({"user_id": me_a["id"]})
    dry = (await owner.post("/api/admin/maintenance/sample-cleanup", json={"dryRun": True})).json()
    assert dry["count"] == 1 and dry["resumes"][0]["id"] == str(before["_id"])
    assert "Anjali" not in json.dumps(dry) and "anjali@" not in json.dumps(dry)  # ids and field names only
    assert (await db[RESUMES].find_one({"user_id": me_a["id"]}))["data"] == before["data"]  # a dry run changes nothing

    run = (await owner.post("/api/admin/maintenance/sample-cleanup", json={"dryRun": False})).json()
    assert run["count"] == 1
    after = await db[RESUMES].find_one({"user_id": me_a["id"]})
    assert after["data"] == strip_sample(SEEDED)[0] and after["updated_at"] > before["updated_at"]
    other = await db[RESUMES].find_one({"user_id": me_b["id"]})
    assert not has_sample(other["data"]) and other["data"]["personal"]["name"] == "Asha Rao"
    assert (await owner.post("/api/admin/maintenance/sample-cleanup", json={"dryRun": True})).json()["count"] == 0
    rows = {r["email"]: r for r in (await owner.get("/api/admin/shared-resumes")).json()["rows"]}
    assert rows["asha@example.com"]["sample"] is False
    acts = [x["action"] async for x in db[AUDIT_LOG].find({"action": {"$regex": "^maintenance"}}).sort("_id", 1)]
    assert acts == ["maintenance.sample_scan", "maintenance.sample_cleanup", "maintenance.sample_scan"]
