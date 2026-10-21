"""app/core/pii.py: ID numbers are removed from free text, everything else (years, phones, PINs, money) stays."""

import pytest

from app.core import pii
from app.core.pii import has_id_number, scrub_id_numbers, scrub_text
from app.orgs.service import holds_id_number


@pytest.mark.parametrize(
    ("text", "left"),
    [
        ("My Aadhaar is 2345 6789 0123 and I live in Pune", "My Aadhaar is and I live in Pune"),
        ("234567890123", ""),
        ("2345-6789-0123", ""),
        ("Aadhaar no: 1234 5678 9012.", "Aadhaar no:."),  # labelled: whatever the digits
        ("VID 1234 5678 9012 3456", "VID"),
        ("PAN ABCPE1234F", "PAN"),
        ("PAN: abcpe 1234 f", "PAN:"),  # loosely written, but labelled
        ("Passport A1234567 valid till 2030", "Passport valid till 2030"),
        ("DL AP09 20120001234", "DL"),
        ("AP0920120001234", ""),
        ("DL no MH-12-2011-0012345", "DL no"),
        ("Driving licence number TS0920110012345", "Driving licence number"),
        ("Account no 123456789012 SBIN0001234", "Account no"),
        ("A/c # 00012345678901", "A/c #"),
        ("Bank account: 9876543210", "Bank account:"),  # labelled as an account, so not a phone
        ("XXXX XXXX 1234", ""),
        ("Voter id ABC1234567", "Voter id"),
    ],
)
def test_id_numbers_are_removed_and_the_sentence_kept(text, left):
    out, n = scrub_text(text)
    assert out == left and n >= 1
    assert has_id_number(text) and not has_id_number(out)


@pytest.mark.parametrize(
    "text",
    [
        "2019-2023",
        "2019 - 2023",
        "Call +91 98765 43210 or 9876543210",
        "+91-98765-43210",
        "+919876543210",
        "9876543210, 9123456789",
        "Pune 411001",
        "Pan India sales, 500016",
        "Scored 87.5% in 2019",
        "CTC ₹4,50,000 / 450000 per year",
        "12,00,000",
        "15/05/2003",
        "2003-05-15",
        "Batch 2019 A",  # not a PAN
        "LMV and HMV driving licence",
        "CGPA 8.9",
        "Roll 21A01",
        "Order #45678",
        "Version 2.0.1234",
    ],
)
def test_ordinary_numbers_stay(text):
    assert scrub_text(text) == (text, 0)
    assert not has_id_number(text)


def test_nested_data_is_walked_and_counted():
    data = {
        "personal": {"name": "Asha", "phone": "+91 98765 43210", "headline": "Aadhaar 2345 6789 0123"},
        "exp": [{"role": "Clerk", "desc": "PAN ABCPE1234F and A/c 123456789012", "off": True}, "plain"],
        "pinfo": {"dob": "2003-05-15"},
        "pages": 2,
    }
    out, n = scrub_id_numbers(data)
    assert n == 3
    assert out["personal"] == {"name": "Asha", "phone": "+91 98765 43210", "headline": "Aadhaar"}
    assert out["exp"] == [{"role": "Clerk", "desc": "PAN and A/c", "off": True}, "plain"]
    assert out["pinfo"] == {"dob": "2003-05-15"} and out["pages"] == 2
    assert data["personal"]["headline"] == "Aadhaar 2345 6789 0123"  # a copy
    assert scrub_id_numbers(data)[0] == out and scrub_id_numbers(out) == (out, 0)


def test_removing_one_number_can_uncover_another_and_strict_drops_what_is_left(monkeypatch):
    tricky = "2345 6789 ABCPE1234F 0123"  # without the PAN, the digits around it read as an Aadhaar
    assert scrub_text(tricky) == ("", 2)
    monkeypatch.setattr(pii, "PASSES", 1)
    assert scrub_text(tricky) == ("2345 6789 0123", 1)
    out, n = scrub_id_numbers({"a": tricky, "b": "fine", "c": [tricky, "kept"]}, strict=True)
    assert out["a"] == "" and out["b"] == "fine" and out["c"] == ["kept"] and n >= 2


def test_holds_id_number_covers_passport_and_licence():
    assert holds_id_number("A1234567") and holds_id_number("AP09 20120001234")
    assert holds_id_number("Passport no A1234567") and holds_id_number("driving licence no.")
    assert not holds_id_number("LMV and HMV driving licence") and not holds_id_number("Passport ready")
