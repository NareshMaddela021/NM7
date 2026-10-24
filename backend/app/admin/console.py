"""Admin console API, part 2: dashboard, customers + support tickets, experts + applications, order assignment,
invoices, quality audits, reports (CSV), settings (prices), automation and team. Every change is audit-logged."""

import csv
import io
import re
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import EmailStr, Field
from pymongo import DESCENDING

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.admin_service import create_admin, provisioning_uri
from app.auth.models import User
from app.auth.service import find_user
from app.auth.sessions import client_ip
from app.automation import run_rules
from app.core import ai_quota
from app.core.db import (
    DB,
    EXPERT_PROFILES,
    ORDER_WORK,
    ORDERS,
    PAYMENTS,
    QUALITY_AUDITS,
    REFUNDS,
    SESSIONS,
    TICKETS,
    USERS,
)
from app.core.email import Email, MailerDep, send_safely
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.schemas import CamelModel
from app.core.time import IST, now
from app.experts.service import active_order_counts, load_profile, load_profiles, profile_out, set_status
from app.jobsearch import access as job_access
from app.linkedin.pack import grant as pack_grant
from app.linkedin.pack import pack_status
from app.linkedin.pack import revoke as pack_revoke
from app.me import emails as me_emails
from app.me.router import ticket_out
from app.me.service import ms
from app.orders.models import Order
from app.orders.service import get_order, order_views
from app.site import RULES, get_site, save_site
from app.work.service import assign, load_work, view

router = APIRouter(prefix="/api/admin", tags=["admin"])
OPEN_ORDER = ("offer", "in_progress", "waiting", "revision")


def _ip(request: Request) -> str | None:
    return client_ip(request)


def _like(q: str) -> dict[str, str]:
    return {"$regex": re.escape(q.strip()), "$options": "i"}


async def _revenue(db, since: datetime | None = None) -> tuple[int, int]:
    """(money in, money refunded) in paise."""
    match: dict[str, Any] = {"status": {"$in": ["captured", "refunded"]}}
    if since:
        match["captured_at"] = {"$gte": since}
    rows = await (
        await db[PAYMENTS].aggregate([{"$match": match}, {"$group": {"_id": None, "n": {"$sum": "$amount"}}}])
    ).to_list()
    rmatch: dict[str, Any] = {"status": "processed"}
    if since:
        rmatch["processed_at"] = {"$gte": since}
    refunded = await (
        await db[REFUNDS].aggregate([{"$match": rmatch}, {"$group": {"_id": None, "n": {"$sum": "$amount"}}}])
    ).to_list()
    return (rows[0]["n"] if rows else 0), (refunded[0]["n"] if refunded else 0)


# ---------- dashboard ----------


@router.get("/stats")
async def stats(db: DB, _: AdminAuth("dashboard"), days: int = Query(30, ge=1, le=366)) -> dict[str, Any]:
    since = now() - timedelta(days=days)
    money_in, refunded = await _revenue(db, since)
    paid = {"paid_at": {"$gte": since}}
    by_plan = {
        r["_id"]: r["n"]
        async for r in await db[ORDERS].aggregate([{"$match": paid}, {"$group": {"_id": "$plan", "n": {"$sum": 1}}}])
    }
    return {
        "days": days,
        "revenue": money_in - refunded,  # paise
        "moneyIn": money_in,
        "refunded": refunded,
        "ordersPaid": sum(by_plan.values()),
        "ordersByPlan": by_plan,
        "customers": await db[USERS].count_documents({"role": "customer", "email_verified_at": {"$ne": None}}),
        "newCustomers": await db[USERS].count_documents({"role": "customer", "created_at": {"$gte": since}}),
        "openOrders": await db[ORDERS].count_documents({"status": {"$in": OPEN_ORDER}}),
        "lateOrders": await db[ORDERS].count_documents(
            {"status": {"$in": OPEN_ORDER}, "delivered_at": None, "deadline_at": {"$lt": now()}}
        ),
        "unassigned": await _unassigned_count(db),
        "refundsInReview": await db[REFUNDS].count_documents({"status": "review"}),
        "ticketsOpen": await db[TICKETS].count_documents({"status": "open"}),
        "applicationsWaiting": await db[EXPERT_PROFILES].count_documents({"status": {"$in": ["review", "testReview"]}}),
        "experts": await db[USERS].count_documents({"role": "expert", "expert_status": "approved"}),
    }


