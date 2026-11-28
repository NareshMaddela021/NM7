"""The shared phone normaliser (app/core/phone.py): every old shape is accepted and stored as E.164."""

import pytest

from app.auth.service import normalize_phone
from app.core.errors import ApiError
from app.core.phone import e164_or_keep, is_mobile, national, pretty, to_e164

SHAPES = [
    "9876543210",
    "98765 43210",
    "98765-43210",
    "+91 98765 43210",
    "+91 98765-43210",
    "+91-98765-43210",
    "+919876543210",
    "919876543210",
    "09876543210",
    "0091 98765 43210",
    " (+91) 98765 43210 ",
]


@pytest.mark.parametrize("raw", SHAPES)
def test_every_old_shape_becomes_e164(raw):
    assert national(raw) == "9876543210"
    assert to_e164(raw) == "+919876543210"
    assert normalize_phone(raw) == "+919876543210"
    assert pretty(raw) == "+91 98765 43210"
    assert is_mobile(raw)


def test_e164_is_kept():
    assert to_e164("+919876543210") == "+919876543210"
    assert to_e164(to_e164("+91 62345 67890")) == "+916234567890"


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_empty_is_none(raw):
    assert to_e164(raw) is None
    assert normalize_phone(raw) is None


@pytest.mark.parametrize(
    "raw", ["12345", "5876543210", "98765 4321", "98765 432100", "+1 415 555 0100", "call me", "91234"]
)
def test_not_an_indian_mobile(raw):
    assert national(raw) == ""
    with pytest.raises(ValueError):
        to_e164(raw)
    with pytest.raises(ApiError) as e:
        normalize_phone(raw)
    assert e.value.code == "invalid_phone"
    assert pretty(raw) == raw  # shown as it was


def test_starts_with_91_is_a_real_number_too():
    # 10 digits that happen to start with 91 are not a country code
    assert to_e164("91234 56789") == "+919123456789"
    assert to_e164("+91 91234 56789") == "+919123456789"


def test_landlines_kept_for_contact_fields():
    assert e164_or_keep("98765 43210") == "+919876543210"
    assert e164_or_keep(" 040-2345 6789 ") == "040-2345 6789"
    assert e164_or_keep("") == ""


# --- through the API: old shapes from old clients are accepted and stored as E.164 -----------------------------------

from app.core.db import COMPANIES, USERS  # noqa: E402
from tests.conftest import signup  # noqa: E402
from tests.test_companies_signup import no_network  # noqa: E402, F401  (no DNS look-ups in the company sign-up)


@pytest.mark.parametrize("raw", ["98765 43210", "+91 98765-43210", "09876543210", "919876543210", "+919876543210"])
async def test_profile_phone_stored_as_e164(client, outbox, db, raw):
    await signup(client, outbox)
    r = await client.patch("/api/me/profile", json={"phone": raw})
    assert r.status_code == 200, r.text
    assert r.json()["phone"] == "+919876543210"
    assert (await db[USERS].find_one({"email": "sai@example.com"}))["phone"] == "+919876543210"


async def test_profile_phone_rules(client, outbox):
    await signup(client, outbox)
    r = await client.patch("/api/me/profile", json={"phone": "58765 43210"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_phone"
    assert (await client.patch("/api/me/profile", json={"phone": ""})).json()["phone"] is None  # optional: cleared


async def test_easy_dashboard_resume_shows_the_number_formatted(client, outbox, db):
    await signup(client, outbox, email="ravi@example.com", name="Ravi Kumar")
    r = await client.put("/api/me/simple/resume/about", json={"value": {"name": "Ravi Kumar", "phone": "919876543210"}})
    assert r.status_code == 200, r.text
    uid = (await db[USERS].find_one({"email": "ravi@example.com"}))["_id"]
    from app.core.db import RESUMES

    d = (await db[RESUMES].find_one({"user_id": uid}))["data"]
    assert d["personal"]["phone"] == "+91 98765 43210"


async def test_admin_finds_a_phone_however_it_was_saved(client, outbox, db, admin_client):
    await signup(client, outbox)
    await db[USERS].update_one({"email": "sai@example.com"}, {"$set": {"phone": "+91 98765 43210"}})  # an old one
    owner = await admin_client()
    for q in ["98765 43210", "9876543210", "+919876543210", "98765"]:
        items = (await owner.get("/api/admin/customers", params={"q": q})).json()["items"]
        assert [x["email"] for x in items] == ["sai@example.com"], q
    await db[USERS].update_one({"email": "sai@example.com"}, {"$set": {"phone": "+919876543210"}})
    items = (await owner.get("/api/admin/customers", params={"q": "98765 43210"})).json()["items"]
    assert [x["email"] for x in items] == ["sai@example.com"]


async def test_company_phone_e164_and_still_matches_old_numbers(client, outbox, db):
    from app.core.security import keyed_hash
    from tests.test_companies_signup import company, sign_up

    _, c1 = await sign_up(client, outbox, email="a1@gmail.com", phone="98765 43210")
    doc = await db[COMPANIES].find_one({"_id": c1["id"]})
    assert doc["phone"] == "+919876543210"
    assert doc["phone_key"] == keyed_hash("company-phone", "9876543210")[:32]  # the key saved before E.164
    _, c2 = await sign_up(client, outbox, email="a2@gmail.com", phone="+91 98765-43210")
    assert "duplicate_phone" in {f["code"] for f in (await db[COMPANIES].find_one({"_id": c2["id"]}))["flags"]}
    r = await client.post("/api/company/signup/check", json=company(phone="12345"))
    assert r.status_code == 422 and "10-digit mobile" in r.text
