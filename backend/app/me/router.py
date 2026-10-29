"""Customer dashboard API (/api/me/*): owner-only. Every query includes the signed-in user's id, so another
customer's item ids simply don't exist (404); experts and admins get 403."""

import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from pymongo import DESCENDING, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.auth.deps import CustomerAuth, MaybeAuth
from app.auth.models import User
from app.auth.service import normalize_phone
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    ATS_CHECKS,
    COVER_LETTERS,
    DB,
    MEMBERSHIPS,
    RESUMES,
    SHARES,
    TICKETS,
    USERS,
    next_number,
)
from app.core.email import MailerDep, send_safely
from app.core.errors import ApiError
from app.core.pii import scrub_id_numbers
from app.core.richtext import clean_rich
from app.core.time import now
from app.downloads.router import account_entitlement
from app.maintenance.sample_data import strip_sample
from app.me import emails, rewards
from app.me.schemas import (
    ApplicationIn,
    ApplicationOut,
    ApplicationPatch,
    CheckIn,
    CheckOut,
    CoverIn,
    CoverOut,
    CoverPatch,
    MeState,
    ProfileOut,
    ProfilePatch,
    PublicResumeOut,
    ReferralOut,
    ResumeIn,
    ResumeOut,
    ResumePatch,
    ShareIn,
    ShareOut,
    TicketCreated,
    TicketIn,
    TicketOut,
)
from app.me.service import add_check, find_share, ms, new_short, referral_code, referrals, share_of, visible_resume
from app.site import get_site

router = APIRouter(prefix="/api/me", tags=["me"])
public = APIRouter(prefix="/api/public", tags=["public"])
log = logging.getLogger("nm7.me")

MAX_RESUMES = 20
MAX_COVERS = 100
MAX_APPS = 500
TICKET_RULES = [(5, timedelta(hours=1)), (20, timedelta(days=1))]


def _not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"We couldn’t find that {what}.")


# ---------- converting stored documents ----------


def resume_out(d: dict[str, Any]) -> ResumeOut:
    return ResumeOut(
        id=d["key"],
        name=d["name"],
        active=d.get("active", False),
        data=d["data"],
        jd=d.get("jd", ""),
        versions=d.get("versions", []),
        pages=d.get("pages"),
        created=ms(d["created_at"]),
        updated=ms(d["updated_at"]),
    )


def cover_out(d: dict[str, Any]) -> CoverOut:
    return CoverOut.model_validate({**d, "id": d["key"], "at": ms(d["created_at"])})


def app_out(d: dict[str, Any]) -> ApplicationOut:
    return ApplicationOut.model_validate({**d, "id": d["key"]})


def ticket_out(d: dict[str, Any]) -> TicketOut:
    return TicketOut(
        id=d["_id"],
        topic=d["topic"],
        order_id=d.get("order_id"),
        text=d["text"],
        status=d["status"],
        reply=d.get("reply"),
        at=ms(d["created_at"]),
        replied_at=ms(d.get("replied_at")),
    )


async def profile_out(db: AsyncDatabase, u: User) -> ProfileOut:
    return ProfileOut(
        name=u.name,
        email=u.email,
        phone=u.phone,
        target_role=u.target_role,
        cities=u.cities,
        level=u.level,
        notify=u.notify,
        ui=u.ui,
        joined=ms(u.created_at),
        referral_code=await referral_code(db, u),
    )


def _fields(body: BaseModel, *, exclude: set[str] | None = None) -> dict[str, Any]:
    return body.model_dump(exclude_unset=True, exclude=exclude)


def without_id_numbers(fields: dict[str, Any], what: str) -> dict[str, Any]:
    """Resume text with an Aadhaar / PAN / passport / licence / account number in it is saved without the number
    (`data`, and the `versions` snapshots). Logged as a count only, never the text."""
    n = 0
    if isinstance(fields.get("data"), dict):
        fields["data"] = clean_rich(fields["data"])  # summary / descriptions: text + bold only, no other markup
    for k in ("data", "versions"):
        if fields.get(k) is not None:
            fields[k], m = scrub_id_numbers(fields[k])
            n += m
    if n:
        log.warning("%s save: removed %d ID-like number(s) from the text", what, n)
    return fields


