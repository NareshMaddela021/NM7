# ruff: noqa: E501  (dense tables)
"""What Nm7 keeps from a DigiLocker document, the name match, the review flag and the badges.

Kept per document (one row per person and kind in `trust_documents`; nothing else):
  kind, doc_type, issuer, fields (a whitelist per kind, below), vendor, vendor_ref, fetched_at, verify_until (re-verify
  by), name_match, review; for PAN also pan_hash (keyed hash, for duplicate detection) and pan_last4.
  dl       classes of vehicle + valid until
  class10  board + year + result          class12  board + year + result
  degree   university + degree + year + result
  pan      verified (the row exists) + name match; never the PAN itself
Never kept: Aadhaar in any form (an Aadhaar document is dropped whole; uid / aadhaar fields are never read), document
numbers (licence, roll, PAN), dates of birth, gender, photos, the XML or PDF. `doc_name` (the name on the document) is
kept only while the name differs from the profile, so the person and a reviewer can see why.

Name match: the profile name and the name on the document, normalised (case, dots, titles such as Mr / Smt / Kumari,
order, initials, a missing middle name). A mismatch never rejects anyone: the document is flagged for human review,
the person is told plainly and can correct their profile name (and check again) or explain.
"""

import re
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId

from app.core.config import get_settings
from app.core.db import TRUST_DL_SESSIONS, TRUST_DOCUMENTS, USERS
from app.core.security import keyed_hash
from app.core.time import IST, now
from app.me.service import ms
from app.trust import retention as R
from app.trust.digilocker import providers as P

KINDS: dict[str, dict[str, Any]] = {
    "dl": {"title": "Driving licence", "types": {"DRVLC"}},
    "class10": {"title": "Class 10", "types": {"SSCER", "SSCMS", "SSLC", "MTRIC"}},
    "class12": {"title": "Class 12", "types": {"HSCER", "HSCMS", "INTER", "PUCER"}},
    "degree": {"title": "Degree", "types": {"DGCER", "PDCER", "DGMST", "UGDEG", "PGDEG"}},
    "pan": {"title": "PAN", "types": {"PANCR"}},
}
AADHAAR_TYPES = {"ADHAR", "AADHAAR", "AADHR", "EAADHAAR"}
REVERIFY_DAYS = 365  # a document is checked again after a year (a driving licence sooner if it expires sooner)
SESSION_MINUTES = 30
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
TITLES = {
    "mr",
    "mrs",
    "ms",
    "miss",
    "dr",
    "shri",
    "sri",
    "smt",
    "kumari",
    "kum",
    "km",
    "master",
    "late",
    "prof",
    "er",
    "adv",
}


def kind_of(doc_type: str) -> str | None:
    t = (doc_type or "").upper()
    return next((k for k, v in KINDS.items() if t in v["types"]), None)


def _text(v: Any, n: int = 120) -> str:
    return " ".join(str(v or "").split())[:n]


def _year(v: Any) -> int | None:
    m = re.search(r"(19|20)\d{2}", str(v or ""))
    return int(m[0]) if m else None


def _result(v: Any) -> str:
    s = str(v or "").strip().lower()
    if not s:
        return "unknown"
    if s.startswith(("pass", "p", "qualified", "first", "second", "third", "distinction")) or s in ("y", "yes"):
        return "pass"
    if s.startswith(("fail", "f")) or s in ("n", "no"):
        return "fail"
    return "unknown"


def _date(v: str) -> str:
    return v if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v or "") else ""


def keep(raw: P.RawDoc) -> dict[str, Any] | None:
    """The whitelist. None: not a document Nm7 keeps (Aadhaar, or a type it doesn't know)."""
    t = (raw.doc_type or "").upper()
    if t in AADHAAR_TYPES or "AADHAAR" in t:
        return None
    kind = kind_of(t)
    if not kind:
        return None
    d = raw.data or {}
    out: dict[str, Any] = {"kind": kind, "doc_type": t, "issuer": _text(raw.issuer), "fields": {}}
    if kind == "dl":
        classes = [re.sub(r"[^A-Z0-9-]", "", str(c).upper())[:10] for c in (d.get("classes") or [])][:12]
        out["fields"] = {"classes": [c for c in classes if c], "valid_until": _date(raw.valid_until)}
    elif kind in ("class10", "class12"):
        out["fields"] = {"board": _text(raw.issuer), "year": _year(d.get("year")), "result": _result(d.get("result"))}
    elif kind == "degree":
        out["fields"] = {"university": _text(raw.issuer), "degree": _text(d.get("degree"), 80),
                         "year": _year(d.get("year")), "result": _result(d.get("result"))}  # fmt: skip
    elif kind == "pan":
        pan = re.sub(r"\s", "", raw.number or "").upper()
        if not PAN_RE.fullmatch(pan):
            return None  # not a PAN we can verify
        out["fields"] = {"verified": True}
        out["pan_hash"] = keyed_hash("pan", pan)
        out["pan_last4"] = pan[-4:]
    return out


