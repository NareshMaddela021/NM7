"""One Share button for all apps: the per-channel share counter (no personal data), the link-preview page for share
robots (Open Graph + Twitter tags, every job text escaped), the Daily report line, and "Applied ✓" on every card
(GET /api/me/applied-jobs)."""

from datetime import timedelta

from app.admin import daily
from app.core.db import JOBS, RATE_EVENTS, SHARE_EVENTS
from app.core.time import ist_day, now
from app.jobs import share
from tests.conftest import signup
from tests.test_jobs_public import add


async def test_share_taps_are_counted_per_channel_and_nothing_personal_is_kept(client, db):
    for ch in ("whatsapp", "whatsapp", "copy", "native", "linkedin", "telegram", "facebook", "x", "email"):
        r = await client.post("/api/public/shares", json={"channel": ch})
        assert r.status_code == 204, r.text
        assert "set-cookie" not in r.headers
    # an unknown channel (or none, or something extra) is refused
    assert (await client.post("/api/public/shares", json={"channel": "myspace"})).status_code == 422
    assert (await client.post("/api/public/shares", json={})).status_code == 422
    rows = await db[SHARE_EVENTS].find().to_list(None)
    by = {r["channel"]: r["n"] for r in rows}
    assert by == {
        "whatsapp": 2,
        "copy": 1,
        "native": 1,
        "linkedin": 1,
        "telegram": 1,
        "facebook": 1,
        "x": 1,
        "email": 1,
    }
    assert all(set(r) == {"_id", "day", "channel", "n"} for r in rows)  # no user, ip, agent or link stored
    assert {r["day"] for r in rows} == {ist_day()}
    # the rate limit keeps only a salted hash of the address
    keys = [e["key"] async for e in db[RATE_EVENTS].find({"key": {"$regex": "^share:"}})]
    assert keys and all("127.0.0.1" not in k and "testclient" not in k for k in keys)


async def test_signed_in_share_is_still_anonymous(client, db, outbox):
    await signup(client, outbox)
    assert (await client.post("/api/public/shares", json={"channel": "copy"})).status_code == 204
    row = await db[SHARE_EVENTS].find_one({})
    assert set(row) == {"_id", "day", "channel", "n"}


async def test_over_the_rate_limit_is_not_counted(client, db, monkeypatch):
    monkeypatch.setattr(share, "RULES", [(2, timedelta(hours=1))])
    for _ in range(4):
        assert (await client.post("/api/public/shares", json={"channel": "x"})).status_code == 204
    assert (await db[SHARE_EVENTS].find_one({}))["n"] == 2


async def test_daily_report_line_and_daily_numbers(admin_client, client, db):
    y = ist_day(now() - timedelta(days=1))
    for ch, n in (("whatsapp", 7), ("copy", 3), ("linkedin", 2)):
        await db[SHARE_EVENTS].insert_one({"_id": f"{y}:{ch}", "day": y, "channel": ch, "n": n})
    await db[SHARE_EVENTS].insert_one({"_id": f"{ist_day()}:x", "day": ist_day(), "channel": "x", "n": 5})  # today
    owner = await admin_client("owner")
    d = (await owner.get("/api/admin/daily-report")).json()
    assert d["shares"]["total"] == 12
    assert d["shares"]["text"] == "Shares yesterday: 12 (WhatsApp 7, Copy link 3, LinkedIn 2)."
    assert d["shares"]["byChannel"] == {"whatsapp": 7, "copy": 3, "linkedin": 2}
    assert len(d["summary"]) == 5
    # nothing yet
    await db[SHARE_EVENTS].delete_many({})
    assert (await owner.get("/api/admin/daily-report")).json()["shares"]["text"] == "Shares yesterday: 0."
    # the daily email numbers
    await db[SHARE_EVENTS].insert_one({"_id": f"{ist_day()}:copy", "day": ist_day(), "channel": "copy", "n": 4})
    t = (await owner.get("/api/admin/today")).json()
    assert t["shares"] == 4 and "Shares: 4" in t["text"]
    assert "Shares: 0" in daily.message({**t, "shares": 0}, "x")


async def test_preview_page_has_the_tags_and_escapes_job_text(client, db):
    j = await add(db, title='Data <script>alert(1)</script> "Analyst"', company={"name": "Acme & Sons <b>"},
                  locations=["Hyderabad"])  # fmt: skip
    r = await client.get(f"/api/jobs/{j['slug']}/preview")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/html")
    html = r.text
    tags = ['property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url"',
            'name="twitter:card" content="summary_large_image"', 'name="twitter:title"',
            'name="twitter:image"']  # fmt: skip
    for tag in tags:
        assert tag in html, tag
    assert 'content="https://nm7.si/og-image.png"' in html
    assert f'property="og:url" content="https://nm7.si/jobs/{j["slug"]}"' in html
    assert "<script>alert(1)</script>" not in html and "<b>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html and "Acme &amp; Sons &lt;b&gt;" in html
    assert "&quot;Analyst&quot;" in html
    assert "Hyderabad" in html
    # people who open it directly are sent on to the job page
    assert f'location.replace("https://nm7.si/jobs/{j["slug"]}")' in html


async def test_preview_unknown_demo_and_closed_jobs(client, db):
    r = await client.get("/api/jobs/no-such-job-000/preview")
    assert r.status_code == 404 and 'property="og:title"' in r.text and "https://nm7.si/jobs" in r.text
    j = await add(db, title="Demo Role")
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"demo": True}})
    assert (await client.get(f"/api/jobs/{j['slug']}/preview")).status_code == 404
    c = await add(db, title="Closed Role", status="closed")
    r = await client.get(f"/api/jobs/{c['slug']}/preview")
    assert r.status_code == 200 and "Closed: Closed Role" in r.text


async def test_applied_jobs_ids(client, db, outbox):
    a = await add(db, title="Applied Role", applyMethod="nm7", applyUrl="")
    b = await add(db, title="Other Role", applyUrl="https://acme.example/c/9")
    assert (await client.get("/api/me/applied-jobs")).status_code == 401
    await signup(client, outbox)
    assert (await client.get("/api/me/applied-jobs")).json() == {"items": []}
    assert (await client.post(f"/api/jobs/{a['_id']}/apply", json={})).status_code == 201
    out = (await client.get("/api/me/applied-jobs")).json()
    assert out == {"items": [{"id": a["_id"], "status": "applied"}]}
    assert b["_id"] not in [x["id"] for x in out["items"]]
    # the job page says so too
    assert (await client.get(f"/api/jobs/{a['slug']}")).json()["application"]["status"] == "applied"
