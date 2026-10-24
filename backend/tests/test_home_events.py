"""Home page tap counters: first-party, per day, no personal data; only known names count."""

from app.core.db import HOME_EVENTS


async def test_known_events_are_counted_per_day_and_nothing_personal_is_kept(client, admin_client, db):
    for name in ("hero_build", "hero_build", "lang_te", "start_papers"):
        r = await client.post("/api/public/events", json={"name": name})
        assert r.status_code == 204
    assert (await client.post("/api/public/events", json={"name": "made_up"})).status_code == 204  # ignored
    rows = await db[HOME_EVENTS].find().to_list(None)
    assert sorted((r["name"], r["n"]) for r in rows) == [("hero_build", 2), ("lang_te", 1), ("start_papers", 1)]
    assert all(set(r) == {"_id", "day", "name", "n"} for r in rows)  # no ip, user, cookie or agent stored
    assert "set-cookie" not in r.headers

    nm7 = await admin_client("owner")
    out = (await nm7.get("/api/admin/home-clicks?days=7")).json()
    ev = {e["name"]: e for e in out["events"]}
    assert ev["hero_build"]["total"] == 2 and ev["hero_build"]["byDay"][out["days"][0]] == 2
    assert ev["demo_summary"]["total"] == 0
    assert (await client.get("/api/admin/home-clicks")).status_code in (401, 403)
