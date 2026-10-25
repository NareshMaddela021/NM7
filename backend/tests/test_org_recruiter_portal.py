"""Recruiter portal (colleges, Phase 3): invites by group, the emailed one-time code, expiry and revoke, consent
(withdrawing removes a student at once), only the groups and branches given, coordinator isolation, contact rules
(hidden / shown / after shortlist), search filters with skill synonyms, job match on Campus only, the shortlist board
and "Shortlisted by" for students, downloads (allowed, rate-limited), plan limits (Drive 1, Campus unlimited), no ID
numbers, everything in the Activity log, and the demo invite."""

from datetime import timedelta

import pytest

from app.core.db import AUDIT_LOG, MEMBERSHIPS, RECRUITER_INVITES
from app.core.time import IST, now
from app.orgs import demo
from tests.test_orgs import RESUME, setup_group
from tests.test_orgs_phase2 import coordinator, second_org
from tests.test_orgs_recruiter import opted_in

JD = (
    "We are hiring a Data Analyst. Must have: Python, SQL and Power BI. Good to have: Tableau. "
    "Freshers welcome. Location: Hyderabad."
)


def err(r):
    return r.json()["error"]["code"]


def day(n=30):
    return (now().astimezone(IST).date() + timedelta(days=n)).isoformat()


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


async def plan(owner, org_id, plan_id):
    r = await owner.put(f"/api/admin/orgs/{org_id}/billing/plan", json={"planId": plan_id})
    assert r.status_code == 200, r.text


@pytest.fixture
async def campus(owner):
    """JNTU Anantapur on Campus; its group shares with recruiters."""
    org, g = await setup_group(owner)
    await plan(owner, org["id"], "campus")
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.status_code == 200, r.text
    return org, r.json()


def resume(name, email, skills="Python, SQL", grade="8.4 CGPA", **extra):
    return {
        **RESUME,
        "personal": {**RESUME["personal"], "name": name, "email": email},
        "edu": [{"institution": "JNTU Anantapur", "degree": "B.Tech", "grade": grade, "to": "2026-05"}],
        "skillGroups": [{"label": "Skills", "value": skills}],
        **extra,
    }


async def invite(c, org_id, group_ids, **extra):
    body = {
        "company": "Acme Analytics",
        "recruiterName": "Ravi K",
        "email": "ravi@acme.example",
        "groupIds": group_ids,
        "expiresOn": day(),
        **extra,
    }
    r = await c.post(f"/api/org/{org_id}/recruiter-invites", json=body)
    assert r.status_code == 201, r.text
    return r.json(), r.json()["url"].rsplit("/", 1)[1]


async def sign_in(rec, outbox, token, email="ravi@acme.example"):
    r = await rec.post(f"/api/recruiter/{token}/code")
    assert r.status_code == 200 and r.json()["sent"] is True, r.text
    r = await rec.post(f"/api/recruiter/{token}/session", json={"code": outbox.last_code(email)})
    assert r.status_code == 200, r.text
    return {"X-Recruiter-Session": r.json()["session"]}


