"""Server copy of the prices in frontend/src/lib/pricing.js. The server never trusts an amount from the browser.
Amounts are in paise (₹999 = 99900). Keep both files in step."""

from app.core.errors import ApiError

PLANS: dict[str, tuple[str, int]] = {
    "diy": ("Fix it yourself", 99_00),
    "expert": ("Expert rewrite", 999_00),
    "launch": ("Career Launch", 2999_00),
    "linkedin_pack": ("LinkedIn pack", 149_00),  # self-serve, unlocked at once (app/linkedin/pack.py)
    # job search (app/jobsearch/access.py): self-serve, unlocked at once
    "tailor_pack": ("Tailor pack", 49_00),  # unlimited job matches, tailored copies, AI rewrites, cover letters
    "interview_pack": ("Interview pack", 99_00),  # the full interview prep pack and practice mode
    # 12 months of downloads + Tailor, Interview and LinkedIn packs (app/me/student_pass.py)
    "annual_pass": ("Annual student pass", 199_00),
}
ADDONS: dict[str, tuple[str, int]] = {
    "revision": ("Extra revision round", 199_00),
    "express": ("Express delivery (24h)", 299_00),
    "linkedin": ("LinkedIn makeover", 499_00),
}
SELF_SERVE = ("diy", "linkedin_pack", "tailor_pack", "interview_pack", "annual_pass")  # paid → done at once, no expert
DELIVERY_HOURS = 48
CURRENCY = "INR"


def price(plan: str, addons: list[str], site: dict | None = None) -> list[tuple[str, str, str, int]]:
    """Line items (kind, code, name, amount) for a new order. `site` holds the owner's prices (app/site.py)."""
    plans = {k: (v["name"], v["amount"], v["active"]) for k, v in site["plans"].items()} if site else None
    extras = {k: (v["name"], v["amount"], v["active"]) for k, v in site["addons"].items()} if site else None
    plans = plans or {k: (n, a, True) for k, (n, a) in PLANS.items()}
    extras = extras or {k: (n, a, True) for k, (n, a) in ADDONS.items()}
    if plan not in plans or not plans[plan][2]:
        raise ApiError(400, "unknown_plan", "Pick one of the plans.")
    if len(set(addons)) != len(addons):
        raise ApiError(400, "duplicate_addon", "Each add-on can be added once.")
    if addons and plan in SELF_SERVE:
        raise ApiError(400, "addon_not_allowed", "Add-ons are for expert plans.")
    for a in addons:
        if a not in extras or not extras[a][2]:
            raise ApiError(400, "unknown_addon", f"Unknown add-on: {a}.")
    if plan == "launch" and "linkedin" in addons:
        raise ApiError(400, "addon_not_allowed", "Career Launch already includes the LinkedIn makeover.")
    items = [("plan", plan, *plans[plan][:2])]
    items += [("addon", a, *extras[a][:2]) for a in addons]
    return items
