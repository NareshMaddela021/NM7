"""Codes API.

POST /api/me/codes/apply                      a customer at the pay step: {code, item, resumeId?}. A free code
                                              unlocks at once (an order at Rs 0, in any payment mode); a discount
                                              code returns the new price (it is used when the order is placed).
(an organization's plan: GET …/billing/quote?code=, POST …/billing/code, …/checkout, …/whatsapp; app/billing)

Admin → Codes (Owner only: the "settings" permission; everyone else gets 403):
GET    /api/admin/coupons?q=&status=&type=&item=   list
POST   /api/admin/coupons                          create (code typed, or made up when left empty)
POST   /api/admin/coupons/bulk                     N one-time codes with a prefix (DRIVE-7KQ2, …)
PUT    /api/admin/coupons/{code}                   edit (past uses keep their record)
POST   /api/admin/coupons/{code}/pause · /resume
DELETE /api/admin/coupons/{code}                   only a code never used (a used one can only be paused)
GET    /api/admin/coupons/{code}/uses · uses.csv   who used it
GET    /api/admin/coupons/targets?q=               organizations and groups for "Only for"
"""

import csv
import io
import re
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import Field, model_validator
from pymongo.errors import DuplicateKeyError

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core.db import COUPON_USES, COUPONS, DB, ORG_GROUPS, ORGANIZATIONS, USERS
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.coupons.flow import (
    already_has,
    customer_quote,
    guarded,
    mode_allows,
    quote_view,
    redeem_customer,
    resume_key,
    rs,
)
from app.coupons.service import (
    CODE_RE,
    ITEMS,
    ORG_ITEMS,
    TYPES,
    _day_end,
    _day_start,
    day_of,
    label_of,
    new_code,
    norm,
    only_out,
    status_of,
)

me = APIRouter(prefix="/api/me/codes", tags=["codes"])
admin = APIRouter(prefix="/api/admin/coupons", tags=["admin-codes"])

Item = Literal[
    "resume", "tailor_pack", "interview_pack", "launch", "expert", "linkedin_pack", "annual_pass", "drive", "campus"
]
NOT_FOUND = ApiError(404, "not_found", "No such code.")


# ---------- a customer at the pay step ----------
class ApplyIn(CamelModel):
    code: str = Field(min_length=1, max_length=40)
    item: Item
    resume_id: str | None = Field(None, max_length=100)  # a resume download: the resume to unlock