@router.get("/ai-usage")
async def ai_usage(db: DB, _: AdminAuth("dashboard"), days: int = Query(7, ge=1, le=30)) -> dict[str, Any]:
    """AI calls per day (Snap photos, summary writer): calls, fallbacks (with why the first model's answer was
    unusable), failures, refused by a limit, summary options dropped by the server's checks."""
    return await ai_quota.usage(db, days)


async def _unassigned_count(db) -> int:
    assigned = [w["_id"] async for w in db[ORDER_WORK].find({"expert_id": {"$ne": None}}, {"_id": 1})]
    return await db[ORDERS].count_documents({"status": "offer", "_id": {"$nin": assigned}})


# ---------- customers ----------


class CustomerRow(CamelModel):
    id: str
    name: str
    email: str
    phone: str | None
    verified: bool
    blocked: bool
    joined: int
    orders: int
    spent: int  # paise
    notes: str


@router.get("/customers")
async def customers(
    db: DB,
    _: AdminAuth("customers"),
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    match: dict[str, Any] = {"role": "customer"}
    if q:
        match["$or"] = [{"name": _like(q)}, {"email": _like(q)}, {"phone": _like(q)}]
    total = await db[USERS].count_documents(match)
    users = await db[USERS].find(match).sort("created_at", DESCENDING).skip(offset).limit(limit).to_list()
    ids = [u["_id"] for u in users]
    agg = {
        r["_id"]: r
        async for r in await db[ORDERS].aggregate(
            [
                {"$match": {"customer_id": {"$in": ids}, "paid_at": {"$ne": None}}},
                {"$group": {"_id": "$customer_id", "n": {"$sum": 1}, "spent": {"$sum": "$amount"}}},
            ]
        )
    }
    items = [
        CustomerRow(
            id=u["_id"],
            name=u["name"],
            email=u["email"],
            phone=u.get("phone"),
            verified=u.get("email_verified_at") is not None,
            blocked=u.get("disabled_at") is not None,
            joined=ms(u["created_at"]),
            orders=agg.get(u["_id"], {}).get("n", 0),
            spent=agg.get(u["_id"], {}).get("spent", 0),
            notes=u.get("admin_notes", ""),
        )
        for u in users
    ]
    return {"items": [i.model_dump(by_alias=True) for i in items], "total": total}


async def _customer(db, user_id: str) -> User:
    u = User.load(await db[USERS].find_one({"_id": user_id, "role": "customer"}))
    if not u:
        raise ApiError(404, "not_found", "No such customer.")
    return u


@router.get("/customers/{user_id}")
async def customer_detail(user_id: str, db: DB, _: AdminAuth("customers")) -> dict[str, Any]:
    u = await _customer(db, user_id)
    orders = [Order.load(o) async for o in db[ORDERS].find({"customer_id": u.id}).sort("created_at", DESCENDING)]
    raw = await db[USERS].find_one({"_id": u.id}, {"admin_notes": 1})
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "phone": u.phone,
        "verified": u.verified,
        "blocked": u.disabled_at is not None,
        "joined": ms(u.created_at),
        "targetRole": u.target_role,
        "notes": (raw or {}).get("admin_notes", ""),
        "orders": [o.model_dump(by_alias=True, mode="json") for o in await order_views(db, orders)],
        "linkedinPack": await _pack_out(db, u.id),
        "jobPacks": await _job_packs_out(db, u.id),
        "tickets": [
            ticket_out(t).model_dump(by_alias=True)
            async for t in db[TICKETS].find({"user_id": u.id}).sort("created_at", DESCENDING)
        ],
    }


class BlockIn(CamelModel):
    blocked: bool
    reason: str = Field("", max_length=500)


@router.post("/customers/{user_id}/block")
async def block_customer(user_id: str, body: BlockIn, request: Request, db: DB, auth: AdminAuth("customers")) -> dict:
    u = await _customer(db, user_id)
    t = now()
    await db[USERS].update_one({"_id": u.id}, {"$set": {"disabled_at": t if body.blocked else None, "updated_at": t}})
    if body.blocked:
        await db[SESSIONS].update_many({"user_id": u.id, "revoked_at": None}, {"$set": {"revoked_at": t}})
    action = "customer.blocked" if body.blocked else "customer.unblocked"
    await audit(db, auth.user.id, action, target=u.id, data={"email": u.email, "reason": body.reason}, ip=_ip(request))
    return {"ok": True, "blocked": body.blocked}


