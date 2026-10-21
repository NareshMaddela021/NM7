"""Start-up index creation: a changed index definition (TTL, keys under the same name) is repaired, not fatal."""

from pymongo import ASCENDING, DESCENDING

from app.core.db import AUDIT_LOG, EMAIL_CODES, ORDERS, WEBHOOK_EVENTS, WEBHOOK_KEEP, ensure_indexes


async def test_changed_ttl_is_replaced(db):
    await db[WEBHOOK_EVENTS].drop_index("received_at_1")
    await db[WEBHOOK_EVENTS].create_index("received_at", expireAfterSeconds=10)  # an older deploy's definition
    await ensure_indexes(db)  # would raise IndexOptionsConflict (code 85) without the repair
    info = await db[WEBHOOK_EVENTS].index_information()
    assert info["received_at_1"]["expireAfterSeconds"] == WEBHOOK_KEEP


async def test_same_name_other_keys_is_replaced(db):
    await db[ORDERS].drop_index("paid_at_1")
    await db[ORDERS].create_index([("created_at", DESCENDING)], name="paid_at_1")  # IndexKeySpecsConflict (86)
    await ensure_indexes(db)
    info = await db[ORDERS].index_information()
    assert info["paid_at_1"]["key"] == [("paid_at", ASCENDING)]


async def test_same_keys_other_name_is_replaced(db):
    await db[EMAIL_CODES].drop_index("code_hash_1")
    await db[EMAIL_CODES].create_index("code_hash", name="old_code_hash")  # "already exists with a different name"
    await ensure_indexes(db)
    info = await db[EMAIL_CODES].index_information()
    assert "code_hash_1" in info and "old_code_hash" not in info


async def _keys(db, name):
    return [[tuple(k) for k in i["key"]] for i in (await db[name].index_information()).values()]


async def test_indexes_the_hot_queries_need_exist(db):
    await ensure_indexes(db)
    assert [("data.orgs", ASCENDING), ("_id", DESCENDING)] in await _keys(db, AUDIT_LOG)
    assert [("paid_at", ASCENDING)] in await _keys(db, ORDERS)
    assert [("code_hash", ASCENDING)] in await _keys(db, EMAIL_CODES)
    assert [("received_at", ASCENDING)] in await _keys(db, WEBHOOK_EVENTS)
