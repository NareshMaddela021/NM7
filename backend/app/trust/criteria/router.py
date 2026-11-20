# ruff: noqa: E501  (dense response shapes and consent text)
"""Vetting Trust T7: the job's requirements (criteria) and each candidate's Met / Not met / Unknown with evidence.

Company (only where the Trust switch lets the company in; else 404 and the pages look as before):
  GET  /api/company/{cid}/trust/criteria/{jid}             the criteria (extracted on first use, again when the JD changes)
  PUT  /api/company/{cid}/trust/criteria/{jid} {items}     the company's own list (the source of truth from now on);
                                                           a criterion about gender, religion, caste, age, looks, names or
                                                           colleges is refused (400)
  POST /api/company/{cid}/trust/criteria/{jid}/reextract   read the description again (replaces the edits)
  POST /api/company/{cid}/trust/criteria/{jid}/evaluate {people}   the strips for people the company can see for this job
                                                           (its applicants, Hire now candidates): cached answers re-used,
                                                           new / reworded criteria answered now (rules) or queued (AI)
  POST /api/company/{cid}/trust/criteria/{jid}/run         answer a few queued ones with the AI now ("evaluating…")
Applicants (one job picked) carry `criteria` per person and are sorted by must-haves met, then nice-to-haves met,
then the match score (attach_applicants); Hire now by the match score that counts must-haves (blend, attach_hire). Not met never rejects or hides anyone.

Candidate (Vetting Trust on for them):
  GET    /api/me/trust/criteria                            the consent, and per application the criteria I was
                                                           evaluated on with my own evidence (never anyone else's)
  POST   /api/me/trust/criteria/claims {jobId, criterionId, certId, note}   add evidence: a certificate from my wallet;
                                                           it counts only after Nm7 checks it
  DELETE /api/me/trust/criteria/claims/{id}
Admin (Admin → Skill checks → Vetting Trust → Evidence to check):
  GET  /api/admin/trust/criteria                           the claims waiting, counts
  GET  /api/admin/trust/criteria/claims/{id}/file          the certificate
  POST /api/admin/trust/criteria/claims/{id}/review {decision: verify | reject, note}
"""

from typing import Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, Response
from pydantic import Field

from app.admin.deps import AdminAuth
from app.audit import audit
from app.auth.deps import CustomerAuth
from app.companies.model import POST
from app.companies.signup import company_for
from app.core.config import get_settings
from app.core.db import (
    APPLICATIONS,
    CERTIFICATES,
    DB,
    HIRE_PROFILES,
    JOBS,
    TRUST_CRITERIA,
    TRUST_CRITERIA_CLAIMS,
    TRUST_CRITERIA_EVALS,
    TRUST_CRITERIA_QUEUE,
    USERS,
)
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.trust import access
from app.trust import consent as C
from app.trust import retention as R
from app.trust.criteria import evaluate as EV
from app.trust.criteria import extract as X

company = APIRouter(prefix="/api/company", tags=["trust"])
me = APIRouter(prefix="/api/me/trust/criteria", tags=["trust"], dependencies=[access.ON])
admin = APIRouter(prefix="/api/admin/trust/criteria", tags=["trust"])

PURPOSE = EV.PURPOSE
MAX_PEOPLE = 100
HIRE_TOP = 100  # Hire now: the top people (after the filters) that get criteria and are re-sorted
MAX_PENDING_CLAIMS = 20

C.add_purpose(C.Purpose(PURPOSE, "Matching you to a job's requirements",
    "When you apply to a job, or a company finds you in Hire now, we compare the job's requirements (for example “2 years of Tally” or "
    "“a two-wheeler licence”) with your resume, your shared skill check results, your AI interview answers, your verified documents and your "
    "work preferences. For each requirement the company sees Met, Not met or Unknown, with the exact words it came from. Before an AI reads "
    "anything we remove your name, photo, gender, age, college, address, email and phone. It is only a label: nobody is rejected because of it, "
    "and you can see what you were checked on and add evidence. We keep the results for {days} days. If you take this back, they are deleted "
    "now and companies see Unknown.", 1, "criteria_evals"))  # fmt: skip
R.register(R.DataType("criteria_evals", "Requirement checks for jobs (Met / Not met / Unknown with the quoted evidence)", 180, 30, 365,
                      TRUST_CRITERIA_EVALS, field="at", purpose=PURPOSE,
                      note="Deleted by the daily job, or now when the Matching consent is taken back"))  # fmt: skip