@me.post("/apply")
async def apply_code(body: ApplyIn, request: Request, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    if body.item in ORG_ITEMS:
        raise ApiError(400, "code_wrong_item", "Enter organization plan codes on your organization’s Billing page.")
    uid = auth.user.id
    c, original, discount = await guarded(
        db, f"user:{uid}", client_ip(request), lambda: customer_quote(db, uid, body.code, body.item)
    )
    view = quote_view(c, body.item, original, discount)
    if not view["free"]:
        await mode_allows(db, False)  # Off: nothing can be paid, so a discount can't be used
        return {**view, "unlocked": False}
    rkey = await resume_key(db, uid, body.resume_id) if body.item == "resume" else None
    msg = await already_has(db, uid, body.item, rkey)
    if msg:
        raise ApiError(409, "already_unlocked", msg)
    order = await redeem_customer(db, uid, c, body.item, rkey)
    return {**view, "unlocked": True, "orderId": order.id, "resumeId": rkey}


# ---------- admin ----------
class OnlyIn(CamelModel):
    kind: Literal["org", "group"]
    id: str = Field(min_length=1, max_length=64)


class CouponIn(CamelModel):
    type: Literal["free", "percent", "flat"]
    value: int = Field(0, ge=0, le=10_000_000)  # percent: 1-99; flat: paise; free: ignored
    items: list[Item | Literal["all"]] = Field(min_length=1, max_length=len(ITEMS) + 1)
    total_limit: int | None = Field(None, ge=1, le=1_000_000)  # None: unlimited
    per_limit: int = Field(1, ge=1, le=100)  # per person (per organization for the organization plans)
    valid_from: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")  # IST days, inclusive
    valid_until: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    only: OnlyIn | None = None
    note: str = Field("", max_length=300)

    @model_validator(mode="after")
    def _ok(self):
        if self.type == "percent" and not 1 <= self.value <= 99:
            raise ValueError("A percent off is 1 to 99 (use Free unlock for 100%).")
        if self.type == "flat" and self.value < 100:
            raise ValueError("A flat discount is at least Rs 1.")
        if self.type == "free":
            self.value = 0
        if self.valid_from and self.valid_until and self.valid_until < self.valid_from:
            raise ValueError("‘Valid until’ is before ‘Valid from’.")
        if "all" in self.items:
            self.items = ["all"]
        return self


class NewCouponIn(CouponIn):
    code: str = Field("", max_length=40)  # empty: made up


class BulkIn(CouponIn):
    prefix: str = Field(min_length=1, max_length=20)
    count: int = Field(ge=1, le=1000)


async def _check_only(db, only: OnlyIn | None) -> dict[str, Any] | None:
    if not only:
        return None
    coll = ORGANIZATIONS if only.kind == "org" else ORG_GROUPS
    if not await db[coll].find_one({"_id": only.id}, {"_id": 1}):
        raise ApiError(400, "bad_target", "That organization or group no longer exists.")
    return {"kind": only.kind, "id": only.id}


async def _fields(db, body: CouponIn) -> dict[str, Any]:
    return {
        "type": body.type,
        "value": body.value,
        "items": body.items,
        "total_limit": body.total_limit,
        "per_limit": body.per_limit,
        "valid_from": _day_start(body.valid_from) if body.valid_from else None,
        "valid_until": _day_end(body.valid_until) if body.valid_until else None,
        "only": await _check_only(db, body.only),
        "note": body.note.strip(),
    }


def _ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


async def _row(db, c: dict[str, Any], names: dict | None = None) -> dict[str, Any]:
    only = c.get("only")
    if only and names is not None:
        o = {**only, "name": names.get((only["kind"], only["id"]), "(deleted)")}
    else:
        o = await only_out(db, only)
    return {
        "code": c["_id"],
        "type": c["type"],
        "value": c["value"],
        "label": label_of(c),
        "items": c["items"],
        "itemNames": ["All paid items"] if "all" in c["items"] else [ITEMS[i][0] for i in c["items"] if i in ITEMS],
        "totalLimit": c.get("total_limit"),
        "perLimit": int(c.get("per_limit") or 1),
        "uses": int(c.get("uses") or 0),
        "validFrom": day_of(c.get("valid_from")),
        "validUntil": day_of(c.get("valid_until")),
        "status": status_of(c),
        "paused": bool(c.get("paused")),
        "only": o,
        "note": c.get("note", ""),
        "batch": c.get("batch"),
        "createdAt": _ms(c.get("created_at")),
        "lastUsedAt": _ms(c.get("last_used_at")),
    }


async def _only_names(db, coupons: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    names: dict[tuple[str, str], str] = {}
    for kind, coll in (("org", ORGANIZATIONS), ("group", ORG_GROUPS)):
        ids = list({c["only"]["id"] for c in coupons if (c.get("only") or {}).get("kind") == kind})
        if ids:
            async for d in db[coll].find({"_id": {"$in": ids}}, {"name": 1}):
                names[(kind, d["_id"])] = d.get("name", "")
    return names


@admin.get("")
async def list_codes(
    db: DB,
    _: AdminAuth("settings"),
    q: str = Query("", max_length=60),
    status: Literal["", "active", "paused", "expired", "scheduled", "used_up"] = "",
    type: Literal["", "free", "percent", "flat"] = "",  # noqa: A002
    item: str = Query("", max_length=20),
) -> dict[str, Any]:
    find: dict[str, Any] = {}
    if q.strip():
        rx = re.escape(norm(q)) if norm(q) else re.escape(q.strip())
        find["$or"] = [{"_id": {"$regex": rx}}, {"note": {"$regex": re.escape(q.strip()), "$options": "i"}}]
    if type:
        find["type"] = type
    if item:
        find["items"] = {"$in": [item, "all"]}
    coupons = await db[COUPONS].find(find).sort("created_at", -1).limit(2000).to_list(None)
    names = await _only_names(db, coupons)
    rows = [await _row(db, c, names) for c in coupons]
    if status:
        rows = [r for r in rows if r["status"] == status]
    return {"codes": rows, "items": [{"id": k, "name": v[0]} for k, v in ITEMS.items()], "types": list(TYPES)}


@admin.get("/targets")
async def targets(db: DB, _: AdminAuth("settings"), q: str = Query("", max_length=60)) -> list[dict[str, Any]]:
    """Organizations and their groups, for "Only for"."""
    find = {"name": {"$regex": re.escape(q.strip()), "$options": "i"}} if q.strip() else {}
    orgs = await db[ORGANIZATIONS].find(find, {"name": 1}).sort("name", 1).limit(50).to_list(None)
    gfind = {**find} if find else {}
    groups = await db[ORG_GROUPS].find(gfind, {"name": 1, "org_id": 1}).sort("name", 1).limit(100).to_list(None)
    org_names = {
        o["_id"]: o["name"]
        async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({g["org_id"] for g in groups})}}, {"name": 1})
    }
    return [{"kind": "org", "id": o["_id"], "name": o.get("name", "")} for o in orgs] + [
        {"kind": "group", "id": g["_id"], "name": g.get("name", ""), "orgName": org_names.get(g.get("org_id"), "")}
        for g in groups
    ]


