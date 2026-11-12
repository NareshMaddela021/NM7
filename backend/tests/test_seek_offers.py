# ruff: noqa: E501
"""Phase 6 S5: the offer checker. Rules flag a fee or deposit, a bond or penalty (amount and years), missing basics,
pay far from similar jobs on Nm7 (only with data), the company on Nm7 and scam words; a plain verdict; never called
legal advice; a PDF is read in memory and never stored; Save keeps the text without ID numbers; erased with the
account."""

import base64

from fpdf import FPDF

from app.core.db import COMPANIES, OFFER_CHECKS, USERS
from app.seek.offers import ctc_yearly, years_in
from tests.conftest import signup
from tests.test_seek_salary import _fresh_cache, _jobs  # noqa: F401

GOOD = """Acme Analytics Private Limited
Offer of employment
Dear Sai, we are pleased to appoint you to the position of Data Analyst.
Your CTC will be Rs 3,00,000 per annum. Date of joining: 1 December 2026.
Location: Hyderabad office.
For and on behalf of Acme Analytics Private Limited, Authorised Signatory, HR Manager."""

BAD = """Bright Future Solutions
Congratulations! You are selected as Data Analyst. Salary Rs 25,000 per month.
Please pay a registration fee of Rs 2,500 to confirm your seat.
You must sign a service agreement to serve the company for 2 years; leaving early carries a penalty of Rs 1,50,000."""


def pdf_b64(text):
    p = FPDF()
    p.add_page()
    p.set_font("Helvetica", size=11)
    for line in text.splitlines():
        p.cell(0, 8, line.replace("₹", "Rs "), new_x="LMARGIN", new_y="NEXT")
    return base64.b64encode(bytes(p.output())).decode()


def test_rule_helpers():
    assert ctc_yearly("Your CTC will be Rs 3,00,000 per annum.") == 300000
    assert ctc_yearly("Salary Rs 25,000 per month.") == 300000
    assert ctc_yearly("CTC: 4.5 LPA") == 450000
    assert years_in("serve the company for 2 years") == 2 and years_in("a bond of three years") == 3
    assert years_in("for 18 months") == 1.5


async def test_clean_offer_looks_ok(client, outbox, db):
    await signup(client, outbox)
    await db[COMPANIES].insert_one(
        {
            "_id": "c1",
            "slug": "acme",
            "details": {"legal_name": "Acme Analytics Private Limited"},
            "trust": "verified",
            "score": {"value": 82},
        }
    )
    r = (await client.post("/api/me/offer-check", json={"text": GOOD})).json()
    assert r["verdict"] == "ok" and r["verdictText"] == "Looks OK" and r["findings"] == []
    assert r["company"] == {"name": "Acme Analytics Private Limited", "trust": "verified", "score": 82, "slug": "acme"}
    assert r["facts"]["ctc"] == 300000 and r["saved"] is False
    assert "not a lawyer's opinion" in r["note"] and "legal advice" not in (r["note"] + r["explanation"]).lower()
    assert await db[OFFER_CHECKS].count_documents({}) == 0  # nothing kept unless saved


async def test_fee_bond_missing_and_scam(client, outbox, db):
    await signup(client, outbox)
    r = (await client.post("/api/me/offer-check", json={"text": BAD})).json()
    assert r["verdict"] == "warning" and r["verdictText"] == "Warning"
    by = {f["kind"]: f for f in r["findings"]}
    assert by["fee"]["level"] == "warning" and any("registration fee" in q for q in by["fee"]["quotes"])
    assert by["bond"]["amount"] == 150000 and by["bond"]["years"] == 2 and "HR or a lawyer" in by["bond"]["detail"]
    assert set(by["missing"]["missing"]) >= {"joining", "location", "signatory"}
    assert "company" in by  # not on Nm7: a point to check
    # only missing basics: "Check these points"
    r = (
        await client.post(
            "/api/me/offer-check",
            json={"text": "Hello Sai, you are selected as a data analyst in our team. Welcome aboard, see you soon."},
        )
    ).json()
    assert r["verdict"] == "check" and r["verdictText"] == "Check these points"
    assert (await client.post("/api/me/offer-check", json={"text": "short"})).status_code == 422


async def test_pay_vs_salary_guide_only_with_data(client, outbox, db):
    await signup(client, outbox)
    high = GOOD.replace("Rs 3,00,000 per annum", "Rs 24,00,000 per annum")
    r = (await client.post("/api/me/offer-check", json={"text": high})).json()
    assert "pay" not in {f["kind"] for f in r["findings"]} and r["pay"] is None  # no data: nothing said
    await _jobs(db, 10)  # 20,000 … 29,000 a month
    r = (await client.post("/api/me/offer-check", json={"text": high})).json()
    pay = next(f for f in r["findings"] if f["kind"] == "pay")
    assert "much higher" in pay["title"] and "based on 10 jobs" in pay["detail"] and r["pay"]["monthly"] == 200000


async def test_pdf_read_in_memory_and_save_strips_ids(client, outbox, db):
    await signup(client, outbox)
    r = (await client.post("/api/me/offer-check", json={"pdf": pdf_b64(BAD)})).json()
    assert r["verdict"] == "warning" and await db[OFFER_CHECKS].count_documents({}) == 0
    assert (
        await client.post("/api/me/offer-check", json={"pdf": base64.b64encode(b"not a pdf at all").decode()})
    ).status_code == 422
    with_id = GOOD + "\nAadhaar: 2345 6789 0123. PAN ABCDE1234F."
    r = (await client.post("/api/me/offer-check", json={"text": with_id, "save": True, "label": "Acme"})).json()
    assert r["saved"] and r["id"]
    doc = await db[OFFER_CHECKS].find_one({})
    assert "2345 6789 0123" not in doc["text"] and "ABCDE1234F" not in doc["text"] and "pdf" not in doc
    rows = (await client.get("/api/me/offer-check")).json()
    assert [x["label"] for x in rows] == ["Acme"] and "text" not in rows[0]
    assert (await client.delete(f"/api/me/offer-check/{r['id']}")).status_code == 200
    assert (await client.get("/api/me/offer-check")).json() == []


async def test_erased_with_the_account(client, outbox, db):
    from app.me.erase import erase_account

    await signup(client, outbox)
    uid = (await db[USERS].find_one({"email": "sai@example.com"}))["_id"]
    await client.post("/api/me/offer-check", json={"text": GOOD, "save": True})
    await erase_account(db, uid)
    assert await db[OFFER_CHECKS].count_documents({"user_id": uid}) == 0


def test_ai_explanation_is_checked():
    import pytest

    from app.core import claude
    from app.seek.offers import check_explain

    r = {"findings": [{"title": "There is a bond or penalty (₹1,50,000, 2 year(s))"}], "pay": None}
    check = check_explain(BAD, r)
    assert check(
        {"explanation": "The letter has a bond of 2 years with a penalty of Rs 1,50,000. Ask HR before you sign."}
    )
    for bad in (
        "You will lose Rs 5,00,000 if you leave early, so be careful with it.",  # a number not in the letter
        "This is legal advice: the bond is safe to sign, so go ahead and accept it.",  # never
        "Short.",
    ):
        with pytest.raises(claude.Unusable):
            check({"explanation": bad})
