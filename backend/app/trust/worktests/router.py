# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T15 endpoints: typing, situational-judgement and aptitude tests; the reliability record.

Candidate (signed in; 404 while Vetting Trust is hidden from this person):
  GET  /api/me/trust/worktests                    the three tests, my latest results / badges, retake limits, the pledge
  POST /api/me/trust/worktests/start {test, lang, pledge, extraTime}     a paper (or the running one, to carry on)
  PUT  /api/me/trust/worktests/{id}/progress {answers, times | typed}   saved as they go; the clock is the server's
  POST /api/me/trust/worktests/{id}/submit {...}  marked (typing: typed, ms, inputs, insertedChars, pasteAttempts)
  GET  /api/me/trust/worktests/{id}               the result
  GET  /api/me/trust/reliability                  my record, the consent, what I can explain / dispute, stays to confirm
  POST /api/me/trust/reliability/{rid}/answer {why, text}                explain (within 48 h) or dispute
  POST /api/me/trust/reliability/stay {offer, days}                      "I'm still working there"
One-tap links (no sign-in, from /stop-alerts#k=ratt|rstay|rme&t=…; T11's signed links, rate-limited per address):
  POST /api/public/trust/rel/att/check · /att/act {token, result: attended | no_show}     the company, after the interview
  POST /api/public/trust/rel/stay/check · /stay/act {token, days, working, reason}        the company, day 30 / 90
  POST /api/public/trust/rel/me/check · /me/act {token, id, why, text | offer, days}       the candidate
Admin:
  GET  /api/admin/trust/worktests                 banks (validated), counts, latest results, reliability counts, disputes
  POST /api/admin/trust/worktests/disputes/{rid} {decision: count | remove, note}
  POST /api/admin/trust/worktests/run             the reliability pass now
"""

from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, HIRE_SLOTS, TRUST_WORKTESTS, USERS
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.trust import access
from app.trust.reliability import service as REL
from app.trust.worktests import banks as B
from app.trust.worktests import service as S

me = APIRouter(prefix="/api/me/trust", tags=["trust"], dependencies=[access.ON])
public = APIRouter(prefix="/api/public/trust/rel", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/worktests", tags=["trust"])


class StartIn(CamelModel):
    test: Literal["typing", "sjt", "aptitude"]
    lang: Literal["en", "hi", "te"] = "en"
    pledge: int | None = None
    extra_time: bool = False


class WorkIn(CamelModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    times: dict[str, float] = Field(default_factory=dict)
    signals: dict[str, Any] = Field(default_factory=dict)
    typed: str = Field("", max_length=2000)
    ms: int = Field(0, ge=0, le=3_600_000)
    inputs: int = Field(0, ge=0, le=100_000)
    inserted_chars: int = Field(0, ge=0, le=100_000)
    paste_attempts: int = Field(0, ge=0, le=10_000)


def _body(b: WorkIn) -> dict[str, Any]:
    return {"answers": b.answers, "times": b.times, "signals": b.signals, "typed": b.typed, "ms": b.ms, "inputs": b.inputs,
            "insertedChars": b.inserted_chars, "pasteAttempts": b.paste_attempts}  # fmt: skip


@me.get("/worktests")
async def catalogue(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.catalogue(db, auth.user.id)


@me.post("/worktests/start")
async def start(body: StartIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.start(db, auth.user.id, body.test, body.lang, body.pledge, body.extra_time)


@me.put("/worktests/{aid}/progress")
async def progress(aid: str, body: WorkIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.progress(db, auth.user.id, aid, _body(body))


@me.post("/worktests/{aid}/submit")
async def submit(aid: str, body: WorkIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.submit(db, auth.user.id, aid, _body(body))


@me.get("/worktests/{aid}")
async def result(aid: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.result(db, auth.user.id, aid)


# --- the reliability record: the candidate ------------------------------------------------------------------------------


class AnswerIn(CamelModel):
    why: Literal["emergency", "job_ended", "company_cancelled", "was_there", "still_working", "other"]
    text: str = Field("", max_length=500)


class StayIn(CamelModel):
    offer: str = Field(min_length=24, max_length=24)
    days: Literal[30, 90]


@me.get("/reliability")
async def my_record(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await REL.mine(db, auth.user.id)


@me.post("/reliability/{rid}/answer")
async def my_answer(rid: str, body: AnswerIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    await REL.answer(db, auth.user.id, rid, body.why, body.text)
    return await REL.mine(db, auth.user.id)


@me.post("/reliability/stay")
async def my_stay(body: StayIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    await REL.confirm_stay(db, auth.user.id, body.offer, body.days)
    return await REL.mine(db, auth.user.id)


# --- one-tap links ------------------------------------------------------------------------------------------------------

LINK_RULES = [(300, timedelta(hours=1))]
BAD_LINK = "This link has expired or isn’t complete. Sign in to Nm7 to answer there."


class TokenIn(CamelModel):
    token: str = Field(min_length=20, max_length=200)


class AttIn(TokenIn):
    result: Literal["attended", "no_show"]


class CoStayIn(TokenIn):
    days: Literal[30, 90]
    working: bool
    reason: str = Field("", max_length=300)


class MeActIn(TokenIn):
    id: str = Field("", max_length=80)
    why: str = Field("", max_length=30)
    text: str = Field("", max_length=500)
    offer: str = Field("", max_length=24)
    days: int = 0


async def _link(db, request: Request, token: str, kind: str) -> dict[str, Any]:
    from app.trust.booking import service as BK

    key = f"trust-t15-link:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, LINK_RULES)
    await rate_limit.record(db, key)
    link = await BK.open_link(db, token, kind)
    if not await REL.allowed(db, link["user_id"]):  # the switch or the consent changed since the link was sent
        raise ApiError(404, "invalid_link", BAD_LINK)
    return link


async def _slot(db, link: dict[str, Any]) -> dict[str, Any]:
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        s = await db[HIRE_SLOTS].find_one({"_id": ObjectId(link["offer_id"]), "company_id": link["company_id"]})
    except (InvalidId, TypeError):
        s = None
    if not s or s.get("user_id") != link["user_id"] or s.get("status") != "booked":
        raise ApiError(404, "invalid_link", "This interview isn’t booked any more.")
    return s


async def _att_view(db, s: dict[str, Any]) -> dict[str, Any]:
    from app.trust.agent import service as A

    u = await db[USERS].find_one({"_id": s["user_id"]}, {"name": 1}) or {}
    _, role = await REL._names(db, s["company_id"], s.get("job_id"))
    return {"kind": "attendance", "first": A._first(u), "role": role, "at": ms(s["starts_at"]), "mark": s.get("mark") or "",
            "canMark": s["starts_at"] <= now()}  # fmt: skip


@public.post("/att/check")
async def att_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    return await _att_view(db, await _slot(db, await _link(db, request, body.token, "attendance")))


@public.post("/att/act")
async def att_act(body: AttIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    from app.hire.slots import apply_mark

    link = await _link(db, request, body.token, "attendance")
    s = await _slot(db, link)
    if s["starts_at"] > now():
        raise ApiError(409, "not_yet", "Mark it once the interview has started.")
    await apply_mark(db, s, body.result, link["company_id"], mailer)
    await audit(
        db,
        None,
        "hire.slot_mark",
        target=link["company_id"],
        data={"by": "one-tap link", "slot": str(s["_id"]), "result": body.result},
    )
    return await _att_view(db, {**s, "mark": body.result})


async def _stay_view(db, link: dict[str, Any]) -> dict[str, Any]:
    o = await REL._offer(db, link["offer_id"])
    if o.get("company_id") != link["company_id"] or o["user_id"] != link["user_id"]:
        raise ApiError(404, "invalid_link", BAD_LINK)
    t = now()
    due = [d for d in REL.STAY_DAYS if REL.stay_due(o, d, t)]
    answers = {}
    for d in REL.STAY_DAYS:
        r = await db["trust_reliability"].find_one({"_id": f"stay{d}:{o['_id']}"}, {"outcome": 1, "source": 1})
        if r and r["source"] == "employer":
            answers[str(d)] = r["outcome"]
    return {"kind": "stay", "candidate": o.get("candidate_name") or "", "role": o.get("title") or "", "joinDate": o.get("join_date"),
            "due": due, "answers": answers}  # fmt: skip


@public.post("/stay/check")
async def stay_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    return await _stay_view(db, await _link(db, request, body.token, "stay"))


@public.post("/stay/act")
async def stay_act(body: CoStayIn, request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    link = await _link(db, request, body.token, "stay")
    o = await REL._offer(db, link["offer_id"])
    if o.get("company_id") != link["company_id"] or not REL.stay_due(o, body.days, now()):
        raise ApiError(409, "not_yet", "You can answer this once the day comes.")
    if not body.working and len(body.reason.strip()) < 3:
        raise ApiError(400, "reason", "Say in a few words what happened (kept with the record).")
    await REL.on_stay(db, o, body.days, body.working, "company", body.reason, mailer)
    await audit(
        db,
        None,
        "trust.reliability_stay",
        target=link["company_id"],
        data={"by": "one-tap link", "offer": str(o["_id"]), "days": body.days, "working": body.working},
    )
    return await _stay_view(db, link)


@public.post("/me/check")
async def me_check(body: TokenIn, request: Request, db: DB) -> dict[str, Any]:
    from app.trust.agent import service as A

    link = await _link(db, request, body.token, "rel_me")
    u = await db[USERS].find_one({"_id": link["user_id"]}, A.USER_FIELDS) or {}
    d = await REL.mine(db, link["user_id"])
    d.pop("consent", None)
    return {**d, "first": A._first(u), "lang": (await A.prefs(db, u))["lang"] if u else "en"}


@public.post("/me/act")
async def me_act(body: MeActIn, request: Request, db: DB) -> dict[str, Any]:
    link = await _link(db, request, body.token, "rel_me")
    if body.offer:
        if body.days not in REL.STAY_DAYS:
            raise ApiError(400, "days", "30 or 90 days.")
        await REL.confirm_stay(db, link["user_id"], body.offer, body.days)
    else:
        await REL.answer(db, link["user_id"], body.id, body.why, body.text, via="link")
    return await me_check(TokenIn(token=body.token), request, db)


# --- Admin --------------------------------------------------------------------------------------------------------------


class DecideIn(CamelModel):
    decision: Literal["count", "remove"]
    note: str = Field("", max_length=500)


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    by: dict[str, int] = {}
    async for x in await db[TRUST_WORKTESTS].aggregate(
        [{"$group": {"_id": {"t": "$test", "l": "$lang", "s": "$status"}, "n": {"$sum": 1}}}]
    ):
        by[f"{x['_id']['t']}_{x['_id']['l']}_{x['_id']['s']}"] = x["n"]
    latest = []
    scores = await S.norms(db)
    async for d in db[TRUST_WORKTESTS].find({"status": "submitted"}).sort("submitted_at", -1).limit(30):
        u = await db[USERS].find_one({"_id": d["user_id"]}, {"name": 1, "email": 1}) or {}
        latest.append({**(S.result_out(d, *S._top_now(d, scores)) or {}), "user": {"name": u.get("name", ""), "email": u.get("email", "")},
                       "form": d["form"], "rawFlags": d.get("flags") or [], "integrityReasons": (d.get("integrity") or {}).get("reasons") or []})  # fmt: skip
    return {"banks": B.summary(), "counts": by, "norms": {"people": len(scores), "needed": S.S.NORM_MIN}, "latest": latest,
            "reliability": {"counts": await REL.counts(db), "disputes": await REL.queue(db)},
            "rules": {"typing": S.S.__doc__.split("Situational")[0].strip(), "windowHours": int(REL.WINDOW.total_seconds() // 3600), "disputeDays": REL.DISPUTE_DAYS}}  # fmt: skip


@admin.post("/disputes/{rid}")
async def decide(rid: str, body: DecideIn, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    return await REL.decide(db, rid, body.decision, body.note, auth.user.id)


@admin.post("/run")
async def run_now(db: DB, mailer: MailerDep, _: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        return await REL.run(db, mailer, force=True)
