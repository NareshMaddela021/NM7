"""Erasing a person's data when their account is deleted (Profile & settings > Delete account, after the 7-day undo
window; see app/me/delete.py). Every feature that stores personal data adds it here.

`erase_user_data` removes what the person made or what is about them: resumes (with their versions), cover letters,
applications, ATS checks, the job profile, job posts and interview practice, LinkedIn data, certificates, health
alerts, the public resume link, offers, alumni profile and requests, reviewer comments, referral rewards, support
tickets, organization memberships (and their drive check-ins, reminder rows and recruiter shortlists), sessions and
email codes. Code uses stay counted but no longer point to the person (coupons.service.forget_user).

`erase_account` also keeps what the law needs for paid orders (GST): the order, its amounts and invoice stay, but the
order no longer points to the person and the invoice's email (and name, unless it is a business with a GSTIN) are
removed. Unpaid orders and expert work files go. The account itself is replaced by a tombstone with no name, email
or phone, so the email address can sign up again.
"""

import secrets
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import (
    ALUMNI,
    ALUMNI_REQUESTS,
    APPLICATIONS,
    ATS_CHECKS,
    CERTIFICATES,
    COVER_LETTERS,
    DRIVE_CHECKINS,
    DRIVES,
    EMAIL_CODES,
    FEATURE_GRANTS,
    HEALTH,
    INVOICES,
    JOB_MATCHES,
    JOB_PROFILES,
    LINKEDIN,
    LINKEDIN_PACKS,
    MEMBERSHIPS,
    OFFERS,
    ORDER_WORK,
    ORDERS,
    ORG_STAFF,
    RECRUITER_INVITES,
    RECRUITER_LINKS,
    REFERRAL_REWARDS,
    REMINDER_BATCHES,
    RESUMES,
    REVIEW_COMMENTS,
    SESSIONS,
    SHARES,
    TICKETS,
    USERS,
    WEBHOOK_EVENTS,
)
from app.core.time import now


async def _memberships(db: AsyncDatabase, user_id: str) -> int:
    """The person's organization memberships and what hangs off them (by membership id)."""
    mids = [m["_id"] async for m in db[MEMBERSHIPS].find({"user_id": user_id}, {"_id": 1})]
    if not mids:
        return 0
    await db[DRIVE_CHECKINS].delete_many({"membership_id": {"$in": mids}})
    await db[DRIVES].update_many({"slots.members": {"$in": mids}}, {"$pull": {"slots.$[].members": {"$in": mids}}})
    await db[REMINDER_BATCHES].update_many({}, {"$pull": {"items": {"membership_id": {"$in": mids}}}})
    unset = {f"board.{m}": "" for m in mids}
    q = {"$or": [{f"board.{m}": {"$exists": True}} for m in mids]}
    await db[RECRUITER_INVITES].update_many(q, {"$unset": unset})
    unset = {f"shortlist.{m}": "" for m in mids}
    q = {"$or": [{f"shortlist.{m}": {"$exists": True}} for m in mids]}
    await db[RECRUITER_LINKS].update_many(q, {"$unset": unset})
    return (await db[MEMBERSHIPS].delete_many({"_id": {"$in": mids}})).deleted_count