# ---------- everything at once (opening the dashboard) ----------


@router.get("/state")
async def state(auth: CustomerAuth, db: DB) -> MeState:
    uid = auth.user.id
    q = {"user_id": uid}
    return MeState(
        profile=await profile_out(db, auth.user),
        resumes=[resume_out(d) async for d in db[RESUMES].find(q).sort("created_at", 1)],
        covers=[cover_out(d) async for d in db[COVER_LETTERS].find(q).sort("created_at", DESCENDING)],
        apps=[app_out(d) async for d in db[APPLICATIONS].find(q).sort("created_at", DESCENDING)],
        checks=[CheckOut.model_validate({**d, "at": ms(d["at"])}) async for d in db[ATS_CHECKS].find(q).sort("at", 1)],
        share=await share_of(db, auth.user),
        tickets=[ticket_out(d) async for d in db[TICKETS].find(q).sort("created_at", DESCENDING)],
        referral=await _referral(db, auth.user),
    )


# ---------- profile ----------


@router.get("/profile")
async def get_profile(auth: CustomerAuth, db: DB) -> ProfileOut:
    return await profile_out(db, auth.user)


@router.patch("/profile")
async def patch_profile(body: ProfilePatch, auth: CustomerAuth, db: DB) -> ProfileOut:
    f = _fields(body)
    if "name" in f:
        f["name"] = " ".join(f["name"].split())
        if not f["name"]:
            raise ApiError(400, "name_required", "Enter your name.")
    if "phone" in f:
        f["phone"] = normalize_phone(f["phone"])
    if f:
        raw = await db[USERS].find_one_and_update(
            {"_id": auth.user.id}, {"$set": {**f, "updated_at": now()}}, return_document=ReturnDocument.AFTER
        )
        auth.user = User.load(raw)
    return await profile_out(db, auth.user)


# ---------- resumes (the active one is the builder's draft) ----------


async def _resume(db: AsyncDatabase, uid: str, key: str) -> dict[str, Any]:
    d = await db[RESUMES].find_one({"user_id": uid, "key": key})
    if not d:
        raise _not_found("resume")
    return d


@router.get("/resumes")
async def list_resumes(auth: CustomerAuth, db: DB) -> list[ResumeOut]:
    return [resume_out(d) async for d in db[RESUMES].find({"user_id": auth.user.id}).sort("created_at", 1)]


@router.post("/resumes", status_code=201)
async def add_resume(body: ResumeIn, auth: CustomerAuth, db: DB) -> ResumeOut:
    uid = auth.user.id
    count = await db[RESUMES].count_documents({"user_id": uid})
    if count >= MAX_RESUMES:
        raise ApiError(400, "too_many", f"You can keep up to {MAX_RESUMES} resumes. Delete one first.")
    t = now()
    active = body.active or count == 0
    f = without_id_numbers(body.model_dump(exclude={"id"}), "resume")
    if isinstance(f.get("data"), dict):
        f["data"], _ = strip_sample(f["data"])  # a new resume never starts with the example person's values
    doc = {
        **f,
        "key": body.id,
        "user_id": uid,
        "active": active,
        "created_at": t,
        "updated_at": t,
    }
    if active:
        await db[RESUMES].update_many({"user_id": uid}, {"$set": {"active": False}})
    try:
        await db[RESUMES].insert_one(doc)
    except DuplicateKeyError:
        raise ApiError(409, "exists", "That resume already exists.") from None
    return resume_out(doc)


@router.get("/resumes/{key}")
async def get_resume(key: str, auth: CustomerAuth, db: DB) -> ResumeOut:
    return resume_out(await _resume(db, auth.user.id, key))


