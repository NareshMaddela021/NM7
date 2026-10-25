"""One file-name rule for every download (app/core/filenames.py, the same as frontend/src/lib/fileName.js): empty
parts and repeats dropped (case-insensitive, also inside a longer part), safe characters, about 80 characters at
most, the extension kept."""

from app.core.filenames import file_name, slug
from app.orgs.service import file_name as resume_file_name


def test_repeats_are_dropped():
    assert file_name(["AsuraaX", "AsuraaX", "Job Drive 2026", "QR"], "png") == "AsuraaX_Job_Drive_2026_QR.png"
    assert file_name(["AsuraaX", "asuraax", "", None, "Resume"], "pdf") == "AsuraaX_Resume.pdf"
    assert file_name(["AsuraaX", "AsuraaX Job Drive 2026", "QR"], "png") == "AsuraaX_Job_Drive_2026_QR.png"
    assert file_name(["JNTU Anantapur", "B.Tech 2026 – JNTU Anantapur"], "zip") == "B_Tech_2026_JNTU_Anantapur.zip"
    assert file_name(["AsuraaX AsuraaX Batch"], "csv") == "AsuraaX_Batch.csv"
    assert file_name(["AsuraaX_ASURAAX_shortlist"], "zip") == "AsuraaX_shortlist.zip"
    assert file_name(["Asura", "AsuraaX Batch"], "pdf") == "Asura_AsuraaX_Batch.pdf"  # only looks similar: stays


def test_safe_short_extension_kept_and_fallback():
    assert file_name(["Acme & Co. (India)", "shortlist"], "csv") == "Acme_Co_India_shortlist.csv"
    assert file_name(['a/b\\c:d*e?f"g<h>i|j'], "pdf") == "a_b_c_d_e_f_g_h_i_j.pdf"
    long = file_name(["A very long college name that goes on and on", "Another long group name for 2026", "QR"], "pdf")
    assert len(long) <= 80 and long.endswith(".pdf") and not long.endswith("_.pdf")
    assert len(file_name(["x" * 200], "zip")) <= 80
    assert file_name(["", "🚀"], "csv") == "Nm7.csv"
    assert file_name(["Needs changes", "2026-10-25"], "csv") == "Needs_changes_2026-10-25.csv"
    assert file_name(["రాము కుమార్", "రాము"], "pdf") == "రాము_కుమార్.pdf"
    assert slug("Asha – Data Analyst") == "Asha_Data_Analyst"


def test_resume_files_in_a_zip():
    assert resume_file_name("21A01", "Asha Rao") == "21A01_Asha_Rao_Resume.pdf"
    assert resume_file_name("21A01", "21A01 Asha Rao") == "21A01_Asha_Rao_Resume.pdf"  # the roll isn't said twice
    assert resume_file_name("", "Asha Rao Resume") == "Asha_Rao_Resume.pdf"
    assert resume_file_name(None, "", "ab12cd34ef") == "ab12cd34_Resume.pdf"
