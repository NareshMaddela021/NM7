# ruff: noqa: E501  (dense docstrings)
"""The business-registry lookup provider interface, the test provider and the registry.

A provider answers one question: what does the government registry say about this registration number?
  lookup(kind, number) → Registry   kind: gstin | udyam | cin (the number already passed formats.problem)

Registry facts (only what the match needs): found, legal name, trade name, status (active / cancelled / suspended /
inactive / unknown), registration date (YYYY-MM-DD), state, city, the vendor's reference. Keys come from
app/core/config.py and are never returned by any API (Admin only sees "set / not set").
"""

from dataclasses import dataclass, field
from typing import Protocol

from app.trust.employer import formats as F

STATUSES = ("active", "cancelled", "suspended", "inactive", "unknown")


@dataclass
class Registry:
    found: bool
    legal_name: str = ""
    trade_name: str = ""
    status: str = "unknown"  # one of STATUSES
    registered_on: str = ""  # YYYY-MM-DD
    state: str = ""
    city: str = ""
    vendor_ref: str = ""
    extra: dict = field(default_factory=dict)  # never stored; for the adapter's own tests


class LookupError_(Exception):  # noqa: N801  (the vendor couldn't be reached or answered oddly: try again later)
    pass


class Provider(Protocol):
    key: str
    label: str
    test: bool

    def keys(self) -> dict[str, bool]: ...

    def ready(self) -> bool: ...

    async def lookup(self, kind: str, number: str, *, hint: str = "") -> Registry: ...


class Mock:
    """Deterministic, from the number and the company's name (the hint) only; no network. Markers for tests and the demo:
      a company name with "cancelled" (or a GSTIN whose entity character is 9)  → the registry says Cancelled
      a company name with "mismatch"                                          → the registry has another name
      a company name with "notfound"                                          → no record for this number
      a company name with "vendordown"                                        → the lookup fails (try again later)
    Anything else: active, the registry's legal name is the company's own name, registered 1 April 2019."""

    key = "mock"
    label = "Test provider (no real registry lookup)"
    test = True

    def keys(self) -> dict[str, bool]:
        return {}

    def ready(self) -> bool:
        return True

    async def lookup(self, kind: str, number: str, *, hint: str = "") -> Registry:
        h = (hint or "").lower()
        n = F.clean(kind, number)
        if "vendordown" in h:
            raise LookupError_("mock vendor down")
        if "notfound" in h:
            return Registry(False, vendor_ref=f"mock-{kind}-none")
        name = (hint or "Test Business").strip()
        if "mismatch" in h:
            name = "Sunrise Traders and Exports"
        status = "cancelled" if "cancelled" in h or (kind == "gstin" and n[12:13] == "9") else "active"
        return Registry(True, legal_name=name, trade_name=name, status=status, registered_on="2019-04-01",
                        state=F.state_of(kind, n), city="Hyderabad", vendor_ref=f"mock-{kind}-{n[-4:]}")  # fmt: skip


def registry() -> dict[str, Provider]:
    from app.trust.employer.surepass import Surepass

    return {"mock": Mock(), "surepass": Surepass()}


def get(key: str) -> Provider | None:
    return registry().get(key)