@router.patch("/resumes/{key}")
async def patch_resume(key: str, body: ResumePatch, auth: CustomerAuth, db: DB) -> ResumeOut:
    uid = auth.user.id
    old = await _resume(db, uid, key)
    f = without_id_numbers(_fields(body), "resume")
    if_updated = f.pop("if_updated", None)
    if if_updated is not None and ms(old["updated_at"]) > if_updated and "data" in f:
        raise ApiError(409, "stale", "This resume was changed somewhere else. Reloading the latest copy.")
    if f.get("active"):
        await db[RESUMES].update_many({"user_id": uid, "key": {"$ne": key}}, {"$set": {"active": False}})
    touched = {} if f and set(f) <= {"pages"} else {"updated_at": now()}  # a page count alone isn't an edit
    if "data" in f and f["data"] != old.get("data"):
        # an organization asked for changes (or marked it ready): the edit sends it back for another look
        await db[MEMBERSHIPS].update_many(
            {"user_id": uid, "resume_id": key, "review_status": {"$in": ["needs_changes", "ready"]}},
            {"$set": {"review_status": "none"}},
        )
    d = await db[RESUMES].find_one_and_update(
        {"user_id": uid, "key": key}, {"$set": {**f, **touched}}, return_document=ReturnDocument.AFTER
    )
    if not d:
        raise _not_found("resume")
    return resume_out(d)


@router.delete("/resumes/{key}", status_code=204)
async def delete_resume(key: str, auth: CustomerAuth, db: DB) -> Response:
    uid = auth.user.id
    d = await _resume(db, uid, key)
    if await db[RESUMES].count_documents({"user_id": uid}) <= 1:
        raise ApiError(400, "last_resume", "Keep at least one resume.")
    await db[RESUMES].delete_one({"_id": d["_id"]})
    if d.get("active"):  # the oldest one becomes the builder's draft
        first = await db[RESUMES].find_one({"user_id": uid}, sort=[("created_at", 1)])
        await db[RESUMES].update_one({"_id": first["_id"]}, {"$set": {"active": True}})
    return Response(status_code=204)


# ---------- cover letters and job applications (same pattern) ----------


async def _add(db, collection: str, uid: str, body: BaseModel, limit: int, what: str) -> dict[str, Any]:
    if await db[collection].count_documents({"user_id": uid}) >= limit:
        raise ApiError(400, "too_many", f"You can keep up to {limit} {what}s. Delete some first.")
    t = now()
    f = body.model_dump(exclude={"id", "at"})
    doc = {**f, "key": body.id, "user_id": uid, "created_at": t, "updated_at": t}
    try:
        await db[collection].insert_one(doc)
    except DuplicateKeyError:
        raise ApiError(409, "exists", f"That {what} already exists.") from None
    return doc


