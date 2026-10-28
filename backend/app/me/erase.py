"""Erasing a person's data when their account is deleted. There is no self-service "Delete account" yet (it is a
support request), so this is the one function support / a future endpoint calls; every new feature adds its data here.
Kept for the records the law or other people need: code uses stay counted but no longer point to the person
(coupons.service.forget_user)."""

from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import HEALTH


async def erase_user_data(db: AsyncDatabase, user_id: str) -> dict[str, int]:
    from app.coupons.service import forget_user

    out = {"resume_health": (await db[HEALTH].delete_many({"_id": user_id})).deleted_count}
    out["coupon_uses_anonymised"] = await forget_user(db, user_id)
    return out
