"""Test data for the browser end-to-end tests (frontend/e2e-live). Only touches a database whose name ends in _e2e.

MONGODB_DB=nm7_e2e uv run python -m tests.e2e_seed reset
... admin EMAIL ROLE PASSWORD          → {"secret": "..."} (authenticator key)
... customer EMAIL NAME PASSWORD       → {"id": "..."}
... expert EMAIL NAME PASSWORD STATUS  → {"id": "..."}
... paid-order EMAIL PLAN              → {"id": "RS-…"} (as if Razorpay had confirmed the payment)
... customer-order EMAIL PLAN         → the checkout answer (a customer order waiting for Razorpay's webhook)
... org-order ORG_ID PLAN EMAIL [REF]  → the checkout answer (an org order waiting for Razorpay's webhook), made
                                          without calling Razorpay (the browser tests run without Razorpay keys)
... company-verify COMPANY_ID              → {"ok": true} (as if an admin approved it: Verified for a year)
... job JSON [STATUS] [AGE_HOURS]       → {"id", "slug"} (a job-board job, as an admin would add it)
... auto-apply-run [EMAIL [past]]      → the Auto Apply run now (any hour); with EMAIL and "past", that student's
                                          preview days are over first
... job-alerts EMAIL                   → {"sent": [{to, subject, text}], "stop": token} (the alert pass for one person,
                                          its emails captured instead of sent, and their "Stop these emails" token)
"""

import asyncio
import json
import os
import sys
from datetime import timedelta

from app.auth.admin_service import create_admin
from app.auth.models import User
from app.billing.checkout import new_org_order, quote, quote_out
from app.core.db import ORDERS, ORGANIZATIONS, PAYMENTS, USERS, close_client, ensure_indexes, get_client, get_database
from app.core.security import hash_password
from app.core.time import now
from app.orders.service import build_order, next_invoice_no
from app.payments.models import Payment


