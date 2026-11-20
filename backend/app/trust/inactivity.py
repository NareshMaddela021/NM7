# ruff: noqa: E501  (plain-language emails)
"""Erase Trust data after a long time without signing in (DPDP: don't keep data longer than needed).

OFF by itself (Admin → Skill checks → Vetting Trust → Inactivity, `trust.inactivity.on`) until the owner turns it on,
separately from the Trust switch. When on, once a day:

1. People with Trust data (an age check or a consent) who haven't been active for N months (default 24) get a warning
   email: "sign in before <date> to keep it". Activity counts from the latest of: last sign-in or use of the site
   (users.last_active_at, stamped at most daily by app/auth/sessions.py), a live session, the account's creation and the
   day this setting was turned on (so nobody is warned for time before the feature existed).
2. If they are still inactive when the notice period (default 30 days) is over, their Trust data is erased:
   mode "trust" (default) erases every Trust data type (retention.erase_user), the age record and parental requests,
   and marks their consents withdrawn (the consent history stays as the record); mode "account" schedules the whole
   account for the existing erase path (app/me/delete.py erase_due, the same as a self-serve deletion).
3. Signing in after the warning cancels it.

Never erased without a warning sent first and the full notice period after it. While Vetting Trust is hidden only the
testers can be warned (access.mail_filter), so only they can ever be erased. At most CAP people a pass.
"""

from datetime import datetime, timedelta
from html import escape
from typing import Any

from app.audit import audit
from app.core.config import get_settings
from app.core.db import DELETION_REQUESTS, SESSIONS, TRUST_CONSENTS, TRUST_PARENTS, TRUST_PROFILES, TRUST_RUNS, USERS
from app.core.email import Email, Mailer, send_safely
from app.core.time import IST, now
from app.trust import access
from app.trust import retention as R

CAP = 200
EVERY = timedelta(hours=23)
MONTH = timedelta(days=30)


def warning_email(u: dict[str, Any], months: int, when: datetime, withdraw: str) -> Email:
    site = get_settings().site_url.rstrip("/")
    first = (u.get("name") or "").split(" ")[0] or "there"
    day = f"{when.astimezone(IST):%d %b %Y}"
    lines = [f"Hi {first},", "", f"You haven't used Nm7 for about {months} months.",
             f"To protect your privacy we will delete your verification data (consents, selfies, voice recordings, documents and interview texts) on {day}.",
             "", f"Want to keep it? Just sign in before {day}: {site}/login", "",
             f"Want it gone sooner? Take back your consents here (no sign-in needed): {withdraw}", "", "Nm7 · nm7.si"]  # fmt: skip
    html = (f"<p>Hi {escape(first)},</p><p>You haven’t used Nm7 for about {months} months. To protect your privacy we will delete your "
            f"verification data (consents, selfies, voice recordings, documents and interview texts) on <b>{day}</b>.</p>"
            f'<p>Want to keep it? Just <a href="{escape(site)}/login">sign in</a> before {day}.</p>'
            f'<p style="color:#666;font-size:13px">Want it gone sooner? <a href="{escape(withdraw)}">Take back your consents</a> (no sign-in needed).</p>')  # fmt: skip
    return Email(
        to=u["email"],
        to_name=u.get("name", ""),
        subject=f"Your Nm7 verification data will be deleted on {day}",
        text="\n".join(lines),
        html=html,
    )


async def last_active(db, u: dict[str, Any], floor: datetime | None) -> datetime:
    s = await db[SESSIONS].find_one({"user_id": u["_id"]}, {"last_seen_at": 1}, sort=[("last_seen_at", -1)])
    seen = [x for x in (u.get("last_active_at"), u.get("created_at"), (s or {}).get("last_seen_at"), floor) if x]
    return max(seen) if seen else now()


async def erase_trust(db, uid: str) -> dict[str, int]:
    """Every Trust data type, the age record and parental requests; consents marked withdrawn (history kept)."""
    out = await R.erase_user(db, uid)
    t = now()
    out["consents_withdrawn"] = (await db[TRUST_CONSENTS].update_many({"user_id": uid, "withdrawn_at": None},
                                                                      {"$set": {"withdrawn_at": t, "withdraw_channel": "inactivity"}})).modified_count  # fmt: skip
    out["parent_requests"] = (await db[TRUST_PARENTS].delete_many({"user_id": uid})).deleted_count
    await db[TRUST_PROFILES].update_one({"_id": uid}, {"$set": {"erased_at": t}, "$unset": {"adult_from": "", "age_checked_at": "", "age_method": "",
                                                                                        "parent_confirmed_at": "", "parent_request": "", "inactivity": ""}})  # fmt: skip
    return out


