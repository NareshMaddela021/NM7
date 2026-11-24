"""Auto Apply 2.0 (A4): companies connect their own hiring system; approved / full-auto 2.0 applications to a linked job
are delivered there; statuses come back into the candidate's tracker.

Connections (`ats_connections`, one per company): the partner, its non-secret settings (board token, site, region,
subdomain), the keys as one Fernet-encrypted blob (app/core/security.encrypt: the same key setting as the other
secrets at rest), the last 4 characters of the main key, who connected it and when, the last test, the last error kind
and the last successful sync. The keys are decrypted only for a partner call and are never returned, logged, put in an
error or written to the activity log.

Delivery (`ats_deliveries`, one per application): the Nm7 application is always made first (the company sees it in
its Nm7 dashboard whatever happens), then it is queued for the partner. Each pass sends due ones (at most
DELIVER_PER_PASS, PER_COMPANY_PASS per company); a failure waits (BACKOFF) and is tried again, at most MAX_TRIES
times, after which it stays "Kept on Nm7" for good. Nothing is ever lost.

Status read-back: a background pass inside heavy_or_skip reads at most SYNC_PER_PASS delivered applications (batches
of BATCH, small projections, the oldest check first, each no more than every CHECK_EVERY), maps the partner's stage
onto Nm7's (base.map_status) and moves the application forward through the A2 status sync (app/autoapply/sync.py):
the candidate's tracker, the in-app update, email only via access.may_mail; a rejection counts in learning.

The Auto Apply 2.0 switch (OFF by default): a partner delivery happens only when access.pair_ok lets this candidate's
application reach this company (while OFF: a tester ↔ a company with a listed tester on its team; demo ↔ the demo
company only, always). The demo company's connection is "connected (demo)": fake deliveries, never the network.
"""

import json
import logging
from datetime import timedelta
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.audit import audit
from app.autoapply import access
from app.autoapply.ats import adapters, darwinbox
from app.autoapply.ats.base import MESSAGES, RANK, Adapter, PartnerError, Submission, client, map_status
from app.core import reviewer
from app.core.config import get_settings
from app.core.db import APPLICATIONS, ATS_CONNECTIONS, ATS_DELIVERIES, AUTO_COPIES, AUTO_ITEMS, COMPANIES, JOBS, USERS
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt
from app.core.time import now

log = logging.getLogger("nm7.autoapply.ats")

PARTNERS: dict[str, type[Adapter]] = {
    "zoho": adapters.Zoho,
    "greenhouse": adapters.Greenhouse,
    "lever": adapters.Lever,
    "darwinbox": darwinbox.Darwinbox,
}
REAL = tuple(PARTNERS)
MAX_TRIES = 6
BACKOFF = (timedelta(minutes=10), timedelta(minutes=30), timedelta(hours=2), timedelta(hours=6), timedelta(hours=24))
LEASE = timedelta(minutes=10)
DELIVER_PER_PASS = 20
PER_COMPANY_PASS = 5
SYNC_PER_PASS = 60
SYNC_PER_COMPANY = 20
CHECK_EVERY = timedelta(hours=6)
BATCH = 30
STOP_AFTER = timedelta(days=60)  # statuses are read for 60 days after delivery


def sandbox_on() -> bool:
    return not get_settings().is_prod


def partner_cls(key: str) -> type[Adapter] | None:
    if key == "sandbox":
        return adapters.Sandbox if sandbox_on() else None
    return PARTNERS.get(key)


def catalogue() -> list[dict[str, Any]]:
    keys = [*REAL, *(["sandbox"] if sandbox_on() else [])]
    out = []
    for k in keys:
        cls = partner_cls(k)
        out.append(
            {
                "key": k,
                "name": cls.name,
                "how": cls.how,
                "fields": [f.out() for f in cls.fields],
                "confirmed": darwinbox.CONFIRMED if k == "darwinbox" else True,
            }
        )
    return out


def name_of(key: str) -> str:
    cls = partner_cls(key) or PARTNERS.get(key)
    return cls.name if cls else key


