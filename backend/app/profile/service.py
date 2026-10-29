"""The Job Profile: one master career record per customer (same sections as a resume). Personal information is
private: never on a share link and only shown to the customer's expert when the customer switches that on.

Job preferences (target roles, cities, notice period, salary) were removed in October 2026. Old values stay stored,
unused, until they are cleared after a dry run; nobody else ever sees them (experts included)."""

from typing import Any


def strip_private(data: dict[str, Any], *, salary: bool = False, personal: bool = False) -> dict[str, Any]:
    """A copy without job preferences (always: they were removed, salary included; `salary` is no longer used) and
    without personal information (unless `personal`)."""
    out = dict(data or {})
    out.pop("prefs", None)
    if not personal:
        out.pop("pinfo", None)
    return out


def privacy_of(doc: dict[str, Any] | None) -> dict[str, bool]:
    p = (doc or {}).get("privacy") or {}
    return {"experts": bool(p.get("experts")), "salary": bool(p.get("salary")), "personal": bool(p.get("personal"))}
