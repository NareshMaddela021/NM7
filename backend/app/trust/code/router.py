# ruff: noqa: E501  (dense response lines)
"""Vetting Trust T14 endpoints. Candidate endpoints are behind the Trust switch (404 for people it is off for).

Candidate (the practical task opened as a coding task by POST /api/me/skill-checks/{id}/task/start):
  GET  /api/me/trust/code/{aid}            the problem (never the hidden tests), my draft, runs left, the submission
                                           (a queued one that is due is tried again), the replay consent line
  PUT  /api/me/trust/code/{aid}/draft      {language, source}  saved as I type (no lost work)
  POST /api/me/trust/code/{aid}/run        {language, source}  the visible samples only (rate limited)
  POST /api/me/trust/code/{aid}/submit     {language, source, stats, replay?, blurs, blurMs}  queued, then hidden tests
Company (header X-Recruiter-Account; Trust switch + Admin "companies may watch replays"; candidates it can see):
  GET  /api/company/{cid}/trust/code/{uid} the latest coding result (X of Y) and the editor replay, if they agreed
Admin ("jobs" to read, "settings" to change; audited):
  GET  /api/admin/trust/code               provider, keys set / not set, limits, rate limits, counts
  PUT  /api/admin/trust/code               settings
  POST /api/admin/trust/code/health        ask the chosen sandbox if it is up
  GET  /api/admin/trust/code/problems      every problem WITH its hidden tests (admins only)
  POST /api/admin/trust/code/problems      add / PUT /problems/{pid} edit (a new version, validated by running the
                                           reference solution through the sandbox; offered only once it passes)
  POST /api/admin/trust/code/problems/{pid}/validate
  GET  /api/admin/trust/code/results       the latest coding results (cases, flags, tries)
  GET  /api/admin/trust/code/replay/{aid}  one replay (each view is in the audit log)
"""

import re
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Request
from pydantic import Field, field_validator

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.auth.sessions import client_ip
from app.companies.signup import company_for
from app.core.db import DB, TRUST_CODE, TRUST_CODE_PROBLEMS, TRUST_CODE_REPLAYS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site, save_site
from app.trust import access
from app.trust import retention as R
from app.trust.code import problems as PB
from app.trust.code import providers as P
from app.trust.code import service as S

me = APIRouter(prefix="/api/me/trust/code", tags=["trust"], dependencies=[access.ON])
company = APIRouter(prefix="/api/company/{cid}/trust/code", tags=["trust"])
admin = APIRouter(prefix="/api/admin/trust/code", tags=["trust"])


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "This coding task isn’t here.") from None


class CodeIn(CamelModel):
    language: str = Field(max_length=20)
    source: str = Field(max_length=PB.MAX_SOURCE)


class SubmitIn(CodeIn):
    stats: dict[str, int] = Field(default_factory=dict, max_length=10)
    replay: dict[str, Any] | None = None  # checked (size cap, format) in replay.clean
    blurs: int = Field(0, ge=0, le=10000)
    blur_ms: int = Field(0, ge=0, le=86_400_000)

    @field_validator("stats")
    @classmethod
    def _bounded(cls, v: dict[str, int]) -> dict[str, int]:
        return {k: max(0, min(1_000_000, int(n))) for k, n in v.items() if k in ("typed", "pasted", "largestPaste")}


