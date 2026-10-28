"""Short public resume link (nm7.si/r/<short>): made when the link is turned on, opens the same resume as the link
name, can hide the phone and email, never sends ID numbers, stops when turned off, can't be taken as a link name,
and goes with the account."""

from app.core.db import SHARES
from app.me.erase import erase_user_data
from app.me.service import SHORT_ABC
from tests.conftest import signup
from tests.test_me import RESUME, add_resume, err


async def test_short_link_hide_email_and_revoke(client, outbox, make_client, db):
    await signup(client, outbox, name="Asha Rao")
    data = {**RESUME, "pinfo": {"aadhaar": "2345 6789 0123"}}
    r = await client.post("/api/me/resumes", json={"id": "r1", "name": "Main", "data": data})
    assert r.status_code == 201
    assert (await client.get("/api/me/share")).json()["short"] is None  # nothing until it's turned on
    body = {"on": True, "slug": "asha-rao", "resumeId": "r1", "hidePhone": True, "hideEmail": True}
    sh = (await client.put("/api/me/share", json=body)).json()
    short = sh["short"]
    assert len(short) == 6 and set(short) <= set(SHORT_ABC) and sh["hideEmail"] is True
    viewer = make_client()
    r = await viewer.get(f"/api/public/resumes/{short}")
    assert r.status_code == 200
    p = r.json()["data"]["personal"]
    assert p["phone"] == "" and p["email"] == "" and p["name"] == "Sai Varsha"
    assert "2345" not in r.text  # ID numbers never go out
    # views through either link count for the owner
    await make_client().get("/api/public/resumes/asha-rao")
    assert (await client.get("/api/me/share")).json()["viewCount"] >= 1
    # the code stays the same when settings change
    body["hideEmail"] = False
    sh = (await client.put("/api/me/share", json=body)).json()
    assert sh["short"] == short
    assert (await viewer.get(f"/api/public/resumes/{short}")).json()["data"]["personal"]["email"] == "sai@example.com"
    # someone else can't take the short code as their link name
    other = make_client()
    await signup(other, outbox, "b@example.com", name="Bala")
    r = await other.put("/api/me/share", json={"on": True, "slug": short})
    assert r.status_code == 409 and err(r) == "slug_taken"
    # revoked: both links stop
    await client.put("/api/me/share", json={**body, "on": False})
    assert (await viewer.get(f"/api/public/resumes/{short}")).status_code == 404
    assert (await viewer.post(f"/api/public/resumes/{short}/export")).status_code == 404
    # erased with the account
    uid = (await db[SHARES].find_one({"short": short}))["_id"]
    assert (await erase_user_data(db, uid))["public_links"] == 1


async def test_short_link_export_follows_owner(client, outbox, make_client):
    await signup(client, outbox, name="Asha Rao")
    await add_resume(client, "r1")
    short = (await client.put("/api/me/share", json={"on": True, "slug": "asha-r", "resumeId": "r1"})).json()["short"]
    r = await make_client().post(f"/api/public/resumes/{short}/export")
    assert r.status_code in (200, 402)  # same rule as the link name