# --- the name match ----------------------------------------------------------------------------------------------------


def tokens(name: str) -> list[str]:
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z\s]", " ", s)
    return [t for t in s.split() if t not in TITLES]


def name_match(profile: str, doc: str) -> str:
    """match / mismatch / unknown (no name on one side)."""
    a, b = tokens(profile), tokens(doc)
    if not a or not b:
        return "unknown"
    if sorted(a) == sorted(b) or "".join(a) == "".join(b) or "".join(sorted(a)) == "".join(sorted(b)):
        return "match"
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    pool = list(long_)
    full = 0
    for t in short:
        hit = next((p for p in pool if p == t), None)
        if hit is None and len(t) == 1:
            hit = next((p for p in pool if p.startswith(t)), None)
        if hit is None and len(t) > 1:
            hit = next((p for p in pool if len(p) == 1 and t.startswith(p)), None)
        if hit is None:
            return "mismatch"
        pool.remove(hit)
        full += len(t) > 1 and len(hit) > 1
    if not full:
        return "mismatch"  # initials only on one side: a person checks
    # extra words on the longer side: a middle name or a father's name is fine; with a one-word name only initials are
    return "match" if len(short) >= 2 or all(len(p) == 1 for p in pool) else "mismatch"


# --- settings ----------------------------------------------------------------------------------------------------------


def doc_settings(site: dict[str, Any]) -> dict[str, Any]:
    return {"provider": "mock", **((site.get("trust") or {}).get("documents") or {})}


async def provider_for(db, user: dict[str, Any] | None, site: dict[str, Any], testers: set[str]) -> P.Provider | None:
    """The chosen provider when it has its keys. The test provider: anywhere but production, and on production only for
    admins, demo accounts and testers (its documents are not real, so nobody else may get its badges)."""
    p = P.get(doc_settings(site)["provider"]) or P.Mock()
    if not p.test:
        return p if p.ready() else None
    if not get_settings().is_prod:
        return p
    u = user or {}
    email = (u.get("email_lc") or u.get("email") or "").lower()
    return p if u.get("demo") or u.get("role") == "admin" or (email and email in testers) else None


def callback_url(provider: str) -> str:
    return f"{get_settings().api_public_url.rstrip('/')}/api/public/trust/digilocker/callback/{provider}"


def redirect_url(sid: str) -> str:
    return f"{get_settings().site_url.rstrip('/')}/me/settings?dl={sid}#s-docs"


# --- storing a fetch ---------------------------------------------------------------------------------------------------


def _verify_until(kind: str, fields: dict[str, Any], t: datetime) -> datetime:
    until = t + timedelta(days=REVERIFY_DAYS)
    v = fields.get("valid_until") if kind == "dl" else None
    if v:
        try:
            end = datetime.fromisoformat(v).replace(tzinfo=UTC)
            until = min(until, end)
        except ValueError:
            pass
    return until


async def store(
    db, uid: str, session: dict[str, Any], docs: list[P.RawDoc], vendor: str, test: bool
) -> list[dict[str, Any]]:
    """Keeps the whitelisted fields of each wanted document (replacing the person's earlier one of the same kind)."""
    user = await db[USERS].find_one({"_id": uid}, {"name": 1}) or {}
    profile = user.get("name") or ""
    wanted = set(session.get("kinds") or [])
    t = now()
    saved = []
    for raw in docs:
        k = keep(raw)
        if not k or k["kind"] not in wanted:
            continue
        match = name_match(profile, raw.name)
        reasons = [] if match == "match" else ["name_differs" if match == "mismatch" else "no_name"]
        if k.get("pan_hash") and await db[TRUST_DOCUMENTS].find_one(
            {"pan_hash": k["pan_hash"], "user_id": {"$ne": uid}}, {"_id": 1}
        ):
            reasons.append("pan_elsewhere")  # the same PAN on another account: a person checks (never an auto-reject)
        row = {
            "_id": ObjectId(), "user_id": uid, **k, "vendor": vendor, "vendor_ref": session.get("vendor_ref"),
            "session_id": session["_id"], "test": test, "fetched_at": t, "created_at": t,
            "verify_until": _verify_until(k["kind"], k["fields"], t), "name_match": match,
            "review": {"status": "open" if reasons else "none", "reasons": reasons, "note": "", "explained_at": None},
        }  # fmt: skip
        if match != "match":
            row["doc_name"] = _text(raw.name, 120)  # only while it differs: the person and the reviewer see why
        await db[TRUST_DOCUMENTS].delete_many({"user_id": uid, "kind": k["kind"]})
        await db[TRUST_DOCUMENTS].insert_one(row)
        wanted.discard(k["kind"])
        saved.append(row)
    return saved