R.register(R.DataType("criteria_claims", "Evidence you added for a job requirement (the certificate stays in your wallet)", 365, 90, 730,
                      TRUST_CRITERIA_CLAIMS, field="created_at", purpose=PURPOSE,
                      note="Deleted by the daily job, or now when the Matching consent is taken back"))  # fmt: skip


@R.on_withdraw(PURPOSE)
async def _drop_queue(db, uid: str) -> int:
    return (await db[TRUST_CRITERIA_QUEUE].delete_many({"user_id": uid})).deleted_count


def show_test(c: dict[str, Any]) -> bool:
    return bool(c.get("demo")) or not get_settings().is_prod


def who(cid: str) -> str:
    return f"company:{cid}"


# --- company ------------------------------------------------------------------------------------------------------------


async def _company_job(db, cid: str, jid: str, hdr: str | None, role=None) -> tuple[dict, dict, dict]:
    acc, c, _ = await (company_for(db, cid, hdr, role) if role else company_for(db, cid, hdr))
    if not await access.for_company(db, c, acc):
        raise ApiError(404, "not_found", "Not found.")
    j = await db[JOBS].find_one({"_id": jid, "company_id": cid})
    if not j:
        raise ApiError(404, "not_found", "That job isn’t here.")
    return acc, c, j


class CriterionIn(CamelModel):
    kind: Literal[X.KINDS] = "other"  # type: ignore[valid-type]
    text: str = Field(min_length=1, max_length=400)
    must: bool = False


class CriteriaIn(CamelModel):
    items: list[CriterionIn] = Field(max_length=X.MAX_ITEMS + 5)


class PeopleIn(CamelModel):
    people: list[str] = Field(min_length=1, max_length=MAX_PEOPLE)