async def test_email_code_session_expiry_and_revoke(campus, owner, db, make_client, outbox):
    org, g = campus
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=resume("Asha Rao", "asha@example.com"))
    inv, token = await invite(owner, org["id"], [g["id"]])
    assert inv["state"] == "active" and inv["emailSent"] is True
    assert any(m.to == "ravi@acme.example" and token in m.text for m in outbox.sent)  # the invite email
    doc = await db[RECRUITER_INVITES].find_one({"_id": inv["id"]})
    assert token not in str(doc)  # only a keyed hash of the link is stored
    rec = make_client()
    info = (await rec.get(f"/api/recruiter/{token}")).json()
    assert info["company"] == "Acme Analytics" and info["emailHint"].startswith("ra") and "acme" in info["emailHint"]
    # no session: nothing to see
    r = await rec.get(f"/api/recruiter/{token}/candidates")
    assert r.status_code == 401 and err(r) == "session_required"
    # a wrong code, then the right one; a code works once
    await rec.post(f"/api/recruiter/{token}/code")
    code = outbox.last_code("ravi@acme.example")
    assert code not in str(await db[RECRUITER_INVITES].find_one({"_id": inv["id"]}))
    bad = "000000" if code != "000000" else "111111"
    assert err(await rec.post(f"/api/recruiter/{token}/session", json={"code": bad})) == "wrong_code"
    r = await rec.post(f"/api/recruiter/{token}/session", json={"code": code})
    assert r.status_code == 200
    h = {"X-Recruiter-Session": r.json()["session"]}
    assert err(await rec.post(f"/api/recruiter/{token}/session", json={"code": code})) == "wrong_code"
    assert [
        c["name"] for c in (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()["candidates"]
    ] == ["Asha Rao"]
    assert (
        await rec.get(f"/api/recruiter/{token}/candidates", headers={"X-Recruiter-Session": "x" * 40})
    ).status_code == 401
    # an expired code doesn't work
    await rec.post(f"/api/recruiter/{token}/code")
    code = outbox.last_code("ravi@acme.example")
    await db[RECRUITER_INVITES].update_one({"_id": inv["id"]}, {"$set": {"code_exp": now() - timedelta(seconds=1)}})
    assert err(await rec.post(f"/api/recruiter/{token}/session", json={"code": code})) == "wrong_code"
    # the invite expires: 410 everywhere, the session too
    await db[RECRUITER_INVITES].update_one({"_id": inv["id"]}, {"$set": {"expires_at": now() - timedelta(minutes=1)}})
    assert (await rec.get(f"/api/recruiter/{token}")).status_code == 410
    assert (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).status_code == 410
    # extended: back (the old session still within its 12 hours)
    r = await owner.post(f"/api/org/{org['id']}/recruiter-invites/{inv['id']}/extend", json={"expiresOn": day(10)})
    assert r.status_code == 200 and r.json()["state"] == "active"
    assert (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).status_code == 200
    # an expiry date too far ahead or in the past is refused
    for bad_day in (day(-1), day(200)):
        r = await owner.post(f"/api/org/{org['id']}/recruiter-invites/{inv['id']}/extend", json={"expiresOn": bad_day})
        assert err(r) == "bad_expiry"
    # revoked: gone, sessions cleared
    r = await owner.post(f"/api/org/{org['id']}/recruiter-invites/{inv['id']}/revoke")
    assert r.json()["state"] == "revoked"
    assert (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).status_code == 410
    # five codes a day
    _, t2 = await invite(owner, org["id"], [g["id"]])
    for _ in range(5):
        assert (await rec.post(f"/api/recruiter/{t2}/code")).status_code == 200
    assert (await rec.post(f"/api/recruiter/{t2}/code")).status_code == 429


async def test_only_consenting_students_in_the_groups_and_branches_given(campus, owner, db, make_client, outbox):
    org, g = campus
    a, ma = await opted_in(
        make_client, outbox, "a@example.com", "A Person", roll="R1", data=resume("A Person", "a@example.com")
    )
    await opted_in(
        make_client, outbox, "b@example.com", "B Person", opt=False, roll="R2", data=resume("B Person", "b@example.com")
    )
    c, mc = await opted_in(
        make_client, outbox, "c@example.com", "C Person", roll="R3", data=resume("C Person", "c@example.com")
    )
    await db[MEMBERSHIPS].update_one({"_id": mc["id"]}, {"$set": {"field_values": {"roll": "R3", "branch": "ECE"}}})
    # a second group of the same college, not given to this recruiter
    g2 = (
        await owner.post(
            f"/api/admin/orgs/{org['id']}/groups",
            json={"name": "MBA 2026", "code": "JNTUMBA", "settings": {"shareWithRecruiters": True}},
        )
    ).json()
    _, md = await opted_in(
        make_client, outbox, "d@example.com", "D Person", roll="R4", data=resume("D Person", "d@example.com")
    )
    await db[MEMBERSHIPS].update_one({"_id": md["id"]}, {"$set": {"group_id": g2["id"]}})
    _, token = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    page = (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()
    assert [x["name"] for x in page["candidates"]] == ["A Person", "C Person"] and page["branches"] == ["CSE", "ECE"]
    # only the CSE branch
    _, t_cse = await invite(owner, org["id"], [g["id"]], branches=["CSE"])
    h2 = await sign_in(rec, outbox, t_cse)
    page = (await rec.get(f"/api/recruiter/{t_cse}/candidates", headers=h2)).json()
    assert [x["name"] for x in page["candidates"]] == ["A Person"]
    cid_a = page["candidates"][0]["id"]
    # withdrawing consent removes a student at once (list, one resume, board, downloads)
    await rec.put(f"/api/recruiter/{t_cse}/board/{cid_a}", headers=h2, json={"stage": "shortlisted"})
    await a.patch(f"/api/me/groups/{ma['id']}", json={"recruiterOptIn": False})
    assert (await rec.get(f"/api/recruiter/{t_cse}/candidates", headers=h2)).json()["candidates"] == []
    assert (await rec.get(f"/api/recruiter/{t_cse}/candidates/{cid_a}", headers=h2)).status_code == 404
    assert err(await rec.post(f"/api/recruiter/{t_cse}/downloads", headers=h2, json={})) == "nothing_to_download"
    # leaving: gone too
    await c.post(f"/api/me/groups/{mc['id']}/leave")
    assert (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()["candidates"] == []
    # a group that doesn't share with recruiters can't be given
    g3 = (await owner.post(f"/api/admin/orgs/{org['id']}/groups", json={"name": "Diploma", "code": "JNTUDIP"})).json()
    r = await owner.post(
        f"/api/org/{org['id']}/recruiter-invites",
        json={"company": "X", "recruiterName": "Y", "email": "y@x.example", "groupIds": [g3["id"]], "expiresOn": day()},
    )
    assert err(r) == "group_not_shared"


async def test_coordinator_isolation(campus, owner, make_client, outbox):
    org, g = campus
    await opted_in(make_client, outbox, "a@example.com", "A Person", data=resume("A Person", "a@example.com"))
    inv, _ = await invite(owner, org["id"], [g["id"]])
    other, og = await second_org(owner)
    await plan(owner, other["id"], "campus")
    coord, _ = await coordinator(owner, make_client, outbox, other["id"], email="other@example.com")
    base = f"/api/org/{org['id']}"
    for r in (
        await coord.get(f"{base}/recruiter-invites"),
        await coord.get(f"{base}/recruiter-invites/{inv['id']}/activity"),
        await coord.post(f"{base}/recruiter-invites/{inv['id']}/revoke"),
        await coord.post(
            f"{base}/recruiter-invites",
            json={
                "company": "X",
                "recruiterName": "Y",
                "email": "y@x.example",
                "groupIds": [g["id"]],
                "expiresOn": day(),
            },
        ),
    ):
        assert r.status_code == 404, r.text
    # its own organization: can't give another organization's group either
    r = await coord.post(
        f"/api/org/{other['id']}/recruiter-invites",
        json={"company": "X", "recruiterName": "Y", "email": "y@x.example", "groupIds": [g["id"]], "expiresOn": day()},
    )
    assert r.status_code == 404
    assert (await coord.get(f"/api/org/{other['id']}/recruiter-invites")).json()["invites"] == []


async def test_contact_rules_no_id_numbers_and_the_activity_log(campus, owner, db, make_client, outbox):
    org, g = campus
    data = resume(
        "Asha Rao",
        "asha@example.com",
        headline="Aadhaar 2345 6789 0123",
        pinfo={"address": "1 Main Road, Anantapur"},
        certs=[{"name": "PAN ABCDE1234F"}, {"name": "AWS CCP"}],
    )
    data["personal"]["headline"] = "Aadhaar 2345 6789 0123"
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=data)
    rec = make_client()
    # hidden (the default)
    _, t1 = await invite(owner, org["id"], [g["id"]])
    h1 = await sign_in(rec, outbox, t1)
    page = (await rec.get(f"/api/recruiter/{t1}/candidates", headers=h1)).json()
    c = page["candidates"][0]
    assert (
        "email" not in c and "phone" not in c and c["headline"] == "" and c["certs"] == ["PAN", "AWS CCP"]
    )  # the number itself went at save
    one = (await rec.get(f"/api/recruiter/{t1}/candidates/{c['id']}", headers=h1)).json()
    assert (
        one["data"]["personal"]["email"] == "" and one["data"]["personal"]["phone"] == "" and "pinfo" not in one["data"]
    )
    for blob in (page, one):
        assert "2345" not in str(blob) and "ABCDE1234F" not in str(blob)
    # only after shortlisting
    _, t2 = await invite(owner, org["id"], [g["id"]], contact="after_shortlist")
    h2 = await sign_in(rec, outbox, t2)
    cid = (await rec.get(f"/api/recruiter/{t2}/candidates", headers=h2)).json()["candidates"][0]["id"]
    assert "email" not in (await rec.get(f"/api/recruiter/{t2}/candidates/{cid}", headers=h2)).json()
    r = await rec.put(f"/api/recruiter/{t2}/board/{cid}", headers=h2, json={"stage": "shortlisted", "note": "Good SQL"})
    assert r.json()["email"] == "asha@example.com" and r.json()["note"] == "Good SQL"
    one = (await rec.get(f"/api/recruiter/{t2}/candidates/{cid}", headers=h2)).json()
    assert one["data"]["personal"]["phone"] == "+91 98765 43210"
    # shown
    _, t3 = await invite(owner, org["id"], [g["id"]], contact="shown")
    h3 = await sign_in(rec, outbox, t3)
    assert (await rec.get(f"/api/recruiter/{t3}/candidates", headers=h3)).json()["candidates"][0][
        "email"
    ] == "asha@example.com"
    # every login, search, view and stage change is in the organization's Activity log, without IP addresses
    acts = [
        a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"], "action": {"$regex": "^recruiter_"}})
    ]
    for a in ("recruiter_invite", "recruiter_login", "recruiter_search", "recruiter_view", "recruiter_stage"):
        assert a in acts, a
    async for a in db[AUDIT_LOG].find({"action": {"$in": ["recruiter_login", "recruiter_search", "recruiter_view"]}}):
        assert not a.get("ip")
    log = (await owner.get("/api/admin/org-audit")).json()  # the Activity log shows these actions
    assert {"recruiter_login", "recruiter_view", "recruiter_stage"} <= {e["action"] for e in log}
    inv_id = (await owner.get(f"/api/org/{org['id']}/recruiter-invites")).json()["invites"][-1]["id"]
    act = (await owner.get(f"/api/org/{org['id']}/recruiter-invites/{inv_id}/activity")).json()
    assert {"recruiter_login", "recruiter_search", "recruiter_view"} <= {x["action"] for x in act}


async def test_search_filters_and_skill_synonyms(campus, owner, make_client, outbox):
    org, g = campus
    await opted_in(
        make_client,
        outbox,
        "a@example.com",
        "A Person",
        roll="R1",
        data=resume(
            "A Person",
            "a@example.com",
            skills="Python, PostgreSQL, Power BI",
            grade="8.6 CGPA",
            certs=[{"name": "AWS Cloud Practitioner"}],
            langs=[{"name": "Telugu"}],
        ),
    )
    await opted_in(
        make_client,
        outbox,
        "b@example.com",
        "B Person",
        roll="R2",
        data=resume("B Person", "b@example.com", skills="Java", grade="6.9 CGPA", exp=[]),
    )
    _, token = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await sign_in(rec, outbox, token)

    async def names(**params):
        r = await rec.get(f"/api/recruiter/{token}/candidates", headers=h, params=params)
        assert r.status_code == 200, r.text
        return [x["name"] for x in r.json()["candidates"]]

    assert await names() == ["A Person", "B Person"]
    assert await names(skills="postgres") == ["A Person"]  # a synonym of PostgreSQL
    assert await names(skills="Python,Power BI") == ["A Person"]
    assert await names(skills="Java") == ["B Person"]
    assert await names(cgpaMin=8) == ["A Person"]
    assert await names(cgpaMax=7) == ["B Person"]
    assert await names(year=2026) == ["A Person", "B Person"]
    assert await names(year=2025) == []
    assert await names(internship="true") == ["A Person"]
    assert await names(cert="aws") == ["A Person"]
    assert await names(language="telugu") == ["A Person"]
    assert await names(branch="ECE") == []
    a = (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()["candidates"][0]
    assert a["cgpa"] == 8.6 and a["year"] == 2026 and "PostgreSQL" in a["skills"] and isinstance(a["ats"], int)


async def test_job_match_on_campus_only(campus, owner, make_client, outbox):
    org, g = campus
    await opted_in(
        make_client,
        outbox,
        "a@example.com",
        "A Person",
        roll="R1",
        data=resume("A Person", "a@example.com", skills="Python, SQL, Power BI, Tableau"),
    )
    await opted_in(
        make_client,
        outbox,
        "b@example.com",
        "B Person",
        roll="R2",
        data=resume("B Person", "b@example.com", skills="Java"),
    )
    _, token = await invite(owner, org["id"], [g["id"]])
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    r = await rec.post(f"/api/recruiter/{token}/match", headers=h, json={"jd": JD})
    assert r.status_code == 200, r.text
    got = r.json()["candidates"]
    assert [x["name"] for x in got] == ["A Person", "B Person"] and got[0]["match"] > got[1]["match"]
    assert "SQL" in got[0]["found"] and "SQL" in got[1]["missing"]
    # Drive: no job match mode
    await plan(owner, org["id"], "drive")
    r = await rec.post(f"/api/recruiter/{token}/match", headers=h, json={"jd": JD})
    assert r.status_code == 402 and err(r) == "plan_feature"
    assert (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()["jobMatch"] is False


async def test_plan_limits_drive_one_campus_unlimited_free_none(owner, make_client, outbox):
    org, g = await setup_group(owner)
    coord, _ = await coordinator(owner, make_client, outbox, org["id"])
    body = {"company": "X", "recruiterName": "Y", "email": "y@x.example", "groupIds": [g["id"]], "expiresOn": day()}
    url = f"/api/org/{org['id']}/recruiter-invites"
    # Free: recruiter links aren't in the plan (switched off reads as not there, as for recruiter links)
    assert (await coord.post(url, json=body)).status_code == 404
    await plan(owner, org["id"], "drive")
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.json()["settings"]["shareWithRecruiters"] is True
    first = await coord.post(url, json=body)
    assert first.status_code == 201, first.text
    r = await coord.post(url, json=body)
    assert r.status_code == 409 and err(r) == "plan_limit"
    # a revoked invite frees the place
    await coord.post(f"{url}/{first.json()['id']}/revoke")
    assert (await coord.post(url, json=body)).status_code == 201
    await plan(owner, org["id"], "campus")
    for _ in range(3):
        assert (await coord.post(url, json=body)).status_code == 201


async def test_board_downloads_csv_and_shortlisted_by_for_students(campus, owner, db, make_client, outbox):
    org, g = campus
    a, ma = await opted_in(
        make_client, outbox, "a@example.com", "A Person", roll="R1", data=resume("A Person", "a@example.com")
    )
    await opted_in(
        make_client, outbox, "b@example.com", "B Person", roll="R2", data=resume("B Person", "b@example.com")
    )
    _, token = await invite(owner, org["id"], [g["id"]], contact="after_shortlist")
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    cands = (await rec.get(f"/api/recruiter/{token}/candidates", headers=h)).json()["candidates"]
    cid_a = cands[0]["id"]
    # nothing on the board: nothing to download
    assert err(await rec.post(f"/api/recruiter/{token}/downloads", headers=h, json={})) == "nothing_to_download"
    for stage in ("shortlisted", "interview", "selected"):
        r = await rec.put(f"/api/recruiter/{token}/board/{cid_a}", headers=h, json={"stage": stage, "note": "n"})
        assert r.json()["stage"] == stage
    assert (
        err(await rec.put(f"/api/recruiter/{token}/board/{cid_a}", headers=h, json={"stage": "hired"}))
        == "invalid_input"
    )
    await rec.put(f"/api/recruiter/{token}/board/{cands[1]['id']}", headers=h, json={"stage": "rejected"})
    dl = (await rec.post(f"/api/recruiter/{token}/downloads", headers=h, json={})).json()
    # the board without the rejected
    assert [i["name"] for i in dl["items"]] == ["A Person"] and dl["stamp"].startswith("Shared with Acme Analytics")
    assert dl["items"][0]["data"]["personal"]["email"] == "a@example.com"  # contact after shortlist
    assert "B Person" in str(
        (await rec.post(f"/api/recruiter/{token}/downloads", headers=h, json={"ids": [c["id"] for c in cands]})).json()
    )
    csv = await rec.get(f"/api/recruiter/{token}/board.csv", headers=h)
    # the whole board
    assert csv.status_code == 200 and "A Person" in csv.text and "selected" in csv.text and "rejected" in csv.text
    # the coordinator's table and the dashboard count it
    rows = (await owner.get("/api/admin/shared-resumes", params={"orgId": org["id"]})).json()
    rows = rows if isinstance(rows, list) else rows.get("rows", rows.get("items", []))
    a_row = next(r for r in rows if r["name"] == "A Person")
    assert [x["company"] for x in a_row["shortlistedBy"]] == ["Acme Analytics"]
    # students see "Shortlisted by" only when the organization allows it
    me = lambda: a.get("/api/me/groups")  # noqa: E731
    groups = (await me()).json()
    groups = groups if isinstance(groups, list) else groups["groups"]
    assert groups[0]["shortlistedBy"] == []
    r = await owner.put(f"/api/org/{org['id']}/recruiter-settings", json={"showShortlist": True})
    assert r.status_code == 200
    groups = (await me()).json()
    groups = groups if isinstance(groups, list) else groups["groups"]
    assert groups[0]["shortlistedBy"] == ["Acme Analytics"]
    # downloads off for an invite: refused
    _, t2 = await invite(owner, org["id"], [g["id"]], allowPdf=False)
    h2 = await sign_in(rec, outbox, t2)
    r = await rec.post(f"/api/recruiter/{t2}/downloads", headers=h2, json={"ids": [cid_a]})
    assert r.status_code == 403 and err(r) == "downloads_off"
    # rate limit: 20 download requests an hour (2 made above)
    for _ in range(18):
        assert (await rec.post(f"/api/recruiter/{token}/downloads", headers=h, json={})).status_code == 200
    assert (await rec.post(f"/api/recruiter/{token}/downloads", headers=h, json={})).status_code == 429


async def test_demo_invite(owner, db, make_client):
    made = await demo.create_demo(db, None)
    path = made["recruiterPath"]
    token, session = path.removeprefix("/recruiter/").split("#s=")
    rec = make_client()
    page = (await rec.get(f"/api/recruiter/{token}/candidates", headers={"X-Recruiter-Session": session})).json()
    assert page["company"].endswith("(demo)") and page["candidates"]
    assert any(c["stage"] == "shortlisted" for c in page["candidates"])
    await demo.remove_demo(db)
    assert await db[RECRUITER_INVITES].count_documents({"org_id": demo.ORG_ID}) == 0