def _secret(conn: dict[str, Any]) -> dict[str, Any]:
    return json.loads(decrypt(conn["secret_enc"])) if conn.get("secret_enc") else {}


def adapter_for(conn: dict[str, Any], http=None) -> Adapter:
    cls = partner_cls(conn["partner"]) or PARTNERS.get(conn["partner"])
    if conn.get("demo"):
        return adapters.Demo(cls({}, {}) if cls else None, conn.get("config") or {}, {})
    if not cls:
        raise PartnerError("config")
    return cls(conn.get("config") or {}, _secret(conn), http)


def safe(conn: dict[str, Any] | None) -> dict[str, Any] | None:
    """What the browser may see: never a key, only its last 4 characters."""
    from app.me.service import ms

    if not conn:
        return None
    cls = partner_cls(conn["partner"]) or PARTNERS.get(conn["partner"])
    shown = {f.key: (conn.get("config") or {}).get(f.key) for f in (cls.fields if cls else []) if not f.secret}
    err = conn.get("last_error") or None
    return {
        "partner": conn["partner"],
        "name": name_of(conn["partner"]) + (" (demo)" if conn.get("demo") else ""),
        "demo": bool(conn.get("demo")),
        "settings": {k: v for k, v in shown.items() if v},
        "last4": conn.get("last4") or "",
        "statusReadable": bool(conn.get("status_readable")),
        "connectedAt": ms(conn.get("connected_at")),
        "testedAt": ms(conn.get("tested_at")),
        "testOk": conn.get("test_ok"),
        "lastError": {
            "type": err["type"],
            "message": MESSAGES.get(err["type"], MESSAGES["error"]),
            "at": ms(err.get("at")),
        }
        if err
        else None,
        "lastSyncAt": ms(conn.get("last_ok_sync_at")),
        "lastDeliveredAt": ms(conn.get("last_ok_at")),
    }


def _fail(e: PartnerError, code: str = "partner") -> ApiError:
    return ApiError(400, f"{code}_{e.kind}", e.message)


