# ruff: noqa: E501  (dense registry and response lines)
"""Admin → Skill checks → Vetting Trust (owner only, "settings" permission; every change audited).

GET  /api/admin/trust                 the switch, testers, inactivity settings, the retention schedule, last runs
PUT  /api/admin/trust/switch          {public, testers}
PUT  /api/admin/trust/inactivity      {on, months, noticeDays, mode}
PUT  /api/admin/trust/retention       {days: {type: n}}   (each clamped to the type's safe bounds)
POST /api/admin/trust/retention/run   run the deletion job now
"""

from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.sessions import client_ip
from app.core.db import DB, TRUST_RUNS
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import retention as R

admin = APIRouter(prefix="/api/admin/trust", tags=["trust"])


def _inactivity_out(i: dict[str, Any]) -> dict[str, Any]:
    return {"on": bool(i.get("on")), "months": int(i.get("months") or 24), "noticeDays": int(i.get("notice_days") or 30),
            "mode": i.get("mode") or "trust", "enabledAt": ms(i.get("enabled_at"))}  # fmt: skip


async def _out(db) -> dict[str, Any]:
    from app.trust.consent import PURPOSES

    tr = (await get_site(db))["trust"]
    runs = {r["_id"]: r async for r in db[TRUST_RUNS].find({})}
    ina = runs.get("inactivity") or {}
    return {
        "public": bool(tr.get("public")),
        "testers": list(tr.get("testers") or []),
        "inactivity": _inactivity_out(tr["inactivity"]),
        "inactivityLast": {"at": ms(ina.get("ran_at")), **(ina.get("last") or {})},
        "inactivityTotal": ina.get("total") or {},
        "retention": await R.schedule(db),
        "retentionAt": ms((runs.get("retention") or {}).get("ran_at")),
        "purposes": [{"key": p.key, "title": p.title, "version": p.version} for p in PURPOSES.values()],
    }


@admin.get("")
async def overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _out(db)


class SwitchIn(CamelModel):
    public: bool
    testers: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("testers")
    @classmethod
    def _emails(cls, v: list[str]) -> list[str]:
        out = []
        for e in v:
            e = str(e).strip().lower()
            if e and "@" in e and len(e) <= 254 and e not in out:
                out.append(e)
        return out


@admin.put("/switch")
async def switch(body: SwitchIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = (await get_site(db))["trust"]
    new = body.model_dump()
    old = {"public": bool(before.get("public")), "testers": list(before.get("testers") or [])}
    if new != old:
        await save_site(db, {"trust.public": new["public"], "trust.testers": new["testers"]})
        await audit(
            db, auth.user.id, "trust.switch", target="site", data={"from": old, "to": new}, ip=client_ip(request)
        )
    return await _out(db)


class InactivityIn(CamelModel):
    on: bool
    months: int = Field(24, ge=6, le=60)
    notice_days: int = Field(30, ge=14, le=90)
    mode: Literal["trust", "account"] = "trust"


@admin.put("/inactivity")
async def inactivity(body: InactivityIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = (await get_site(db))["trust"]["inactivity"]
    new = {**body.model_dump(), "enabled_at": before.get("enabled_at")}
    if body.on and not before.get("on"):
        new["enabled_at"] = now()  # nobody is warned for time before it was turned on
    if not body.on:
        new["enabled_at"] = None
    if new != before:
        await save_site(db, {"trust.inactivity": new})
        await audit(db, auth.user.id, "trust.inactivity", target="site", data={"on": body.on, "months": body.months,
                    "notice_days": body.notice_days, "mode": body.mode}, ip=client_ip(request))  # fmt: skip
    return await _out(db)


class RetentionIn(CamelModel):
    days: dict[str, int]


@admin.put("/retention")
async def retention(body: RetentionIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    site = await get_site(db)
    changes: dict[str, Any] = {}
    diff: dict[str, Any] = {}
    for k, v in body.days.items():
        dt = R.TYPES.get(k)
        if not dt:
            raise ApiError(400, "unknown_type", f"There is no data type “{k}”.")
        if not dt.min_days <= v <= dt.max_days:
            raise ApiError(400, "out_of_bounds", f"{dt.label}: choose {dt.min_days}–{dt.max_days} days.")
        if v != R.days_for(site, k):
            changes[f"trust.retention.{k}"] = v
            diff[k] = {"from": R.days_for(site, k), "to": v}
    if changes:
        await save_site(db, changes)
        await audit(db, auth.user.id, "trust.retention", target="site", data=diff, ip=client_ip(request))
    return await _out(db)


@admin.post("/retention/run")
async def run_now(db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        counts = await R.run(db, force=True)
    await audit(db, auth.user.id, "trust.retention_run", target="site", data=counts)
    return {"deleted": counts, **(await _out(db))}
