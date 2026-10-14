"""Server copy of the prices in frontend/src/lib/pricing.js. The server never trusts an amount from the browser.
Amounts are in paise (₹999 = 99900). Keep both files in step."""

from app.core.errors import ApiError

PLANS: dict[str, tuple[str, int]] = {
    "diy": ("Fix it yourself", 99_00),
    "expert": ("Expert rewrite", 999_00),
    "launch": ("Career Launch", 2999_00),
}
ADDONS: dict[str, tuple[str, int]] = {
    "revision": ("Extra revision round", 199_00),
    "express": ("Express delivery (24h)", 299_00),
    "linkedin": ("LinkedIn makeover", 499_00),
}
DELIVERY_HOURS = 48
CURRENCY = "INR"


def price(plan: str, addons: list[str]) -> list[tuple[str, str, str, int]]:
    """Line items (kind, code, name, amount) for a new order."""
    if plan not in PLANS:
        raise ApiError(400, "unknown_plan", "Pick one of the plans.")
    if len(set(addons)) != len(addons):
        raise ApiError(400, "duplicate_addon", "Each add-on can be added once.")
    if addons and plan == "diy":
        raise ApiError(400, "addon_not_allowed", "Add-ons are for expert plans.")
    for a in addons:
        if a not in ADDONS:
            raise ApiError(400, "unknown_addon", f"Unknown add-on: {a}.")
    if plan == "launch" and "linkedin" in addons:
        raise ApiError(400, "addon_not_allowed", "Career Launch already includes the LinkedIn makeover.")
    items = [("plan", plan, *PLANS[plan])]
    items += [("addon", a, *ADDONS[a]) for a in addons]
    return items