class NotesIn(CamelModel):
    notes: str = Field(max_length=5000)


@router.put("/customers/{user_id}/notes")
async def customer_notes(user_id: str, body: NotesIn, request: Request, db: DB, auth: AdminAuth("customers")) -> dict:
    u = await _customer(db, user_id)
    await db[USERS].update_one({"_id": u.id}, {"$set": {"admin_notes": body.notes}})
    await audit(db, auth.user.id, "customer.notes", target=u.id, data={"email": u.email}, ip=_ip(request))
    return {"ok": True}


class PackGrantIn(CamelModel):
    granted: bool
    note: str = Field("", max_length=500)


async def _pack_out(db, user_id: str) -> dict[str, Any] | None:
    st = await pack_status(db, user_id)
    return {"source": st["source"], "orderId": st["order_id"], "purchasedAt": ms(st["purchased_at"])} if st else None


@router.post("/customers/{user_id}/linkedin-pack")
async def grant_linkedin_pack(
    user_id: str, body: PackGrantIn, request: Request, db: DB, auth: AdminAuth("customers")
) -> dict[str, Any]:
    """Grant (or take back) the LinkedIn pack by hand, e.g. to test it before payments are on. A paid pack is
    never taken back here: refund its order instead."""
    u = await _customer(db, user_id)
    if body.granted:
        if not await pack_grant(db, u.id, auth.user.id, body.note.strip()):
            raise ApiError(409, "already_paid", "This customer already bought the LinkedIn pack.")
        action = "linkedin_pack.granted"
    else:
        await pack_revoke(db, u.id)
        action = "linkedin_pack.revoked"
    await audit(db, auth.user.id, action, target=u.id, data={"email": u.email, "note": body.note}, ip=_ip(request))
    return {"linkedinPack": await _pack_out(db, u.id)}


async def _job_packs_out(db, user_id: str) -> dict[str, Any]:
    out = {}
    for f in ("tailor", "interview"):
        st = await job_access.status(db, user_id, f)
        out[f] = {"source": st["source"], "orderId": st["order_id"]} if st else None
    return out


class JobPackGrantIn(CamelModel):
    feature: Literal["tailor", "interview"]
    granted: bool
    note: str = Field("", max_length=500)


@router.post("/customers/{user_id}/job-pack")
async def grant_job_pack(
    user_id: str, body: JobPackGrantIn, request: Request, db: DB, auth: AdminAuth("customers")
) -> dict[str, Any]:
    """Grant (or take back) the Tailor pack or the Interview pack by hand, e.g. to test them before payments are on.
    A paid pack is never taken back here: refund its order instead."""
    u = await _customer(db, user_id)
    if body.granted:
        await job_access.grant(db, u.id, body.feature, auth.user.id, body.note.strip())
        action = f"{body.feature}_pack.granted"
    else:
        await job_access.revoke(db, u.id, body.feature)
        action = f"{body.feature}_pack.revoked"
    await audit(db, auth.user.id, action, target=u.id, data={"email": u.email, "note": body.note}, ip=_ip(request))
    return {"jobPacks": await _job_packs_out(db, u.id)}


# ---------- support tickets ----------


@router.get("/tickets")
async def tickets(
    db: DB,
    _: AdminAuth("customers"),
    status: Literal["open", "resolved"] | None = None,
    limit: int = Query(100, ge=1, le=200),
) -> list[dict[str, Any]]:
    stages: list[dict] = [
        {"$match": {"status": status} if status else {}},
        {"$sort": {"created_at": -1}},
        {"$limit": limit},
        {"$lookup": {"from": USERS, "localField": "user_id", "foreignField": "_id", "as": "u"}},
        {"$set": {"u": {"$first": "$u"}}},
    ]
    out = []
    async for t in await db[TICKETS].aggregate(stages):
        row = ticket_out(t).model_dump(by_alias=True)
        row["customer"] = {
            "id": t["user_id"],
            "name": (t.get("u") or {}).get("name"),
            "email": (t.get("u") or {}).get("email"),
        }
        out.append(row)
    return out


