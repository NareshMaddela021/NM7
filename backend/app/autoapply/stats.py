"""Auto Apply 2.0, phase A7: the numbers per channel and the success measures (Admin → Daily report's "Auto Apply"
section and Admin → Auto Apply), and the candidate's own week (app/autoapply/weekly.py).

Everything is counted in MongoDB (count_documents and aggregations grouped to a handful of rows); no collection is
ever loaded into memory. Demo records are never counted.

Channels: Nm7 (internal), email, partner (a company's hiring system), company form, one tap.
  sent        applications made in the window (each channel's application record)
  delivered   Nm7 and one tap: every application · email: sent minus bounced (auto_mail) · partner: delivered to the
              hiring system · company form: the company's page answered (the proof)
  failed      email: bounced · partner: kept on Nm7 after the hiring system refused · company form: Nm7 tried the form
              and it didn't go through (the job went to one tap)
  replied     the company answered: an email reply to the apply address, or the application moved to shortlisted,
              interview or offer (a "not selected" isn't counted as a reply)
  interviews  reached interview (or offer), or an email reply read as an interview invite

The success measures and their targets (plain met / not met; "No data yet" when there is nothing to count):
  reply / interview rate ≥ 10 %          applications of the last 30 days that got a reply or an interview
  10–25 applications a week per seeker   last 7 days ÷ people with 2.0 on (not paused, not demo)
  waiting questions answered in 24 h ≥ 70 %   questions asked 1–30 days ago, answered within 24 hours
  email bounce < 2 %, complaints < 0.1 %      2.0 emails of the last 30 days
  company complaints ~0                   employers' opt-outs and spam complaints in the last 30 days (0 = met)
  one tap ending in "I applied" ≥ 50 %    kits on a morning list 1–30 days ago that the candidate confirmed
  fully automatic share, week over week   the share of the last 7 days' applications sent with no tap from the
                                          candidate (full auto), against the 7 days before: met when it grew
"""

from datetime import datetime, timedelta
from typing import Any

from app.core.db import APPLICATIONS, AUTO_ITEMS, AUTO_MAIL, EMAIL_BLOCKS, USERS
from app.core.time import now

CHANNELS = (("internal", "Nm7"), ("email", "Email"), ("partner", "Partner"), ("form", "Company form"),
            ("one_tap", "One tap"))  # fmt: skip
NE = {"$ne": True}

_TL = {"$ifNull": ["$timeline.status", []]}
_INTERVIEW = {
    "$or": [
        {"$in": ["$status", ["interview", "offer"]]},
        {"$in": ["interview", _TL]},
        {"$gt": ["$it.interview_at", None]},
    ]
}
_REPLIED = {
    "$or": [
        _INTERVIEW,
        {"$in": ["$status", ["shortlisted"]]},
        {"$in": ["shortlisted", _TL]},
        {"$gt": ["$it.replied_at", None]},
    ]
}


def _pct(a: int, b: int) -> float | None:
    return round(100 * a / b, 1) if b else None


async def by_channel(db, since: datetime, until: datetime, user_id: str | None = None) -> dict[str, dict[str, int]]:
    """{channel: {sent, replied, interviews, auto, partner_delivered, partner_kept}} for 2.0 applications made in
    [since, until): one aggregation grouped by channel."""
    match: dict[str, Any] = {"v2": True, "created_at": {"$gte": since, "$lt": until}}
    if user_id:
        match["user_id"] = user_id
    else:
        match["demo"] = NE
    pipe = [
        {"$match": match},
        {"$project": {"status": 1, "timeline.status": 1, "channel_v2": 1, "auto_item_id": 1}},
        {
            "$lookup": {
                "from": AUTO_ITEMS,
                "localField": "auto_item_id",
                "foreignField": "_id",
                "as": "it",
                "pipeline": [
                    {
                        "$project": {
                            "channel_v2": 1,
                            "replied_at": 1,
                            "interview_at": 1,
                            "partner.state": 1,
                            "auto_full": 1,
                        }
                    }
                ],
            }
        },  # fmt: skip
        {"$set": {"it": {"$first": "$it"}}},
        {"$set": {"ch": {"$ifNull": ["$it.channel_v2", {"$ifNull": ["$channel_v2", "internal"]}]}}},
        {
            "$group": {
                "_id": "$ch",
                "sent": {"$sum": 1},
                "replied": {"$sum": {"$cond": [_REPLIED, 1, 0]}},
                "interviews": {"$sum": {"$cond": [_INTERVIEW, 1, 0]}},
                "auto": {"$sum": {"$cond": [{"$eq": ["$it.auto_full", True]}, 1, 0]}},
                "partner_delivered": {"$sum": {"$cond": [{"$eq": ["$it.partner.state", "delivered"]}, 1, 0]}},
                "partner_kept": {"$sum": {"$cond": [{"$eq": ["$it.partner.state", "kept"]}, 1, 0]}},
            }
        },
    ]
    out: dict[str, dict[str, int]] = {}
    async for r in await db[APPLICATIONS].aggregate(pipe):
        k = r.pop("_id") or "internal"
        k = k if k in dict(CHANNELS) else "internal"
        row = out.setdefault(k, {})
        for f, v in r.items():
            row[f] = row.get(f, 0) + int(v or 0)
    return out


