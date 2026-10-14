"""Test data for the browser end-to-end tests (frontend/e2e-live). Only touches a database whose name ends in _e2e.

MONGODB_DB=nm7_e2e uv run python -m tests.e2e_seed reset
... admin EMAIL ROLE PASSWORD          → {"secret": "..."} (authenticator key)
... customer EMAIL NAME PASSWORD       → {"id": "..."}
... expert EMAIL NAME PASSWORD STATUS  → {"id": "..."}
... paid-order EMAIL PLAN              → {"id": "RS-…"} (as if Razorpay had confirmed the payment)
"""

import asyncio
import json
import os
import sys
from datetime import timedelta

from app.auth.admin_service import create_admin
from app.auth.models import User
from app.core.db import ORDERS, PAYMENTS, USERS, close_client, ensure_indexes, get_client, get_database
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
    sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":

    async def run():
        try:
            print(json.dumps(await main(*sys.argv[1:])))
        finally:
            await close_client()

    asyncio.run(run())
