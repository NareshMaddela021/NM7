# ruff: noqa: E501  (dense lookup tables)
"""Registration numbers, checked locally before any paid lookup.

  GSTIN  15 characters: 2-digit state code, the PAN (5 letters, 4 digits, 1 letter), entity number, Z, check character
         (app/companies/checks.py has the pattern and the check-character sum; reused here)
  CIN    21 characters: L/U, 5-digit industry code, 2-letter state, year, company type, 6 digits (checks.CIN_RE)
  Udyam  UDYAM-XX-00-0000000: the MSME registration number (2-letter state, 2-digit district, 7 digits)

We keep only a keyed hash and a masked form of the number in the Trust records (the company's own sign-up record still
has the number it typed, as before).
"""

import re

from app.companies.checks import check_registration, clean_number
from app.core.security import keyed_hash

KINDS = {"gstin": "GSTIN", "udyam": "Udyam (MSME) number", "cin": "CIN"}
REGISTRY = {"gstin": "GST", "udyam": "Udyam (MSME)", "cin": "MCA"}  # shown on the badge: "Verified employer · GST"
UDYAM_RE = re.compile(r"^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$")

GST_STATES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
    "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
    "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
    "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
    "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory", "99": "Centre Jurisdiction",
}  # fmt: skip
STATE_CODES = {
    "AN": "Andaman and Nicobar Islands", "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam", "BR": "Bihar",
    "CH": "Chandigarh", "CT": "Chhattisgarh", "CG": "Chhattisgarh", "DN": "Dadra and Nagar Haveli", "DD": "Daman and Diu",
    "DL": "Delhi", "GA": "Goa", "GJ": "Gujarat", "HR": "Haryana", "HP": "Himachal Pradesh", "JK": "Jammu and Kashmir",
    "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala", "LA": "Ladakh", "LD": "Lakshadweep", "MP": "Madhya Pradesh",
    "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram", "NL": "Nagaland", "OR": "Odisha",
    "OD": "Odisha", "PY": "Puducherry", "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu",
    "TG": "Telangana", "TS": "Telangana", "TR": "Tripura", "UP": "Uttar Pradesh", "UT": "Uttarakhand", "UK": "Uttarakhand",
    "WB": "West Bengal",
}  # fmt: skip


def clean(kind: str, number: str) -> str:
    n = clean_number(number)
    if kind == "udyam":
        n = n.replace("–", "-").replace("—", "-")
        if n.startswith("UDYAM") and "-" not in n and len(n) == 16:  # UDYAMTS020001234 typed without dashes
            n = f"UDYAM-{n[5:7]}-{n[7:9]}-{n[9:]}"
    return n


def problem(kind: str, number: str) -> str | None:
    """None when the number looks right for its kind (GSTIN: also its check character), else a plain reason."""
    n = clean(kind, number)
    if kind in ("gstin", "cin"):
        return check_registration(kind, n)
    if kind == "udyam":
        m = UDYAM_RE.match(n)
        if not m:
            return "A Udyam number looks like UDYAM-TS-02-0001234."
        if m.group(1) not in STATE_CODES:
            return "The two letters after UDYAM- are a state code, like TS or MH."
        return None
    return "Pick GSTIN, Udyam or CIN."


def state_of(kind: str, number: str) -> str:
    """The state written into the number itself (GSTIN digits 1–2, CIN letters 7–8, Udyam letters 7–8)."""
    n = clean(kind, number)
    if kind == "gstin":
        return GST_STATES.get(n[:2], "")
    if kind == "cin":
        return STATE_CODES.get(n[6:8], "")
    if kind == "udyam":
        return STATE_CODES.get(n[6:8], "")
    return ""


def mask(kind: str, number: str) -> str:
    """27•••••••••01ZV → enough for the company to recognise its own number; never the whole number."""
    n = clean(kind, number)
    if kind == "udyam":
        return n[:12] + "•••" + n[-4:] if len(n) >= 16 else "•" * len(n)
    keep_start, keep_end = (2, 3) if kind == "gstin" else (8, 3)
    return n[:keep_start] + "•" * max(0, len(n) - keep_start - keep_end) + n[-keep_end:]


def number_hash(kind: str, number: str) -> str:
    return keyed_hash("trust-employer-reg", kind, clean(kind, number))