@me.get("/{aid}")
async def mine(aid: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.status(db, auth.user.id, _oid(aid))


@me.put("/{aid}/draft")
async def draft(aid: str, body: CodeIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.save_draft(db, auth.user.id, _oid(aid), body.language, body.source)


@me.post("/{aid}/run")
async def run(aid: str, body: CodeIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.run_samples(db, auth.user.id, _oid(aid), body.language, body.source)


@me.post("/{aid}/submit")
async def submit(aid: str, body: SubmitIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await S.submit(
        db, auth.user.id, _oid(aid), body.language, body.source, body.stats, body.replay, body.blurs, body.blur_ms
    )


# --- company -------------------------------------------------------------------------------------------------------------


@company.get("/{uid}")
async def company_code(cid: str, uid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, c, _ = await company_for(db, cid, x_recruiter_account)
    return await S.company_view(db, c, acc, uid)


# --- admin ---------------------------------------------------------------------------------------------------------------


def _camel(k: str) -> str:
    a, *rest = k.split("_")
    return a + "".join(x.title() for x in rest)


async def admin_out(db) -> dict[str, Any]:
    site = await get_site(db)
    st = S.settings_of(site)
    return {
        "settings": {_camel(k): st[k] for k in S.DEFAULTS}, "bounds": {_camel(k): list(v) for k, v in S.BOUNDS.items()},
        "providers": [{"key": p.key, "label": p.label, "test": p.test, "keys": p.keys(), "ready": p.ready()} for p in P.registry().values()],
        "languages": [{"key": k, "label": v["label"]} for k, v in P.LANGUAGES.items()],
        "counts": await S.admin_counts(db), "replayDays": R.days_for(site, "code_replay"), "codeDays": R.days_for(site, "code_tasks"),
        "replayMaxBytes": S.RP.MAX_BYTES,
    }  # fmt: skip


@admin.get("")
async def overview(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    return await admin_out(db)


class SettingsIn(CamelModel):
    on: bool = True
    provider: str
    cpu_s: float
    wall_s: float
    memory_mb: int
    output_kb: int
    processes: int = 30
    runs_per_task: int
    runs_per_minute: int
    ai_review: bool = True
    big_paste: int = 200
    company_replay: bool = True

    @field_validator("provider")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in P.registry():
            raise ValueError("unknown provider")
        return v


@admin.put("")
async def put_settings(body: SettingsIn, request: Request, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    new = body.model_dump()
    for k, (lo, hi) in S.BOUNDS.items():
        if not lo <= float(new[k]) <= hi:
            raise ApiError(400, "bounds", f"{k} must be between {lo:g} and {hi:g}.")
    before = S.settings_of(await get_site(db))
    if new != {k: before[k] for k in new}:
        await save_site(db, {"trust.code": new})
        await audit(
            db,
            auth.user.id,
            "trust.code_settings",
            target="site",
            data={"from": before, "to": new},
            ip=client_ip(request),
        )
    return await admin_out(db)


@admin.post("/health")
async def health(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    st = S.settings_of(await get_site(db))
    p = P.get(st["provider"])
    h = await p.health() if p else P.Health(False, "unknown provider")
    return {"provider": st["provider"], "ok": h.ok, "detail": h.detail, "at": ms(now())}


def _problem_admin(p: dict[str, Any]) -> dict[str, Any]:
    v = p.get("validated") or {}
    return {
        "id": p["_id"], "title": p["title"], "statement": p["statement"], "skills": p.get("skills") or [], "minutes": p.get("minutes", 30),
        "languages": p["languages"], "samples": p["samples"], "hidden": p["hidden"], "reference": p["reference"], "active": bool(p.get("active")),
        "version": p.get("version", 1), "seed": bool(p.get("seed")),
        "validated": {"ok": bool(v.get("ok")), "at": ms(v.get("at")), "passed": v.get("passed"), "total": v.get("total"), "failing": v.get("failing") or [],
                      "error": v.get("error", ""), "note": v.get("note", ""), "provider": v.get("provider", "")} if v else None,
    }  # fmt: skip


@admin.get("/problems")
async def problems(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    from app.hire.vetting.roles import ROLES

    await PB.ensure_seeds(db)
    rows = await db[TRUST_CODE_PROBLEMS].find({}).sort("title", 1).to_list(200)
    return {"items": [_problem_admin(p) for p in rows], "skills": [r["test"] for r in ROLES if r["task"] == "tech"]}


class TestIn(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    stdin: str = Field("", max_length=PB.MAX_IO)
    expected: str = Field(max_length=PB.MAX_IO)


class RefIn(CamelModel):
    language: str = Field(max_length=20)
    source: str = Field(max_length=PB.MAX_SOURCE)


class ProblemIn(CamelModel):
    title: str = Field(max_length=120)
    statement: str = Field(max_length=6000)
    skills: list[str] = Field(default_factory=list, max_length=20)
    minutes: int = Field(30, ge=10, le=90)
    languages: dict[str, str] = Field(max_length=len(P.LANGUAGES))
    samples: list[TestIn] = Field(max_length=PB.MAX_SAMPLES)
    hidden: list[TestIn] = Field(max_length=PB.MAX_HIDDEN)
    reference: RefIn
    active: bool = True


async def _save(db, pid: str, body: ProblemIn, actor: str, new: bool) -> dict[str, Any]:
    from app.hire.vetting.roles import ROLES

    doc = body.model_dump()
    tech = {r["test"] for r in ROLES if r["task"] == "tech"}
    doc["skills"] = [s for s in doc["skills"] if s in tech]
    bad = PB.check(doc)
    if bad:
        raise ApiError(400, "invalid", " ".join(bad))
    t = now()
    if new:
        await db[TRUST_CODE_PROBLEMS].insert_one(
            {"_id": pid, **doc, "version": 1, "created_at": t, "updated_at": t, "updated_by": actor, "validated": None}
        )
    else:
        r = await db[TRUST_CODE_PROBLEMS].update_one(
            {"_id": pid},
            {"$set": {**doc, "updated_at": t, "updated_by": actor, "validated": None}, "$inc": {"version": 1}},
        )
        if not r.matched_count:
            raise ApiError(404, "not_found", "That problem isn’t here.")
    await audit(
        db,
        actor,
        "trust.code_problem_saved",
        target=pid,
        data={"new": new, "hidden": len(doc["hidden"]), "skills": doc["skills"]},
    )
    await S.validate(db, pid, actor)
    return _problem_admin(await db[TRUST_CODE_PROBLEMS].find_one({"_id": pid}))


@admin.post("/problems")
async def add_problem(body: ProblemIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    slug = re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")[:40] or "problem"
    pid, n = slug, 1
    while await db[TRUST_CODE_PROBLEMS].find_one({"_id": pid}, {"_id": 1}):
        n += 1
        pid = f"{slug}-{n}"
    return await _save(db, pid, body, auth.user.id, True)


@admin.put("/problems/{pid}")
async def edit_problem(pid: str, body: ProblemIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    return await _save(db, pid, body, auth.user.id, False)


@admin.post("/problems/{pid}/validate")
async def validate(pid: str, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    await S.validate(db, pid, auth.user.id)
    return _problem_admin(await db[TRUST_CODE_PROBLEMS].find_one({"_id": pid}))


@admin.get("/results")
async def results(db: DB, _: AdminAuth("jobs")) -> dict[str, Any]:
    rows = (
        await db[TRUST_CODE]
        .find({"submission": {"$exists": True}})
        .sort("submission.queued_at", -1)
        .limit(50)
        .to_list(50)
    )
    have = {
        r["attempt_id"]
        async for r in db[TRUST_CODE_REPLAYS].find({"attempt_id": {"$in": [x["_id"] for x in rows]}}, {"attempt_id": 1})
    }
    return {"items": [{**S.result_out(x, admin=True), "hasReplay": x["_id"] in have} for x in rows]}


@admin.get("/replay/{aid}")
async def replay(aid: str, db: DB, auth: AdminAuth("jobs")) -> dict[str, Any]:
    oid = _oid(aid)
    row = await db[TRUST_CODE_REPLAYS].find_one({"attempt_id": oid})
    d = await db[TRUST_CODE].find_one({"_id": oid})
    if not d:
        raise ApiError(404, "not_found", "That coding task isn’t here.")
    await audit(
        db,
        auth.user.id,
        "trust.code_replay_viewed",
        target=d["user_id"],
        data={"by": "admin", "attempt": aid, "replay": bool(row)},
    )
    return {**S.result_out(d, admin=True), "replay": S.replay_out(row)}
