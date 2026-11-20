# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T5 endpoints: the calling agent (everything behind the one Trust switch; Admin pages always on).

Company (header X-Recruiter-Account; 404 while Vetting Trust is hidden from this company; posting admins change):
  GET  /api/company/{cid}/trust/agent                   per job: on / off, live status (contacted, interested, booked)
  PUT  /api/company/{cid}/trust/agent/jobs/{jid} {on, knockouts: [{text, want}]}   the per-job toggle + extra yes/no questions
Candidate (signed in, while Vetting Trust is on for them):
  GET  /api/me/trust/agent                              consent, channels, language, quiet days, opt-outs, "What we said"
  PUT  /api/me/trust/agent {whatsapp, call, lang, quietDays}   (turning a channel on again is opting back in)
Webhooks (no sign-in; every one signature-checked):
  GET  /api/public/trust/agent/whatsapp                 Meta's set-up check (hub.verify_token → hub.challenge)
  POST /api/public/trust/agent/whatsapp                 messages and statuses (X-Hub-Signature-256)
  POST /api/public/trust/agent/voice/{provider}?token=  the call result (the secret token or an X-Nm7-Signature HMAC)
Admin:
  GET  /api/admin/trust/agent                           providers, keys set / not set, settings, templates, counts, log
  PUT  /api/admin/trust/agent                           providers, caps, quiet hours, waits, template approvals
  POST /api/admin/trust/agent/run                       one pass now
  POST /api/admin/trust/agent/simulate {convoId, text | button | call}   the test console (test providers only)