async def complete(db, session: dict[str, Any], provider: P.Provider) -> dict[str, Any]:
    """Asks the vendor once (from the candidate's poll or the vendor's callback). Idempotent: a session is stored once."""
    t = now()
    if session["status"] != "pending":
        return session
    exp = session.get("expires_at")
    if exp and exp.replace(tzinfo=exp.tzinfo or UTC) < t:
        await db[TRUST_DL_SESSIONS].update_one(
            {"_id": session["_id"], "status": "pending"}, {"$set": {"status": "expired", "updated_at": t}}
        )
        return {**session, "status": "expired"}
    user = await db[USERS].find_one({"_id": session["user_id"]}, {"name": 1}) or {}
    try:
        got = await provider.fetch(session, name_hint=user.get("name") or "")
    except Exception as e:  # noqa: BLE001  (a vendor outage must not break the page)
        got = P.Fetched("failed", error=type(e).__name__)
    if got.status == "pending":
        await db[TRUST_DL_SESSIONS].update_one({"_id": session["_id"]}, {"$set": {"polled_at": t}})
        return session
    claimed = await db[TRUST_DL_SESSIONS].find_one_and_update(
        {"_id": session["_id"], "status": "pending"}, {"$set": {"status": "storing", "updated_at": t}}
    )
    if not claimed:  # the callback and the poll at the same moment: the other one stores it
        return await db[TRUST_DL_SESSIONS].find_one({"_id": session["_id"]}) or session
    if got.status != "done":
        await db[TRUST_DL_SESSIONS].update_one(
            {"_id": session["_id"]}, {"$set": {"status": got.status, "error": got.error[:200], "updated_at": t}}
        )
        return {**session, "status": got.status}
    saved = await store(db, session["user_id"], session, got.docs, provider.key, provider.test)
    missing = sorted(set(session.get("kinds") or []) - {r["kind"] for r in saved})
    await db[TRUST_DL_SESSIONS].update_one({"_id": session["_id"]}, {"$set": {"status": "done", "fetched": len(saved),
                                           "missing": missing, "updated_at": now()}})  # fmt: skip
    return {**session, "status": "done", "fetched": len(saved), "missing": missing}


# --- what people see ---------------------------------------------------------------------------------------------------


def _date_words(v: str) -> str:
    try:
        return datetime.fromisoformat(v).strftime("%-d %b %Y")
    except (TypeError, ValueError):
        return ""


def summary(row: dict[str, Any], for_company: bool = False) -> str:
    """One line. For companies no university, college or board name (fair matching: never the college) and no name."""
    f = row.get("fields") or {}
    k = row["kind"]
    passed = {"pass": "passed", "fail": "not passed"}.get(f.get("result"), "")
    if k == "dl":
        cls = ", ".join(f.get("classes") or [])
        until = _date_words(f.get("valid_until") or "")
        return f"Driving licence{f' ({cls})' if cls else ''}{f' · valid to {until}' if until else ''}"
    if k in ("class10", "class12"):
        bits = [KINDS[k]["title"], passed, str(f.get("year") or "")]
        if not for_company:
            bits.append(f.get("board") or "")
        return " · ".join(b for b in bits if b)
    if k == "degree":
        bits = [f.get("degree") or "Degree", passed, str(f.get("year") or "")]
        if not for_company:
            bits.append(f.get("university") or "")
        return " · ".join(b for b in bits if b)
    if k == "pan":
        return "PAN verified" + ("" if for_company else f" (ending {row.get('pan_last4', '')})")
    return KINDS.get(k, {}).get("title", k)


