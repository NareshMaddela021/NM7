# ruff: noqa: E501  (dense queries)
"""Reading every integrity signal Nm7 already has, for many people at once (one query per source, never per person).
Nothing here writes to the sources: V2, V3, V5, T2 and T3 keep working exactly as they do.

  V2 skill checks     skill_attempts (v 2) integrity.reasons, one signal per reason per attempt; cleared when a person
                      cleared the attempt (integrity.cleared_by) or a V5 appeal on it was upheld (retest / corrected),
                      confirmed when the V2 integrity queue held it
  V3 AI interview     vetting_interviews signals: 3+ paste attempts, or 9+ times away / 3+ minutes away
  V5 fraud scan       vetting_queue kind "fraud" naming the person: phone, device, duplicate resume, dates, copied
                      answers; cleared / confirmed by the V5 decision
  T2 documents        trust_documents review reasons: the name differs, the same PAN on another account; cleared /
                      confirmed (not_cleared) by the T2 review
  T3 ID + selfie      trust_face: the check didn't pass after all tries (a review of kind "tries"), the joining-day
                      selfie not the same person. A manual-check request (no camera, a disability) is never a signal.
  T8 snapshots        trust_snapshots photo rows with a face check: no face, more than one face, not the same person
  T4 fraud reports    reports are about jobs and companies, never about a candidate: not a candidate signal.

`observations` counts what the person has done (finished skill checks, graded interviews, documents, an ID check,
snapshots) so a person with nothing done is "Not enough data", not "Low risk".
"""

from datetime import datetime, timedelta
from typing import Any

from app.core.db import (
    SKILL_ATTEMPTS,
    TRUST_DOCUMENTS,
    TRUST_FACE,
    TRUST_SNAPSHOTS,
    VETTING_INTERVIEWS,
    VETTING_QUEUE,
)
from app.trust.integrity.rating import KINDS, MAX_AGE_DAYS, Signal

FRAUD_KINDS = {
    "phone": "fraud_phone",
    "device": "fraud_device",
    "resume": "fraud_resume",
    "dates": "fraud_dates",
    "copied": "fraud_copied",
}
DOC_TITLES = {
    "dl": "Driving licence",
    "class10": "Class 10",
    "class12": "Class 12",
    "degree": "Degree",
    "pan": "PAN card",
}
WHAT = {"skill": "Skill check", "interview": "AI interview"}


def _fraud_kind(key: str) -> str:
    return FRAUD_KINDS.get((key or "").split(":", 1)[0], "fraud_other")


