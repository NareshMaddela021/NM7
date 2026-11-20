# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T2: "Verify with DigiLocker" (behind the Trust switch; needs the "documents" consent from T1).

  GET    /api/me/trust/documents                       the card: provider ready?, consent, my documents, an open request
  POST   /api/me/trust/documents/sessions {kinds}      a DigiLocker consent URL from the vendor (→ the candidate approves)
  POST   /api/me/trust/documents/sessions/{id}/check   ask the vendor now (after DigiLocker sends the candidate back)
  POST   /api/me/trust/documents/sessions/{id}/mock-approve {allow}   the test provider's "DigiLocker" (test only)
  POST   /api/me/trust/documents/{id}/explain {note}   a name that differs: explain it to the reviewer
  POST   /api/me/trust/documents/{id}/recheck          after correcting the profile name: compare again
  DELETE /api/me/trust/documents/{id}                  remove one document (and its badge)
  POST   /api/public/trust/digilocker/callback/{provider}   the vendor's callback (signature checked; then Nm7 fetches)
  GET    /api/admin/trust/documents                    provider, keys set / not set, callback URL, counts, review queue
  PUT    /api/admin/trust/documents {provider}
  POST   /api/admin/trust/documents/{id}/review {decision: clear | not_cleared, note}

Taking back the "documents" consent deletes every fetched document and request at once (retention "documents" and
"documents_requests" types), so the badges go with them.
"""

from datetime import timedelta
from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, TRUST_DL_SESSIONS, TRUST_DOCUMENTS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access, consent
from app.trust.digilocker import providers as P
from app.trust.digilocker import service as S

me = APIRouter(prefix="/api/me/trust/documents", tags=["trust"], dependencies=[access.ON])
public = APIRouter(prefix="/api/public/trust/digilocker", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/documents", tags=["trust"])

START_RULES = [(10, timedelta(days=1))]


async def _provider(db, uid: str) -> P.Provider | None:
    site = await get_site(db)
    u = await db[USERS].find_one({"_id": uid}, {"demo": 1, "role": 1, "email": 1, "email_lc": 1})
    return await S.provider_for(db, u, site, await access.testers(db))


def _session_out(s: dict[str, Any] | None) -> dict[str, Any] | None:
    if not s:
        return None
    return {"id": s["_id"], "status": s["status"], "kinds": s.get("kinds") or [], "createdAt": ms(s.get("created_at")),
            "fetched": s.get("fetched", 0), "missing": s.get("missing") or [], "mock": s.get("vendor") == "mock"}  # fmt: skip


async def _mine(db, uid: str) -> dict[str, Any]:
    p = await _provider(db, uid)
    rows = await db[TRUST_DOCUMENTS].find({"user_id": uid}).to_list(20)
    rows.sort(key=lambda r: list(S.KINDS).index(r["kind"]) if r["kind"] in S.KINDS else 99)
    last = await db[TRUST_DL_SESSIONS].find_one({"user_id": uid}, sort=[("created_at", -1)])
    user = await db[USERS].find_one({"_id": uid}, {"name": 1}) or {}
    return {
        "provider": {"ready": p is not None, "test": bool(p and p.test), "label": p.label if p else ""},
        "consent": await consent.has(db, uid, "documents"),
        "kinds": [{"key": k, "title": v["title"]} for k, v in S.KINDS.items()],
        "documents": [S.mine_out(r) for r in rows],
        "session": _session_out(last),
        "profileName": user.get("name") or "",
    }


@me.get("")
async def mine(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _mine(db, auth.user.id)


class StartIn(CamelModel):
    kinds: list[Literal["dl", "class10", "class12", "degree", "pan"]] = Field(min_length=1, max_length=5)


@me.post("/sessions")
async def start(body: StartIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    await consent.require(db, uid, "documents")  # T1: the age gate (or a parent) and the Documents consent
    p = await _provider(db, uid)
    if not p:
        raise ApiError(503, "provider_off", "DigiLocker isn’t connected yet. Please try again later.")
    key = f"trust-dl-start:{uid}"
    await rate_limit.check(db, key, START_RULES, "You started DigiLocker many times today. Please try again tomorrow.")
    await rate_limit.record(db, key)
    sid = str(ObjectId())
    kinds = list(dict.fromkeys(body.kinds))
    try:
        st = await p.start(sid=sid, kinds=kinds, redirect_url=S.redirect_url(sid), name_hint=auth.user.name or "")
    except Exception as e:  # noqa: BLE001  (the vendor is down: say so plainly)
        t = now()
        await db[TRUST_DL_SESSIONS].insert_one({"_id": sid, "user_id": uid, "vendor": p.key, "vendor_ref": None, "kinds": kinds,
                                                "status": "failed", "error": type(e).__name__, "created_at": t, "updated_at": t})  # fmt: skip
        raise ApiError(
            502, "vendor_error", "DigiLocker couldn’t be reached just now. Please try again in a few minutes."
        ) from None
    t = now()
    await db[TRUST_DL_SESSIONS].update_many(
        {"user_id": uid, "status": "pending"}, {"$set": {"status": "replaced", "updated_at": t}}
    )
    await db[TRUST_DL_SESSIONS].insert_one({"_id": sid, "user_id": uid, "vendor": p.key, "vendor_ref": st.vendor_ref, "kinds": kinds,
                                            "status": "pending", "created_at": t, "updated_at": t,
                                            "expires_at": st.expires_at or t + timedelta(minutes=S.SESSION_MINUTES)})  # fmt: skip
    await audit(db, uid, "trust.digilocker_start", target=uid, data={"vendor": p.key, "kinds": kinds})
    return {"id": sid, "url": st.url, "mock": p.test}


async def _session(db, uid: str, sid: str) -> dict[str, Any]:
    s = await db[TRUST_DL_SESSIONS].find_one({"_id": sid, "user_id": uid})
    if not s:
        raise ApiError(404, "not_found", "That DigiLocker request isn’t here any more. Start again.")
    return s


@me.post("/sessions/{sid}/check")
async def check(sid: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    s = await _session(db, auth.user.id, sid)
    p = P.get(s["vendor"])
    if s["status"] == "pending" and p:
        await S.complete(db, s, p)
    out = await _mine(db, auth.user.id)
    out["session"] = _session_out(await db[TRUST_DL_SESSIONS].find_one({"_id": sid}))
    return out


class MockIn(CamelModel):
    allow: bool = True


@me.post("/sessions/{sid}/mock-approve")
async def mock_approve(sid: str, body: MockIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    s = await _session(db, auth.user.id, sid)
    if s["vendor"] != "mock":
        raise ApiError(404, "not_found", "Not found.")
    await db[TRUST_DL_SESSIONS].update_one(
        {"_id": sid}, {"$set": {"mock_approved" if body.allow else "mock_denied": True}}
    )
    return await check(sid, db, auth)


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "That document isn’t here any more.") from None


async def _doc(db, uid: str, doc_id: str) -> dict[str, Any]:
    r = await db[TRUST_DOCUMENTS].find_one({"_id": _oid(doc_id), "user_id": uid})
    if not r:
        raise ApiError(404, "not_found", "That document isn’t here any more.")
    return r


class ExplainIn(CamelModel):
    note: str = Field(min_length=3, max_length=600)


@me.post("/{doc_id}/explain")
async def explain(doc_id: str, body: ExplainIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    r = await _doc(db, auth.user.id, doc_id)
    if (r.get("review") or {}).get("status") not in ("open", "not_cleared"):
        raise ApiError(409, "no_review", "Nothing to explain: this document is verified.")
    await db[TRUST_DOCUMENTS].update_one({"_id": r["_id"]}, {"$set": {"review.note": " ".join(body.note.split()),
                                         "review.explained_at": now(), "review.status": "open"}})  # fmt: skip
    await audit(db, auth.user.id, "trust.document_explained", target=auth.user.id, data={"kind": r["kind"]})
    return await _mine(db, auth.user.id)


@me.post("/{doc_id}/recheck")
async def recheck(doc_id: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    r = await _doc(db, auth.user.id, doc_id)
    rv = r.get("review") or {}
    if r.get("name_match") == "match" or not r.get("doc_name"):
        return await _mine(db, auth.user.id)
    user = await db[USERS].find_one({"_id": auth.user.id}, {"name": 1}) or {}
    m = S.name_match(user.get("name") or "", r["doc_name"])
    if m == "match":
        reasons = [x for x in rv.get("reasons") or [] if x not in ("name_differs", "no_name")]
        st = "open" if reasons else ("cleared" if rv.get("status") == "cleared" else "none")
        await db[TRUST_DOCUMENTS].update_one({"_id": r["_id"]}, {"$set": {"name_match": "match", "review.reasons": reasons,
                                             "review.status": st}, "$unset": {"doc_name": ""}})  # fmt: skip
    return await _mine(db, auth.user.id)


@me.delete("/{doc_id}")
async def remove(doc_id: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    r = await _doc(db, auth.user.id, doc_id)
    await db[TRUST_DOCUMENTS].delete_one({"_id": r["_id"]})
    await audit(db, auth.user.id, "trust.document_removed", target=auth.user.id, data={"kind": r["kind"]})
    return await _mine(db, auth.user.id)


# --- the vendor's callback ---------------------------------------------------------------------------------------------

CALLBACK_RULES = [(120, timedelta(minutes=10))]


@public.post("/callback/{provider}")
async def callback(provider: str, request: Request, db: DB) -> dict[str, Any]:
    key = f"trust-dl-callback:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, CALLBACK_RULES)
    await rate_limit.record(db, key)
    p = P.get(provider)
    body = await request.body()
    if not p or len(body) > 64_000 or not p.verify_callback(body, {k.lower(): v for k, v in request.headers.items()}):
        raise ApiError(401, "bad_signature", "Signature check failed.")
    ref = p.callback_ref(body)
    s = await db[TRUST_DL_SESSIONS].find_one({"vendor": p.key, "vendor_ref": ref}) if ref else None
    if not s:
        return {"ok": True}  # nothing to do (an old or unknown request): never say which exist
    await S.complete(db, s, p)  # Nm7 asks the vendor itself; the callback body is never trusted for documents
    return {"ok": True}


# --- company views (Hire now cards, applicant cards) -----------------------------------------------------------------


async def add_badges(
    db, rows: list[dict[str, Any]], key: str, company: dict[str, Any], account: dict[str, Any] | None
) -> None:
    """Puts `docs` (verified documents), `face` (T3: ID + selfie) and `integrity` (T8: the label) on each row, only where the Trust switch lets this company see them."""
    uids = [r[key] for r in rows if r.get(key)]
    got = await S.badges(db, uids, company, account)
    if got is None:
        return
    from app.trust.face.service import badges as face_badges

    face = await face_badges(db, uids, company, account) or {}  # T3: "ID + selfie verified", "Same person at joining"
    from app.trust.integrity.service import labels

    integ = await labels(db, uids, company, account) or {}  # T8: the integrity label only (never the signals)
    for r in rows:
        r["docs"] = got.get(r.get(key), [])
        r["face"] = face.get(r.get(key))
        r["integrity"] = integ.get(r.get(key))


# --- Admin -------------------------------------------------------------------------------------------------------------


async def _admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    chosen = S.doc_settings(site)["provider"]
    items = []
    async for r in db[TRUST_DOCUMENTS].find({"review.status": "open"}).sort("fetched_at", -1).limit(50):
        u = await db[USERS].find_one({"_id": r["user_id"]}, {"name": 1, "email": 1}) or {}
        items.append({**S.mine_out(r), "userName": u.get("name", ""), "email": u.get("email", ""),
                      "reasonKeys": (r.get("review") or {}).get("reasons") or []})  # fmt: skip
    return {
        "provider": chosen,
        "providers": [
            {
                "key": p.key,
                "label": p.label,
                "test": p.test,
                "ready": p.ready(),
                "keys": p.keys(),
                "callbackUrl": None if p.test else S.callback_url(p.key),
            }
            for p in P.registry().values()
        ],  # fmt: skip
        "counts": await S.counts(db),
        "review": items,
    }


@admin.get("")
async def admin_overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _admin_out(db)


class ProviderIn(CamelModel):
    provider: str

    @field_validator("provider")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in P.registry():
            raise ValueError("unknown provider")
        return v


@admin.put("")
async def admin_provider(body: ProviderIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    before = S.doc_settings(await get_site(db))["provider"]
    if body.provider != before:
        await save_site(db, {"trust.documents.provider": body.provider})
        await audit(db, auth.user.id, "trust.digilocker_provider", target="site", data={"from": before, "to": body.provider},
                    ip=client_ip(request))  # fmt: skip
    return await _admin_out(db)


class ReviewIn(CamelModel):
    decision: Literal["clear", "not_cleared"]
    note: str = Field("", max_length=600)


@admin.post("/{doc_id}/review")
async def admin_review(doc_id: str, body: ReviewIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    r = await db[TRUST_DOCUMENTS].find_one({"_id": _oid(doc_id)})
    if not r:
        raise ApiError(404, "not_found", "That document isn’t here any more.")
    st = "cleared" if body.decision == "clear" else "not_cleared"
    upd: dict[str, Any] = {"$set": {"review.status": st, "review.decided_at": now(), "review.decided_by": auth.user.id,
                                    "review.decision_note": body.note.strip()}}  # fmt: skip
    if st == "cleared":
        upd["$unset"] = {"doc_name": ""}  # no longer needed once a person has checked it
    await db[TRUST_DOCUMENTS].update_one({"_id": r["_id"]}, upd)
    await audit(
        db, auth.user.id, "trust.document_review", target=r["user_id"], data={"kind": r["kind"], "decision": st}
    )
    return await _admin_out(db)