@company.get("/{cid}/trust/criteria/{jid}")
async def get_criteria(cid: str, jid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    _, _, j = await _company_job(db, cid, jid, x_recruiter_account)
    return {**X.out(await X.for_job(db, j, who(cid)), j), "kinds": [{"key": k, "label": X.KIND_LABEL[k]} for k in X.KINDS],
            "max": X.MAX_ITEMS}  # fmt: skip


@company.put("/{cid}/trust/criteria/{jid}")
async def put_criteria(
    cid: str, jid: str, body: CriteriaIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    acc, _, j = await _company_job(db, cid, jid, x_recruiter_account, POST)
    from app.trust.fairness import filters as F  # Vetting Trust T12: direct filters refused, proxies warned

    items, warned = [], []
    for x in body.items:
        text = X.tidy(x.text)
        if len(text) < X.MIN_TEXT:
            raise ApiError(400, "too_short", "Each requirement needs a few words.")
        fs = F.check_text(text)
        if topic := X.unfair(text):
            await F.log(db, cid, "criteria", [{"topic": topic, "level": "refuse", "phrase": text}], "refused")
            raise ApiError(400, "unfair", X.refusal(topic), extra={"topic": topic, "text": text})
        if F.refused(fs):
            await F.log(db, cid, "criteria", F.refused(fs), "refused")
            raise ApiError(400, "unfair", F.refusal_text(fs), extra={"topic": F.refused(fs)[0].topic, "text": text})
        warned += F.warned(fs)
        items.append({"kind": x.kind, "text": text, "must": x.must, "by": "company"})
    if len(items) > X.MAX_ITEMS:
        raise ApiError(400, "too_many", f"Keep it to {X.MAX_ITEMS} requirements at most.")
    old = await X.for_job(db, j, who(cid))
    before = {X.chash(o["kind"], o["text"]): o.get("by", "rules") for o in old.get("items") or []}
    for x in items:  # an unchanged one keeps where it came from
        x["by"] = before.get(X.chash(x["kind"], x["text"]), "company")
    cleaned = X.clean_items(items, "company")
    t = now()
    await db[TRUST_CRITERIA].update_one(
        {"_id": jid}, {"$set": {"items": cleaned, "edited": True, "updated_at": t, "edited_by": acc["email_lc"]}}
    )
    await audit(
        db, None, "trust.criteria_edit", target=cid, data={"by": acc["email_lc"], "job": jid, "n": len(cleaned)}
    )
    await F.log(db, cid, "criteria", warned, "override")
    return {**X.out(await db[TRUST_CRITERIA].find_one({"_id": jid}), j), "fairness": F.out(warned)}


@company.post("/{cid}/trust/criteria/{jid}/reextract")
async def reextract(cid: str, jid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    acc, _, j = await _company_job(db, cid, jid, x_recruiter_account, POST)
    await db[TRUST_CRITERIA].delete_one({"_id": jid})
    row = await X.for_job(db, j, who(cid))
    await audit(
        db, None, "trust.criteria_reextract", target=cid, data={"by": acc["email_lc"], "job": jid, "by_": row["by"]}
    )
    return X.out(row, j)


async def _visible(db, c: dict[str, Any], j: dict[str, Any], people: list[str]) -> dict[str, dict[str, Any] | None]:
    """uid → the resume to read (their application's, or None for the active one), for people this company may see
    for this job: its applicants, and Hire now candidates (on, with consent); never people who hid from it."""
    from app.companies.applicants import _resume_doc
    from app.seek.support import hidden_from, hidden_users

    hidden = await hidden_users(db, c, people)
    people = [p for p in people if p not in hidden]
    out: dict[str, dict[str, Any] | None] = {}
    async for a in db[APPLICATIONS].find({"job_id": j["_id"], "company_id": c["_id"], "channel": "nm7", "company_removed_at": None,
                                          "user_id": {"$in": people}}):  # fmt: skip
        out[a["user_id"]] = await _resume_doc(db, a)
    rest = [p for p in people if p not in out]
    if rest:
        async for p in db[HIRE_PROFILES].find({"_id": {"$in": rest}, "on": True, "consent_at": {"$ne": None}}):
            if not hidden_from(p, c):
                out[p["_id"]] = None
    return out


@company.post("/{cid}/trust/criteria/{jid}/evaluate")
async def evaluate(
    cid: str, jid: str, body: PeopleIn, db: DB, x_recruiter_account: str | None = Header(None)
) -> dict[str, Any]:
    _, c, j = await _company_job(db, cid, jid, x_recruiter_account)
    crit = await X.for_job(db, j, who(cid))
    seen = await _visible(db, c, j, list(dict.fromkeys(body.people)))
    got = await EV.strips(
        db, crit, list(seen), who=who(cid), resumes={k: v for k, v in seen.items() if v}, show_test=show_test(c)
    )
    return {"criteria": X.out(crit, j), "items": got, "pending": sum(s["pending"] for s in got.values())}


@company.post("/{cid}/trust/criteria/{jid}/run")
async def run_now(cid: str, jid: str, db: DB, x_recruiter_account: str | None = Header(None)) -> dict[str, Any]:
    await _company_job(db, cid, jid, x_recruiter_account)
    done = await EV.run_queue(db, job_id=jid, max_calls=EV.CALLS_PER_REQUEST)
    left = await db[TRUST_CRITERIA_QUEUE].count_documents({"job_id": jid})
    return {**done, "pending": left}


def blend(score: int, strip: dict[str, Any] | None) -> int:
    """Hire now's shown score (item 29): with must-haves on the job, half the skills match and half the must-haves met,
    so a person missing must-haves never shows 100%. The same sum as blendScore in CriteriaBits.jsx. Order only."""
    s = max(0, min(100, int(score or 0)))
    total = int((strip or {}).get("mustTotal") or 0)
    if not total:
        return s
    met = min(int((strip or {}).get("mustMet") or 0), total)
    return int(s / 2 + 50 * met / total + 0.5)


async def attach_applicants(db, rows: list[dict[str, Any]], j: dict[str, Any], c: dict[str, Any], acc: dict[str, Any] | None,
                            resumes: dict[str, Any]) -> dict[str, Any] | None:  # fmt: skip
    """Applicants for one job: `criteria` on each row, sorted by must-haves met, nice-to-haves met, then as before.
    None (and nothing changes) where the Trust switch doesn't let the company in."""
    if not await access.for_company(db, c, acc):
        return None
    crit = await X.for_job(db, j, who(c["_id"]))
    got = await EV.strips(
        db, crit, [r["userId"] for r in rows], who=who(c["_id"]), resumes=resumes, show_test=show_test(c)
    )
    for r in rows:
        r["criteria"] = got.get(r["userId"])
    rows.sort(key=lambda r: EV.sort_key(r["criteria"]))  # stable: the old order (fit, score, newest) breaks ties
    return X.out(crit, j)


async def attach_hire(
    db, rows: list[dict[str, Any]], j: dict[str, Any], c: dict[str, Any], acc: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Hire now: `criteria` on the top people, who are re-sorted by the match score that counts must-haves (`blend`),
    then must-haves met, then nice-to-haves met."""
    if not await access.for_company(db, c, acc):
        return None
    crit = await X.for_job(db, j, who(c["_id"]))
    top = rows[:HIRE_TOP]
    got = await EV.strips(db, crit, [r["key"] for r in top], who=who(c["_id"]), show_test=show_test(c))
    for r in top:
        r["criteria"] = got.get(r["key"])
    top.sort(key=lambda r: (-blend(int((r.get("match") or {}).get("score") or 0), r["criteria"]), *EV.sort_key(r["criteria"])))
    rows[:HIRE_TOP] = top
    return X.out(crit, j)


# --- candidate ----------------------------------------------------------------------------------------------------------


def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except (InvalidId, TypeError):
        raise ApiError(404, "not_found", "Not found.") from None


def claim_out(c: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(c["_id"]), "jobId": c["job_id"], "criterion": c["text"], "kind": c["kind"], "title": c.get("title", ""),
            "note": c.get("note", ""), "status": c["status"], "at": ms(c["created_at"]), "reviewedAt": ms(c.get("reviewed_at")),
            "reviewNote": c.get("review_note", "")}  # fmt: skip


async def _mine(db, uid: str) -> dict[str, Any]:
    from app.companies.applicants import _resume_doc
    from app.site import get_site

    consent = uid in await EV.consented(db, [uid])
    apps = await db[APPLICATIONS].find({"user_id": uid, "company_id": {"$exists": True}, "company_removed_at": None},
                                       {"job_id": 1, "role": 1, "company": 1, "created_at": 1, "copy_id": 1, "resume_id": 1, "user_id": 1}
                                       ).sort("created_at", -1).limit(20).to_list(20)  # fmt: skip
    crits = {r["_id"]: r async for r in db[TRUST_CRITERIA].find({"_id": {"$in": [a["job_id"] for a in apps]}})}
    jobs = {j["_id"]: j async for j in db[JOBS].find({"_id": {"$in": list(crits)}}, {"title": 1, "company": 1})}
    u = await db[USERS].find_one({"_id": uid}, {"demo": 1}) or {}
    test_ok = bool(u.get("demo")) or not get_settings().is_prod
    out = []
    for a in apps:
        crit = crits.get(a["job_id"])
        if not crit or not crit.get("items"):
            continue
        r = await _resume_doc(db, a)
        s = (await EV.strips(db, crit, [uid], who=f"user:{uid}", resumes={uid: r}, show_test=test_ok, queue=False))[uid]
        hs = {x["id"]: X.chash(x["kind"], x["text"]) for x in crit["items"]}
        for x in s["items"]:
            x["key"] = hs[x["id"]]
        out.append({"appId": str(a["_id"]), "jobId": a["job_id"], "job": (jobs.get(a["job_id"]) or {}).get("title") or a.get("role", ""),
                    "company": a.get("company", ""), "appliedAt": ms(a.get("created_at")), **s})  # fmt: skip
    claims = [
        claim_out(c) async for c in db[TRUST_CRITERIA_CLAIMS].find({"user_id": uid}).sort("created_at", -1).limit(50)
    ]
    certs = [{"id": c["_id"], "title": c["title"], "issuer": c.get("issuer", "")}
             async for c in db[CERTIFICATES].find({"user_id": uid}, {"title": 1, "issuer": 1}).sort("created_at", 1).limit(20)]  # fmt: skip
    return {"consent": consent, "consentTitle": C.PURPOSES[PURPOSE].title, "consentText": C.text_of(C.PURPOSES[PURPOSE], await get_site(db)),
            "applications": out, "claims": claims, "certificates": certs}  # fmt: skip


@me.get("")
async def my_criteria(db: DB, auth: CustomerAuth) -> dict[str, Any]:
    return await _mine(db, auth.user.id)


class ClaimIn(CamelModel):
    job_id: str = Field(min_length=1, max_length=40)
    criterion_id: str = Field(min_length=1, max_length=10)
    cert_id: str = Field(min_length=1, max_length=60)
    note: str = Field("", max_length=300)


@me.post("/claims", status_code=201)
async def add_claim(body: ClaimIn, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    uid = auth.user.id
    await C.require(db, uid, PURPOSE)
    if not await db[APPLICATIONS].find_one(
        {"user_id": uid, "job_id": body.job_id, "company_removed_at": None}, {"_id": 1}
    ):
        raise ApiError(404, "not_found", "You haven’t applied to that job.")
    crit = await db[TRUST_CRITERIA].find_one({"_id": body.job_id}) or {}
    c = next((x for x in crit.get("items") or [] if x["id"] == body.criterion_id), None)
    if not c:
        raise ApiError(404, "not_found", "That requirement isn’t on the job any more.")
    cert = await db[CERTIFICATES].find_one({"_id": body.cert_id, "user_id": uid}, {"title": 1})
    if not cert:
        raise ApiError(404, "not_found", "Pick a certificate from your wallet (Profile > Certificates).")
    h = X.chash(c["kind"], c["text"])
    if await db[TRUST_CRITERIA_CLAIMS].find_one(
        {"user_id": uid, "chash": h, "cert_id": body.cert_id, "status": {"$ne": "rejected"}}
    ):
        raise ApiError(409, "duplicate", "You already added this certificate for this requirement.")
    if await db[TRUST_CRITERIA_CLAIMS].count_documents({"user_id": uid, "status": "pending"}) >= MAX_PENDING_CLAIMS:
        raise ApiError(429, "too_many", "Please wait until Nm7 has checked the evidence you already added.")
    from app.core.pii import scrub_text

    row = {"user_id": uid, "job_id": body.job_id, "chash": h, "kind": c["kind"], "text": c["text"], "cert_id": body.cert_id,
           "title": cert["title"], "note": scrub_text(" ".join(body.note.split()))[0], "status": "pending", "created_at": now()}  # fmt: skip
    await db[TRUST_CRITERIA_CLAIMS].insert_one(row)
    await audit(db, uid, "trust.criteria_claim", data={"job": body.job_id})
    return claim_out(row)


@me.delete("/claims/{claim_id}")
async def remove_claim(claim_id: str, db: DB, auth: CustomerAuth) -> dict[str, Any]:
    r = await db[TRUST_CRITERIA_CLAIMS].delete_one({"_id": _oid(claim_id), "user_id": auth.user.id})
    if not r.deleted_count:
        raise ApiError(404, "not_found", "Not found.")
    return {"ok": True}


# --- admin ----------------------------------------------------------------------------------------------------------------


@admin.get("")
async def admin_claims(db: DB, _: AdminAuth("settings")) -> dict[str, Any]:
    rows = await db[TRUST_CRITERIA_CLAIMS].find({"status": "pending"}).sort("created_at", 1).limit(100).to_list(100)
    users = {u["_id"]: u async for u in db[USERS].find({"_id": {"$in": [r["user_id"] for r in rows]}}, {"name": 1})}
    counts = {
        s: await db[TRUST_CRITERIA_CLAIMS].count_documents({"status": s}) for s in ("pending", "verified", "rejected")
    }
    return {"pending": [{**claim_out(r), "userName": (users.get(r["user_id"]) or {}).get("name", "")} for r in rows], "counts": counts,
            "queue": await db[TRUST_CRITERIA_QUEUE].count_documents({})}  # fmt: skip


@admin.get("/claims/{claim_id}/file")
async def admin_claim_file(claim_id: str, db: DB, _: AdminAuth("settings")) -> Response:
    from app.certs.service import file_response_headers

    r = await db[TRUST_CRITERIA_CLAIMS].find_one({"_id": _oid(claim_id)})
    cert = r and await db[CERTIFICATES].find_one({"_id": r["cert_id"], "user_id": r["user_id"]})
    if not cert:
        raise ApiError(404, "not_found", "The certificate was deleted.")
    return Response(bytes(cert["file"]), media_type=cert["mime"], headers=file_response_headers(cert))


class ReviewIn(CamelModel):
    decision: Literal["verify", "reject"]
    note: str = Field("", max_length=300)


@admin.post("/claims/{claim_id}/review")
async def admin_review(claim_id: str, body: ReviewIn, db: DB, auth: AdminAuth("settings")) -> dict[str, Any]:
    r = await db[TRUST_CRITERIA_CLAIMS].find_one({"_id": _oid(claim_id)})
    if not r:
        raise ApiError(404, "not_found", "Not found.")
    status = "verified" if body.decision == "verify" else "rejected"
    await db[TRUST_CRITERIA_CLAIMS].update_one({"_id": r["_id"]}, {"$set": {"status": status, "reviewed_at": now(), "review_note": body.note,
                                                                           "reviewed_by": auth.user.id}})  # fmt: skip
    await audit(
        db,
        auth.user.id,
        "trust.criteria_claim_review",
        target=r["user_id"],
        data={"claim": claim_id, "decision": status},
    )
    return claim_out(await db[TRUST_CRITERIA_CLAIMS].find_one({"_id": r["_id"]}))
