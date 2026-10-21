"""The automation pass: one at a time across instances, and a deadline alert is emailed once (audit #45)."""

import asyncio
from datetime import timedelta

from app import automation
from app.core.db import LOCKS, ORDER_WORK, ORDERS
from app.core.time import now
from tests.conftest import Outbox


async def _order_due(db, oid="ord_due"):
    await db[ORDERS].insert_one(
        {"_id": oid, "status": "in_progress", "deadline_at": now() + timedelta(hours=2), "delivered_at": None}
    )


async def test_lease_lets_one_pass_run_at_a_time(db):
    assert await automation.take_lease(db) is True
    assert await automation.take_lease(db) is False  # held
    await automation.release_lease(db)
    assert await automation.take_lease(db) is True
    # an expired lease (a crashed instance) is taken over
    await db[LOCKS].update_one({"_id": "automation"}, {"$set": {"until": now() - timedelta(seconds=1)}})
    assert await automation.take_lease(db) is True
    await automation.release_lease(db)


async def test_two_concurrent_automation_passes_alert_once(db, outbox):
    await _order_due(db)
    a, b = await asyncio.gather(automation.run_rules(db, outbox), automation.run_rules(db, outbox))
    assert sorted([a.get("deadline_alert", -1), b.get("deadline_alert", -1)]) == [-1, 1]  # one ran, one skipped
    assert len([m for m in outbox.sent if "[Deadline]" in m.subject]) == 1
    # the next pass finds the alert already claimed
    assert (await automation.run_rules(db, outbox)).get("deadline_alert") == 0
    assert len(outbox.sent) == 1


async def test_concurrent_deadline_alerts_claim_before_sending(db):
    """Even inside one pass window, two alert runs for the same order send one email."""
    await _order_due(db, "ord_claim")
    boxes = [Outbox(), Outbox()]
    await asyncio.gather(automation._deadline_alert(db, 24, boxes[0]), automation._deadline_alert(db, 24, boxes[1]))
    assert len(boxes[0].sent) + len(boxes[1].sent) == 1
    assert (await db[ORDER_WORK].find_one({"_id": "ord_claim"}))["alerted_at"] is not None