class ReplyIn(CamelModel):
    reply: str = Field(min_length=2, max_length=5000)
    resolve: bool = True


@router.post("/tickets/{ticket_id}/reply")
async def reply_ticket(
    ticket_id: str, body: ReplyIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("customers")
) -> dict[str, Any]:
    t = await db[TICKETS].find_one({"_id": ticket_id})
    if not t:
        raise ApiError(404, "not_found", "No such ticket.")
    at = now()
    status = "resolved" if body.resolve else t["status"]
    await db[TICKETS].update_one(
        {"_id": ticket_id},
        {"$set": {"reply": body.reply.strip(), "replied_at": at, "status": status, "replied_by": auth.user.id}},
    )
    user = User.load(await db[USERS].find_one({"_id": t["user_id"]}))
    emailed = await send_safely(mailer, me_emails.ticket_reply(user, t, body.reply.strip())) if user else False
    await audit(db, auth.user.id, "ticket.replied", target=ticket_id, data={"resolved": body.resolve}, ip=_ip(request))
    out = ticket_out(await db[TICKETS].find_one({"_id": ticket_id})).model_dump(by_alias=True)
    return {**out, "emailed": emailed}


# ---------- experts and applications ----------


@router.get("/experts")
async def experts(
    db: DB, _: AdminAuth("experts"), status: str | None = Query(None, max_length=20)
) -> list[dict[str, Any]]:
    match: dict[str, Any] = {"role": "expert"}
    if status:
        match["expert_status"] = status
    users = await db[USERS].find(match).sort("created_at", DESCENDING).to_list(None)
    ids = [u["_id"] for u in users]
    profiles = {p["_id"]: p for p in await load_profiles(db, ids)}
    active_orders = await active_order_counts(db, ids)
    out = []
    for u in users:
        prof = profiles.get(u["_id"])
        p = (prof or {}).get("profile") or {}
        active = active_orders.get(u["_id"], 0)
        out.append(
            {
                "id": u["_id"],
                "name": u["name"],
                "email": u["email"],
                "status": u.get("expert_status") or "draft",
                "paused": bool(u.get("expert_paused")),
                "joined": ms(u["created_at"]),
                "submitted": ms((prof or {}).get("submitted_at")),
                "headline": (p.get("about") or {}).get("headline", ""),
                "domains": (p.get("expertise") or {}).get("domains", []),
                "perWeek": (p.get("services") or {}).get("perWeek"),
                "orders": active,
            }
        )
    return out


@router.get("/experts/{user_id}")
async def expert_detail(user_id: str, db: DB, _: AdminAuth("experts")) -> dict[str, Any]:
    u = await db[USERS].find_one({"_id": user_id, "role": "expert"})
    if not u:
        raise ApiError(404, "not_found", "No such expert.")
    return {
        "id": u["_id"],
        "name": u["name"],
        "email": u["email"],
        "status": u.get("expert_status") or "draft",
        "paused": bool(u.get("expert_paused")),
        "profile": profile_out(await load_profile(db, user_id), for_admin=True),
    }


class DecisionIn(CamelModel):
    action: Literal["approve", "changes", "reject", "test", "pass", "fail"]
    note: str = Field("", max_length=2000)
    scores: dict[str, int] | None = None


def _test_task(domains: set[str]) -> str:
    """Which sample resume the expert rewrites (frontend/src/lib/expertTest.js TASKS)."""
    if domains & {"Data & analytics", "Finance", "Product"}:
        return "T-DATA"
    if domains & {"Software engineering", "Core engineering"}:
        return "T-SDE"
    return "T-GEN"


NEXT = {
    # action: (allowed from, new status)
    "changes": (("review",), "changes"),
    "reject": (("review", "testReview", "test"), "rejected"),
    "test": (("review",), "test"),
    "approve": (("review",), "approved"),
    "pass": (("testReview",), "approved"),
    "fail": (("testReview",), "rejected"),
}
STATUS_TEXT = {
    "changes": "Please update your profile and submit it again.",
    "test": "Your profile looks good. Last step: a short test task — open your expert profile to start it.",
    "approved": "You’re approved as an Nm7 expert. You can now receive orders.",
    "rejected": "We can’t approve your expert profile right now.",
}


