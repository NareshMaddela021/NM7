"""What Auto Apply did and what waits for the student (Phase 3, A3 "Needs your answer" and the preview days).

  GET  /api/me/auto-apply/items                         needs your answer · waiting for your Approve · applied
  POST /api/me/auto-apply/items/{id}/answer {answers, remember}   answer the job's questions: applies at once (within
                                                        today's limit; over it, first thing in the next run)
  POST /api/me/auto-apply/items/{id}/go                 a borderline match: apply anyway (same limits)
  POST /api/me/auto-apply/items/{id}/skip               not this one
  POST /api/me/auto-apply/items/{id}/approve            preview days: send this one
  POST /api/me/auto-apply/items/approve-all             preview days: send all waiting

"remember" saves each answer for the same question in later jobs (Profile: the saved answers are the student's own
words, never made up). Nothing is sent while Auto Apply is off for everyone or the student is paused by Admin.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import Field

from app.audit import audit
from app.auth.deps import CustomerAuth
from app.autoapply import engine
from app.core.db import AUTO_COPIES, AUTO_ITEMS, DB, JOBS, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.site import get_site

router = APIRouter(prefix="/api/me/auto-apply/items", tags=["auto apply"])

SHOWN_STATES = ("needs_answer", "waiting_approval", "queued", "applied")


class AnswerIn(CamelModel):
    answers: dict[str, str | int] = Field(default_factory=dict, max_length=5)
    remember: bool = True


def _out(it: dict[str, Any], j: dict[str, Any] | None, missing: set[str] | None = None) -> dict[str, Any]:
    from app.companies.questions import public

    qs = public((j or {}).get("questions"))
    missing = missing if missing is not None else set(it.get("missing") or [])
    return {
        "id": it["_id"],
        "state": it["state"],
        "kind": it.get("kind"),
        "score": it.get("score"),
        "channel": it.get("channel"),
        "job": {"id": it["job_id"], "title": it.get("title"), "company": it.get("company"), "slug": it.get("slug")},
        "questions": [q for q in qs if q["id"] in missing] if it.get("kind") == "questions" else [],
        "at": ms(it.get("updated_at")),
    }


@router.get("")
async def items(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    rows = (
        await db[AUTO_ITEMS]
        .find({"user_id": auth.user.id, "state": {"$in": list(SHOWN_STATES)}})
        .sort("updated_at", -1)
        .to_list(200)
    )
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": [r["job_id"] for r in rows]}}, {"questions": 1})}
    u = await db[USERS].find_one({"_id": auth.user.id}, {"auto_apply": 1}) or {}
    out = {"needsAnswer": [], "waiting": [], "queued": [], "applied": []}
    key = {"needs_answer": "needsAnswer", "waiting_approval": "waiting", "queued": "queued", "applied": "applied"}
    for r in rows:
        missing = None
        if r.get("kind") == "questions" and jobs.get(r["job_id"]):  # answers saved since then count
            missing = {q["id"] for q in (await engine.saved_answers(u, jobs[r["job_id"]]))[1]}
        out[key[r["state"]]].append(_out(r, jobs.get(r["job_id"]), missing))
    out["applied"] = out["applied"][:30]
    return out


async def _context(db, uid: str, iid: str, states: tuple[str, ...]):
    site = await get_site(db)
    if not site["auto_apply"]["on"]:
        raise ApiError(409, "site_off", "Auto Apply is paused for everyone right now. Nothing is being sent.")
    u = await db[USERS].find_one({"_id": uid}, {"auto_apply": 1, "email": 1, "name": 1})
    a = (u or {}).get("auto_apply") or {}
    if a.get("admin_paused"):
        raise ApiError(409, "admin_paused", "Auto Apply is paused on your account. Write to us from Help.")
    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": uid})
    if not it or it["state"] not in states:
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    j = await db[JOBS].find_one({"_id": it["job_id"]})
    if not j or j.get("status") != "active":
        await db[AUTO_ITEMS].update_one({"_id": iid}, {"$set": {"state": "expired", "updated_at": now()}})
        raise ApiError(409, "closed", "This job has closed.")
    return site, u, it, j


async def _send_now(db, site, u, it, j, answers: dict[str, Any]) -> str:
    """Apply now within today's limit, else queue it for the next run."""
    day = engine.today()
    d = site["auto_apply"]
    limit = min(int((u.get("auto_apply") or {}).get("daily_limit", d["daily_limit"])), int(d["max_daily_limit"]))
    if await engine.used_today(db, u["_id"], day) >= limit:
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]}, {"$set": {"state": "queued", "answers": answers, "updated_at": now()}}
        )
        return "queued"
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"counted_day": day}})
    return await engine.finish(db, {**it, "counted_day": day}, j, u, answers, day, site)