async def collect(db, uids: list[str], t: datetime) -> dict[str, dict[str, Any]]:
    """{uid: {"signals": [Signal], "observations": n, "snapshots": n}} for every uid asked about."""
    out: dict[str, dict[str, Any]] = {u: {"signals": [], "observations": 0, "snapshots": 0} for u in uids}
    if not uids:
        return out
    since = t - timedelta(days=MAX_AGE_DAYS)
    ids = list(out)

    # V2 skill checks (the test and its practical task share the attempt's integrity)
    attempts: list[dict[str, Any]] = []
    async for a in db[SKILL_ATTEMPTS].find({"user_id": {"$in": ids}, "v": 2, "submitted_at": {"$gt": since}},
                                           {"user_id": 1, "skill": 1, "submitted_at": 1, "integrity": 1, "kind": 1}):  # fmt: skip
        out[a["user_id"]]["observations"] += 1
        if (a.get("integrity") or {}).get("reasons"):
            attempts.append(a)
    held: set[Any] = set()
    upheld: set[Any] = set()
    if attempts:
        aids = [a["_id"] for a in attempts]
        async for q in db[VETTING_QUEUE].find(
            {"kind": "integrity", "attempt_id": {"$in": aids}, "decision": "hold"}, {"attempt_id": 1}
        ):
            held.add(q["attempt_id"])
        async for q in db[VETTING_QUEUE].find(
            {"kind": "appeal", "ref": {"$in": aids}, "outcome": {"$in": ["retest", "corrected"]}}, {"ref": 1}
        ):
            upheld.add(q["ref"])
    for a in attempts:
        integ = a["integrity"]
        st, by = "open", ""
        if a["_id"] in upheld:
            st, by = "cleared", "Your appeal was upheld"
        elif integ.get("cleared_by"):
            st, by = "cleared", "Skill check review"
        elif a["_id"] in held:
            st, by = "confirmed", "Skill check review"
        for reason in integ.get("reasons") or []:
            if reason not in KINDS:
                continue
            out[a["user_id"]]["signals"].append(Signal(
                key=f"attempt:{a['_id']}:{reason}", kind=reason, at=a["submitted_at"], where=f"Skill check: {a.get('skill', '')}" + (" (refresher)" if a.get("kind") == "refresh" else ""),
                source_status=st, by=by, detail=f"V2 integrity {integ.get('level', '')} · {integ.get('points', 0)} points on the attempt",
                ref={"appeal": {"kind": "skill", "ref": str(a["_id"])}},
            ))  # fmt: skip

    # V3 AI interview
    async for iv in db[VETTING_INTERVIEWS].find(
        {"user_id": {"$in": ids}, "started_at": {"$gt": since}},
        {"user_id": 1, "test": 1, "started_at": 1, "answered_at": 1, "graded_at": 1, "status": 1, "signals": 1},
    ):
        if iv.get("status") in ("graded", "review"):
            out[iv["user_id"]]["observations"] += 1
        sig = iv.get("signals") or {}
        at = iv.get("graded_at") or iv.get("answered_at") or iv["started_at"]
        where = f"AI interview: {iv.get('test', '')}"
        appeal = {"appeal": {"kind": "interview", "ref": str(iv["_id"])}} if iv.get("status") == "graded" else {}
        if int(sig.get("pasteAttempts") or 0) >= 3:
            out[iv["user_id"]]["signals"].append(Signal(key=f"interview:{iv['_id']}:paste", kind="iv_paste", at=at, where=where,
                                                        detail=f"{int(sig['pasteAttempts'])} paste attempts", ref=appeal))  # fmt: skip
        if int(sig.get("blurs") or 0) > 8 or int(sig.get("blurMs") or 0) > 180_000:
            out[iv["user_id"]]["signals"].append(Signal(key=f"interview:{iv['_id']}:away", kind="iv_away", at=at, where=where,
                                                        detail=f"Away {int(sig.get('blurs') or 0)} times, {int(sig.get('blurMs') or 0) // 1000} s in all", ref=appeal))  # fmt: skip

    # V5 fraud scan (one item can name several people)
    async for q in db[VETTING_QUEUE].find({"kind": "fraud", "users": {"$in": ids}, "updated_at": {"$gt": since}}):
        st = (
            {"clear": "cleared", "confirmed": "confirmed"}.get(q.get("decision") or "", "open")
            if q.get("status") == "done"
            else "open"
        )
        for u in q.get("users") or []:
            if u in out:
                out[u]["signals"].append(Signal(key=f"fraud:{q['_id']}", kind=_fraud_kind(q.get("key", "")), at=q.get("created_at") or q["updated_at"],
                                                where="Account checks (daily scan)", source_status=st, by="Account check review" if st != "open" else "",
                                                detail="; ".join(q.get("evidence") or [])[:500] + (f" · {len(q.get('users') or [])} accounts" if len(q.get("users") or []) > 1 else "")))  # fmt: skip

    # T2 documents
    async for d in db[TRUST_DOCUMENTS].find(
        {"user_id": {"$in": ids}}, {"user_id": 1, "kind": 1, "review": 1, "fetched_at": 1, "doc_name": 1}
    ):
        out[d["user_id"]]["observations"] += 1
        rv = d.get("review") or {}
        st = {"cleared": "cleared", "not_cleared": "confirmed"}.get(rv.get("status") or "", "open")
        for reason in rv.get("reasons") or []:
            kind = {"name_differs": "doc_name", "pan_elsewhere": "doc_pan_dup"}.get(reason)
            if kind:
                out[d["user_id"]]["signals"].append(Signal(key=f"doc:{d['_id']}:{reason}", kind=kind, at=d.get("fetched_at") or t,
                                                           where=f"DigiLocker: {DOC_TITLES.get(d.get('kind'), d.get('kind', ''))}", source_status=st,
                                                           by="Document review" if st != "open" else "",
                                                           detail=(f"Name on the document: {d['doc_name']}" if d.get("doc_name") and kind == "doc_name" else "")))  # fmt: skip

    # T3 ID + selfie (never a manual-check request: no camera or a disability is not a signal)
    async for f in db[TRUST_FACE].find(
        {"_id": {"$in": ids}}, {"status": 1, "review": 1, "continuity": 1, "verified_at": 1, "updated_at": 1}
    ):
        uid = f["_id"]
        if f.get("status") in ("verified", "review", "not_cleared", "retry"):
            out[uid]["observations"] += 1
        rv = f.get("review") or {}
        if rv.get("kind") == "tries":
            st = {"cleared": "cleared", "reset": "cleared", "not_cleared": "confirmed"}.get(
                rv.get("status") or "", "open"
            )
            out[uid]["signals"].append(Signal(key="face:identity", kind="selfie_failed", at=rv.get("requested_at") or f.get("updated_at") or t,
                                              where="ID + selfie check", source_status=st, by="ID + selfie review" if st != "open" else "",
                                              detail=rv.get("last_reason") or ""))  # fmt: skip
        c = f.get("continuity") or {}
        crv = c.get("review") or {}
        if c.get("status") == "not_same" or crv.get("kind") == "tries":
            st = {"cleared": "cleared", "reset": "cleared", "not_cleared": "confirmed"}.get(
                crv.get("status") or "", "open"
            )
            if c.get("status") == "not_same":
                st = "confirmed"
            out[uid]["signals"].append(Signal(key=f"face:joining:{c.get('offer_id', '')}", kind="joining_not_same", at=crv.get("requested_at") or c.get("at") or t,
                                              where="Joining-day selfie", source_status=st, by="ID + selfie review" if st != "open" else "",
                                              detail=c.get("last_reason") or ""))  # fmt: skip

    # T8 webcam snapshots (a photo's signal goes when the photo is deleted by the retention job)
    async for p in db[TRUST_SNAPSHOTS].find(
        {"user_id": {"$in": ids}, "kind": "photo"}, {"user_id": 1, "created_at": 1, "check": 1, "where": 1}
    ):
        out[p["user_id"]]["snapshots"] += 1
        chk = p.get("check") or {}
        w = p.get("where") or {}
        where = f"Webcam snapshot · {WHAT.get(w.get('kind'), 'Test')}: {w.get('skill', '')}".rstrip(": ")
        kind = None
        if chk.get("faces") == 0:
            kind = "snap_no_face"
        elif (chk.get("faces") or 0) > 1:
            kind = "snap_many_faces"
        elif chk.get("same") is False:
            kind = "snap_other_person"
        if kind:
            out[p["user_id"]]["signals"].append(Signal(key=f"snap:{p['_id']}", kind=kind, at=p["created_at"], where=where,
                                                       detail=f"Faces seen: {chk.get('faces')}" + (f" · same-person score {chk['score']}" if chk.get("score") is not None else ""),
                                                       ref={"snapshot": str(p["_id"])}))  # fmt: skip
    for v in out.values():
        if v["snapshots"]:
            v["observations"] += 1
    return out


def apply_decisions(signals: list[Signal], decisions: dict[str, Any]) -> None:
    """A T8 decision (clear / confirm) wins over the source's status; "open" goes back to the source's."""
    for s in signals:
        d = (decisions or {}).get(s.key.replace(".", "_")) or {}
        if d.get("status") in ("cleared", "confirmed"):
            s.status, s.by = d["status"], "Nm7 review"
        else:
            s.status = s.source_status