async def _get(db, code: str) -> dict[str, Any]:
    c = await db[COUPONS].find_one({"_id": norm(code)})
    if not c:
        raise NOT_FOUND
    return c


@admin.post("", status_code=201)
async def create_code(body: NewCouponIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    code = norm(body.code)
    if code and not CODE_RE.match(code):
        raise ApiError(400, "bad_code", "A code is 3 to 32 letters, digits or dashes.")
    doc = {**await _fields(db, body), "uses": 0, "paused": False, "created_at": now(), "created_by": auth.user.id}
    for _ in range(5):
        k = code or new_code()
        try:
            await db[COUPONS].insert_one({"_id": k, **doc})
            break
        except DuplicateKeyError:
            if code:
                raise ApiError(409, "code_taken", "That code already exists.") from None
    else:
        raise ApiError(409, "code_taken", "Couldn’t make a new code. Try again.")
    await audit(db, auth.user.id, "coupon.created", target=k, data=_log(k, doc), ip=client_ip(request))
    return await _row(db, await _get(db, k))


def _log(code: str, d: dict[str, Any]) -> dict[str, Any]:
    out = {"code": code, **{k: d[k] for k in ("type", "value", "items", "total_limit", "per_limit", "note") if k in d}}
    for k in ("valid_from", "valid_until"):
        if d.get(k):
            out[k] = day_of(d[k])
    if d.get("only"):
        out["only"] = d["only"]
    return out


@admin.post("/bulk", status_code=201)
async def bulk_create(body: BulkIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    """`count` codes, each usable once by one person (or one organization): PREFIX-XXXX."""
    prefix = norm(body.prefix).strip("-")
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,19}", prefix or "-"):
        raise ApiError(400, "bad_prefix", "A prefix is letters, digits or dashes.")
    t = now()
    batch = f"{prefix}-{t.astimezone(IST).strftime('%Y%m%d%H%M%S')}"
    fields = {**await _fields(db, body), "total_limit": 1, "per_limit": 1}
    doc = {**fields, "uses": 0, "paused": False, "created_at": t, "created_by": auth.user.id, "batch": batch}
    made: list[str] = []
    tries = 0
    while len(made) < body.count and tries < body.count * 5 + 20:
        tries += 1
        k = new_code(prefix)
        try:
            await db[COUPONS].insert_one({"_id": k, **doc})
            made.append(k)
        except DuplicateKeyError:
            continue
    data = {**_log(prefix, doc), "prefix": prefix, "count": len(made), "batch": batch}
    await audit(db, auth.user.id, "coupon.bulk_created", target=batch, data=data, ip=client_ip(request))
    return {"batch": batch, "codes": made, "count": len(made)}


@admin.put("/{code}")
async def edit_code(code: str, body: CouponIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict:
    c = await _get(db, code)
    fields = await _fields(db, body)
    await db[COUPONS].update_one({"_id": c["_id"]}, {"$set": {**fields, "updated_at": now()}})
    before = _log(c["_id"], c)
    after = _log(c["_id"], fields)
    diff = {
        k: {"from": before.get(k), "to": after.get(k)}
        for k in set(before) | set(after)
        if before.get(k) != after.get(k)
    }
    await audit(
        db,
        auth.user.id,
        "coupon.edited",
        target=c["_id"],
        data={"code": c["_id"], "changes": diff},
        ip=client_ip(request),
    )
    return await _row(db, await _get(db, c["_id"]))


async def _pause(db, code: str, paused: bool, request: Request, actor: str) -> dict[str, Any]:
    c = await _get(db, code)
    await db[COUPONS].update_one({"_id": c["_id"]}, {"$set": {"paused": paused, "updated_at": now()}})
    action = "coupon.paused" if paused else "coupon.resumed"
    await audit(db, actor, action, target=c["_id"], data={"code": c["_id"]}, ip=client_ip(request))
    return await _row(db, await _get(db, c["_id"]))


@admin.post("/{code}/pause")
async def pause(code: str, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    return await _pause(db, code, True, request, auth.user.id)


@admin.post("/{code}/resume")
async def resume(code: str, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    return await _pause(db, code, False, request, auth.user.id)


@admin.delete("/{code}")
async def delete_code(code: str, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    c = await _get(db, code)
    used = await db[COUPON_USES].find_one({"code": c["_id"]}, {"_id": 1})
    r = await db[COUPONS].delete_one({"_id": c["_id"], "uses": 0}) if not used else None
    if not r or not r.deleted_count:
        raise ApiError(409, "code_used", "This code has been used, so it can only be paused.")
    await audit(db, auth.user.id, "coupon.deleted", target=c["_id"], data=_log(c["_id"], c), ip=client_ip(request))
    return {"deleted": c["_id"]}


async def _uses(db, code: str) -> list[dict[str, Any]]:
    rows = await db[COUPON_USES].find({"code": code}).sort("at", -1).limit(5000).to_list(None)
    uids = list({u["user_id"] for u in rows if u.get("user_id")})
    oids = list({u["org_id"] for u in rows if u.get("org_id")})
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": uids}}, {"name": 1, "email": 1})}
    orgs = {o["_id"]: o.get("name", "") async for o in db[ORGANIZATIONS].find({"_id": {"$in": oids}}, {"name": 1})}
    out = []
    for u in rows:
        p = users.get(u.get("user_id")) or {}
        org = u.get("org_id")
        out.append(
            {
                "who": "org" if org else "user",
                "name": orgs.get(org, "(deleted organization)")
                if org
                else (p.get("name") or ("Deleted account" if u.get("forgotten") or not p else "")),
                "email": "" if org else p.get("email", ""),
                "item": u["item"],
                "itemName": ITEMS.get(u["item"], (u["item"],))[0],
                "orderId": u.get("order_id"),
                "original": u["original"],
                "discount": u["discount"],
                "final": u["final"],
                "status": u.get("status", "used"),
                "at": _ms(u.get("at")),
            }
        )
    return out


@admin.get("/{code}/uses")
async def uses(code: str, db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    c = await _get(db, code)
    return {"code": await _row(db, c), "uses": await _uses(db, c["_id"])}


@admin.get("/{code}/uses.csv")
async def uses_csv(code: str, request: Request, db: DB, auth: AdminAuth("settings")) -> Response:
    c = await _get(db, code)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["Code", "Used by", "Email", "Item", "Order", "Date", "Original (Rs)", "Discount (Rs)", "Final (Rs)", "Status"]
    )
    for u in await _uses(db, c["_id"]):
        at = datetime.fromtimestamp(u["at"] / 1000, IST).strftime("%Y-%m-%d %H:%M") if u["at"] else ""
        w.writerow(
            [
                csv_safe(x)
                for x in (
                    c["_id"],
                    u["name"],
                    u["email"],
                    u["itemName"],
                    u["orderId"] or "",
                    at,
                    rs(u["original"]),
                    rs(u["discount"]),
                    rs(u["final"]),
                    u["status"],
                )
            ]
        )
    await audit(
        db,
        auth.user.id,
        "report.exported",
        target=f"coupon-uses:{c['_id']}",
        data={"code": c["_id"]},
        ip=client_ip(request),
    )
    return Response(
        CSV_BOM + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="Nm7_code_{c["_id"]}_uses.csv"'},
    )