@router.post("/{iid}/answer")
async def answer(iid: str, body: AnswerIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    from app.companies import questions as qmod

    site, u, it, j = await _context(db, auth.user.id, iid, ("needs_answer",))
    qs = j.get("questions") or []
    saved, missing = await engine.saved_answers(u, j)
    given, problems = qmod.answers_for(missing, body.answers)
    if problems:
        raise ApiError(400, "answers", " ".join(problems), extra={"problems": problems})
    answers = {**saved, **given}
    if body.remember and given:
        texts = {q["id"]: q["text"] for q in qs}
        await db[USERS].update_one(
            {"_id": u["_id"]},
            {"$set": {f"auto_apply.answers.{engine.norm(texts[k])}": v for k, v in given.items()}},
        )
    if qmod.knockout(qs, answers):
        # honest answers that don't fit the company's rules: applying would only waste their time
        await db[AUTO_ITEMS].update_one(
            {"_id": iid}, {"$set": {"state": "skipped", "reason": "not_a_fit", "updated_at": now()}}
        )
        await audit(db, u["_id"], "auto_apply.answer", target=j["_id"], data={"state": "skipped"})
        return {"state": "skipped", "reason": "not_a_fit"}
    state = await _send_now(db, site, u, it, j, answers)
    await audit(db, u["_id"], "auto_apply.answer", target=j["_id"], data={"state": state, "remember": body.remember})
    return {"state": state}


@router.post("/{iid}/go")
async def go(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    site, u, it, j = await _context(db, auth.user.id, iid, ("needs_answer",))
    if it.get("kind") != "borderline":
        raise ApiError(409, "questions", "Answer the questions first.")
    answers, missing = await engine.saved_answers(u, j)
    if missing:
        await db[AUTO_ITEMS].update_one(
            {"_id": iid}, {"$set": {"kind": "questions", "missing": [q["id"] for q in missing], "updated_at": now()}}
        )
        return {"state": "needs_answer", "kind": "questions"}
    state = await _send_now(db, site, u, it, j, answers)
    await audit(db, u["_id"], "auto_apply.go", target=j["_id"], data={"state": state, "score": it.get("score")})
    return {"state": state}


@router.post("/{iid}/skip")
async def skip(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    it = await db[AUTO_ITEMS].find_one({"_id": iid, "user_id": auth.user.id})
    if not it or it["state"] not in ("needs_answer", "waiting_approval", "queued"):
        raise ApiError(404, "not_found", "This job isn’t waiting for you any more.")
    upd: dict[str, Any] = {"$set": {"state": "skipped", "reason": "student", "updated_at": now()}}
    if it["state"] != "waiting_approval":
        upd["$unset"] = {"counted_day": ""}  # a waiting one was counted when Nm7 prepared it
    await db[AUTO_ITEMS].update_one({"_id": iid}, upd)
    await audit(db, auth.user.id, "auto_apply.skip", target=it["job_id"])
    return {"state": "skipped"}


async def _approve(db, u, it, j) -> str:
    copy = await db[AUTO_COPIES].find_one({"_id": it.get("copy_id")})
    if not copy:
        return await engine.finish(
            db, {**it, "approved": True}, j, u, it.get("answers") or {}, engine.today(), await get_site(db)
        )
    app = await engine.apply_nm7(db, it, j, u, copy, it.get("answers") or {})
    state = "applied" if app else "skipped"
    await db[AUTO_ITEMS].update_one(
        {"_id": it["_id"]}, {"$set": {"state": state, "approved": True, "applied_at": now(), "updated_at": now()}}
    )
    return state


@router.post("/approve-all")
async def approve_all(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    n = 0
    async for it in db[AUTO_ITEMS].find({"user_id": auth.user.id, "state": "waiting_approval"}):
        try:
            _, u, it2, j = await _context(db, auth.user.id, it["_id"], ("waiting_approval",))
        except ApiError as e:
            if e.code in ("site_off", "admin_paused"):
                raise
            continue
        n += (await _approve(db, u, it2, j)) == "applied"
    await audit(db, auth.user.id, "auto_apply.approve_all", data={"applied": n})
    return {"applied": n}


@router.post("/{iid}/approve")
async def approve(iid: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    _, u, it, j = await _context(db, auth.user.id, iid, ("waiting_approval",))
    state = await _approve(db, u, it, j)
    await audit(db, auth.user.id, "auto_apply.approve", target=j["_id"], data={"state": state})
    return {"state": state}
