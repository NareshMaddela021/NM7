"""Round J2: every experience level from internship to 15+ years on the job board. The bands, how years map to them,
older "3+ years" jobs, and the bulk-import message that lists the levels."""

import json

import pytest
from pydantic import ValidationError

from app.jobs.model import BANDS, EXPERIENCE, JobIn, band_for_years, errors_of, with_older

BASE = {"title": "Backend Engineer", "company": {"name": "Acme"}, "locations": ["Pune"], "description": "x" * 40,
        "applyUrl": "https://acme.example/jobs/1"}  # fmt: skip


def test_bands_and_years():
    assert BANDS == ("internship", "fresher", "0_1", "1_3", "3_5", "5_8", "8_12", "12_15", "15_plus")
    assert set(BANDS) | {"not_stated", "3_plus"} == set(EXPERIENCE)
    pairs = [(0, 0), (0, 1), (0, 2), (1, 3), (2, None), (3, 5), (4, 4), (5, 8), (7, None), (8, 12), (11, 13),
             (12, 15), (14, None), (15, 20), (25, None)]  # fmt: skip
    got = [band_for_years(lo, hi) for lo, hi in pairs]
    assert got == ["fresher", "0_1", "1_3", "1_3", "1_3", "3_5", "3_5", "5_8", "5_8", "8_12", "8_12", "12_15",
                   "12_15", "15_plus", "15_plus"]  # fmt: skip
    assert with_older(["3_5", "8_12"]) == ["3_5", "8_12", "3_plus"] and with_older(["fresher"]) == ["fresher"]


def test_job_levels_and_the_bulk_message():
    for raw, want in [("5_8", "5_8"), ("3-5 years", "3_5"), ("15+", "15_plus"), ("15+ years", "15_plus"),
                      ("Fresher", "fresher"), ("not_stated", "not_stated"), ("3_plus", "3_plus")]:  # fmt: skip
        assert JobIn(**BASE, experience=raw).experience == want
    with pytest.raises(ValidationError) as e:
        JobIn(**BASE, experience="10 years")
    assert errors_of(e.value) == [
        "Experience must be one of: internship, fresher, 0_1, 1_3, 3_5, 5_8, 8_12, 12_15, 15_plus, not_stated."
    ]


async def test_bulk_import_says_which_levels(admin_client):
    owner = await admin_client("owner")
    rows = [{**BASE, "experience": "5_8"}, {**BASE, "title": "Ops Lead", "experience": "senior"}]
    r = await owner.post("/api/admin/jobs/import", json={"format": "json", "text": json.dumps(rows)})
    assert r.status_code == 200, r.text
    out = r.json()
    bad = [x for x in out["rows"] if x["result"] == "rejected"]
    assert len(bad) == 1 and "3_5, 5_8, 8_12, 12_15, 15_plus" in bad[0]["errors"][0]