async def run(db, mailer: Mailer, t: datetime | None = None, force: bool = False) -> dict[str, int]:
    """Once a day from the automation pass. Returns {warned, erased, cleared} ({} when off or not due)."""
    from app.site import get_site
    from app.trust.consent import withdraw_link

    t = t or now()
    cfg = (await get_site(db))["trust"]["inactivity"]
    if not cfg.get("on"):
        return {}
    if not force:
        last = await db[TRUST_RUNS].find_one({"_id": "inactivity"}, {"ran_at": 1}) or {}
        if last.get("ran_at") and last["ran_at"] > t - EVERY:
            return {}
    months = int(cfg.get("months") or 24)
    notice = timedelta(days=int(cfg.get("notice_days") or 30))
    cutoff = t - months * MONTH
    floor = cfg.get("enabled_at")
    out = {"warned": 0, "erased": 0, "cleared": 0}

    # people already warned: back again → the warning goes; still away after the notice → erased
    async for p in db[TRUST_PROFILES].find({"inactivity.warned_at": {"$exists": True}}).limit(CAP):
        w = p["inactivity"]
        u = await db[USERS].find_one({"_id": p["_id"]})
        if not u or u.get("deleted_at"):
            await db[TRUST_PROFILES].update_one({"_id": p["_id"]}, {"$unset": {"inactivity": ""}})
            continue
        if await last_active(db, u, None) > w["warned_at"]:
            await db[TRUST_PROFILES].update_one({"_id": p["_id"]}, {"$unset": {"inactivity": ""}})
            out["cleared"] += 1
            continue
        if t < w["erase_after"]:
            continue
        if cfg.get("mode") == "account":
            await db[USERS].update_one({"_id": u["_id"], "deletion": {"$exists": False}},
                                       {"$set": {"deletion": {"requested_at": t, "erase_at": now(), "reason": "inactivity"}}})  # fmt: skip
            await db[DELETION_REQUESTS].update_one({"_id": u["_id"]}, {"$set": {"name": u.get("name", ""), "email": u.get("email", ""), "requested_at": t,
                                                                            "erase_at": now(), "status": "pending", "reason": "inactivity"}}, upsert=True)  # fmt: skip
            await db[TRUST_PROFILES].update_one(
                {"_id": u["_id"]}, {"$unset": {"inactivity": ""}, "$set": {"erased_at": t}}
            )
            counts = {"account_scheduled": 1}
        else:
            counts = await erase_trust(db, u["_id"])
        await audit(
            db,
            None,
            "trust.inactivity_erased",
            target=u["_id"],
            data={"mode": cfg.get("mode", "trust"), "items": sum(counts.values())},
        )
        out["erased"] += 1

    # warnings: only people background emails may reach (while Trust is hidden: the testers)
    mf = await access.mail_filter(db)
    if mf is not None:
        q = {
            "inactivity.warned_at": {"$exists": False},
            "erased_at": {"$exists": False},
            "age_checked_at": {"$exists": True},
        }
        async for p in db[TRUST_PROFILES].find(q, {"_id": 1}, batch_size=200):
            if out["warned"] >= CAP:
                break
            u = await db[USERS].find_one(
                {
                    "_id": p["_id"],
                    "role": "customer",
                    "demo": {"$ne": True},
                    "deleted_at": None,
                    "disabled_at": None,
                    **mf,
                }
            )
            if not u or not u.get("email_verified_at") or u.get("email_bounced"):
                continue
            if await last_active(db, u, floor) >= cutoff:
                continue
            erase_after = t + notice
            if not await send_safely(mailer, warning_email(u, months, erase_after, withdraw_link(u["_id"]))):
                continue  # not warned: never erased
            await db[TRUST_PROFILES].update_one(
                {"_id": u["_id"]}, {"$set": {"inactivity": {"warned_at": t, "erase_after": erase_after}}}
            )
            await audit(db, None, "trust.inactivity_warned", target=u["_id"])
            out["warned"] += 1

    await db[TRUST_RUNS].update_one(
        {"_id": "inactivity"},
        {"$set": {"ran_at": t, "last": out}, "$inc": {f"total.{k}": v for k, v in out.items()}},
        upsert=True,
    )
    return out
