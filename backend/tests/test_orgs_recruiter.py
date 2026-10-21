"""Nm7 for Organizations (Phase 3C): recruiter share links — consent first (group setting + member opt-in), who can
be added, expiry, revoke, the access code, members who leave or opt out vanishing at once, contact details hidden by
default, downloads blocked when off, no ID numbers, the shortlist, branding, and limits."""

from datetime import timedelta

import pytest

from app.core import rate_limit
from app.core.db import AUDIT_LOG, MEMBERSHIPS, RECRUITER_LINKS
from app.core.security import keyed_hash
from app.core.time import now
from tests.test_orgs import RESUME, join, member, setup_group
from tests.test_orgs_kiosk import features
from tests.test_orgs_phase2 import coordinator, second_org


def err(r):
    return r.json()["error"]["code"]


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


@pytest.fixture
async def setup(owner):
    org, g = await setup_group(owner)
    await features(owner, org["id"], recruiter_links=True)
    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.json()["settings"]["shareWithRecruiters"] is True
    return org, r.json()


async def opted_in(make_client, outbox, email, name, opt=True, data=None, roll="21A01"):
    data = data or {**RESUME, "personal": {**RESUME["personal"], "name": name, "email": email}}
    c, _ = await member(make_client, outbox, email, name, data)
    r = await c.post(
        "/api/me/groups/join",
        json={"code": "JNTUA26", "consent": True, "fields": {"roll": roll, "branch": "CSE"}, "resumeId": "r1",
              "recruiterOptIn": opt},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    return c, r.json()


async def make_link(c, org_id, **extra):
    body = {"company": "Acme Hiring", "label": "Campus 2026", **extra}
    r = await c.post(f"/api/org/{org_id}/recruiter-links", json=body)
    assert r.status_code == 201, r.text
    link = r.json()
    return link, link["url"].rsplit("/", 1)[1]


async def test_switched_off_is_404_everywhere_and_other_orgs_cant_reach_links(owner, make_client, outbox):
    org, g = await setup_group(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/recruiter-links"
    assert (await c.get(base)).status_code == 404
    assert (await c.post(base, json={"company": "Acme"})).status_code == 404
    r = await c.patch(f"/api/org/{org['id']}/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    assert r.status_code == 404
    await features(owner, org["id"], recruiter_links=True)
    await c.patch(f"/api/org/{org['id']}/groups/{g['id']}", json={"settings": {"shareWithRecruiters": True}})
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    link, token = await make_link(c, org["id"])
    anon = make_client()
    assert (await anon.get(f"/api/recruit/{token}")).status_code == 200
    # org B's coordinator sees nothing of org A's links
    org_b, _ = await second_org(owner)
    await features(owner, org_b["id"], recruiter_links=True)
    cb, _ = await coordinator(owner, make_client, outbox, org_b["id"], "b@example.com")
    assert (await cb.get(f"/api/org/{org['id']}/recruiter-links")).status_code == 404
    assert (await cb.post(f"/api/org/{org_b['id']}/recruiter-links/{link['id']}/revoke")).status_code == 404
    # switching the feature off ends the public link too
    await features(owner, org["id"], recruiter_links=False)
    assert (await anon.get(f"/api/recruit/{token}")).status_code == 404


async def test_only_approved_opted_in_members_are_added(setup, owner, db, make_client, outbox):
    org, g = setup
    await opted_in(make_client, outbox, "yes@example.com", "Yes Person", roll="R1")
    await opted_in(make_client, outbox, "no@example.com", "No Person", opt=False, roll="R2")
    old, _ = await member(make_client, outbox, "old@example.com", "Earlier Member")
    await join(old, roll="R3")  # joined without the opt-in (like members who joined before Phase 3C)
    # join info and My groups show the opt-in
    info = (await make_client().get("/api/public/join/JNTUA26")).json()
    assert info["group"]["shareWithRecruiters"] is True
    mine = (await old.get("/api/me/groups")).json()[0]
    assert mine["shareWithRecruiters"] is True and mine["recruiterOptIn"] is False
    link, token = await make_link(owner, org["id"])
    assert link["added"] == 1 and link["skipped"] == 2 and link["candidates"] == 1
    names = [c["name"] for c in (await make_client().get(f"/api/recruit/{token}")).json()["candidates"]]
    assert names == ["Yes Person"]
    # nobody eligible: refused
    r = await owner.post(f"/api/org/{org['id']}/recruiter-links", json={"company": "X", "filters": {"q": "No Person"}})
    assert err(r) == "nobody_eligible"
    # the earlier member opts in from My groups; a new link can include them
    r = await old.patch(f"/api/me/groups/{mine['id']}", json={"recruiterOptIn": True})
    assert r.json()["recruiterOptIn"] is True
    link2, _ = await make_link(owner, org["id"])
    assert link2["added"] == 2
    # pending members (approval groups) can't be added
    await db[MEMBERSHIPS].update_many({}, {"$set": {"approval": "pending"}})
    assert err(await owner.post(f"/api/org/{org['id']}/recruiter-links", json={"company": "X"})) == "nobody_eligible"


async def test_viewers_and_limited_coordinators(setup, owner, make_client, outbox):
    org, g = setup
    await opted_in(make_client, outbox, "a@example.com", "A Person")
    v, _ = await coordinator(owner, make_client, outbox, org["id"], "viewer@example.com", role="viewer")
    assert (await v.post(f"/api/org/{org['id']}/recruiter-links", json={"company": "X"})).status_code == 403
    link, _ = await make_link(owner, org["id"])
    assert len((await v.get(f"/api/org/{org['id']}/recruiter-links")).json()) == 1  # can see the list
    assert (await v.post(f"/api/org/{org['id']}/recruiter-links/{link['id']}/revoke")).status_code == 403


async def test_leaving_or_opting_out_removes_a_member_from_every_link_at_once(setup, owner, db, make_client, outbox):
    org, _ = setup
    a, ma = await opted_in(make_client, outbox, "a@example.com", "A Person", roll="R1")
    b, mb = await opted_in(make_client, outbox, "b@example.com", "B Person", roll="R2")
    _, t1 = await make_link(owner, org["id"])
    _, t2 = await make_link(owner, org["id"], company="Beta Corp")
    rec = make_client()
    names = lambda t: [c["name"] for c in rec_list[t]]  # noqa: E731
    rec_list = {t: (await rec.get(f"/api/recruit/{t}")).json()["candidates"] for t in (t1, t2)}
    assert names(t1) == names(t2) == ["A Person", "B Person"]
    cid_b = rec_list[t1][1]["id"]
    await a.patch(f"/api/me/groups/{ma['id']}", json={"recruiterOptIn": False})
    await b.post(f"/api/me/groups/{mb['id']}/leave")
    for t in (t1, t2):
        assert (await rec.get(f"/api/recruit/{t}")).json()["candidates"] == []
    assert (await rec.get(f"/api/recruit/{t1}/candidates/{cid_b}")).status_code == 404
    # rejected by the organization: gone too
    await a.patch(f"/api/me/groups/{ma['id']}", json={"recruiterOptIn": True})
    assert len((await rec.get(f"/api/recruit/{t1}")).json()["candidates"]) == 1
    await db[MEMBERSHIPS].update_one({"_id": ma["id"]}, {"$set": {"approval": "rejected"}})
    assert (await rec.get(f"/api/recruit/{t1}")).json()["candidates"] == []


async def test_contact_hidden_by_default_answers_chosen_no_id_numbers(setup, owner, make_client, outbox):
    org, _ = setup
    data = {
        **RESUME,
        "personal": {**RESUME["personal"], "headline": "Aadhaar 2345 6789 0123"},
        "pinfo": {"address": "1 Main Road, Anantapur", "father": "R Rao"},
    }
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=data)
    _, token = await make_link(owner, org["id"], answerKeys=["roll"])
    rec = make_client()
    page = (await rec.get(f"/api/recruit/{token}")).json()
    c = page["candidates"][0]
    assert "email" not in c and "phone" not in c and page["includeContact"] is False
    assert c["answers"] == {"Roll number": "21A01"} and page["answerLabels"] == ["Roll number"]  # branch not chosen
    assert c["headline"] == "" and "2345" not in str(page)
    one = (await rec.get(f"/api/recruit/{token}/candidates/{c['id']}")).json()
    p = one["data"]["personal"]
    assert p["email"] == "" and p["phone"] == "" and p["headline"] == ""
    assert "pinfo" not in one["data"]  # the whole section, not only the address
    assert [e["company"] for e in one["data"]["exp"]] == ["Infosys"]  # hidden entries stay hidden
    assert one["stamp"].startswith("Shared with Acme Hiring via Nm7 · expires ")
    # with contact details included
    _, token2 = await make_link(owner, org["id"], includeContact=True)
    c2 = (await rec.get(f"/api/recruit/{token2}")).json()["candidates"][0]
    assert c2["email"] == "asha@example.com"
    d2 = (await rec.get(f"/api/recruit/{token2}/candidates/{c2['id']}")).json()["data"]["personal"]
    assert d2["phone"] == "+91 98765 43210"


async def test_recruiter_hides_pinfo_and_location_without_include_contact(setup, owner, make_client, outbox):
    org, _ = setup
    pinfo = {
        "father": "R Rao",
        "mother": "S Lakshmi",
        "dob": "2003-05-15",
        "gender": "Female",
        "marital": "Single",
        "nationality": "Indian",
        "languages": "Telugu, English",
        "address": "1 Main Road, Anantapur",
    }
    personal = {**RESUME["personal"], "name": "Asha Rao", "location": "Anantapur, AP", "level": "Fresher (0–1 yr)"}
    photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD"
    data = {**RESUME, "personal": personal, "pinfo": pinfo, "hidden": {"pinfo": False}}
    data.update(photo=photo, showPhoto=True)
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao", data=data)
    rec = make_client()
    _, token = await make_link(owner, org["id"])
    cid = (await rec.get(f"/api/recruit/{token}")).json()["candidates"][0]["id"]
    for d in (
        (await rec.get(f"/api/recruit/{token}/candidates/{cid}")).json()["data"],
        (await rec.post(f"/api/recruit/{token}/downloads", json={})).json()["items"][0]["data"],
    ):
        assert "pinfo" not in d and "photo" not in d and d["showPhoto"] is False  # a face is personal too
        assert d["personal"] == {**personal, "email": "", "phone": "", "location": ""}
        s = str(d)
        assert not any(v in s for v in ("R Rao", "Lakshmi", "2003", "Female", "Single", "Main Road", ", AP"))
    # with contact details included, everything the member prints is there
    _, token2 = await make_link(owner, org["id"], includeContact=True)
    cid2 = (await rec.get(f"/api/recruit/{token2}")).json()["candidates"][0]["id"]
    d2 = (await rec.get(f"/api/recruit/{token2}/candidates/{cid2}")).json()["data"]
    assert d2["pinfo"] == pinfo and d2["personal"] == personal
    assert d2["photo"] == photo and d2["showPhoto"] is True


async def test_downloads_only_when_allowed(setup, owner, db, make_client, outbox):
    org, _ = setup
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    _, off = await make_link(owner, org["id"], allowDownloads=False)
    rec = make_client()
    r = await rec.post(f"/api/recruit/{off}/downloads", json={})
    assert r.status_code == 403 and err(r) == "downloads_off"
    assert (await rec.get(f"/api/recruit/{off}")).json()["allowDownloads"] is False
    link, on = await make_link(owner, org["id"])
    r = await rec.post(f"/api/recruit/{on}/downloads", json={})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert [i["name"] for i in r.json()["items"]] == ["Asha Rao"]
    listed = next(x for x in (await owner.get(f"/api/org/{org['id']}/recruiter-links")).json() if x["id"] == link["id"])
    assert (listed["views"], listed["downloads"]) == (0, 1)


async def test_expiry_extend_revoke_and_the_expired_page(setup, owner, db, make_client, outbox):
    org, _ = setup
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    assert (
        await owner.post(f"/api/org/{org['id']}/recruiter-links", json={"company": "X", "days": 91})
    ).status_code == 422
    link, token = await make_link(owner, org["id"])
    assert link["expiresAt"] - int(now().timestamp() * 1000) > 13 * 86_400_000  # 14 days by default
    rec = make_client()
    await db[RECRUITER_LINKS].update_one({"_id": link["id"]}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    r = await rec.get(f"/api/recruit/{token}")
    assert r.status_code == 410 and err(r) == "link_expired"
    r = await owner.post(f"/api/org/{org['id']}/recruiter-links/{link['id']}/extend", json={"days": 30})
    assert r.json()["state"] == "active"
    assert (await rec.get(f"/api/recruit/{token}")).status_code == 200
    r = await owner.post(f"/api/org/{org['id']}/recruiter-links/{link['id']}/revoke")
    assert r.json()["state"] == "revoked"
    assert err(await rec.get(f"/api/recruit/{token}")) == "link_expired"
    assert (await owner.post(f"/api/org/{org['id']}/recruiter-links/{link['id']}/extend", json={})).status_code == 400
    assert (await rec.get("/api/recruit/nope")).status_code == 404


async def test_access_code_is_hashed_and_rate_limited(setup, owner, db, make_client, outbox):
    org, _ = setup
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    link, token = await make_link(owner, org["id"], accessCode=True)
    code = link["accessCode"]
    assert len(code) == 6 and link["hasCode"] is True
    doc = await db[RECRUITER_LINKS].find_one({"_id": link["id"]})
    assert code not in str(doc) and token not in str(doc) and doc["token_hash"] == keyed_hash("recruiter", token)
    assert "accessCode" not in (await owner.get(f"/api/org/{org['id']}/recruiter-links")).json()[0]
    rec = make_client()
    assert err(await rec.get(f"/api/recruit/{token}")) == "code_required"
    bad = "000000" if code != "000000" else "111111"
    assert err(await rec.get(f"/api/recruit/{token}", headers={"X-Access-Code": bad})) == "wrong_code"
    assert (await rec.get(f"/api/recruit/{token}", headers={"X-Access-Code": code})).status_code == 200
    for _ in range(9):
        await rec.get(f"/api/recruit/{token}", headers={"X-Access-Code": bad})
    assert (await rec.get(f"/api/recruit/{token}", headers={"X-Access-Code": code})).status_code == 429


async def test_rate_limit_per_link(setup, owner, db, make_client, outbox):
    org, _ = setup
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao")
    _, token = await make_link(owner, org["id"])
    key = rate_limit.stored(f"recruit:{keyed_hash('recruiter', token)[:24]}")
    await db["rate_events"].insert_many([{"key": key, "at": now()} for _ in range(600)])
    assert (await make_client().get(f"/api/recruit/{token}")).status_code == 429


async def test_shortlist_shows_for_the_coordinator_and_audit_has_no_ips(setup, owner, db, make_client, outbox):
    org, _ = setup
    await opted_in(make_client, outbox, "a@example.com", "A Person", roll="R1")
    await opted_in(make_client, outbox, "b@example.com", "B Person", roll="R2")
    link, token = await make_link(owner, org["id"])
    rec = make_client()
    cands = (await rec.get(f"/api/recruit/{token}")).json()["candidates"]
    r = await rec.post(f"/api/recruit/{token}/candidates/{cands[1]['id']}/interest", json={"interested": True})
    assert r.json() == {"id": cands[1]["id"], "interested": True}
    assert [c["interested"] for c in (await rec.get(f"/api/recruit/{token}")).json()["candidates"]] == [False, True]
    rows = (await owner.get(f"/api/org/{org['id']}/shared-resumes?shortlistedBy={link['id']}")).json()["rows"]
    assert [r["name"] for r in rows] == ["B Person"]
    assert rows[0]["shortlistedBy"] == [{"linkId": link["id"], "company": "Acme Hiring"}]
    await rec.post(f"/api/recruit/{token}/candidates/{cands[1]['id']}/interest", json={"interested": False})
    assert (await owner.get(f"/api/org/{org['id']}/shared-resumes?shortlistedBy={link['id']}")).json()["rows"] == []
    await owner.post(f"/api/org/{org['id']}/recruiter-links/{link['id']}/revoke")
    actions = [e async for e in db[AUDIT_LOG].find({"target": link["id"]}).sort("_id", 1)]
    assert [e["action"] for e in actions] == [
        "share_create", "share_view", "share_shortlist", "share_view", "share_shortlist", "share_revoke",
    ]  # fmt: skip
    assert all(e.get("ip") is None for e in actions if e["action"] != "share_create" and e["action"] != "share_revoke")
    assert all(e["data"]["link"] == link["id"] for e in actions if e["action"].startswith("share_v"))
    acts = {e["action"] for e in (await owner.get(f"/api/org/{org['id']}/audit")).json()}
    assert {"share_create", "share_view", "share_shortlist", "share_revoke"} <= acts