def _clean(cls: type[Adapter], raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    import re

    config: dict[str, Any] = {}
    secret: dict[str, Any] = {}
    for f in cls.fields:
        v = str(raw.get(f.key) or "").strip()
        if not v:
            if f.required:
                raise ApiError(400, "missing", f"Please fill in “{f.label}”.")
            continue
        if not re.fullmatch(f.pattern, v) or (f.options and v not in {o for o, _ in f.options}):
            raise ApiError(400, "bad_field", f"“{f.label}” isn’t in the right format.")
        (secret if f.secret else config)[f.key] = v
    return config, secret


def _last4(s: str) -> str:
    return s[-4:] if len(s) >= 8 else ""


async def connection(db, cid: str) -> dict[str, Any] | None:
    return await db[ATS_CONNECTIONS].find_one({"_id": cid})


async def connect(db, c: dict[str, Any], acc: dict[str, Any], partner: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Check the details with the partner (Test connection), then save them, the keys encrypted."""
    cls = partner_cls(partner)
    if not cls:
        raise ApiError(400, "partner", "Choose one of the hiring systems on the list.")
    config, secret = _clean(cls, raw)
    t = now()
    if c.get("demo"):  # the demo company: "connected (demo)", never the network, never a real key kept
        doc = {
            "_id": c["_id"],
            "company_id": c["_id"],
            "partner": partner,
            "config": config,
            "secret_enc": None,
            "last4": "demo",
            "demo": True,
            "connected_at": t,
            "connected_by": acc["email_lc"],
            "tested_at": t,
            "test_ok": True,
            "status_readable": False,
        }
    else:
        async with client() as http:
            ad = cls(config, secret, http)
            try:
                secret = await ad.prepare()
                await ad.test()
            except PartnerError as e:
                await audit(
                    db,
                    None,
                    "company.ats_connect_failed",
                    target=c["_id"],
                    data={"by": acc["email_lc"], "partner": partner, "error": e.kind},
                )
                raise _fail(e) from None
        doc = {
            "_id": c["_id"],
            "company_id": c["_id"],
            "partner": partner,
            "config": config,
            "secret_enc": encrypt(json.dumps(secret)),
            "last4": _last4(ad.main_secret),
            "demo": False,
            "connected_at": t,
            "connected_by": acc["email_lc"],
            "tested_at": t,
            "test_ok": True,
            "status_readable": ad.can_read_status(),
            "last_error": None,
        }
    before = await connection(db, c["_id"])
    await db[ATS_CONNECTIONS].replace_one({"_id": c["_id"]}, doc, upsert=True)
    if before and before["partner"] != partner:  # another system now: the old job links no longer mean anything
        await db[JOBS].update_many({"company_id": c["_id"]}, {"$unset": {"partner_job": ""}})
    await audit(
        db,
        None,
        "company.ats_connect",
        target=c["_id"],
        data={"by": acc["email_lc"], "partner": partner, "replaced": bool(before)},
    )
    return doc


async def test_saved(db, c: dict[str, Any], acc: dict[str, Any]) -> dict[str, Any]:
    conn = await connection(db, c["_id"])
    if not conn:
        raise ApiError(404, "not_connected", "No hiring system is connected.")
    t = now()
    try:
        async with client() as http:
            await adapter_for(conn, http).test()
    except PartnerError as e:
        await db[ATS_CONNECTIONS].update_one(
            {"_id": c["_id"]},
            {"$set": {"tested_at": t, "test_ok": False, "last_error": {"type": e.kind, "status": e.status, "at": t}}},
        )
        await audit(
            db,
            None,
            "company.ats_test",
            target=c["_id"],
            data={"by": acc["email_lc"], "partner": conn["partner"], "ok": False, "error": e.kind},
        )
        raise _fail(e) from None
    await db[ATS_CONNECTIONS].update_one({"_id": c["_id"]}, {"$set": {"tested_at": t, "test_ok": True}})
    await audit(
        db,
        None,
        "company.ats_test",
        target=c["_id"],
        data={"by": acc["email_lc"], "partner": conn["partner"], "ok": True},
    )
    return await connection(db, c["_id"])


async def disconnect(db, c: dict[str, Any], acc: dict[str, Any]) -> int:
    """The keys are deleted at once. Applications still waiting stay on Nm7 ("Kept on Nm7")."""
    conn = await db[ATS_CONNECTIONS].find_one_and_delete({"_id": c["_id"]})
    if not conn:
        raise ApiError(404, "not_connected", "No hiring system is connected.")
    await db[JOBS].update_many({"company_id": c["_id"]}, {"$unset": {"partner_job": ""}})
    n = await _give_up(db, {"company_id": c["_id"], "state": "pending"}, "disconnected")
    await audit(
        db,
        None,
        "company.ats_disconnect",
        target=c["_id"],
        data={"by": acc["email_lc"], "partner": conn["partner"], "waiting_kept_on_nm7": n},
    )
    return n


async def partner_jobs(db, c: dict[str, Any]) -> list[dict[str, Any]]:
    conn = await connection(db, c["_id"])
    if not conn:
        raise ApiError(404, "not_connected", "No hiring system is connected.")
    try:
        async with client() as http:
            return await adapter_for(conn, http).jobs()
    except PartnerError as e:
        await db[ATS_CONNECTIONS].update_one(
            {"_id": c["_id"]}, {"$set": {"last_error": {"type": e.kind, "status": e.status, "at": now()}}}
        )
        raise _fail(e) from None


async def link_job(db, c, acc, jid: str, partner_job: dict[str, Any] | None) -> dict[str, Any]:
    j = await db[JOBS].find_one({"_id": jid, "company_id": c["_id"]})
    if not j:
        raise ApiError(404, "not_found", "This job isn’t yours.")
    conn = await connection(db, c["_id"])
    if partner_job:
        if not conn:
            raise ApiError(409, "not_connected", "Connect your hiring system first.")
        link = {
            "partner": conn["partner"],
            "id": str(partner_job["id"])[:120],
            "title": str(partner_job.get("title") or "")[:160],
        }
        await db[JOBS].update_one({"_id": jid}, {"$set": {"partner_job": link}})
    else:
        link = None
        await db[JOBS].update_one({"_id": jid}, {"$unset": {"partner_job": ""}})
    await audit(
        db,
        None,
        "company.ats_link_job",
        target=c["_id"],
        data={"by": acc["email_lc"], "job": jid, "partner_job": (link or {}).get("id")},
    )
    return link or {}


# ---------- delivery ----------


def _partner_mark(d: dict[str, Any]) -> dict[str, Any]:
    return {"key": d["partner"], "name": d["partner_name"], "state": d["state"]}


async def queue(db, u: dict[str, Any], it: dict[str, Any], j: dict[str, Any], site: dict[str, Any]) -> dict | None:
    """Right after a 2.0 application was made on Nm7 for a job linked to the company's hiring system: queue it for
    the partner. → the partner mark for the tracker ({key, name, state}) or None (stays an Nm7 application only)."""
    link = j.get("partner_job") or None
    if not link or not j.get("company_id") or reviewer.is_reviewer(u):  # the review account: never a partner
        return None
    conn = await connection(db, j["company_id"])
    if not conn or conn["partner"] != link.get("partner"):
        return None
    c = await db[COMPANIES].find_one({"_id": j["company_id"]}, {"members": 1, "demo": 1})
    if not access.pair_ok(u, c, site["auto_apply_v2"]):
        return None  # the switch: never a real company's hiring system for a real candidate before launch
    app = await db[APPLICATIONS].find_one({"user_id": u["_id"], "job_id": j["_id"]}, {"_id": 1})
    if not app:
        return None
    t = now()
    d = {
        "_id": str(ObjectId()),
        "app_id": app["_id"],
        "item_id": it["_id"],
        "user_id": u["_id"],
        "job_id": j["_id"],
        "company_id": j["company_id"],
        "partner": conn["partner"],
        "partner_name": name_of(conn["partner"]) + (" (demo)" if conn.get("demo") else ""),
        "partner_job_id": link["id"],
        "state": "pending",
        "tries": 0,
        "next_at": t,
        "created_at": t,
        "demo": bool(conn.get("demo")),
    }
    try:
        await db[ATS_DELIVERIES].insert_one(d)
    except DuplicateKeyError:
        return None
    mark = _partner_mark(d)
    await db[APPLICATIONS].update_one({"_id": app["_id"]}, {"$set": {"channel_v2": "partner", "partner": mark}})
    return mark


async def _set_mark(db, d: dict[str, Any], state: str, extra: dict[str, Any] | None = None) -> None:
    mark = {"key": d["partner"], "name": d["partner_name"], "state": state, **(extra or {})}
    await db[APPLICATIONS].update_one({"_id": d["app_id"]}, {"$set": {"partner": mark}})
    await db[AUTO_ITEMS].update_one({"_id": d["item_id"]}, {"$set": {"partner": mark}})


async def _give_up(db, q: dict[str, Any], why: str) -> int:
    n = 0
    async for d in db[ATS_DELIVERIES].find(q, {"app_id": 1, "item_id": 1, "partner": 1, "partner_name": 1}).limit(500):
        await db[ATS_DELIVERIES].update_one(
            {"_id": d["_id"]}, {"$set": {"state": "failed", "reason": why, "failed_at": now()}}
        )
        await _set_mark(db, d, "kept", {"reason": why})
        n += 1
    return n


async def _submission(db, d: dict[str, Any]) -> Submission | None:
    from app.autoapply import pdf
    from app.autoapply.emailing import profile_link

    app = await db[APPLICATIONS].find_one({"_id": d["app_id"]}, {"copy_id": 1, "answers": 1, "user_id": 1})
    u = await db[USERS].find_one({"_id": d["user_id"]}, {"name": 1, "email": 1})
    j = await db[JOBS].find_one({"_id": d["job_id"]}, {"questions": 1})
    if not app or not u or not app.get("copy_id"):
        return None
    copy = await db[AUTO_COPIES].find_one({"_id": app["copy_id"]})
    if not copy:
        return None
    data = copy.get("data") or {}
    p = data.get("personal") or {}
    name = (u.get("name") or p.get("name") or "").strip().split()
    qs = {q.get("id"): q.get("text") for q in (j or {}).get("questions") or []}
    answers = [(str(qs[k]), str(v)) for k, v in (app.get("answers") or {}).items() if k in qs and v not in (None, "")]
    return Submission(
        job_id=d["partner_job_id"],
        first_name=name[0] if name else "Candidate",
        last_name=" ".join(name[1:]),
        email=u.get("email") or "",
        phone=str(p.get("phone") or "")[:40],
        resume_pdf=pdf.render(data),
        resume_name=pdf.file_name(data),
        cover_note=list(copy.get("cover_note") or []),
        answers=answers,
        profile_url=await profile_link(db, d["user_id"]),
    )


async def _note_error(db, cid: str, e: PartnerError, t) -> None:
    await db[ATS_CONNECTIONS].update_one(
        {"_id": cid}, {"$set": {"last_error": {"type": e.kind, "status": e.status, "at": t}}, "$inc": {"failures": 1}}
    )


async def deliver_one(db, d: dict[str, Any], conn: dict[str, Any], site: dict[str, Any], http) -> str:
    t = now()
    u = await db[USERS].find_one({"_id": d["user_id"]}, access.PROJECTION)
    c = await db[COMPANIES].find_one({"_id": d["company_id"]}, {"members": 1, "demo": 1})
    if reviewer.is_reviewer(d["user_id"]):  # the Chrome Web Store review account never reaches a hiring system
        await _give_up(db, {"_id": d["_id"]}, "demo")
        return "kept"
    if not access.pair_ok(u, c, site["auto_apply_v2"]):
        await _give_up(db, {"_id": d["_id"]}, "switch_off")
        return "kept"
    sub = await _submission(db, d)
    if not sub:
        await _give_up(db, {"_id": d["_id"]}, "missing")
        return "kept"
    try:
        got = await adapter_for(conn, http).submit(sub)
    except Exception as ex:  # noqa: BLE001 — a partner problem never loses the application: it is on Nm7 already
        e = ex if isinstance(ex, PartnerError) else PartnerError("error")
        tries = int(d.get("tries") or 0) + 1
        log.warning("auto apply partner delivery failed: %s, %s (try %s)", d["partner"], e.kind, tries)
        await _note_error(db, d["company_id"], e, t)
        if tries >= MAX_TRIES:
            await db[ATS_DELIVERIES].update_one(
                {"_id": d["_id"]},
                {
                    "$set": {
                        "state": "failed",
                        "tries": tries,
                        "reason": e.kind,
                        "error": {"type": e.kind, "status": e.status, "at": t},
                        "failed_at": t,
                    }
                },
            )
            await _set_mark(db, d, "kept", {"reason": e.kind})
            return "kept"
        wait = BACKOFF[min(tries - 1, len(BACKOFF) - 1)]
        if e.retry_after:
            wait = max(wait, timedelta(seconds=e.retry_after))
        await db[ATS_DELIVERIES].update_one(
            {"_id": d["_id"]},
            {"$set": {"tries": tries, "next_at": t + wait, "error": {"type": e.kind, "status": e.status, "at": t}}},
        )
        await _set_mark(db, d, "retrying", {"reason": e.kind})
        return "retrying"
    from app.autoapply.engine import today

    await db[ATS_DELIVERIES].update_one(
        {"_id": d["_id"]},
        {
            "$set": {
                "state": "delivered",
                "tries": int(d.get("tries") or 0) + 1,
                "delivered_at": t,
                "day": today(t),
                "remote_id": got.get("remote_id"),
                "candidate_id": got.get("candidate_id"),
                "email": sub.email,
                "checked_at": t,
                "error": None,
            }
        },
    )
    await db[ATS_CONNECTIONS].update_one({"_id": d["company_id"]}, {"$set": {"last_ok_at": t}})
    await _set_mark(db, d, "delivered")
    return "delivered"


async def deliver_due(db, limit: int = DELIVER_PER_PASS) -> dict[str, int]:
    """Send what is due. Each one is claimed first (a lease), so two passes never send it twice."""
    from app.site import get_site

    site = await get_site(db)
    counts: dict[str, int] = {}
    if not site["auto_apply"]["on"]:
        return counts
    t = now()
    per: dict[str, int] = {}
    conns: dict[str, dict[str, Any] | None] = {}
    sent = 0
    async with client() as http:
        cursor = db[ATS_DELIVERIES].find({"state": "pending", "next_at": {"$lte": t}}, {"_id": 1, "company_id": 1})
        async for row in cursor.sort("next_at", 1).limit(limit * 3):
            if sent >= limit:
                break
            cid = row["company_id"]
            if per.get(cid, 0) >= PER_COMPANY_PASS:
                continue
            d = await db[ATS_DELIVERIES].find_one_and_update(
                {"_id": row["_id"], "state": "pending", "next_at": {"$lte": t}}, {"$set": {"next_at": t + LEASE}}
            )
            if not d:
                continue
            if cid not in conns:
                conns[cid] = await connection(db, cid)
            conn = conns[cid]
            if not conn or conn["partner"] != d["partner"]:
                await _give_up(db, {"_id": d["_id"]}, "disconnected")
                counts["kept"] = counts.get("kept", 0) + 1
                continue
            per[cid] = per.get(cid, 0) + 1
            sent += 1
            state = await deliver_one(db, d, conn, site, http)
            counts[state] = counts.get(state, 0) + 1
    return counts


async def kick(db) -> None:
    """A background task after an approval: send it now instead of at the next pass."""
    try:
        await deliver_due(db, limit=PER_COMPANY_PASS)
    except Exception:  # noqa: BLE001
        log.exception("auto apply partner: delivery kick failed")


# ---------- the status read-back ----------


async def apply_status(db, d: dict[str, Any], status: str, mailer=None) -> bool:
    """Move the Nm7 application forward to the partner's status (never back) through the A2 status sync."""
    from app.autoapply import sync
    from app.jobs.apply import status_change

    app = await db[APPLICATIONS].find_one({"_id": d["app_id"]})
    if not app:
        return False
    cur = app.get("status") or "applied"
    if cur in ("offer", "rejected", "no_reply") or RANK.get(status, 0) <= RANK.get(cur, 0):
        return False
    await db[APPLICATIONS].update_one({"_id": app["_id"]}, status_change(app, status))
    await sync.on_status(db, app, status, mailer)
    return True


async def sync_pass(db, mailer=None, limit: int = SYNC_PER_PASS) -> dict[str, Any]:
    from app.core.heavy import heavy_or_skip
    from app.site import get_site

    site = await get_site(db)
    if not site["auto_apply"]["on"]:
        return {"off": True}
    t = now()
    counts: dict[str, Any] = {"checked": 0, "moved": 0}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {"waiting_heavy": True}
        q = {
            "state": "delivered",
            "final": {"$ne": True},
            "delivered_at": {"$gte": t - STOP_AFTER},
            "$or": [{"checked_at": None}, {"checked_at": {"$lte": t - CHECK_EVERY}}],
        }
        fields = {
            "app_id": 1,
            "item_id": 1,
            "company_id": 1,
            "partner": 1,
            "partner_name": 1,
            "partner_job_id": 1,
            "remote_id": 1,
            "email": 1,
            "sandbox_status": 1,
            "user_id": 1,
        }
        conns: dict[str, dict[str, Any] | None] = {}
        per: dict[str, int] = {}
        synced: dict[str, bool] = {}
        async with client() as http:
            cursor = db[ATS_DELIVERIES].find(q, fields).sort("checked_at", 1).limit(limit).batch_size(BATCH)
            async for d in cursor:
                cid = d["company_id"]
                if per.get(cid, 0) >= SYNC_PER_COMPANY:
                    continue
                if cid not in conns:
                    if len(conns) > 50:
                        conns.clear()
                    conns[cid] = await connection(db, cid)
                conn = conns[cid]
                await db[ATS_DELIVERIES].update_one({"_id": d["_id"]}, {"$set": {"checked_at": t}})
                if not conn or conn["partner"] != d["partner"]:
                    continue
                ad = adapter_for(conn, http)
                if not ad.can_read_status() and not conn.get("demo"):
                    continue
                per[cid] = per.get(cid, 0) + 1
                counts["checked"] += 1
                try:
                    raw = await ad.status(d)
                except PartnerError as e:
                    await _note_error(db, cid, e, t)
                    synced.setdefault(cid, False)
                    continue
                synced[cid] = True
                status = map_status(raw)
                sets: dict[str, Any] = {"remote_status": str(raw or "")[:80]}
                if status in ("offer", "rejected"):
                    sets["final"] = True
                await db[ATS_DELIVERIES].update_one({"_id": d["_id"]}, {"$set": sets})
                if status and await apply_status(db, d, status, mailer):
                    counts["moved"] += 1
        for cid, good in synced.items():
            if good:
                await db[ATS_CONNECTIONS].update_one({"_id": cid}, {"$set": {"last_ok_sync_at": t}})
    return counts


async def run(db, mailer=None) -> dict[str, Any]:
    """The automation pass: deliveries due, then the status read-back."""
    out: dict[str, Any] = {}
    try:
        out["delivered"] = await deliver_due(db)
    except Exception:  # noqa: BLE001
        log.exception("auto apply partner: delivery pass failed")
    try:
        out["sync"] = await sync_pass(db, mailer)
    except Exception:  # noqa: BLE001
        log.exception("auto apply partner: status pass failed")
    return out


# ---------- for the company page and Admin ----------


async def company_counts(db, cid: str) -> dict[str, int]:
    from app.autoapply.engine import today

    return {
        "today": await db[ATS_DELIVERIES].count_documents({"company_id": cid, "state": "delivered", "day": today()}),
        "delivered": await db[ATS_DELIVERIES].count_documents({"company_id": cid, "state": "delivered"}),
        "waiting": await db[ATS_DELIVERIES].count_documents({"company_id": cid, "state": "pending"}),
        "kept": await db[ATS_DELIVERIES].count_documents({"company_id": cid, "state": "failed"}),
    }


async def health(db) -> list[dict[str, Any]]:
    """Per partner, for Admin: never a key, never a company's settings."""
    from app.autoapply.engine import today
    from app.me.service import ms

    day = today()
    out = []
    for k in [*REAL, *(["sandbox"] if sandbox_on() else [])]:
        conns = (
            await db[ATS_CONNECTIONS]
            .find({"partner": k}, {"demo": 1, "last_error": 1, "last_ok_sync_at": 1, "last_ok_at": 1})
            .to_list(2000)
        )
        errs = sorted((c["last_error"] for c in conns if c.get("last_error")), key=lambda e: e["at"], reverse=True)
        syncs = [c["last_ok_sync_at"] for c in conns if c.get("last_ok_sync_at")]
        oks = [c["last_ok_at"] for c in conns if c.get("last_ok_at")]
        out.append(
            {
                "key": k,
                "name": name_of(k),
                "confirmed": darwinbox.CONFIRMED if k == "darwinbox" else True,
                "connected": sum(1 for c in conns if not c.get("demo")),
                "demo": sum(1 for c in conns if c.get("demo")),
                "deliveredToday": await db[ATS_DELIVERIES].count_documents(
                    {"partner": k, "state": "delivered", "day": day}
                ),
                "retrying": await db[ATS_DELIVERIES].count_documents(
                    {"partner": k, "state": "pending", "tries": {"$gt": 0}}
                ),
                "failures": await db[ATS_DELIVERIES].count_documents({"partner": k, "state": "failed"}),
                "lastErrorType": errs[0]["type"] if errs else None,
                "lastErrorAt": ms(errs[0]["at"]) if errs else None,
                "lastSyncAt": ms(max(syncs)) if syncs else None,
                "lastDeliveredAt": ms(max(oks)) if oks else None,
            }
        )
    return out