@router.post("/experts/{user_id}/decision")
async def expert_decision(
    user_id: str, body: DecisionIn, request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("experts")
) -> dict[str, Any]:
    u = User.load(await db[USERS].find_one({"_id": user_id, "role": "expert"}))
    prof = await load_profile(db, user_id)
    if not u or not prof:
        raise ApiError(404, "not_found", "No such application.")
    allowed, to = NEXT[body.action]
    if prof["status"] not in allowed:
        raise ApiError(409, "bad_status", f"This application is “{prof['status']}”; it can’t be changed that way.")
    extra: dict[str, Any] = {"note": body.note.strip(), "decided_by": auth.user.id, "decided_at": now()}
    if body.action == "test":
        domains = set(((prof.get("profile") or {}).get("expertise") or {}).get("domains") or [])
        extra["test"] = {
            "taskId": _test_task(domains),
            "sentAt": ms(now()),
            "due": ms(now() + timedelta(hours=48)),
            "submitted": None,
        }
    if body.action in ("pass", "fail") and prof.get("test"):
        extra["test"] = {**prof["test"], "scores": body.scores or {}, "result": body.action}
    await set_status(db, user_id, to, extra)
    await audit(
        db,
        auth.user.id,
        f"expert.{body.action}",
        target=user_id,
        data={"from": prof["status"], "to": to, "note": body.note.strip()},
        ip=_ip(request),
    )
    text = f"Hi {u.name},\n\n{STATUS_TEXT.get(to, '')}\n\n{body.note.strip()}\n\nNm7 · nm7.si"
    await send_safely(mailer, Email(u.email, u.name, "Your Nm7 expert application", text, text.replace("\n", "<br>")))
    return await expert_detail(user_id, db, auth)


class PauseIn(CamelModel):
    paused: bool


@router.post("/experts/{user_id}/pause")
async def pause_expert(user_id: str, body: PauseIn, request: Request, db: DB, auth: AdminAuth("experts")) -> dict:
    r = await db[USERS].update_one({"_id": user_id, "role": "expert"}, {"$set": {"expert_paused": body.paused}})
    if not r.matched_count:
        raise ApiError(404, "not_found", "No such expert.")
    await audit(db, auth.user.id, "expert.paused" if body.paused else "expert.resumed", target=user_id, ip=_ip(request))
    return {"ok": True, "paused": body.paused}


# ---------- order detail and assignment ----------


@router.get("/orders/{order_id}")
async def admin_order(order_id: str, db: DB, _: AdminAuth("orders")) -> dict[str, Any]:
    order = await get_order(db, order_id)
    if not order:
        raise ApiError(404, "not_found", "No such order.")
    out = (await order_views(db, [order]))[0].model_dump(by_alias=True, mode="json")
    customer = await db[USERS].find_one({"_id": order.customer_id}, {"name": 1, "email": 1, "phone": 1})
    out["customer"] = {"id": order.customer_id, **{k: (customer or {}).get(k) for k in ("name", "email", "phone")}}
    out["work"] = await view(db, order, await load_work(db, order.id), "admin") if order.plan != "diy" else None
    return out


class AssignIn(CamelModel):
    expert_id: str | None = None


@router.post("/orders/{order_id}/assign")
async def assign_order(order_id: str, body: AssignIn, request: Request, db: DB, auth: AdminAuth("orders")) -> dict:
    order = await get_order(db, order_id)
    if not order or order.plan == "diy":
        raise ApiError(404, "not_found", "No such expert order.")
    if order.status not in ("offer", "in_progress"):
        raise ApiError(409, "bad_status", "Only orders that haven’t started can be (re)assigned.")
    before = (await load_work(db, order.id)).get("expert_id")
    if body.expert_id:
        ex = await db[USERS].find_one({"_id": body.expert_id, "role": "expert", "expert_status": "approved"})
        if not ex or ex.get("expert_paused"):
            raise ApiError(400, "bad_expert", "Pick an approved expert who isn’t paused.")
    expires = await assign(db, order, body.expert_id)
    await audit(
        db,
        auth.user.id,
        "order.assigned",
        target=order.id,
        data={"from": before, "to": body.expert_id},
        ip=_ip(request),
    )
    return {"ok": True, "expertId": body.expert_id, "offerExpires": ms(expires)}