async def _mail(db, since: datetime, until: datetime) -> dict[str, int]:
    q = {"kind": "first", "at": {"$gte": since, "$lt": until}}
    return {
        "sent": await db[AUTO_MAIL].count_documents(q),
        "bounced": await db[AUTO_MAIL].count_documents({**q, "bounced_at": {"$ne": None}}),
        "complained": await db[AUTO_MAIL].count_documents({**q, "complained_at": {"$ne": None}}),
    }


async def channels(db, t: datetime, days: int = 7) -> list[dict[str, Any]]:
    since = t - timedelta(days=days)
    got = await by_channel(db, since, t)
    mail = await _mail(db, since, t)
    form_failed = await db[AUTO_ITEMS].count_documents(
        {"state": "ready", "updated_at": {"$gte": since}, "form_proof.ok": False, "v2": True, "demo": NE}
    )
    out = []
    for k, label in CHANNELS:
        g = got.get(k) or {}
        sent = int(g.get("sent", 0))
        delivered, failed = sent, 0
        if k == "email":
            sent = max(sent, mail["sent"])
            failed = mail["bounced"]
            delivered = max(0, sent - failed)
        elif k == "partner":
            delivered, failed = int(g.get("partner_delivered", 0)), int(g.get("partner_kept", 0))
        elif k == "form":
            failed = form_failed
        replied, interviews = int(g.get("replied", 0)), int(g.get("interviews", 0))
        out.append({
            "key": k, "label": label, "sent": sent, "delivered": delivered, "failed": failed, "replied": replied,
            "interviews": interviews, "replyRate": _pct(replied, sent), "interviewRate": _pct(interviews, sent),
        })  # fmt: skip
    return out


def _state(v: float | None, ok: bool) -> str:
    return "none" if v is None else ("met" if ok else "miss")


def measure(key: str, label: str, value: float | None, target: str, ok: bool, note: str = "") -> dict[str, Any]:
    return {"key": key, "label": label, "value": value, "target": target, "state": _state(value, ok), "note": note}


async def seekers(db) -> int:
    return await db[USERS].count_documents(
        {"auto_apply.v2_consent_at": {"$ne": None}, "auto_apply.on": True, "demo": NE, "disabled_at": None}
    )


async def answered_24h(db, t: datetime) -> tuple[int, int]:
    """(asked, answered within 24 h) for waiting questions asked 1–30 days ago."""
    pipe = [
        {"$match": {"v2": True, "created_at": {"$gte": t - timedelta(days=30), "$lt": t - timedelta(days=1)},
                    "demo": NE, "$or": [{"state": "needs_answer"}, {"answered_at": {"$ne": None}}]}},  # fmt: skip
        {"$project": {"wait": {"$subtract": ["$answered_at", {"$ifNull": ["$asked_at", "$created_at"]}]}}},
        {"$group": {"_id": None, "asked": {"$sum": 1},
                    "fast": {"$sum": {"$cond": [{"$and": [{"$ne": ["$wait", None]},
                                                          {"$lte": ["$wait", 86_400_000]}]}, 1, 0]}}}},
    ]  # fmt: skip
    async for r in await db[AUTO_ITEMS].aggregate(pipe):
        return int(r["asked"]), int(r["fast"])
    return 0, 0