"""

import json
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request, Response
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.companies.model import POST
from app.companies.signup import company_for
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, JOBS, TRUST_AGENT_CONVOS, TRUST_AGENT_EVENTS, USERS
from app.core.email import MailerDep
from app.core.errors import ApiError
from app.core.heavy import heavy_or_busy
from app.core.schemas import CamelModel
from app.core.security import same
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust import consent as C
from app.trust import knockout as K
from app.trust.agent import bolna
from app.trust.agent import providers as P
from app.trust.agent import service as S
from app.trust.agent import texts as T

company = APIRouter(prefix="/api/company/{cid}/trust/agent", tags=["trust"])
me = APIRouter(prefix="/api/me/trust/agent", tags=["trust"], dependencies=[access.ON])
public = APIRouter(prefix="/api/public/trust/agent", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/agent", tags=["trust"])

MOCK_VERIFY_TOKEN = "nm7-test-verify"


# --- the company -----------------------------------------------------------------------------------------------------------


async def _co(db, cid: str, session: str | None, roles: set[str] | None = None) -> tuple[dict, dict]:
    acc, c, _ = await company_for(db, cid, session, roles)
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    return acc, c


@company.get("")
async def company_jobs(cid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await _co(db, cid, x_recruiter_account)
    st = S.agent_settings(await get_site(db))
    rows = (
        await db[JOBS]
        .find({"company_id": cid, "status": {"$in": ["active", "review", "paused"]}})
        .sort("created_at", -1)
        .to_list(100)
    )
    return {
        "perJob": int(st["per_job"]), "quiet": {"from": st["quiet_from"], "to": st["quiet_to"]},
        "jobs": [{"id": j["_id"], "title": j["title"], "status": j["status"], "eligible": S.eligible(j), **(await S.job_status(db, j))} for j in rows],
        "maxExtra": K.MAX_EXTRA,
    }  # fmt: skip


class JobIn(CamelModel):
    on: bool
    knockouts: list[dict[str, Any]] | None = Field(None, max_length=K.MAX_EXTRA)


@company.put("/jobs/{jid}")
async def company_toggle(cid: str, jid: str, body: JobIn, db: DB, mailer: MailerDep, background: BackgroundTasks,
                         x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:  # fmt: skip
    acc, _ = await _co(db, cid, x_recruiter_account, POST)
    j = await db[JOBS].find_one({"_id": jid, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "This job isn’t yours.")
    if body.on and not S.eligible(j):
        raise ApiError(409, "not_nm7", "Nm7 can only call or message people about jobs that take applications on Nm7.")
    try:
        kos = K.parse_extra(body.knockouts) if body.knockouts is not None else None
    except ValueError as e:
        msg = e.errors()[0]["msg"] if hasattr(e, "errors") else str(e)
        raise ApiError(400, "invalid", msg.removeprefix("Value error, ")) from None
    j = await S.set_job(db, j, body.on, kos, acc["email_lc"])
    await audit(
        db,
        None,
        "trust.agent_job",
        target=cid,
        data={"by": acc["email_lc"], "job": jid, "on": body.on, "knockouts": len(kos or [])},
    )
    if body.on and j["status"] == "active":
        background.add_task(S.kick, db, mailer)
    return {"id": j["_id"], "title": j["title"], "status": j["status"], "eligible": True, **(await S.job_status(db, j))}


# --- the candidate ---------------------------------------------------------------------------------------------------------


def _mask(phone: str | None) -> str:
    d = S.wa_id(phone)
    return f"+91 •••••{d[-5:]}" if d else ""


async def _me_out(db, uid: str) -> dict[str, Any]:
    site = await get_site(db)
    st = S.agent_settings(site)
    u = await db[USERS].find_one({"_id": uid}, S.USER_FIELDS)
    p = await S.prefs(db, u)
    row = (await C.current(db, uid)).get(S.PURPOSE)
    purpose = C.PURPOSES[S.PURPOSE]
    return {
        "consent": C.status_of(row, purpose), "consentTitle": purpose.title, "consentText": C.text_of(purpose, site),
        "phone": _mask(u.get("phone")), "whatsapp": p["whatsapp"], "call": p["call"], "lang": p["lang"], "quietDays": p["quiet_days"],
        "optedOut": {"whatsapp": ms(p["opt_out"].get("whatsapp")), "call": ms(p["opt_out"].get("call"))},
        "quiet": {"from": st["quiet_from"], "to": st["quiet_to"]}, "perDay": int(st["per_person_day"]),
        "langs": [{"key": k, "label": v} for k, v in T.LANGS.items()],
        "conversations": await S.what_we_said(db, uid),
    }  # fmt: skip


@me.get("")
async def my_agent(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _me_out(db, auth.user.id)


class PrefsIn(CamelModel):
    whatsapp: bool
    call: bool
    lang: Literal["en", "hi", "te"] = "en"
    quiet_days: list[int] = Field(default_factory=list, max_length=7)

    @field_validator("quiet_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("Quiet days are 0 (Monday) to 6 (Sunday).")
        return sorted(set(v))


@me.put("")
async def set_my_agent(body: PrefsIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    u = await db[USERS].find_one({"_id": uid}, S.USER_FIELDS)
    if body.whatsapp or body.call:
        await C.require(db, uid, S.PURPOSE)
        if not S.wa_id(u.get("phone")):
            raise ApiError(
                400, "no_phone", "Add your mobile number in Profile first (it is the number we message and call)."
            )
    await S.save_prefs(db, u, whatsapp=body.whatsapp, call=body.call, lang=body.lang, quiet_days=body.quiet_days)
    return await _me_out(db, uid)


# --- webhooks ----------------------------------------------------------------------------------------------------------------

HOOK_RULES = [(600, timedelta(minutes=1))]


def _headers(request: Request) -> dict[str, str]:
    return {k.lower(): v for k, v in request.headers.items()}


@public.get("/whatsapp")
async def whatsapp_check(mode: str = Query("", alias="hub.mode"), token: str = Query("", alias="hub.verify_token"),
                         challenge: str = Query("", alias="hub.challenge", max_length=200)) -> Response:  # fmt: skip
    s = get_settings()
    want = s.whatsapp_verify_token or ("" if s.is_prod else MOCK_VERIFY_TOKEN)
    if mode != "subscribe" or not want or not same(token, want):
        raise ApiError(403, "forbidden", "Forbidden.")
    return Response(challenge, media_type="text/plain")


def _wa_signed(raw: bytes, headers: dict[str, str]) -> bool:
    """The real app secret's signature, or (anywhere but production) the test provider's."""
    from app.trust.agent.meta import MetaCloud

    if get_settings().whatsapp_app_secret and MetaCloud().verify(raw, headers):
        return True
    return not get_settings().is_prod and P.MockWhatsApp().verify(raw, headers)


@public.post("/whatsapp")
async def whatsapp_hook(request: Request, db: DB, mailer: MailerDep) -> dict[str, Any]:
    key = f"trust-agent-wa:{client_ip(request) or '-'}"
    await rate_limit.check(db, key, HOOK_RULES)
    await rate_limit.record(db, key)
    raw = await request.body()
    if len(raw) > 200_000 or not _wa_signed(raw, _headers(request)):
        raise ApiError(401, "bad_signature", "Signature check failed.")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise ApiError(400, "bad_body", "Not JSON.") from None
    msgs, _statuses = P.parse_meta(body if isinstance(body, dict) else {})
    done = [await S.on_whatsapp(db, m, mailer) for m in msgs[:20]]
    return {"ok": True, "handled": done}


@public.post("/voice/{provider}")
async def voice_hook(
    provider: str, request: Request, db: DB, mailer: MailerDep, token: str = Query("", max_length=200)
) -> dict[str, Any]:
    reg = P.voice_providers()
    vo = reg.get(provider)
    raw = await request.body()
    if (
        not vo
        or (vo.test and get_settings().is_prod)
        or len(raw) > 500_000
        or not vo.verify(raw, _headers(request), token)
    ):
        raise ApiError(401, "bad_signature", "Signature check failed.")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise ApiError(400, "bad_body", "Not JSON.") from None
    if not isinstance(body, dict):
        raise ApiError(400, "bad_body", "Not an object.")
    res = vo.parse(body)
    return {"ok": True, "handled": await S.on_call(db, res, bolna.ref_of(body) or str(body.get("convo") or ""), mailer)}


# --- Admin ---------------------------------------------------------------------------------------------------------------------


def _settings_out(st: dict[str, Any]) -> dict[str, Any]:
    return {"whatsappProvider": st["whatsapp_provider"], "voiceProvider": st["voice_provider"], "perJob": int(st["per_job"]),
            "perPersonDay": int(st["per_person_day"]), "quietFrom": st["quiet_from"], "quietTo": st["quiet_to"],
            "callAfterHours": int(st["call_after_hours"]), "closeAfterHours": int(st["close_after_hours"]), "minScore": int(st["min_score"]),
            "approved": {k: bool(v.get("approved")) for k, v in st["templates"].items()}}  # fmt: skip


def _prov(p) -> dict[str, Any]:
    return {"key": p.key, "label": p.label, "test": p.test, "ready": p.ready(), "keys": p.keys()}


async def _admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    st = S.agent_settings(site)
    t = now()
    base = get_settings().api_public_url.rstrip("/")
    ev = await db[TRUST_AGENT_EVENTS].find({}).sort("at", -1).to_list(50)
    convos = await db[TRUST_AGENT_CONVOS].find({}).sort("updated_at", -1).to_list(30)
    uids = list({e["user_id"] for e in ev} | {c["user_id"] for c in convos})
    users = {u["_id"]: u.get("email", "") async for u in db[USERS].find({"_id": {"$in": uids}}, {"email": 1})}
    jids = list({c["job_id"] for c in convos} | {e["job_id"] for e in ev if e.get("job_id")})
    titles = {j["_id"]: j.get("title", "") async for j in db[JOBS].find({"_id": {"$in": jids}}, {"title": 1})}
    return {
        "settings": _settings_out(st), "public": bool((site.get("trust") or {}).get("public")),
        "providers": {"whatsapp": [_prov(p) for p in P.whatsapp_providers().values()], "voice": [_prov(p) for p in P.voice_providers().values()]},
        "webhooks": {"whatsapp": f"{base}/api/public/trust/agent/whatsapp", "voice": f"{base}/api/public/trust/agent/voice/bolna?token=<VOICE_WEBHOOK_SECRET>"},
        "templates": [{"lang": k, "language": T.LANGS[k], "name": T.TEMPLATE_NAME, "category": "UTILITY", "body": v["body"], "buttons": v["buttons"],
                       "footer": v["footer"], "approved": bool(st["templates"][k]["approved"])} for k, v in T.TEMPLATES.items()],
        "callScript": {k: v for k, v in T.CALL.items()},
        "counts": {"today": await S.counts(db, t - timedelta(days=1)), "d30": await S.counts(db, t - timedelta(days=30))},
        "open": await db[TRUST_AGENT_CONVOS].count_documents({"state": {"$in": list(S.OPEN)}}),
        "log": [{"at": ms(e["at"]), "kind": e["kind"], "user": users.get(e["user_id"], ""), "job": titles.get(e.get("job_id"), ""),
                 "detail": e.get("status") or e.get("how") or e.get("lang") or ""} for e in ev],
        "conversations": [{"id": c["_id"], "user": users.get(c["user_id"], ""), "job": titles.get(c["job_id"], ""), "state": c["state"],
                           "score": c.get("score"), "at": ms(c["updated_at"]), "nextAt": ms(c.get("next_at"))} for c in convos],
    }  # fmt: skip


@admin.get("")
async def admin_overview(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    return await _admin_out(db)


class SettingsIn(CamelModel):
    whatsapp_provider: str = "mock"
    voice_provider: str = "mock"
    per_job: int = Field(30, ge=1, le=200)
    per_person_day: int = Field(2, ge=1, le=5)
    quiet_from: str = Field("21:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    quiet_to: str = Field("09:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    call_after_hours: int = Field(4, ge=1, le=48)
    close_after_hours: int = Field(72, ge=12, le=240)
    min_score: int = Field(50, ge=0, le=100)
    approved: dict[str, bool] = Field(default_factory=dict)


@admin.put("")
async def admin_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    if body.whatsapp_provider not in P.whatsapp_providers() or body.voice_provider not in P.voice_providers():
        raise ApiError(400, "unknown_provider", "Choose one of the providers listed.")
    if body.quiet_from == body.quiet_to:
        raise ApiError(400, "quiet", "Quiet hours need a start and an end that differ.")
    st = S.agent_settings(await get_site(db))
    new = {"whatsapp_provider": body.whatsapp_provider, "voice_provider": body.voice_provider, "per_job": body.per_job,
           "per_person_day": body.per_person_day, "quiet_from": body.quiet_from, "quiet_to": body.quiet_to,
           "call_after_hours": body.call_after_hours, "close_after_hours": body.close_after_hours, "min_score": body.min_score,
           "templates": {k: {"approved": bool(body.approved.get(k, st["templates"][k]["approved"]))} for k in T.LANGS}}  # fmt: skip
    old = {k: st[k] for k in new}
    if new != old:
        await save_site(db, {"trust.agent": new})
        await audit(
            db,
            auth.user.id,
            "trust.agent_settings",
            target="site",
            data={"from": old, "to": new},
            ip=client_ip(request),
        )
    return await _admin_out(db)


@admin.post("/run")
async def admin_run(db: DB, mailer: MailerDep, auth: AdminAuth("settings")) -> dict[str, Any]:
    async with heavy_or_busy(db):
        got = await S.run(db, mailer, force=True)
    await audit(db, auth.user.id, "trust.agent_run", target="site", data=got)
    return {"ran": got, **(await _admin_out(db))}


class SimIn(CamelModel):
    convo_id: str = Field(min_length=24, max_length=24)
    text: str = Field("", max_length=500)
    button: str = Field("", max_length=20)  # interested | not_now | stop | yes | no | slot:N
    call: dict[str, Any] | None = None  # {status, interest, knockouts: {id: yes/no}, slot, transcript: [{who, text}]}


@admin.post("/simulate")
async def admin_simulate(body: SimIn, db: DB, mailer: MailerDep, auth: AdminAuth("settings")) -> dict[str, Any]:
    """The candidate's side, for trying the flow with the test providers (refused for a real provider)."""
    st = S.agent_settings(await get_site(db))
    convo = await db[TRUST_AGENT_CONVOS].find_one({"_id": body.convo_id})
    if not convo:
        raise ApiError(404, "not_found", "No such conversation.")
    if body.call is not None:
        if st["voice_provider"] != "mock":
            raise ApiError(409, "real_provider", "The test console only works with the test call provider.")
        res = P.parse_canonical({**body.call, "ref": (convo.get("call") or {}).get("ref") or ""})
        got = await S.on_call(db, res, convo["_id"], mailer)
    else:
        if st["whatsapp_provider"] != "mock":
            raise ApiError(409, "real_provider", "The test console only works with the test WhatsApp provider.")
        p = await db["trust_agent_prefs"].find_one({"_id": convo["user_id"]}, {"wa_id": 1}) or {}
        payload = f"nm7:{convo['_id']}:{body.button}" if body.button else ""
        got = await S.on_whatsapp(
            db, P.Inbound(p.get("wa_id") or "", f"sim.{now().timestamp()}", body.text, payload), mailer
        )
    await audit(db, auth.user.id, "trust.agent_simulate", target=convo["_id"], data={"got": got})
    return {"handled": got, **(await _admin_out(db))}
