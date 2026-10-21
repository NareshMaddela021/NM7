"""Removes government ID and bank numbers from what the photo reader returns.

The model is told never to output them; this is the second lock. It runs on every string the model sends back,
before anything is returned to the browser or could be saved. A string that contains an ID-like number is dropped
whole (never partly masked), and any key that names an ID is dropped with its value.
"""

import re
from typing import Any

# Aadhaar (12 digits, 4-4-4 or run together), VID (16), bank account numbers (9-18 digits) and any other long
# digit run, allowing one space or hyphen between digits. Dates (15/05/2003) and years (2019-2023) are shorter.
LONG_DIGITS = re.compile(r"(?<!\d)\d(?:[ \-.]?\d){8,}(?!\d)")
# masked Aadhaar / account numbers: XXXX XXXX 1234, xxxxxxxx1234, **** **** 1234, ••••1234
MASKED = re.compile(r"(?:[Xx*•●]{2,}[ \-]?){1,3}\d{4}\b")
PAN = re.compile(r"\b[A-Za-z]{5}\s?\d{4}\s?[A-Za-z]\b")
EPIC = re.compile(r"\b[A-Za-z]{3}\s?\d{7}\b")  # voter ID
# driving licence: state code + RTO code + year + number, e.g. TS09 20110012345, MH-12-2011-0012345, DL0420110149646
DL = re.compile(r"\b[A-Za-z]{2}[ \-]?\d{2}[ \-]?(?:\d{4}[ \-]?\d{7}|\d{11})\b")
IFSC = re.compile(r"\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b")
# passport: one letter + 7 digits, e.g. A1234567 (the first digit is never 0)
PASSPORT = re.compile(r"\b[A-Za-z][1-9]\d{6}\b")
# "Aadhaar no: …", "A/c 1234…" — the label alone is enough to drop the line ("driving licence" on its own is a
# skill on a driver's resume, so that one needs "no"/"number" after it)
LABEL = re.compile(
    r"\b(aadh?aa?r|uidai|vid\b|virtual id|pan\s*(no|number|card)|epic\s*(no|number)|voter\s*id\s*(no|number)|"
    r"passport\s*(no|number)|(driving\s*)?licen[cs]e\s*(no|number)|dl\s*(no|number)|a/c\b|ac\s*(no|number)\b|"
    r"account\s*(no|number)|ifsc|enrol?ment\s*no)",
    re.IGNORECASE,
)
PATTERNS = (LONG_DIGITS, MASKED, PAN, EPIC, DL, PASSPORT, IFSC)

ID_KEY = re.compile(
    r"(aadh?aa?r|^vid$|virtual_?id|^pan$|pan_?(no|number)|epic|voter_?id|passport|licen[cs]e_?(no|number)|"
    r"dl_?(no|number)|account|ifsc|id_?(no|number)|uid)",
    re.IGNORECASE,
)
PHONE = re.compile(r"^\+?(91[ \-]?)?[6-9]\d{4}[ \-]?\d{5}$|^0\d{2,4}[ \-]?\d{6,8}$")


def looks_like_id(text: str) -> bool:
    """True if the text holds (or is labelled as) a government ID or bank number."""
    return bool(LABEL.search(text)) or any(p.search(text) for p in PATTERNS)


def _clean_str(key: str, value: str) -> str | None:
    if key == "phone":  # a phone number is fine here, and only here — nothing else
        v = value.strip()
        return v if PHONE.match(v) else None
    return None if looks_like_id(value) else value


def scrub(obj: Any, key: str = "") -> Any:
    """A copy of `obj` without ID numbers: such strings become "" (in objects) or are left out (in lists)."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if ID_KEY.search(k):
                continue
            out[k] = scrub(v, key if k == "value" else k)  # {phone: {value: …}} is checked as a phone
        return out
    if isinstance(obj, list):
        items = [scrub(v, key) for v in obj]
        return [v for v in items if v is not None and v != "" and not _emptied(v)]
    if isinstance(obj, str):
        cleaned = _clean_str(key, obj)
        return "" if cleaned is None else cleaned
    return obj


def _emptied(v: Any) -> bool:
    """A list entry whose main text was dropped (e.g. a skill {value: ""}) goes too."""
    return isinstance(v, dict) and "value" in v and v.get("value") == ""
