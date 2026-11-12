"""Phase 5 H7: bulk hiring mode. On for 20–500 openings (Verified, the bulk feature on); a bigger shortlist and invites
beyond 10 only with it; batch status and offers; the walk-in drive with a QR link (consent needed, the person lands in
Applicants at Shortlisted); the CSV (contact only where shared; no formula injection); the progress board's counts."""

import csv
import io
from datetime import timedelta

from app.core.db import COMPANIES, HIRE_OFFERS
from app.core.time import IST, now
from app.site import get_site, save_site
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, err, no_network  # noqa: F401
from tests.test_hire_shortlist import post_job, ready
from tests.test_hire_slots import accepted


async def test_bulk_switch_and_batch_sizes(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    for i in range(12):
        await ready(make_client, outbox, f"p{i}@example.com", f"Person{i} Kumar")
    sl = f"/api/company/{cid}/hire/shortlist"
    assert len((await client.get(sl, params={"job": job, "size": 50}, headers=H(session))).json()["items"]) == 10
    keys = [x["key"] for x in (await client.get(sl, params={"job": job}, headers=H(session))).json()["items"]]
    many = keys + ["x1", "x2"]
    r = await client.post(f"/api/company/{cid}/hire/invite", json={"job": job, "people": many}, headers=H(session))
    assert err(r) == "too_many"  # more than 10 at once needs bulk mode
    url = f"/api/company/{cid}/hire/bulk/{job}"
    assert err(await client.put(url, json={"on": True, "openings": 5}, headers=H(session))) == "invalid_input"  # 20–500
    # the feature closed and not granted: refused
    site = await get_site(db)
    await save_site(db, {"hire": {**site["hire"], "open": {**site["hire"]["open"], "bulk": False}}})
    assert err(await client.put(url, json={"on": True, "openings": 50}, headers=H(session))) == "plan"
    await db[COMPANIES].update_one({"_id": cid}, {"$set": {"hire_features": ["bulk"]}})
    assert (await client.put(url, json={"on": True, "openings": 50}, headers=H(session))).json()["openings"] == 50
    items = (await client.get(sl, params={"job": job, "size": 50}, headers=H(session))).json()["items"]
    assert len(items) == 12
    r = await client.post(f"/api/company/{cid}/hire/invite", json={"job": job, "people": [x["key"] for x in items]},
                          headers=H(session))  # fmt: skip
    assert r.json()["sent"] == 12
    b = (await client.get(f"{url}/board", headers=H(session))).json()
    assert b["openings"] == 50 and b["invited"] == 12 and b["accepted"] == 0 and b["filledPct"] == 0


async def test_batch_status_offers_csv_and_board(client, outbox, db, make_client):
    session, cid, job, asha, uid = await accepted(client, outbox, db, make_client)
    *_, bala, uid2 = await accepted(client, outbox, db, make_client, "bala@example.com", "=Bala K", (session, cid, job))
    url = f"/api/company/{cid}/hire/bulk/{job}"
    assert err(await client.get(f"{url}/board", headers=H(session))) == "not_bulk"
    await client.put(url, json={"on": True, "openings": 20}, headers=H(session))
    r = await client.post(f"{url}/status", json={"people": [uid, uid2], "status": "interview"}, headers=H(session))
    assert r.json()["moved"] == 2
    join = (now().astimezone(IST).date() + timedelta(days=10)).isoformat()
    body = {"people": [uid, uid2, "nobody"], "salary": {"amount": 18000, "unit": "month"}, "joinDate": join}
    r = (await client.post(f"{url}/offers", json=body, headers=H(session))).json()
    assert r["sent"] == 2 and r["skipped"] == [{"person": "nobody", "why": "not_ready"}]
    o = await db[HIRE_OFFERS].find_one({"user_id": uid})
    await asha.post(
        f"/api/me/hire/offers/{o['_id']}/answer", json={"answer": "accept", "typedName": "Asha Rao", "agree": True}
    )
    await db[HIRE_OFFERS].update_one({"_id": o["_id"]}, {"$set": {"status": "joined"}})
    b = (await client.get(f"{url}/board", headers=H(session))).json()
    assert (
        b["accepted"] == 2
        and b["offersSent"] == 2
        and b["offersAccepted"] == 1
        and b["joined"] == 1
        and b["filledPct"] == 5
    )
    assert b["stages"] == {"offer": 2}
    text = (await client.get(f"{url}/csv", headers=H(session))).text.lstrip("﻿")
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0][:4] == ["Name", "Stage", "Email", "Phone"] and len(rows) == 3
    byname = {r[0]: r for r in rows[1:]}
    assert byname["Asha Rao"][2] == "asha@example.com" and byname["Asha Rao"][6] == "joined"
    assert "'=Bala K" in byname  # a spreadsheet won't run it as a formula
    _ = bala


async def test_walkin_qr_checkin(client, outbox, db, make_client):
    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    url = f"/api/company/{cid}/hire/bulk/{job}"
    await client.put(url, json={"on": True, "openings": 100}, headers=H(session))
    day = (now().astimezone(IST).date() + timedelta(days=2)).isoformat()
    w = (await client.post(f"{url}/walkin", json={"date": day, "time": "10:00", "place": "Hitech City office"},
                           headers=H(session))).json()  # fmt: skip
    assert w["path"].startswith("/hire/walkin/") and w["checkins"] == []
    walker = await ready(make_client, outbox, "walker@example.com", "Walk In")
    info = (await walker.get(f"/api/hire/walkin/{w['token']}")).json()
    assert info["role"] and info["place"] == "Hitech City office" and not info["checkedIn"]
    assert err(await walker.post(f"/api/hire/walkin/{w['token']}/checkin", json={})) == "consent"
    assert (await walker.post(f"/api/hire/walkin/{w['token']}/checkin", json={"consent": True})).json()["ok"]
    await walker.post(f"/api/hire/walkin/{w['token']}/checkin", json={"consent": True})  # twice: once
    got = (await client.get(f"{url}/walkin", headers=H(session))).json()
    assert [x["name"] for x in got["checkins"]] == ["Walk In"]
    apps = (await client.get(f"/api/company/{cid}/applicants", headers=H(session))).json()["items"]
    assert apps[0]["status"] == "shortlisted" and apps[0]["origin"] == "walkin" and apps[0]["contact"]
    assert err(await walker.get("/api/hire/walkin/not-a-token")) == "not_found"
    assert (await client.get(f"{url}/board", headers=H(session))).json()["checkedIn"] == 1
