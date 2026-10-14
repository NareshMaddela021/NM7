"""Admin roles — the same table as ROLES in frontend/src/pages/admin/AdminContext.jsx.
The screens only hide sections; these rules are what actually protects the data."""

ROLES: dict[str, set[str]] = {
    "owner": {
        "dashboard",
        "orders",
        "experts",
        "refunds",
        "payments",
        "customers",
        "quality",
        "reports",
        "settings",
        "automation",
        "team",
    },
    "ops": {"dashboard", "orders", "experts", "quality", "automation"},
    "finance": {"dashboard", "payments", "refunds", "reports"},
    "support": {"orders", "customers", "refunds"},
    "quality": {"orders", "quality"},
}


def can(admin_role: str | None, perm: str) -> bool:
    return perm in ROLES.get(admin_role or "", set())