def badge_ok(row: dict[str, Any], t: datetime | None = None) -> bool:
    t = t or now()
    until = row.get("verify_until")
    if until is not None and until.replace(tzinfo=until.tzinfo or UTC) < t:
        return False
    if (row.get("review") or {}).get("status") not in ("none", "cleared"):
        return False
    return (row.get("fields") or {}).get("result") != "fail"


STATE_WORDS = {
    "verified": "Verified via DigiLocker",
    "review": "A person at Nm7 is checking this",
    "not_cleared": "Not verified after a check",
    "expired": "Please verify again",
}


def state_of(row: dict[str, Any], t: datetime | None = None) -> str:
    rv = (row.get("review") or {}).get("status")
    if rv == "open":
        return "review"
    if rv == "not_cleared":
        return "not_cleared"
    until = row.get("verify_until")
    if until is not None and until.replace(tzinfo=until.tzinfo or UTC) < (t or now()):
        return "expired"
    return "verified"


REASONS = {
    "name_differs": "The name on the document is different from your profile name.",
    "no_name": "The document has no name we could compare with your profile.",
    "pan_elsewhere": "This PAN is already verified on another Nm7 account.",
}


def mine_out(row: dict[str, Any]) -> dict[str, Any]:
    rv = row.get("review") or {}
    st = state_of(row)
    return {"id": str(row["_id"]), "kind": row["kind"], "title": KINDS[row["kind"]]["title"], "summary": summary(row),
            "issuer": row.get("issuer", ""), "state": st, "stateText": STATE_WORDS[st], "fetchedAt": ms(row.get("fetched_at")),
            "verifyUntil": ms(row.get("verify_until")), "nameMatch": row.get("name_match"), "nameOnDocument": row.get("doc_name"),
            "reasons": [REASONS.get(r, r) for r in rv.get("reasons") or []], "note": rv.get("note") or "",
            "explainedAt": ms(rv.get("explained_at")),
            "decisionNote": rv.get("decision_note") or "", "test": bool(row.get("test"))}  # fmt: skip


def badge_out(row: dict[str, Any]) -> dict[str, Any]:
    return {"kind": row["kind"], "label": summary(row, for_company=True), "via": "DigiLocker",
            "at": ms(row.get("fetched_at")), "test": bool(row.get("test"))}  # fmt: skip


async def badges(
    db, uids: list[str], company: dict[str, Any], account: dict[str, Any] | None
) -> dict[str, list[dict[str, Any]]] | None:
    """Verified-document badges for a company view, or None when Vetting Trust is hidden from this company. Test-provider
    badges only on a demo company or outside production."""
    from app.trust import access

    if not await access.for_company(db, company, account):
        return None
    show_test = bool(company.get("demo")) or not get_settings().is_prod
    out: dict[str, list[dict[str, Any]]] = {u: [] for u in uids}
    t = now()
    q: dict[str, Any] = {"user_id": {"$in": list(uids)}}
    if not show_test:
        q["test"] = {"$ne": True}
    async for r in db[TRUST_DOCUMENTS].find(q, {"user_id": 1, "kind": 1, "fields": 1, "review": 1, "verify_until": 1,
                                                "fetched_at": 1, "test": 1}):  # fmt: skip
        if badge_ok(r, t):
            out.setdefault(r["user_id"], []).append(badge_out(r))
    order = list(KINDS)
    for v in out.values():
        v.sort(key=lambda b: order.index(b["kind"]))
    return out


async def counts(db) -> dict[str, int]:
    start = now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    return {
        "fetchedToday": await db[TRUST_DOCUMENTS].count_documents({"fetched_at": {"$gte": start}}),
        "failedToday": await db[TRUST_DL_SESSIONS].count_documents(
            {"status": {"$in": ["failed", "denied", "expired"]}, "updated_at": {"$gte": start}}
        ),
        "pending": await db[TRUST_DL_SESSIONS].count_documents({"status": "pending", "expires_at": {"$gt": now()}}),
        "review": await db[TRUST_DOCUMENTS].count_documents({"review.status": "open"}),
    }


# --- retention (T1 framework): the documents themselves are the "documents" type registered in retention.py ---------

R.register(R.DataType("documents_requests", "DigiLocker requests (vendor reference and status; no document data)", 30, 7, 90,
                      TRUST_DL_SESSIONS, purpose="documents", note="Deleted by the daily job, or now when Documents consent is taken back"))  # fmt: skip