async def erase_user_data(db: AsyncDatabase, user_id: str) -> dict[str, int]:
    from app.coupons.service import forget_user

    async def gone(coll: str, q: dict[str, Any]) -> int:
        return (await db[coll].delete_many(q)).deleted_count

    mine = {"user_id": user_id}
    out = {"resume_health": await gone(HEALTH, {"_id": user_id})}
    out["certificates"] = await gone(CERTIFICATES, mine)
    out["offers"] = await gone(OFFERS, mine)
    out["alumni"] = await gone(ALUMNI, mine)
    out["alumni_requests"] = await gone(ALUMNI_REQUESTS, {"$or": [{"from_user": user_id}, {"to_user": user_id}]})
    out["review_comments"] = await gone(REVIEW_COMMENTS, mine)
    out["referral_rewards"] = await gone(REFERRAL_REWARDS, {"_id": user_id})
    out["public_links"] = await gone(SHARES, {"_id": user_id})
    out["resumes"] = await gone(RESUMES, mine)  # versions are kept inside each resume
    out["cover_letters"] = await gone(COVER_LETTERS, mine)
    out["applications"] = await gone(APPLICATIONS, mine)
    out["ats_checks"] = await gone(ATS_CHECKS, mine)
    out["job_profile"] = await gone(JOB_PROFILES, {"_id": user_id})
    out["job_posts"] = await gone(JOB_MATCHES, mine)  # the pasted posts, matches, tailoring and interview practice
    out["linkedin"] = await gone(LINKEDIN, {"_id": user_id})
    out["tickets"] = await gone(TICKETS, mine)
    out["memberships"] = await _memberships(db, user_id)
    out["coupon_uses_anonymised"] = await forget_user(db, user_id)
    return out


async def erase_account(db: AsyncDatabase, user_id: str) -> dict[str, int]:
    """Everything in erase_user_data, then orders anonymised (kept for GST), sign-ins and the account itself."""
    u = await db[USERS].find_one({"_id": user_id}) or {}
    out = await erase_user_data(db, user_id)
    tag = f"deleted-{secrets.token_hex(6)}"  # the kept orders point here, not to the person
    paid = {"customer_id": user_id, "paid_at": {"$ne": None}}
    order_ids = [o["_id"] async for o in db[ORDERS].find({"customer_id": user_id}, {"_id": 1})]
    out["orders_unpaid_removed"] = (
        await db[ORDERS].delete_many({"customer_id": user_id, "paid_at": None, "kind": {"$ne": "org"}})
    ).deleted_count
    out["orders_kept_anonymised"] = (
        await db[ORDERS].update_many(paid, {"$set": {"customer_id": tag, "target_role": None, "anonymised_at": now()}})
    ).modified_count
    await db[ORDER_WORK].delete_many({"_id": {"$in": order_ids}})  # the expert's drafts of the person's resume
    for inv in await db[INVOICES].find({"order_id": {"$in": order_ids}}, {"recipient": 1}).to_list(None):
        rec = inv.get("recipient") or {}
        keep_name = rec.get("name", "") if rec.get("gstin") else ""  # a business invoice keeps its legal name
        sets = {"recipient.email": "", "recipient.name": keep_name, "anonymised_at": now()}
        if not rec.get("gstin"):
            sets["recipient.address"] = ""
        await db[INVOICES].update_one({"_id": inv["_id"]}, {"$set": sets})
    if u.get("email"):  # Razorpay's copy of the payment can hold the email and phone
        for field in ("email", "contact"):
            key = f"payload.payload.payment.entity.{field}"
            val = u["email"] if field == "email" else u.get("phone")
            if val:
                await db[WEBHOOK_EVENTS].update_many({key: val}, {"$set": {key: ""}})
    await db[LINKEDIN_PACKS].delete_many({"_id": user_id})
    await db[FEATURE_GRANTS].delete_many({"_id": {"$regex": f":{user_id}$"}})
    await db[SESSIONS].delete_many({"user_id": user_id})
    await db[EMAIL_CODES].delete_many({"user_id": user_id})
    await db[ORG_STAFF].update_many(
        {"user_id": user_id},
        {"$set": {"status": "removed", "email": "", "email_lc": f"{tag}@deleted.invalid", "user_id": None}},
    )
    await db[USERS].update_one(
        {"_id": user_id},
        {
            "$set": {
                "email": f"{tag}@deleted.invalid",
                "email_lc": f"{tag}@deleted.invalid",
                "name": "Deleted user",
                "phone": None,
                "password_hash": "",  # no password matches: nobody can sign in to it
                "referral_code": None,
                "target_role": "",
                "cities": "",
                "level": "",
                "notify": {},
                "ui": {},
                "signup_token_hash": None,
                "disabled_at": now(),
                "deleted_at": now(),
            },
            "$unset": {"deletion": ""},
        },
    )
    return out
