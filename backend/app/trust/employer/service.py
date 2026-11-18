# ruff: noqa: E501  (dense response lines and plain-language texts)
"""Employer business verification: settings, one lookup, matching against the company's profile, the "Verified
employer" badge, the human review, re-checks every 90 days, counts and retention.

One row per company in `trust_employer` (_id = company id; business facts, no personal data):
  kind, number_hash, number_masked, number_state   the registration (gstin / udyam / cin); the full number only
                encrypted (number_enc) for the re-checks, never in plain and never returned by any API
  registry      {found, legal_name, trade_name, status, registered_on, state, city}: only the facts the match needs
  checks        {status_ok, name {ok, score}, domain_ok, duplicate}
  status        none → verified (the badge) | review (a person at Nm7 checks: never an automatic rejection) |
                not_verified (a person decided; the company is told why and can send another number)
  reasons       plain words for the company and the reviewer (why it went to a person)
  vendor, vendor_ref, test, checked_at, verified_at, verified_by (check / review), next_check_at, dropped_at
  review        {status open / cleared / not_cleared, reason, requested_at, decided_at, decided_by, note}
  consent       {at, by, version}: the company admin agreed to the lookup (taking it back deletes the row)
Every paid lookup also leaves one row in `trust_employer_lookups` (company, kind, vendor, result, by, at) for the counts.

Verified employer = the registry says Active, the registry's legal or trade name matches the company's name on Nm7,
and the website's domain belongs to that name (or Nm7's team already verified the company by hand). Anything else goes
to a person, and the company is told plainly what didn't match. Re-checks every N days (Admin, default 90) in small
batches under the heavy lease; a registration that is no longer active drops the badge and goes to a person.
"""

import logging
import re
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from html import escape
from typing import Any

from app.audit import audit
from app.companies.checks import registrable, site_domain
from app.companies.model import trust_of
from app.core.config import get_settings
from app.core.db import COMPANIES, TRUST_EMPLOYER, TRUST_EMPLOYER_LOOKUPS
from app.core.errors import ApiError
from app.core.security import decrypt, encrypt
from app.core.time import IST, now
from app.me.service import ms
from app.trust import retention as R
from app.trust.employer import formats as F
from app.trust.employer import providers as P

log = logging.getLogger("nm7.trust.employer")

DEFAULTS: dict[str, Any] = {"provider": "mock", "recheck_days": 90, "pause_at": 3, "name_min": 85}
RECHECK_CAP = 40  # lookups per automation pass (each is a paid call)
CONSENT_VERSION = 1
CONSENT_TEXT = ("We look this number up in the government registry (through our verification partner) and keep only what we need: the registered name, "
                "status, registration date and state, a masked copy of the number and the partner's reference. We check it again about every 90 days. "
                "You can remove it at any time.")  # fmt: skip
STATUS_TEXT = {
    "none": "Not verified yet",
    "verified": "Verified employer",
    "review": "A person at Nm7 is checking this",
    "not_verified": "Not verified after a check by a person",
}
REVIEW_NOTE = "A person at Nm7 will check it, usually within 2 working days. Nothing changes for your jobs meanwhile, and you can send another number."
STOP = {"private", "pvt", "limited", "ltd", "llp", "opc", "the", "and", "co", "company", "corporation", "corp", "inc",
        "pvtltd", "p", "plc", "india", "m", "s", "ms"}  # fmt: skip


# --- settings and the provider -------------------------------------------------------------------------------------------


def employer_settings(site: dict[str, Any]) -> dict[str, Any]:
    st = (site.get("trust") or {}).get("employer") or {}
    return {**DEFAULTS, **st}


async def provider_for(
    site: dict[str, Any], company: dict[str, Any], account: dict[str, Any] | None
) -> P.Provider | None:
    """The chosen provider when it has its key. The test provider: anywhere but production, and on production only for
    the demo company and companies whose admin is a tester (its results are not real, so nobody else gets its badge)."""
    p = P.get(employer_settings(site)["provider"]) or P.Mock()
    if not p.test:
        return p if p.ready() else None
    if not get_settings().is_prod or company.get("demo"):
        return p
    email = ((account or {}).get("email_lc") or "").lower()
    testers = {str(e).lower() for e in (site.get("trust") or {}).get("testers") or []}
    return p if email and email in testers else None


