"""Government ID and bank numbers in free text: found and removed, keeping the rest of the sentence.

Resumes and job profiles are typed freely, so an Aadhaar, PAN, passport, driving-licence or account number can land
in any field. Nothing on Nm7 needs those numbers, so they are removed when a resume or job profile is saved
(app/me/router.py, app/profile/router.py), again before anything is printed for an organization or a recruiter
(app/orgs/service.py, app/orgs/recruiter.py: the second lock, which drops a string that still holds one), and from
the note sent to the summary writer (app/summary/router.py).

Legitimate numbers stay: years, dates, phone numbers (10 digits starting 6-9, with or without +91), PIN codes,
percentages, marks and salaries. The photo reader has its own, stricter scrubber (app/photos/scrub.py): it drops a
whole string on the first ID-like number, because nobody typed that text.
"""

import re
from typing import Any

from app.photos.scrub import DL, EPIC, IFSC, MASKED, PASSPORT

# Indian mobile numbers are kept as they are: 10 digits starting 6-9, optionally after +91 / 91 / 0.
PHONE = re.compile(r"(?<!\d)(?:\+?91[ \-]?|0)?[6-9]\d{4}[ \-]?\d{5}(?!\d)")
VID = re.compile(r"(?<!\d)\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}(?!\d)")  # Aadhaar VID (and card numbers)
AADHAAR = re.compile(r"(?<!\d)[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}(?!\d)")
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")  # upper case, no spaces ("Batch 2019 A" is not a PAN)
# "Aadhaar no: 1234 5678 9012", "A/c # 123456789", "PAN: abcpe 1234 f": right after a label, a 9-18 digit run or a
# loosely written PAN is an ID number whatever it looks like.
_LABEL = (
    r"\b(?:aadh?aa?r|uidai|vid|virtual id|pan|epic|voter id|passport|(?:driving )?licen[cs]e|dl|a/c|acct|account|"
    r"bank|ifsc|enrol?ment)\b[^\w\n]{0,4}(?:no|number|num|card)?\.?[^\w\n]{0,4}"
)
LABELLED_DIGITS = re.compile(_LABEL + r"(\d(?:[ \-]?\d){8,17})(?!\d)", re.IGNORECASE)
LABELLED_PAN = re.compile(_LABEL + r"([A-Za-z]{5} ?\d{4} ?[A-Za-z])\b", re.IGNORECASE)
PATTERNS = (MASKED, DL, VID, AADHAAR, PAN, PASSPORT, EPIC, IFSC)
PASSES = 3  # removing one number can leave the digits around it looking like another


def _remove_labelled(text: str) -> tuple[str, int]:
    n = 0

    def gone(m: re.Match) -> str:
        nonlocal n
        n += 1
        return m.group(0)[: m.start(1) - m.start(0)]  # the label stays, the number goes

    for p in (LABELLED_DIGITS, LABELLED_PAN):
        text = p.sub(gone, text)
    return text, n


def tidy(text: str) -> str:
    """Whitespace and punctuation left behind by a removal: "call  ,  mail" becomes "call, mail"."""
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" +([,.;:)])", r"\1", text)
    return text.strip()


def _one_pass(text: str) -> tuple[str, int]:
    out, n = _remove_labelled(text)
    phones: list[str] = []

    def keep(m: re.Match) -> str:
        phones.append(m.group(0))
        return f"\x00{len(phones) - 1}\x00"

    out = PHONE.sub(keep, out)
    for p in PATTERNS:
        out, k = p.subn("", out)
        n += k
    out = re.sub(r"\x00(\d+)\x00", lambda m: phones[int(m.group(1))], out)
    return (tidy(out), n) if n else (text, 0)


def scrub_text(text: str) -> tuple[str, int]:
    """The text without ID numbers (the rest of the sentence stays) and how many were removed."""
    out, total = text, 0
    for _ in range(PASSES):
        out, n = _one_pass(out)
        total += n
        if not n:
            break
    return (out, total) if total else (text, 0)


def has_id_number(text: str) -> bool:
    return scrub_text(text)[1] > 0


def scrub_id_numbers(obj: Any, *, strict: bool = False) -> tuple[Any, int]:
    """A copy of any nested dict / list / string with the ID numbers removed, and how many were removed.
    With `strict`, a string that still holds one after that becomes "" (in objects) or is left out (in lists)."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        n = 0
        for k, v in obj.items():
            out[k], m = scrub_id_numbers(v, strict=strict)
            n += m
        return out, n
    if isinstance(obj, list):
        items = []
        n = 0
        for v in obj:
            v2, m = scrub_id_numbers(v, strict=strict)
            n += m
            if strict and isinstance(v, str) and v2 == "" and v != "":
                continue
            items.append(v2)
        return items, n
    if isinstance(obj, str):
        out, n = scrub_text(obj)
        if strict and n and has_id_number(out):
            return "", n + 1
        return out, n
    return obj, 0
