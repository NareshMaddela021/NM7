"""Admin daily summary: once a day from 8:00 IST, to the Owner admins, yesterday's numbers; off in Admin > Settings;
the Today card's numbers and text; server errors are counted."""

from datetime import UTC, datetime, timedelta

import pytest

from app.admin.daily import count_error, ist_day, numbers, send_daily
from app.core.db import OPS_DAILY, ORGANIZATIONS, PAYMENTS, USERS
from app.core.time import IST
from tests.conftest import signup


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def at_ist(day, hh, mm=0):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=IST)


async def test_today_card_and_numbers(owner, client, outbox, db):
    await signup(client, outbox, "new@example.com", name="New Person")
    now_ = datetime.now(UTC)
    await db[PAYMENTS].insert_one({"_id": "p1", "status": "captured", "captured_at": now_, "amount": 9900})
    await db[ORGANIZATIONS].insert_one({"_id": "o1", "name": "College", "created_at": now_})
    await db[ORGANIZATIONS].insert_one({"_id": "o2", "name": "Demo", "created_at": now_, "demo": True})
    await count_error()
    r = (await owner.get("/api/admin/today")).json()
    assert r["newUsers"] == 1 and r["revenue"] == 9900 and r["orgSignups"] == 1 and r["errors"] == 1
    assert "New users: 1" in r["text"] and "Revenue: Rs 99" in r["text"] and "@" not in r["text"]
    assert (await client.get("/api/admin/today")).status_code in (401, 403)


async def test_sent_once_after_eight_to_owners_only(owner, admin_client, outbox, db):
    await admin_client("support", email="support@nm7.si")
    today = ist_day()
    y = today - timedelta(days=1)
    await db[USERS].insert_one(
        {"_id": "u-y", "role": "customer", "email": "y@example.com", "email_lc": "y@example.com", "name": "Y",
         "created_at": at_ist(y, 15)}
    )  # fmt: skip
    n0 = len(outbox.sent)
    assert await send_daily(db, outbox, at_ist(today, 7, 59)) == 0  # not before 8:00
    assert await send_daily(db, outbox, at_ist(today, 8, 1)) == 1  # the owner only, not support
    mail = outbox.sent[-1]
    assert mail.to == "owner@nm7.si" and "New users: 1" in mail.text and len(outbox.sent) == n0 + 1
    assert await send_daily(db, outbox, at_ist(today, 9)) == 0  # once a day
    assert (await numbers(db, y))["newUsers"] == 1
    # off in Admin > Settings
    r = await owner.put("/api/admin/settings", json={"dailySummary": {"on": False}})
    assert r.json()["dailySummary"] == {"on": False}
    assert await send_daily(db, outbox, at_ist(today + timedelta(days=1), 8, 30)) == 0


async def test_errors_counted(db):
    await count_error()
    await count_error()
    assert (await db[OPS_DAILY].find_one({"_id": f"errors:{ist_day().isoformat()}"}))["n"] == 2
