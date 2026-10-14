"""The Job Profile: one master career record per customer (same sections as a resume, plus private job preferences).
Resumes are copies made from it. Salary and personal information are private: never on a share link and only
shown to the customer's expert when the customer switches that on."""

from typing import Any

PRIVATE_PREFS = ("salaryMin", "salaryMax", "salary")


def strip_private(data: dict[str, Any], *, salary: bool = False, personal: bool = False) -> dict[str, Any]:
    """A copy without the salary range (unless `salary`) and personal information (unless `personal`)."""
    out = dict(data or {})
    prefs = out.get("prefs")
    if isinstance(prefs, dict) and not salary:
        out["prefs"] = {k: v for k, v in prefs.items() if k not in PRIVATE_PREFS}
    if not personal:
        out.pop("pinfo", None)
    return out


def privacy_of(doc: dict[str, Any] | None) -> dict[str, bool]:
    p = (doc or {}).get("privacy") or {}
    return {"experts": bool(p.get("experts")), "salary": bool(p.get("salary")), "personal": bool(p.get("personal"))}
