"""Phase 5 H1: "Ready to join". Consent is needed to turn it on, saving or "Still ready" starts the 7 days again, it
goes stale after 7 days (Admin can change the days), pause keeps everything, one reminder email a day before it
goes stale (never twice for the same week, never when emails are off), the one-tap email link, deletion removes it."""

from datetime import timedelta

from app.core.db import HIRE_PROFILES, USERS
from app.core.time import now
from app.hire.available import available, send_reminders, still_token
from app.site import get_site, save_site
from tests.conftest import signup

URL = "/api/me/hire"
FORM = {
    "on": True,
    "consent": True,
    "joinDate": "2026-12-01",
    "cities": ["Hyderabad", "hyderabad", " Pune "],
    "remote": False,
    "salary": {"amount": 3.5, "unit": "lpa"},
    "noticeDays": 15,
    "jobTypes": ["full_time"],
}


async def _me(client, outbox, db, email="asha@example.com"):
    await signup(client, outbox, email=email, name="Asha Rao")
    return (await db[USERS].find_one({"email": email}))["_id"]


async def test_on_needs_consent_and_a_place_then_available(client, outbox, db):
    uid = await _me(client, outbox, db)
    empty = (await client.get(URL)).json()
    assert empty["on"] is False and empty["available"] is False and empty["confirmDays"] == 7
    r = await client.put(URL, json={**FORM, "consent": False})
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent"
    r = await client.put(URL, json={**FORM, "cities": [], "remote": False})
    assert r.json()["error"]["code"] == "where"
    out = (await client.put(URL, json=FORM)).json()
    assert out["available"] is True and out["consent"] and out["cities"] == ["Hyderabad", "Pune"]
    assert out["salary"] == {"amount": 3.5, "unit": "lpa"} and out["noticeDays"] == 15 and not out["due"]
    p = await db[HIRE_PROFILES].find_one({"_id": uid})
    assert p["consent_at"] and p["confirmed_at"]
    # nothing about contact details is stored here (the account keeps them; companies see them only after an invite)
    assert not {"email", "phone"} & set(p)


async def test_stale_after_seven_days_then_still_ready(client, outbox, db):
    uid = await _me(client, outbox, db)
    await client.put(URL, json=FORM)
    site = await get_site(db)
    old = now() - timedelta(days=6, hours=1)
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"confirmed_at": old}})
    s = (await client.get(URL)).json()
    assert s["available"] and s["due"]  # a day or less left: the card asks
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"confirmed_at": now() - timedelta(days=7, minutes=1)}})
    s = (await client.get(URL)).json()
    assert s["available"] is False and s["stale"] is True
    assert not available(await db[HIRE_PROFILES].find_one({"_id": uid}), site)
    s = (await client.post(f"{URL}/confirm")).json()
    assert s["available"] and not s["stale"] and not s["due"]
    # Admin changes the days: 3 days now
    await save_site(db, {"hire": {"on": True, "confirm_days": 3}})
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"confirmed_at": now() - timedelta(days=4)}})
    assert (await client.get(URL)).json()["available"] is False


async def test_pause_resume_and_off(client, outbox, db):
    await _me(client, outbox, db)
    assert (await client.post(f"{URL}/pause", json={"paused": True})).status_code == 409  # not on yet
    await client.put(URL, json=FORM)
    s = (await client.post(f"{URL}/pause", json={"paused": True})).json()
    assert s["paused"] and not s["available"] and s["joinDate"] == "2026-12-01"  # kept
    s = (await client.post(f"{URL}/pause", json={"paused": False})).json()
    assert s["available"] and not s["paused"]
    s = (await client.put(URL, json={**FORM, "on": False, "consent": False})).json()
    assert not s["on"] and not s["available"] and not s["consent"]
    assert (await client.delete(URL)).json()["on"] is False


async def test_site_switch_off(client, outbox, db):
    await _me(client, outbox, db)
    await save_site(db, {"hire": {"on": False, "confirm_days": 7}})
    assert (await client.put(URL, json=FORM)).json()["error"]["code"] == "hire_off"


async def test_one_reminder_a_day_before_and_the_one_tap_link(client, outbox, db, make_client):
    uid = await _me(client, outbox, db)
    await client.put(URL, json=FORM)
    assert await send_reminders(db, outbox) == 0  # 7 days left: nothing yet
    when = now() - timedelta(days=6, hours=2)
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"confirmed_at": when}})
    n0 = len(outbox.sent)
    assert await send_reminders(db, outbox) == 1
    mail = outbox.sent[-1]
    assert mail.to == "asha@example.com" and "Still ready" in mail.subject and "/hire/still-ready#t=" in mail.text
    assert await send_reminders(db, outbox) == 0 and len(outbox.sent) == n0 + 1  # never twice for the same week
    # the email's link: no sign-in needed, starts the 7 days again
    anon = make_client()
    r = await anon.post("/api/public/hire/still-ready", json={"token": still_token(uid)})
    assert r.status_code == 200 and r.json()["ok"]
    p = await db[HIRE_PROFILES].find_one({"_id": uid})
    assert p["confirmed_at"] > when + timedelta(days=6)
    bad = await anon.post("/api/public/hire/still-ready", json={"token": f"{uid}.{'0' * 32}"})
    assert bad.status_code == 404
    # emails off: no reminder (the card in the app still asks)
    await client.put(f"{URL}/emails", json={"on": False})
    await db[HIRE_PROFILES].update_one({"_id": uid}, {"$set": {"confirmed_at": now() - timedelta(days=6, hours=3)}})
    assert await send_reminders(db, outbox) == 0
    assert (await client.get(URL)).json()["emails"] is False


async def test_account_deletion_removes_it(client, outbox, db):
    from app.me.erase import erase_user_data

    uid = await _me(client, outbox, db)
    await client.put(URL, json=FORM)
    out = await erase_user_data(db, uid)
    assert out["hire_profile"] == 1 and not await db[HIRE_PROFILES].find_one({"_id": uid})