async def main(cmd: str, *args: str) -> dict:
    name = os.environ.get("MONGODB_DB", "")
    if not name.endswith("_e2e"):
        sys.exit("MONGODB_DB must end with _e2e")
    db = get_database()
    if cmd == "reset":
        await get_client().drop_database(name)
        await ensure_indexes(db)
        return {"ok": True}
    if cmd == "site-langs":  # Admin → Settings → "Show Telugu and Hindi" (item 41): on | off
        (state,) = args
        await db["settings"].update_one({"_id": "site"}, {"$set": {"languages.te_hi": state == "on"}}, upsert=True)
        return {"ok": True}
    if cmd == "hire-token":  # the one-tap "Still ready" link's token from the reminder email (Phase 5 H1)
        from app.hire.available import still_token

        (mail,) = args
        u = await db["users"].find_one({"email": mail})
        return {"token": still_token(u["_id"])}
    if cmd == "skill-pass":  # Phase 6 S2: an official skill check finished with this score (the badge needs it)
        from app.seek.paths import on_skill_check

        mail, skill, score = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        doc = {"user_id": u["_id"], "skill": skill, "started_at": t, "ends_at": t, "submitted_at": t,
               "score": int(score), "late": False, "total": 10}  # fmt: skip
        await db["skill_attempts"].insert_one(doc)
        await on_skill_check(db, u["_id"], skill)
        return {"ok": True}
    if cmd == "company-verify":
        (cid,) = args
        await db["companies"].update_one(
            {"_id": cid},
            {"$set": {"review.state": "approved", "verified_until": now() + timedelta(days=365), "trust": "verified"}},
        )
        return {"ok": True}
    if cmd == "job":
        from app.jobs import service
        from app.jobs.model import JobIn

        body, *rest = args
        _, doc = await service.save(db, JobIn.model_validate(json.loads(body)), "admin")
        sets = {}
        if rest and rest[0]:
            sets["status"] = rest[0]
        if len(rest) > 1:
            sets["posted_at"] = now() - timedelta(hours=float(rest[1]))
        if sets:
            await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": sets})
        return {"id": doc["_id"], "slug": doc["slug"]}
    if cmd == "collector-job":  # round J: a job the morning collector posted (source "collector", summary written)
        from app.jobs import service
        from app.jobs.model import JobIn

        body, *waiting = args  # round M: a second argument "no_page_text,…" makes it wait for review for those
        _, doc = await service.save(db, JobIn.model_validate(json.loads(body)), "collector")
        key = doc["apply"]["url"].split("://", 1)[-1].lower().rstrip("/")
        meta = {"url_key": key, "summarised": not waiting, "removed": False}
        sets = {"collector": meta}
        if waiting:
            sets.update(status="review", review={"reasons": waiting[0].split(","), "note": ""})
        await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": sets})
        return {"id": doc["_id"], "slug": doc["slug"]}
    if cmd == "auto-apply-run":
        from app.autoapply import engine

        if len(args) >= 2 and args[1] == "past":
            await db[USERS].update_one(
                {"email_lc": args[0].lower()}, {"$set": {"auto_apply.started_at": now() - timedelta(days=10)}}
            )
        await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
        out = await engine.run(db, force=True, limit=1000)
        return {k: v for k, v in out.items() if isinstance(v, (int, bool))}
    if cmd == "job-alerts":
        from app.jobs import alerts

        (mail,) = args
        u = await db[USERS].find_one({"email_lc": mail.lower()})

        class Capture:
            def __init__(self):
                self.sent = []

            async def send(self, e):
                self.sent.append({"to": e.to, "subject": e.subject, "text": e.text})

        cap = Capture()
        await alerts.send_alerts(db, cap)
        return {"sent": [x for x in cap.sent if x["to"] == u["email"]], "stop": alerts.unsub_token(u["_id"])}
    if cmd == "admin":
        email, role, password = args
        _, secret, _ = await create_admin(db, email, role.title(), role, password)
        return {"secret": secret}
    if cmd in ("customer", "expert"):
        email, full_name, password, *rest = args
        status = rest[0] if rest else None
        u = User(
            email=email,
            name=full_name,
            role=cmd,
            expert_status=status,
            password_hash=await hash_password(password),
            email_verified_at=now(),
            terms_accepted_at=now(),
        )
        await db[USERS].insert_one(u.to_mongo())
        if status:
            await db["expert_profiles"].insert_one({"_id": u.id, "status": status, "profile": {}, "note": ""})
        return {"id": u.id}
    if cmd == "paid-order":
        email, plan = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        order = await build_order(db, user, plan, "Data Analyst", [])
        t = now()
        order.status, order.paid_at = ("done" if plan == "diy" else "offer"), t
        order.invoice_no = await next_invoice_no(db, t)
        order.deadline_at = None if plan == "diy" else t + timedelta(hours=48)
        await db[ORDERS].insert_one(order.to_mongo())
        pay = Payment(
            order_id=order.id,
            razorpay_order_id=f"order_{order.id}",
            razorpay_payment_id=f"pay_{order.id.replace('-', '')}",
            amount=order.amount,
            currency="INR",
            status="captured",
            method="upi",
            captured_at=t,
        )
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {"id": order.id}
    if cmd == "customer-order":
        email, plan = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        order = await build_order(db, user, plan, None, [])
        await db[ORDERS].insert_one(order.to_mongo())
        rzp_order = f"order_E2E{order.id.replace('-', '')}"
        pay = Payment(order_id=order.id, razorpay_order_id=rzp_order, amount=order.amount, status="created")
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {
            "orderId": order.id,
            "razorpayOrderId": rzp_order,
            "amount": order.amount,
            "currency": "INR",
            "keyId": "rzp_test_e2e",
            "name": "Nm7",
            "description": f"{order.items[0].name} · {order.id}",
            "prefill": {"name": user.name, "email": user.email},
        }
    if cmd == "org-order":
        org_id, plan, email, *ref = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        o = await db[ORGANIZATIONS].find_one({"_id": org_id})
        q = await quote(db, o, plan)
        extra = {"ref_code": ref[0], "ref_via": "link"} if ref else {}  # the partner code the page showed
        order = await new_org_order(db, o, user.id, q, **extra)
        await db[ORDERS].insert_one(order.to_mongo())
        rzp_order = f"order_E2E{order.id.replace('-', '')}"
        pay = Payment(order_id=order.id, razorpay_order_id=rzp_order, amount=order.amount, status="created")
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {
            "orderId": order.id,
            "razorpayOrderId": rzp_order,
            "amount": order.amount,
            "currency": "INR",
            "keyId": "rzp_test_e2e",
            "name": "Nm7",
            "description": f"{q['terms']['plan_name']} plan",
            "prefill": {"name": user.name, "email": user.email},
            "quote": quote_out(q),
        }
    sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":

    async def run():
        try:
            print(json.dumps(await main(*sys.argv[1:])))
        finally:
            await close_client()

    asyncio.run(run())