# --- matching ------------------------------------------------------------------------------------------------------------


def tokens(name: str) -> list[str]:
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"\(.*?\)", " ", s)  # "(OPC)", "(India)"
    return [t for t in re.sub(r"[^a-z0-9]+", " ", s).split() if t not in STOP]


def name_score(a: str, b: str) -> int:
    """0–100: how alike two business names are once "Private Limited", "Pvt Ltd", "LLP", "India", punctuation and case
    are set aside. All the words of the shorter name inside the longer one (at least two, or one long word) → 100."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0
    ja, jb = "".join(ta), "".join(tb)
    if ja == jb:
        return 100
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if set(short) <= set(long_) and (len(short) >= 2 or len(short[0]) >= 6):
        return 100
    return round(100 * SequenceMatcher(None, ja, jb).ratio())


def domain_label(c: dict[str, Any]) -> str:
    site = site_domain((c.get("details") or {}).get("website") or "")
    if not site:
        email = c.get("company_email") or ""
        site = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return registrable(site).split(".")[0].replace("-", "") if site else ""


def domain_fits(label: str, *names: str) -> bool:
    """acme.com fits "Acme Analytics Pvt Ltd" (the domain is the name or its start) and tcs.com fits "Tata Consultancy
    Services" (the initials). acme-jobs.in does not fit "Acme Ltd": a longer domain that only contains the name is how
    look-alike sites are made, so a person checks those."""
    if len(label) < 2:
        return False
    for n in names:
        ts = tokens(n)
        if not ts:
            continue
        joined = "".join(ts)
        if (
            (len(label) >= 3 and joined.startswith(label))
            or label == joined
            or (len(ts) >= 2 and label == "".join(t[0] for t in ts))
        ):
            return True
    return False


def evaluate(
    c: dict[str, Any], reg: P.Registry, fs: dict[str, Any], kind: str, duplicate: bool
) -> tuple[bool, dict[str, Any], list[str]]:
    """(verified?, checks, reasons in plain words)."""
    ours = (c.get("details") or {}).get("legal_name") or ""
    where = F.REGISTRY[kind]
    if not reg.found:
        return (
            False,
            {"status_ok": False, "name": {"ok": False, "score": 0}, "domain_ok": False, "duplicate": duplicate},
            [f"The {where} registry has no record of this number. Please check it, or send another number."],
        )
    score = max(name_score(ours, reg.legal_name), name_score(ours, reg.trade_name))
    name_ok = score >= int(fs["name_min"])
    status_ok = reg.status == "active"
    label = domain_label(c)
    domain_ok = domain_fits(label, reg.legal_name, reg.trade_name, ours) or trust_of(c) == "verified"
    reasons = []
    if not status_ok:
        reasons.append(
            f"The {where} registry says this registration is {reg.status if reg.status != 'unknown' else 'not active'}."
        )
    if not name_ok:
        reasons.append(
            f"The name in the registry (“{reg.legal_name or reg.trade_name}”) doesn’t match your company name on Nm7 (“{ours}”)."
        )
    if name_ok and not domain_ok:
        reasons.append(
            f"Your website’s domain ({label or 'none'}) doesn’t clearly belong to “{reg.legal_name or reg.trade_name}”."
        )
    if duplicate:
        reasons.append("This registration is already verified on another Nm7 company account.")
    checks = {
        "status_ok": status_ok,
        "name": {"ok": name_ok, "score": score},
        "domain_ok": domain_ok,
        "duplicate": duplicate,
    }
    return status_ok and name_ok and domain_ok and not duplicate, checks, reasons


# --- state ---------------------------------------------------------------------------------------------------------------


async def get_state(db, cid: str) -> dict[str, Any] | None:
    return await db[TRUST_EMPLOYER].find_one({"_id": cid})


def _registry_out(r: dict[str, Any] | None) -> dict[str, Any] | None:
    if not r:
        return None
    return {"found": bool(r.get("found")), "legalName": r.get("legal_name", ""), "tradeName": r.get("trade_name", ""),
            "status": r.get("status", "unknown"), "registeredOn": r.get("registered_on", ""), "state": r.get("state", ""),
            "city": r.get("city", "")}  # fmt: skip


def state_out(st: dict[str, Any] | None) -> dict[str, Any]:
    """For the company itself (and Admin): where it stands, what the registry said, why a person checks it."""
    st = st or {}
    status = st.get("status") or "none"
    rv = st.get("review") or None
    return {
        "status": status, "statusText": STATUS_TEXT[status], "kind": st.get("kind"), "kindText": F.KINDS.get(st.get("kind") or "", ""),
        "registry": F.REGISTRY.get(st.get("kind") or "", ""), "numberMasked": st.get("number_masked", ""),
        "facts": _registry_out(st.get("registry")), "reasons": list(st.get("reasons") or []),
        "checkedAt": ms(st.get("checked_at")), "verifiedAt": ms(st.get("verified_at")), "verifiedBy": st.get("verified_by"),
        "nextCheckAt": ms(st.get("next_check_at")), "droppedAt": ms(st.get("dropped_at")), "test": bool(st.get("test")),
        "review": None if not rv else {"status": rv.get("status"), "reason": rv.get("reason", ""), "requestedAt": ms(rv.get("requested_at")),
                                         "decidedAt": ms(rv.get("decided_at")), "note": rv.get("note", "")},
        "reviewNote": REVIEW_NOTE if status == "review" else "",
    }  # fmt: skip


def badge_out(st: dict[str, Any]) -> dict[str, Any]:
    """What candidates see: "Verified employer · GST, checked 3 Mar 2027". Never the number."""
    return {"label": "Verified employer", "registry": F.REGISTRY.get(st.get("kind") or "", ""), "checkedAt": ms(st.get("checked_at")),
            "since": ms(st.get("verified_at")), "test": bool(st.get("test"))}  # fmt: skip


async def badges(db, cids: list[str]) -> dict[str, dict[str, Any]]:
    """company id → badge, for verified companies among these. Test-provider badges only on a demo company or outside
    production. The caller decides whether this viewer may see Trust at all (viewer_allowed)."""
    ids = [c for c in set(cids) if c]
    if not ids:
        return {}
    show_test = not get_settings().is_prod
    demo = {c["_id"] async for c in db[COMPANIES].find({"_id": {"$in": ids}, "demo": True}, {"_id": 1})}
    out = {}
    async for st in db[TRUST_EMPLOYER].find({"_id": {"$in": ids}, "status": "verified"}):
        if st.get("test") and not (show_test or st["_id"] in demo):
            continue
        out[st["_id"]] = badge_out(st)
    return out


async def viewer_allowed(db, auth) -> bool:
    """Public pages: Trust items only while the switch is public, or for a signed-in admin / demo account / tester."""
    from app.trust import access

    if await access.is_public(db):
        return True
    return bool(auth) and await access.for_user(db, auth.user.id)


# --- one lookup ----------------------------------------------------------------------------------------------------------


async def _log(db, cid: str, kind: str, p: P.Provider, result: str, by: str) -> None:
    await db[TRUST_EMPLOYER_LOOKUPS].insert_one(
        {"company_id": cid, "kind": kind, "vendor": p.key, "test": p.test, "result": result, "by": by, "at": now()}
    )


async def _duplicate(db, cid: str, h: str) -> bool:
    async for st in db[TRUST_EMPLOYER].find({"_id": {"$ne": cid}, "number_hash": h, "status": "verified"}, {"_id": 1}):
        other = await db[COMPANIES].find_one({"_id": st["_id"]}, {"demo": 1})
        if other and not other.get("demo"):
            return True
    return False


async def verify(
    db, c: dict[str, Any], account: dict[str, Any] | None, *, kind: str, number: str, by: str, actor: str | None
) -> dict[str, Any]:
    """Look the number up and decide: verified (the badge) or a person checks it. Raises 502 when the vendor is down
    (nothing changes; try again later)."""
    from app.site import get_site

    site = await get_site(db)
    fs = employer_settings(site)
    p = await provider_for(site, c, account)
    if not p:
        raise ApiError(503, "provider_off", "Business verification isn’t connected yet. Please try again later.")
    n = F.clean(kind, number)
    if prob := F.problem(kind, n):
        raise ApiError(400, "bad_number", prob)
    try:
        reg = await p.lookup(kind, n, hint=(c.get("details") or {}).get("legal_name") or "")
    except Exception as e:  # noqa: BLE001  (the vendor is down: say so; nothing changes)
        log.warning("employer lookup failed at %s: %s", p.key, type(e).__name__)
        await _log(db, c["_id"], kind, p, "error", by)
        raise ApiError(
            502, "vendor_error", "The registry couldn’t be reached just now. Please try again in a few minutes."
        ) from None
    await _log(db, c["_id"], kind, p, reg.status if reg.found else "not_found", by)
    h = F.number_hash(kind, n)
    ok, checks, reasons = evaluate(c, reg, fs, kind, await _duplicate(db, c["_id"], h))
    t = now()
    prev = await get_state(db, c["_id"]) or {}
    sets: dict[str, Any] = {
        "company_id": c["_id"], "kind": kind, "number_hash": h, "number_masked": F.mask(kind, n), "number_enc": encrypt(n), "number_state": F.state_of(kind, n),
        "registry": {"found": reg.found, "legal_name": reg.legal_name[:200], "trade_name": reg.trade_name[:200], "status": reg.status,
                     "registered_on": reg.registered_on, "state": reg.state[:80], "city": reg.city[:80]},
        "checks": checks, "reasons": reasons, "vendor": p.key, "vendor_ref": reg.vendor_ref[:120], "test": p.test,
        "checked_at": t, "updated_at": t,
    }  # fmt: skip
    if ok:
        sets |= {"status": "verified", "verified_at": t, "verified_by": "check", "review": None, "dropped_at": None,
                 "next_check_at": t + timedelta(days=int(fs["recheck_days"]))}  # fmt: skip
    else:
        sets |= {"status": "review", "next_check_at": None,
                 "review": {"status": "open", "reason": " ".join(reasons), "requested_at": t, "by": by}}  # fmt: skip
    await db[TRUST_EMPLOYER].update_one(
        {"_id": c["_id"]}, {"$set": sets, "$setOnInsert": {"created_at": t}}, upsert=True
    )
    await audit(db, actor, "trust.employer_check", target=c["_id"],
                data={"vendor": p.key, "kind": kind, "status": sets["status"], "registry_status": reg.status if reg.found else "not_found", "by": by,
                      "was": prev.get("status")})  # fmt: skip
    return state_out(await get_state(db, c["_id"]))


async def remove(db, cid: str, actor: str | None) -> int:
    n = (await db[TRUST_EMPLOYER].delete_one({"_id": cid})).deleted_count
    if n:
        await audit(db, actor, "trust.employer_removed", target=cid)
    return n


# --- a person's decision -------------------------------------------------------------------------------------------------


async def decide(db, cid: str, admin_id: str, *, decision: str, note: str) -> dict[str, Any]:
    """verified (the badge, verified_by review) / not_verified (no badge; the company sees the note)."""
    st = await get_state(db, cid)
    if not st:
        raise ApiError(404, "not_found", "There is no business check for this company.")
    t = now()
    from app.site import get_site

    fs = employer_settings(await get_site(db))
    rv = {**(st.get("review") or {"reason": "Admin"}), "decided_at": t, "decided_by": admin_id, "note": note.strip()[:600],
          "status": "cleared" if decision == "verified" else "not_cleared"}  # fmt: skip
    sets: dict[str, Any] = {"review": rv, "updated_at": t}
    if decision == "verified":
        sets |= {"status": "verified", "verified_at": t, "verified_by": "review", "dropped_at": None,
                 "next_check_at": t + timedelta(days=int(fs["recheck_days"]))}  # fmt: skip
    else:
        sets |= {"status": "not_verified", "next_check_at": None}
    await db[TRUST_EMPLOYER].update_one({"_id": cid}, {"$set": sets})
    await audit(db, admin_id, "trust.employer_review", target=cid, data={"decision": decision})
    return state_out(await get_state(db, cid))


# --- re-checks (the automation pass) -------------------------------------------------------------------------------------


def _drop_mail(c: dict[str, Any], to: str, name: str, why: str):
    from app.core.email import Email

    site = get_settings().site_url.rstrip("/")
    lines = [f"Hi {name or 'there'},", f"We re-checked {c['details']['legal_name']}'s business registration and {why}",
             "So the “Verified employer” badge is off for now. A person at Nm7 will look at it, usually within 2 working days. "
             "Your jobs stay as they are. If the registration changed, open your company account and send the new number.",
             f"Your company account: {site}/company", "Nm7 · nm7.si"]  # fmt: skip
    text = "\n\n".join(lines)
    return Email(
        to, name, "Your Verified employer badge is paused", text, "".join(f"<p>{escape(x)}</p>" for x in lines)
    )


async def recheck(db, mailer=None, cap: int = RECHECK_CAP, t: datetime | None = None) -> dict[str, int]:
    """Verified companies whose next check is due: look again. Still fine → next check in N days. No longer active (or
    another name) → the badge drops, a person checks, the company is told (only where Vetting Trust is on for it). The
    vendor down → try again tomorrow. Under the heavy lease, at most `cap` lookups a pass."""
    from app.core.email import send_safely
    from app.core.heavy import heavy_or_skip
    from app.site import get_site
    from app.trust import access

    t = t or now()
    out = {"checked": 0, "kept": 0, "dropped": 0, "errors": 0}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return out
        site = await get_site(db)
        fs = employer_settings(site)
        rows = (
            await db[TRUST_EMPLOYER]
            .find({"status": "verified", "next_check_at": {"$lte": t}})
            .sort("next_check_at", 1)
            .limit(cap)
            .to_list(None)
        )
        for st in rows:
            c = await db[COMPANIES].find_one({"_id": st["_id"]})
            if not c:
                await db[TRUST_EMPLOYER].delete_one({"_id": st["_id"]})
                continue
            p = P.get(st.get("vendor") or "") or await provider_for(site, c, None)
            if not p or not p.ready():
                await db[TRUST_EMPLOYER].update_one(
                    {"_id": st["_id"]}, {"$set": {"next_check_at": t + timedelta(days=1)}}
                )
                out["errors"] += 1
                continue
            out["checked"] += 1
            number = _number(st)
            if not number:
                await db[TRUST_EMPLOYER].update_one(
                    {"_id": st["_id"]}, {"$set": {"next_check_at": t + timedelta(days=int(fs["recheck_days"]))}}
                )
                continue
            try:
                reg = await p.lookup(st["kind"], number, hint=(c.get("details") or {}).get("legal_name") or "")
            except Exception as e:  # noqa: BLE001
                log.warning("employer re-check failed at %s: %s", p.key, type(e).__name__)
                await _log(db, c["_id"], st["kind"], p, "error", "recheck")
                await db[TRUST_EMPLOYER].update_one(
                    {"_id": st["_id"]}, {"$set": {"next_check_at": t + timedelta(days=1)}}
                )
                out["errors"] += 1
                continue
            await _log(db, c["_id"], st["kind"], p, reg.status if reg.found else "not_found", "recheck")
            good, checks, reasons = evaluate(c, reg, fs, st["kind"], False)
            if (
                st.get("verified_by") == "review"
            ):  # a person already accepted the name / domain: only the status counts now
                good = reg.found and reg.status == "active"
                reasons = [r for r in reasons if "registry" in r and ("says" in r or "no record" in r)]
            regf = {"found": reg.found, "legal_name": reg.legal_name[:200], "trade_name": reg.trade_name[:200], "status": reg.status,
                    "registered_on": reg.registered_on, "state": reg.state[:80], "city": reg.city[:80]}  # fmt: skip
            if good:
                await db[TRUST_EMPLOYER].update_one({"_id": st["_id"]}, {"$set": {"registry": regf, "checks": checks, "checked_at": t, "updated_at": t,
                                                     "next_check_at": t + timedelta(days=int(fs["recheck_days"]))}})  # fmt: skip
                out["kept"] += 1
                continue
            why = reasons[0] if reasons else "the registration no longer looks active."
            await db[TRUST_EMPLOYER].update_one({"_id": st["_id"]}, {"$set": {
                "registry": regf, "checks": checks, "reasons": reasons, "checked_at": t, "updated_at": t, "status": "review",
                "dropped_at": t, "next_check_at": None,
                "review": {"status": "open", "reason": "Re-check: " + " ".join(reasons), "requested_at": t, "by": "recheck"}}})  # fmt: skip
            await audit(
                db,
                None,
                "trust.employer_badge_dropped",
                target=c["_id"],
                data={"registry_status": reg.status if reg.found else "not_found"},
            )
            out["dropped"] += 1
            m = next((m for m in c.get("members") or [] if m.get("role") == "main"), None) or {}
            to = m.get("email_lc") or c.get("admin_email") or ""
            if mailer and to and not c.get("demo") and await access.for_company(db, c, {"email_lc": to}):
                await send_safely(
                    mailer, _drop_mail(c, to, m.get("name", ""), why[0].lower() + why[1:] if why else why)
                )
    return out


def _number(st: dict[str, Any]) -> str:
    """The full number for a re-check: kept only encrypted on the row (deleted with it), never in plain."""
    try:
        return decrypt(st["number_enc"]) if st.get("number_enc") else ""
    except Exception:  # noqa: BLE001  (a changed secret key: the company is asked to send it again by the review)
        return ""


async def counts(db) -> dict[str, int]:
    start = now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    month = now() - timedelta(days=30)
    real = {"test": {"$ne": True}}
    return {
        "lookupsToday": await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"at": {"$gte": start}}),
        "lookups30d": await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"at": {"$gte": month}}),
        "paidLookups30d": await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"at": {"$gte": month}, **real}),
        "errors30d": await db[TRUST_EMPLOYER_LOOKUPS].count_documents({"at": {"$gte": month}, "result": "error"}),
        "verified": await db[TRUST_EMPLOYER].count_documents({"status": "verified"}),
        "review": await db[TRUST_EMPLOYER].count_documents({"status": "review"}),
        "notVerified": await db[TRUST_EMPLOYER].count_documents({"status": "not_verified"}),
    }


# --- retention (T1 framework) --------------------------------------------------------------------------------------------


async def _clean(db, cutoff: datetime, cap: int) -> int:
    """Checks not refreshed for N days (a verified one is re-checked every 90 days, so only stale ones go) and old
    lookup rows."""
    ids = [d["_id"] async for d in db[TRUST_EMPLOYER].find({"checked_at": {"$lt": cutoff}}, {"_id": 1}).limit(cap)]
    n = (
        (await db[TRUST_EMPLOYER].delete_many({"_id": {"$in": ids}, "checked_at": {"$lt": cutoff}})).deleted_count
        if ids
        else 0
    )
    lids = [d["_id"] async for d in db[TRUST_EMPLOYER_LOOKUPS].find({"at": {"$lt": cutoff}}, {"_id": 1}).limit(cap)]
    if lids:
        n += (await db[TRUST_EMPLOYER_LOOKUPS].delete_many({"_id": {"$in": lids}})).deleted_count
    return n


async def _no_person(_db, _uid: str) -> int:
    return 0  # business facts about a company, not a person's data


R.register(R.DataType("employer_checks", "Employer business checks: registry name, status, dates, state, a masked number, the partner’s reference (companies, not people)",
                      365, 120, 730, clean=_clean, erase=_no_person,
                      note="Re-checked every 90 days while verified; deleted by the daily job when not checked for this many days, or at once when the company removes it"))  # fmt: skip