# ---------- invoices ----------


@router.get("/invoices")
async def invoices(
    db: DB,
    _: AdminAuth("payments"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    q = {"invoice_no": {"$type": "string"}}
    total = await db[ORDERS].count_documents(q)
    orders = [
        Order.load(o) for o in await db[ORDERS].find(q).sort("paid_at", DESCENDING).skip(offset).limit(limit).to_list()
    ]
    names = {u["_id"]: u for u in await db[USERS].find({"_id": {"$in": [o.customer_id for o in orders]}}).to_list()}
    items = [
        {
            "invoiceNo": o.invoice_no,
            "orderId": o.id,
            "customer": names.get(o.customer_id, {}).get("name"),
            "email": names.get(o.customer_id, {}).get("email"),
            "amount": o.amount,
            "paidAt": ms(o.paid_at),
            "status": o.status,
        }
        for o in orders
    ]
    return {"items": items, "total": total}


# ---------- quality ----------

QA_CHECKS = [
    "ATS-safe layout",
    "Numbers / results in bullets",
    "No spelling or grammar errors",
    "Matches target role",
    "Clean formatting & length",
]


@router.get("/quality")
async def quality(db: DB, _: AdminAuth("quality")) -> dict[str, Any]:
    audited = {a["_id"]: a async for a in db[QUALITY_AUDITS].find().sort("at", DESCENDING).limit(200)}
    rows = []
    q = {"status": {"$in": ["delivered", "approved"]}, "plan": {"$ne": "diy"}}
    async for o in db[ORDERS].find(q).sort("delivered_at", DESCENDING).limit(100):
        work = await db[ORDER_WORK].find_one({"_id": o["_id"]}, {"expert_id": 1, "data.rating": 1}) or {}
        a = audited.get(o["_id"])
        rows.append(
            {
                "orderId": o["_id"],
                "plan": o["plan"],
                "deliveredAt": ms(o.get("delivered_at")),
                "expertId": work.get("expert_id"),
                "rating": (work.get("data") or {}).get("rating"),
                "scores": a["scores"] if a else None,
                "note": a.get("note", "") if a else "",
            }
        )
    return {"checks": QA_CHECKS, "orders": rows}


class AuditIn(CamelModel):
    scores: list[Literal[0, 1]] = Field(min_length=len(QA_CHECKS), max_length=len(QA_CHECKS))
    note: str = Field("", max_length=2000)


@router.put("/quality/{order_id}")
async def save_audit(order_id: str, body: AuditIn, request: Request, db: DB, auth: AdminAuth("quality")) -> dict:
    order = await get_order(db, order_id)
    if not order or order.status not in ("delivered", "approved"):
        raise ApiError(404, "not_found", "Only delivered orders can be audited.")
    work = await load_work(db, order.id)
    await db[QUALITY_AUDITS].update_one(
        {"_id": order.id},
        {
            "$set": {
                "scores": body.scores,
                "note": body.note,
                "by": auth.user.id,
                "at": now(),
                "expert_id": work.get("expert_id"),
            }
        },
        upsert=True,
    )
    await audit(db, auth.user.id, "quality.audited", target=order.id, data={"score": sum(body.scores)}, ip=_ip(request))
    return {"ok": True}


# ---------- reports ----------


async def _orders_between(db, days: int) -> list[Order]:
    since = now() - timedelta(days=days)
    return [Order.load(o) async for o in db[ORDERS].find({"paid_at": {"$gte": since}}).sort("paid_at", 1)]


@router.get("/reports")
async def reports(db: DB, _: AdminAuth("reports"), days: int = Query(30, ge=1, le=366)) -> dict[str, Any]:
    orders = await _orders_between(db, days)
    daily: dict[str, dict[str, int]] = {}
    for o in orders:
        d = o.paid_at.astimezone(IST).strftime("%Y-%m-%d")
        row = daily.setdefault(d, {"orders": 0, "revenue": 0})
        row["orders"] += 1
        row["revenue"] += o.amount
    money_in, refunded = await _revenue(db, now() - timedelta(days=days))
    by_plan: dict[str, int] = {}
    for o in orders:
        by_plan[o.plan] = by_plan.get(o.plan, 0) + 1
    return {
        "days": days,
        "daily": [{"date": k, **v} for k, v in sorted(daily.items())],
        "byPlan": by_plan,
        "moneyIn": money_in,
        "refunded": refunded,
        "newCustomers": await db[USERS].count_documents(
            {"role": "customer", "created_at": {"$gte": now() - timedelta(days=days)}}
        ),
    }


def _csv_safe(v: Any) -> str:
    return csv_safe("" if v is None else str(v))  # no formulas when opened in Excel


@router.get("/reports/orders.csv")
async def orders_csv(
    request: Request, db: DB, auth: AdminAuth("reports"), days: int = Query(30, ge=1, le=366)
) -> Response:
    orders = await _orders_between(db, days)
    users = {u["_id"]: u for u in await db[USERS].find({"_id": {"$in": [o.customer_id for o in orders]}}).to_list()}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["order", "invoice", "paid_at_ist", "plan", "amount_inr", "status", "customer", "email"])
    for o in orders:
        u = users.get(o.customer_id, {})
        w.writerow(
            [
                _csv_safe(x)
                for x in (
                    o.id,
                    o.invoice_no,
                    o.paid_at.astimezone(IST).strftime("%Y-%m-%d %H:%M"),
                    o.plan,
                    f"{o.amount / 100:.2f}",
                    o.status,
                    u.get("name"),
                    u.get("email"),
                )
            ]
        )
    await audit(db, auth.user.id, "report.exported", target="orders.csv", data={"days": days}, ip=_ip(request))
    return Response(
        CSV_BOM + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="nm7-orders-{days}d.csv"'},
    )


# ---------- settings (prices, delivery promise) ----------


class PriceIn(CamelModel):
    amount: int = Field(ge=100, le=10_000_000)  # paise
    active: bool = True


class SettingsIn(CamelModel):
    plans: (
        dict[Literal["diy", "expert", "launch", "linkedin_pack", "tailor_pack", "interview_pack"], PriceIn] | None
    ) = None
    addons: dict[Literal["revision", "express", "linkedin"], PriceIn] | None = None
    delivery_hours: int | None = Field(None, ge=24, le=168)


def _settings_out(site: dict[str, Any]) -> dict[str, Any]:
    return {"plans": site["plans"], "addons": site["addons"], "deliveryHours": site["delivery_hours"]}


@router.get("/settings")
async def get_settings_(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return _settings_out(await get_site(db))


@router.put("/settings")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = await get_site(db)
    changes: dict[str, Any] = {}
    diff: dict[str, Any] = {}
    for group in ("plans", "addons"):
        for k, v in (getattr(body, group) or {}).items():
            old = before[group][k]
            if (old["amount"], old["active"]) != (v.amount, v.active):
                changes[f"{group}.{k}"] = {"amount": v.amount, "active": v.active}
                diff[f"{group}.{k}"] = {
                    "from": {"amount": old["amount"], "active": old["active"]},
                    "to": v.model_dump(),
                }
    if body.delivery_hours and body.delivery_hours != before["delivery_hours"]:
        changes["delivery_hours"] = body.delivery_hours
        diff["delivery_hours"] = {"from": before["delivery_hours"], "to": body.delivery_hours}
    if changes:
        await save_site(db, changes)
        await audit(db, auth.user.id, "settings.changed", target="site", data=diff, ip=_ip(request))
    return _settings_out(await get_site(db))


# ---------- automation ----------


def _rules_out(site: dict[str, Any]) -> list[dict[str, Any]]:
    runs = site["rule_runs"]
    return [
        {
            "id": k,
            "label": RULES[k]["label"],
            "unit": RULES[k]["unit"],
            **site["rules"][k],
            "lastRun": ms(runs.get(k, {}).get("last_run")),
            "acted": runs.get(k, {}).get("acted", 0),
        }
        for k in RULES
    ]


@router.get("/automation")
async def get_rules(db: DB, _: AdminAuth("automation")) -> list[dict[str, Any]]:
    return _rules_out(await get_site(db))


class RuleIn(CamelModel):
    on: bool
    value: int = Field(ge=1, le=1000)


@router.put("/automation/{rule_id}")
async def put_rule(rule_id: str, body: RuleIn, request: Request, db: DB, auth: AdminAuth("automation")) -> list[dict]:
    if rule_id not in RULES:
        raise ApiError(404, "not_found", "No such rule.")
    before = (await get_site(db))["rules"][rule_id]
    await save_site(db, {f"rules.{rule_id}": body.model_dump()})
    await audit(
        db,
        auth.user.id,
        "automation.changed",
        target=rule_id,
        data={"from": before, "to": body.model_dump()},
        ip=_ip(request),
    )
    return _rules_out(await get_site(db))


@router.post("/automation/run")
async def run_now(request: Request, db: DB, mailer: MailerDep, auth: AdminAuth("automation")) -> dict[str, Any]:
    done = await run_rules(db, mailer)
    await audit(db, auth.user.id, "automation.run", data=done, ip=_ip(request))
    return {"acted": done, "rules": _rules_out(await get_site(db))}


# ---------- team ----------


@router.get("/team")
async def team(db: DB, _: AdminAuth("team")) -> list[dict[str, Any]]:
    out = []
    async for u in db[USERS].find({"role": "admin"}).sort("created_at", 1):
        last = await db[SESSIONS].find_one({"user_id": u["_id"], "two_step": True}, sort=[("created_at", -1)])
        out.append(
            {
                "id": u["_id"],
                "name": u["name"],
                "email": u["email"],
                "role": u["admin_role"],
                "twoStep": bool(u.get("totp_secret_enc")),
                "disabled": u.get("disabled_at") is not None,
                "lastLogin": ms(last["created_at"]) if last else None,
            }
        )
    return out


class NewAdminIn(CamelModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    role: Literal["owner", "ops", "finance", "support", "quality"]
    password: str = Field(max_length=200)  # strength checked like every other password


@router.post("/team", status_code=201)
async def add_admin(body: NewAdminIn, request: Request, db: DB, auth: AdminAuth("team")) -> dict[str, Any]:
    """Creates the account and returns its authenticator setup and recovery codes ONCE — hand them over in person."""
    if await find_user(db, body.email):
        raise ApiError(409, "email_taken", "An account with this email already exists.")
    try:
        user, secret, codes = await create_admin(db, body.email, body.name, body.role, body.password)
    except ValueError as e:
        raise ApiError(400, "invalid", str(e).capitalize() + ".") from None
    await audit(
        db, auth.user.id, "team.added", target=user.id, data={"email": user.email, "role": body.role}, ip=_ip(request)
    )
    return {"id": user.id, "otpauthUri": provisioning_uri(user, secret), "secret": secret, "recoveryCodes": codes}


class TeamPatch(CamelModel):
    role: Literal["owner", "ops", "finance", "support", "quality"] | None = None
    disabled: bool | None = None


@router.patch("/team/{user_id}")
async def change_admin(user_id: str, body: TeamPatch, request: Request, db: DB, auth: AdminAuth("team")) -> list[dict]:
    u = await db[USERS].find_one({"_id": user_id, "role": "admin"})
    if not u:
        raise ApiError(404, "not_found", "No such team member.")
    if user_id == auth.user.id:
        raise ApiError(400, "not_yourself", "You can’t change your own role or switch yourself off.")
    sets: dict[str, Any] = {}
    if body.role and body.role != u["admin_role"]:
        sets["admin_role"] = body.role
    if body.disabled is not None and body.disabled != (u.get("disabled_at") is not None):
        sets["disabled_at"] = now() if body.disabled else None
    losing_owner = u["admin_role"] == "owner" and (sets.get("admin_role") or sets.get("disabled_at"))
    if losing_owner:
        owners = await db[USERS].count_documents({"role": "admin", "admin_role": "owner", "disabled_at": None})
        if owners <= 1:
            raise ApiError(400, "last_owner", "Keep at least one active owner.")
    if sets:
        await db[USERS].update_one({"_id": user_id}, {"$set": {**sets, "updated_at": now()}})
        if sets.get("disabled_at") or "admin_role" in sets:
            await db[SESSIONS].update_many({"user_id": user_id, "revoked_at": None}, {"$set": {"revoked_at": now()}})
        await audit(
            db,
            auth.user.id,
            "team.changed",
            target=user_id,
            data={
                "from": {"role": u["admin_role"], "disabled": u.get("disabled_at") is not None},
                "to": body.model_dump(exclude_none=True),
            },
            ip=_ip(request),
        )
    return await team(db, auth)
