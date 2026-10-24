"""GST for organization plans: Indian state codes, GSTIN checks and the tax split.

Amounts are integers in paise. Tax is worked out once per line, rounded to the nearest paisa (half up), and stored
with the order, so an invoice never re-computes it. Same state as the supplier: CGST + SGST (half the rate each);
any other state: IGST at the full rate. With GST off (no supplier GSTIN yet) there are no tax lines at all.
"""

import re
from typing import Any

# GST state / union-territory codes (the first two digits of a GSTIN), as used for place of supply.
STATES: dict[str, str] = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
}

GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_checksum_ok(g: str) -> bool:
    """The 15th character is a mod-36 check digit over the first 14 (the GSTN algorithm)."""
    total = 0
    for i, ch in enumerate(g[:14]):
        v = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return _CHARS[(36 - total % 36) % 36] == g[14]


def gstin_problem(gstin: str, state_code: str | None = None) -> str | None:
    """None when the GSTIN looks right (format, state code, check digit) and matches `state_code` if given."""
    g = (gstin or "").strip().upper()
    if not GSTIN.match(g):
        return "A GSTIN has 15 characters, like 29ABCDE1234F1Z5."
    if g[:2] not in STATES:
        return f"{g[:2]} isn’t a GST state code."
    if not gstin_checksum_ok(g):
        return "This GSTIN’s last character doesn’t match — please check it for typos."
    if state_code and g[:2] != state_code:
        chosen = STATES.get(state_code, state_code)
        return f"This GSTIN is registered in {STATES[g[:2]]}, but the state chosen is {chosen}."
    return None


def half_up(numerator: int, denominator: int) -> int:
    """Integer division rounded half up (amounts are never negative here)."""
    return (2 * numerator + denominator) // (2 * denominator)


def tax_lines(taxable: int, gst_on: bool, rate_bp: int, supplier_state: str, buyer_state: str) -> list[dict[str, Any]]:
    """[{"kind": "cgst"|"sgst"|"igst", "rate_bp": …, "amount": paise}], computed once. rate_bp: 1800 = 18%."""
    if not gst_on or taxable <= 0:
        return []
    if supplier_state and buyer_state == supplier_state:
        half = rate_bp // 2
        amt = half_up(taxable * half, 10_000)
        return [{"kind": "cgst", "rate_bp": half, "amount": amt}, {"kind": "sgst", "rate_bp": half, "amount": amt}]
    return [{"kind": "igst", "rate_bp": rate_bp, "amount": half_up(taxable * rate_bp, 10_000)}]


def tax_label(kind: str) -> str:
    return {"cgst": "CGST", "sgst": "SGST", "igst": "IGST"}[kind]
