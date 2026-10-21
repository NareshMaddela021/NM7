"""AI cost / abuse limits (core/ai_quota.py), shared by Snap photos and the summary writer."""

import asyncio
from datetime import UTC, datetime

import pytest

from app.core import ai_quota
from app.core.errors import ApiError
from app.photos import reader
from tests.conftest import signup
from tests.test_photo_import import model_output, photo, post


@pytest.fixture
def key_on(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")


@pytest.fixture
def failing_model(monkeypatch):
    calls = []

    async def fake(images, stats=None):
        calls.append(images)
        raise reader.ReadFailed("bad_json")

    monkeypatch.setattr(reader, "call_model", fake)
    return calls


async def test_failed_attempts_count_too(client, outbox, key_on, failing_model):
    await signup(client, outbox)
    for _ in range(5):
        assert (await post(client, [photo()])).status_code == 422
    r = await post(client, [photo()])
    assert r.status_code == 429 and "5 times a day" in r.json()["error"]["message"]
    assert len(failing_model) == 5  # the 6th never reached the model


async def test_attempts_sent_at_once_cannot_get_past_the_limit(db):
    results = await asyncio.gather(*(ai_quota.take(db, "summary", "u1") for _ in range(25)), return_exceptions=True)
    ok = [r for r in results if r is None]
    refused = [r for r in results if isinstance(r, ApiError)]
    assert len(ok) == 10 and len(refused) == 15
    doc = await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|person|summary|u1"})
    assert doc["n"] == 10  # refused attempts were rolled back
    assert (await ai_quota.usage(db, 1))["days"][0]["summary"] == {
        "calls": 10,
        "fallback": 0,
        "failed": 0,
        "limited": 15,
        "capped": 0,
        "dropped": 0,
        "unusable": {},
    }


async def test_features_have_their_own_limits(db):
    for _ in range(5):
        await ai_quota.take(db, "photos", "u1")
    with pytest.raises(ApiError):
        await ai_quota.take(db, "photos", "u1")
    for _ in range(10):  # the summary writer still has its 10
        await ai_quota.take(db, "summary", "u1")
    with pytest.raises(ApiError) as e:
        await ai_quota.take(db, "summary", "u1")
    assert e.value.status == 429 and "10 times a day" in e.value.message


async def test_a_kiosk_link_has_its_own_limit_across_candidates(db, monkeypatch):
    monkeypatch.setitem(ai_quota.PER_KIOSK, "summary", 3)
    for user in ("a", "b", "c"):
        await ai_quota.take(db, "summary", user, kiosk_id="k1")
    with pytest.raises(ApiError) as e:
        await ai_quota.take(db, "summary", "d", kiosk_id="k1")
    assert e.value.code == "kiosk_limited"
    # the refused candidate's own count was rolled back too; another kiosk is unaffected
    assert (await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|person|summary|d"}))["n"] == 0
    await ai_quota.take(db, "summary", "d", kiosk_id="k2")


async def test_quota_rollback_when_a_later_inc_fails(db, monkeypatch):
    """A database error after the first counter was incremented: that counter is taken back, nothing stays."""
    real = ai_quota._inc
    calls = []

    async def flaky(db_, key, day, by=1, keep_days=2):
        calls.append((key, by))
        if by > 0 and "|kiosk|" in key:  # the second counter: the server never applied it
            raise ConnectionError("lost")
        return await real(db_, key, day, by=by, keep_days=keep_days)

    monkeypatch.setattr(ai_quota, "_inc", flaky)
    with pytest.raises(ConnectionError):
        await ai_quota.take(db, "summary", "rb", kiosk_id="k-rb")
    person = await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|person|summary|rb"})
    assert person["n"] == 0  # incremented, then taken back
    assert [k for k, by in calls if by < 0] == [
        f"{ai_quota.today()}|person|summary|rb",
        f"{ai_quota.today()}|kiosk|summary|k-rb",  # noted before the failed increment: taken back too
    ]
    assert not await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|all"})  # never reached
    assert (await ai_quota.usage(db, 1))["days"][0]["summary"]["calls"] == 0
    monkeypatch.setattr(ai_quota, "_inc", real)
    await ai_quota.take(db, "summary", "rb", kiosk_id="k-rb")  # works again, with the person's full allowance
    assert (await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|person|summary|rb"}))["n"] == 1


async def test_note_takes_any_outcome_and_usage_lists_the_unusable_reasons(db):
    await ai_quota.note(db, "photos", "fallback")
    await ai_quota.note(db, "photos", "unusable:too_long")
    await ai_quota.note(db, "photos", "unusable:too_long")
    await ai_quota.note(db, "photos", "unusable:empty")
    await ai_quota.note(db, "summary", "dropped", by=3)
    day = (await ai_quota.usage(db, 1))["days"][0]
    assert day["photos"]["fallback"] == 1 and day["photos"]["unusable"] == {"empty": 1, "too_long": 2}
    assert day["summary"]["dropped"] == 3 and day["summary"]["unusable"] == {}
    assert day["photos"]["dropped"] == 0


async def test_the_site_wide_cap(db, monkeypatch):
    monkeypatch.setattr(ai_quota, "DAILY_CAP", 3)
    await ai_quota.take(db, "photos", "a")
    await ai_quota.take(db, "summary", "b")
    await ai_quota.take(db, "summary", "c")
    assert await ai_quota.cap_reached(db)
    with pytest.raises(ai_quota.CapReached):
        await ai_quota.take(db, "summary", "d")
    # a person refused by the cap keeps their own allowance
    assert (await db["ai_usage"].find_one({"_id": f"{ai_quota.today()}|person|summary|d"}))["n"] == 0
    day = (await ai_quota.usage(db, 1))["days"][0]
    assert day["total"] == 3 and day["capReached"] and day["summary"]["capped"] == 1


async def test_photos_at_the_cap_say_busy_and_never_call_the_model(client, outbox, key_on, monkeypatch):
    calls = []

    async def fake(images, stats=None):
        calls.append(1)
        return model_output()

    monkeypatch.setattr(reader, "call_model", fake)
    monkeypatch.setattr(ai_quota, "DAILY_CAP", 1)
    await signup(client, outbox)
    assert (await post(client, [photo()])).status_code == 200
    r = await post(client, [photo()])
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_busy"
    assert len(calls) == 1


async def test_photos_fallback_and_failures_are_counted(client, outbox, key_on, monkeypatch, db):
    async def fake(images, stats=None):
        stats.update(model="claude-sonnet-5-5", fallback=True, reason="bad_json")
        return model_output()

    monkeypatch.setattr(reader, "call_model", fake)
    await signup(client, outbox)
    assert (await post(client, [photo()])).status_code == 200
    photos = (await ai_quota.usage(db, 1))["days"][0]["photos"]
    assert photos["calls"] == 1 and photos["fallback"] == 1 and photos["unusable"] == {"bad_json": 1}

    async def boom(images, stats=None):
        raise RuntimeError("x")

    monkeypatch.setattr(reader, "call_model", boom)
    r = await post(client, [photo()])  # an unexpected failure answers in the API's error shape
    assert r.status_code == 500 and r.json()["error"]["code"] == "server_error"
    photos = (await ai_quota.usage(db, 1))["days"][0]["photos"]
    assert photos["calls"] == 2 and photos["failed"] == 1


def test_the_day_is_the_india_day():
    # 20:00 UTC on 16 Oct is 01:30 on 17 Oct in India
    assert ai_quota.today(datetime(2026, 10, 16, 20, 0, tzinfo=UTC)) == "2026-10-17"
    assert ai_quota.today(datetime(2026, 10, 16, 18, 0, tzinfo=UTC)) == "2026-10-16"


async def test_admin_sees_daily_ai_counts(admin_client, make_client, db, monkeypatch):
    monkeypatch.setattr(ai_quota, "DAILY_CAP", 2)
    await ai_quota.take(db, "photos", "a")
    await ai_quota.take(db, "summary", "b")
    await ai_quota.note(db, "summary", "fallback")
    admin = await admin_client()
    r = await admin.get("/api/admin/ai-usage?days=7")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["cap"] == 2 and d["capReachedToday"] is True and len(d["days"]) == 7
    today = d["days"][0]
    assert today["date"] == ai_quota.today() and today["total"] == 2
    assert today["photos"]["calls"] == 1 and today["summary"]["fallback"] == 1
    assert today["summary"]["dropped"] == 0 and today["summary"]["unusable"] == {}
    assert set(today["photos"]) == {"calls", "fallback", "failed", "limited", "capped", "dropped", "unusable"}
    assert (await make_client().get("/api/admin/ai-usage")).status_code == 401
