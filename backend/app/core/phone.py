"""Indian mobile numbers, one way everywhere.

Stored as E.164: "+919876543210". Accepted in any of the old shapes an API client or an old account may still use:
"98765 43210", "9876543210", "+91 98765 43210", "+91-98765-43210", "919876543210", "09876543210", "0091 98765 43210".
Shown to people as "+91 98765 43210" (pretty()).
"""

from __future__ import annotations

import re

MESSAGE = "Enter a 10-digit mobile number."


def national(raw: str | None) -> str:
    """The 10 digits of an Indian mobile ("" when it is not one). Leading +91 / 91 / 0 / 0091 are dropped."""
    d = re.sub(r"\D", "", raw or "")
    if len(d) > 10:
        if d.startswith("00"):
            d = d[2:]
        if len(d) == 12 and d.startswith("91"):
            d = d[2:]
        elif len(d) == 11 and d.startswith("0"):
            d = d[1:]
    return d if len(d) == 10 and d[0] in "6789" else ""


def is_mobile(raw: str | None) -> bool:
    return bool(national(raw))


def to_e164(raw: str | None) -> str | None:
    """None for an empty value; "+919876543210" for a valid one; ValueError(MESSAGE) otherwise."""
    if raw is None or not str(raw).strip():
        return None
    d = national(str(raw))
    if not d:
        raise ValueError(MESSAGE)
    return f"+91{d}"


def pretty(raw: str | None) -> str:
    """Shown as "+91 98765 43210": an Indian mobile in any accepted shape; anything else comes back as it was."""
    d = national(raw)
    return f"+91 {d[:5]} {d[5:]}" if d else (raw or "")


def e164_or_keep(raw: str | None) -> str:
    """For contact fields that may still hold another kind of number (a referee's or partner's landline): an Indian
    mobile becomes E.164, anything else is kept as typed (trimmed)."""
    d = national(raw)
    return f"+91{d}" if d else (raw or "").strip()