async def _patch(db, collection: str, uid: str, key: str, body: BaseModel, what: str) -> dict[str, Any]:
    d = await db[collection].find_one_and_update(
        {"user_id": uid, "key": key},
        {"$set": {**_fields(body), "updated_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    if not d:
        raise _not_found(what)
    return d


async def _delete(db, collection: str, uid: str, key: str, what: str) -> Response:
    r = await db[collection].delete_one({"user_id": uid, "key": key})
    if not r.deleted_count:
        raise _not_found(what)
    return Response(status_code=204)


def _clean_cover(body: CoverIn | CoverPatch) -> CoverIn | CoverPatch:
    """A cover letter is saved without ID numbers too (the body and the pasted job description)."""
    n = 0
    for k in ("body", "jd"):
        v = getattr(body, k, None)
        if v:
            cleaned, m = scrub_id_numbers(v)
            setattr(body, k, cleaned)
            n += m
    if n:
        log.warning("cover letter saved without %d ID number(s)", n)
    return body


@router.post("/cover-letters", status_code=201)
async def add_cover(body: CoverIn, auth: CustomerAuth, db: DB) -> CoverOut:
    return cover_out(await _add(db, COVER_LETTERS, auth.user.id, _clean_cover(body), MAX_COVERS, "cover letter"))


@router.patch("/cover-letters/{key}")
async def patch_cover(key: str, body: CoverPatch, auth: CustomerAuth, db: DB) -> CoverOut:
    return cover_out(await _patch(db, COVER_LETTERS, auth.user.id, key, _clean_cover(body), "cover letter"))


@router.delete("/cover-letters/{key}", status_code=204)
async def delete_cover(key: str, auth: CustomerAuth, db: DB) -> Response:
    return await _delete(db, COVER_LETTERS, auth.user.id, key, "cover letter")


@router.post("/applications", status_code=201)
async def add_application(body: ApplicationIn, auth: CustomerAuth, db: DB) -> ApplicationOut:
    return app_out(await _add(db, APPLICATIONS, auth.user.id, body, MAX_APPS, "application"))


@router.patch("/applications/{key}")
async def patch_application(key: str, body: ApplicationPatch, auth: CustomerAuth, db: DB) -> ApplicationOut:
    return app_out(await _patch(db, APPLICATIONS, auth.user.id, key, body, "application"))


@router.delete("/applications/{key}", status_code=204)
async def delete_application(key: str, auth: CustomerAuth, db: DB) -> Response:
    return await _delete(db, APPLICATIONS, auth.user.id, key, "application")


# ---------- ATS check history ----------


@router.post("/ats-checks", status_code=201)
async def add_ats_check(body: CheckIn, auth: CustomerAuth, db: DB) -> CheckOut:
    doc = await add_check(db, auth.user.id, body.model_dump())
    return CheckOut.model_validate({**doc, "at": ms(doc["at"])})


# ---------- share link ----------


@router.get("/share")
async def get_share(auth: CustomerAuth, db: DB) -> ShareOut:
    return await share_of(db, auth.user)


@router.put("/share")
async def put_share(body: ShareIn, auth: CustomerAuth, db: DB) -> ShareOut:
    uid = auth.user.id
    if body.resume_id:
        await _resume(db, uid, body.resume_id)
    taken = ApiError(409, "slug_taken", "That link name is taken. Try another.")
    if await db[SHARES].find_one({"short": body.slug, "_id": {"$ne": uid}}, {"_id": 1}):
        raise taken  # someone's short link
    fields: dict[str, Any] = {**body.model_dump(), "updated_at": now()}
    if body.on and not (await db[SHARES].find_one({"_id": uid}, {"short": 1}) or {}).get("short"):
        fields["short"] = await new_short(db)
    try:
        await db[SHARES].update_one(
            {"_id": uid},
            {
                "$set": fields,
                "$setOnInsert": {"views": [], "view_count": 0, "created_at": now()},
            },
            upsert=True,
        )
    except DuplicateKeyError:
        raise taken from None
    return await share_of(db, auth.user)


VIEW_RULE = [(1, timedelta(hours=1))]  # one counted view per visitor per hour


@public.get("/resumes/{slug}")
async def public_resume(slug: str, request: Request, auth: MaybeAuth, db: DB) -> PublicResumeOut:
    """A published resume, for anyone with the link (its name or its short code). The phone number and email are
    removed if the owner chose that; ID numbers never go out."""
    off = ApiError(404, "not_found", "This resume link is turned off or doesn’t exist.")
    s = await find_share(db, slug)
    if not s:
        raise off
    q: dict[str, Any] = {"user_id": s["_id"]}
    r = await db[RESUMES].find_one({**q, "key": s["resume_id"]}) if s.get("resume_id") else None
    r = r or await db[RESUMES].find_one({**q, "active": True}) or await db[RESUMES].find_one(q)
    if not r or not await db[USERS].find_one({"_id": s["_id"], "disabled_at": None}):
        raise off
    data, _ = scrub_id_numbers(visible_resume(r["data"]), strict=True)  # switched-off entries and IDs are not sent
    if s.get("hide_phone"):
        data["personal"] = {**(data.get("personal") or {}), "phone": ""}
        if isinstance(data.get("pinfo"), dict):
            data["pinfo"] = {**data["pinfo"], "address": ""}
    if s.get("hide_email"):
        data["personal"] = {**(data.get("personal") or {}), "email": ""}
    is_owner = auth is not None and auth.user.id == s["_id"]
    key = f"view:{s['_id']}:{client_ip(request) or '-'}"
    if not is_owner and not await rate_limit.count(db, key, VIEW_RULE[0][1]):
        await rate_limit.record(db, key)
        await db[SHARES].update_one(
            {"_id": s["_id"]}, {"$inc": {"view_count": 1}, "$push": {"views": {"$each": [now()], "$slice": -500}}}
        )
    name = (data.get("personal") or {}).get("name") or ""
    can, _ = await account_entitlement(db, s["_id"])
    return PublicResumeOut(name=name, data=data, updated=ms(r["updated_at"]), can_download=can)


@public.post("/resumes/{slug}/export")
async def public_resume_export(slug: str, db: DB) -> dict[str, bool]:
    """Run before a shared resume's PDF is made: allowed when its owner may download (see app/downloads)."""
    s = await find_share(db, slug)
    if not s:
        raise ApiError(404, "not_found", "This resume link is turned off or doesn’t exist.")
    if not (await account_entitlement(db, s["_id"]))[0]:
        raise ApiError(402, "payment_required", "The owner of this resume hasn’t turned on downloads.")
    return {"ok": True}


# ---------- support tickets ----------


@router.post("/tickets", status_code=201)
async def add_ticket(body: TicketIn, auth: CustomerAuth, db: DB, mailer: MailerDep) -> TicketCreated:
    user = auth.user
    key = f"ticket:{user.id}"
    await rate_limit.check(db, key, TICKET_RULES, "You’ve sent a lot of messages. Please wait a little.")
    await rate_limit.record(db, key)
    n = await next_number(db, "ticket", 1001)
    doc = {
        "_id": f"T-{n}",
        "user_id": user.id,
        "topic": body.topic.strip(),
        "order_id": (body.order_id or "").strip() or None,
        "text": body.text.strip(),
        "status": "open",
        "reply": None,
        "created_at": now(),
        "replied_at": None,
    }
    await db[TICKETS].insert_one(doc)
    emailed = await send_safely(mailer, emails.new_ticket(get_settings().support_inbox, user, doc))
    return TicketCreated(**ticket_out(doc).model_dump(), emailed=emailed)


@router.get("/tickets")
async def my_tickets(auth: CustomerAuth, db: DB) -> list[TicketOut]:
    return [ticket_out(d) async for d in db[TICKETS].find({"user_id": auth.user.id}).sort("created_at", DESCENDING)]


# ---------- referrals ----------


@router.get("/referral")
async def my_referral(auth: CustomerAuth, db: DB) -> ReferralOut:
    return await _referral(db, auth.user)


async def _referral(db: AsyncDatabase, user: User) -> ReferralOut:
    """The invite code, who joined with it, and the reward progress ("2 of 3")."""
    fr = {f["id"]: f for f in await rewards.friends(db, user.id)}
    return ReferralOut(
        code=await referral_code(db, user),
        referrals=await referrals(db, user.id, fr),
        reward=await rewards.progress(db, user.id),
    )


# ---------- prices (the owner can change them in the admin console) ----------


@public.get("/prices")
async def prices(db: DB) -> dict[str, Any]:
    site = await get_site(db)

    def rupees(group: str) -> dict[str, Any]:
        return {
            k: {"name": v["name"], "price": v["amount"] / 100, "active": v["active"]} for k, v in site[group].items()
        }

    return {"plans": rupees("plans"), "addons": rupees("addons"), "deliveryHours": site["delivery_hours"]}