async def one_tap(db, t: datetime) -> tuple[int, int]:
    """(kits listed 1–30 days ago, confirmed with "I applied")."""
    q = {"v2": True, "demo": NE, "listed_day": {"$gte": (t - timedelta(days=30)).date().isoformat(),
                                               "$lt": (t - timedelta(days=1)).date().isoformat()}}  # fmt: skip
    return (
        await db[AUTO_ITEMS].count_documents(q),
        await db[AUTO_ITEMS].count_documents({**q, "one_tap.at": {"$ne": None}}),
    )


async def measures(db, t: datetime) -> list[dict[str, Any]]:
    m30 = await by_channel(db, t - timedelta(days=30), t)
    sent30 = sum(x.get("sent", 0) for x in m30.values())
    got30 = sum(x.get("replied", 0) for x in m30.values())  # replied already includes interviews
    week = await by_channel(db, t - timedelta(days=7), t)
    prev = await by_channel(db, t - timedelta(days=14), t - timedelta(days=7))
    sent7 = sum(x.get("sent", 0) for x in week.values())
    sent_prev = sum(x.get("sent", 0) for x in prev.values())
    people = await seekers(db)
    asked, fast = await answered_24h(db, t)
    mail = await _mail(db, t - timedelta(days=30), t)
    company = await db[EMAIL_BLOCKS].count_documents(
        {"reason": {"$in": ["opt_out", "complaint"]}, "at": {"$gte": t - timedelta(days=30)}}
    )
    listed, confirmed = await one_tap(db, t)
    share = _pct(sum(x.get("auto", 0) for x in week.values()), sent7)
    share_prev = _pct(sum(x.get("auto", 0) for x in prev.values()), sent_prev)

    rate = _pct(got30, sent30)
    per = round(sent7 / people, 1) if people else None
    ans = _pct(fast, asked)
    bounce = _pct(mail["bounced"], mail["sent"])
    compl = round(100 * mail["complained"] / mail["sent"], 2) if mail["sent"] else None
    tap = _pct(confirmed, listed)
    grew = share is not None and share_prev is not None and share > share_prev
    trend = "No week before to compare yet." if share_prev is None else f"The week before: {share_prev}%."
    return [
        measure("replyRate", "Reply or interview rate (last 30 days)", rate, "at least 10%", (rate or 0) >= 10,
                f"{got30} of {sent30} applications"),
        measure("perSeeker", "Applications per active seeker (last 7 days)", per, "10–25 a week",
                per is not None and 10 <= per <= 25, f"{sent7} applications, {people} people with 2.0 on"),
        measure("answered24h", "Waiting questions answered within 24 hours", ans, "at least 70%", (ans or 0) >= 70,
                f"{fast} of {asked} questions"),
        measure("bounce", "Email bounce rate (last 30 days)", bounce, "below 2%", bounce is not None and bounce < 2,
                f"{mail['bounced']} of {mail['sent']} emails"),
        measure("complaints", "Email complaints (last 30 days)", compl, "below 0.1%",
                compl is not None and compl < 0.1, f"{mail['complained']} of {mail['sent']} emails"),
        measure("companyComplaints", "Company opt-outs and complaints (last 30 days)", company, "about 0",
                company == 0, "Employers who opted out or marked an email as spam"),
        measure("oneTap", "One tap kits ending in “I applied”", tap, "at least 50%", (tap or 0) >= 50,
                f"{confirmed} of {listed} kits"),
        {**measure("autoShare", "Fully automatic applications (last 7 days)", share, "growing week over week", grew,
                   trend), "prev": share_prev, **({"state": "none"} if share_prev is None and share is not None
                                                  else {})},
    ]  # fmt: skip


async def section(db, t: datetime | None = None) -> dict[str, Any]:
    """The "Auto Apply" section of Admin → Daily report (and the Admin Auto Apply page)."""
    from app.site import get_site

    t = t or now()
    v2 = (await get_site(db))["auto_apply_v2"]
    rows = await channels(db, t)
    return {
        "switchOn": bool(v2.get("public")),
        "pricingOn": bool(v2.get("pricing_on")),
        "windowDays": 7,
        "channels": rows,
        "totals": {k: sum(r[k] for r in rows) for k in ("sent", "delivered", "failed", "replied", "interviews")},
        "measures": await measures(db, t),
    }
