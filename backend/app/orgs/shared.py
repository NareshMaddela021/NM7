"""Organizations: the shared-resumes table, exports, approvals, reviews, reminders and group dashboards.
`register_shared` mounts them on /api/admin (every organization) and /api/org/{org_id} (one organization)."""

import csv
import io
import logging
import secrets
from datetime import UTC, datetime, time
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response

from app.audit import audit
from app.auth.models import new_id
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import DB, EXPORT_JOBS, MEMBERSHIPS, ORG_GROUPS
from app.core.email import MailerDep, send_batch
from app.core.errors import ApiError
from app.core.exports import CSV_BOM, csv_safe
from app.core.richtext import plain
from app.core.time import IST, ist_day, now
from app.orgs import emails
from app.orgs.branding import brands_for
from app.orgs.scope import NOT_FOUND, Scope
from app.orgs.service import (
    COMPLETE,
    _day,
    active_members,
    dashboard,
    file_name,
    filter_rows,
    membership_match,
    opt_out_token,
    printable,
    row_out,
    shared_rows,
    sort_rows,
    unique_names,
    with_shortlists,
)
from app.orgs.shapes import (
    ACTION_RULES,
    BATCH,
    EXPORT_RULES,
    GROUP_REMIND_RULES,
    MAX_EMAILS,
    Approval,
    ApprovalIn,
    ExportIn,
    Filters,
    IdsIn,
    RemindIn,
    Review,
    ReviewIn,
    _ip,
    group_out,
)

log = logging.getLogger("nm7.orgs")

CSV_HEAD = ["Name", "Email", "Phone", "Organization", "Group"]
CSV_TAIL = ["Courses", "Completeness %", "Approval", "Review", "Last updated", "Printed"]
APPROVAL_TEXT = {"approved": "Approved", "pending": "Pending", "rejected": "Rejected"}
REVIEW_TEXT = {"none": "", "needs_changes": "Needs changes", "ready": "Ready"}


async def _rows(db, scope: Scope, f: Filters, sort: str = "joined", direction: str = "desc", *, export: bool = False):
    """Rows in the scope that match the filters. Org / group filters are intersected with the scope (404 outside).
    Exports: approved members only, and only Ready resumes when asked."""
    match = scope.match()
    if f.org:
        if scope.org_id and f.org != scope.org_id:
            raise NOT_FOUND
        match["org_id"] = f.org
    if f.group:
        await scope.group(db, f.group)
        match["group_id"] = f.group
    fd = f.model_dump()
    if export:
        fd["approval"] = "approved"
        if f.only_ready:
            fd["review"] = "ready"
    try:
        rows = await shared_rows(db, {**match, **membership_match(fd)})  # a first cut in Mongo: fewer resumes read
        return sort_rows(filter_rows(await with_shortlists(db, rows), fd), sort, direction)
    except ValueError:
        raise ApiError(400, "bad_date", "Dates must look like 2026-10-16.") from None


async def _selected(
    db, scope: Scope, ids: list[str], *, approved_only: bool = False, with_data: bool = False
) -> list[dict[str, Any]]:
    """The chosen memberships that are in the scope (others are silently left out). `with_data`: with the resume."""
    rows = await shared_rows(db, {**scope.match(), "_id": {"$in": list(set(ids))}}, with_data=with_data)
    return [r for r in rows if r["approval"] == "approved"] if approved_only else rows


async def _memberships(db, scope: Scope, ids: list[str]) -> list[dict[str, Any]]:
    """The chosen active memberships in the scope, resume or not: approving / rejecting works for a pending member
    who deleted their shared resume (or whose account was disabled) too. Exports and reminders use `_selected`."""
    q = {**scope.match(), "_id": {"$in": list(set(ids))}, "left_at": None, "consent.given": True}
    return [{"membership_id": m["_id"], "org_id": m["org_id"]} async for m in db[MEMBERSHIPS].find(q, {"org_id": 1})]


def _orgs(rows: list[dict[str, Any]]) -> list[str]:
    return sorted({r["org_id"] for r in rows})


async def _limit(db, key: str, rules) -> None:
    await rate_limit.check(db, key, rules)
    await rate_limit.record(db, key)


def _stop_url(membership_id: str) -> str:
    return f"{get_settings().site_url}/groups/stop?t={opt_out_token(membership_id)}"


def _ist_midnight(t: datetime) -> datetime:
    """The start of the current India day, as an aware UTC instant."""
    return datetime.combine(t.astimezone(IST).date(), time.min, tzinfo=IST).astimezone(UTC)


def _recent(r: dict[str, Any], t) -> bool:
    return bool(r["last_reminded_at"] and ist_day(r["last_reminded_at"]) == ist_day(t))


async def _email_members(db, mailer, rows, make, *, gap: bool = True) -> tuple[int, dict[str, int]]:
    """Emails `rows`, skipping opted-out members, (with `gap`) anyone already reminded today (IST), and anything over
    500. Every member is claimed first — `last_reminded_at` is set atomically, with the gap in the query — so two
    sends at the same moment never email the same person twice; a member whose email failed gets their previous
    mark back and can be tried again. Review notes (`gap` False) are explicit coordinator actions: no gap."""
    t = now()
    skipped = {"optedOut": 0, "recent": 0, "overLimit": 0, "failed": 0}
    todo = []
    for r in rows:
        if r["reminders_opt_out"]:
            skipped["optedOut"] += 1
        elif gap and _recent(r, t):
            skipped["recent"] += 1
        elif len(todo) >= MAX_EMAILS:
            skipped["overLimit"] += 1
        else:
            todo.append(r)
    if not todo:
        return 0, skipped
    ids = [r["membership_id"] for r in todo]
    claim = new_id()
    q: dict[str, Any] = {"_id": {"$in": ids}, "left_at": None, "reminders_opt_out": {"$ne": True}}
    if gap:
        q["$or"] = [{"last_reminded_at": None}, {"last_reminded_at": {"$lt": _ist_midnight(t)}}]
    await db[MEMBERSHIPS].update_many(q, {"$set": {"last_reminded_at": t, "reminder_claim": claim}})
    claimed = {m["_id"] async for m in db[MEMBERSHIPS].find({"_id": {"$in": ids}, "reminder_claim": claim}, {"_id": 1})}
    skipped["recent"] += len(todo) - len(claimed)  # someone else just reminded (or they opted out / left)
    todo = [r for r in todo if r["membership_id"] in claimed]
    results = await send_batch(mailer, [make(r) for r in todo]) if todo else []
    failed = [r for r, ok in zip(todo, results, strict=True) if not ok]
    skipped["failed"] = len(failed)
    for r in failed:  # give back the previous mark so they can be tried again
        await db[MEMBERSHIPS].update_one(
            {"_id": r["membership_id"], "reminder_claim": claim}, {"$set": {"last_reminded_at": r["last_reminded_at"]}}
        )
    return len(todo) - len(failed), skipped


def register_shared(router: APIRouter, ScopeDep) -> None:  # noqa: N803 — a dependency type, like AdminScope
    """The shared-resumes table, exports, approvals, reviews, reminders and group dashboards, on `router`.
    Every handler starts from the resolved Scope, so the same code serves /api/admin and /api/org/{org_id}."""

    @router.get("/shared-resumes")
    async def shared_resumes(
        db: DB,
        scope: ScopeDep,
        org: str | None = Query(None, max_length=64),
        group: str | None = Query(None, max_length=64),
        q: str | None = Query(None, max_length=100),
        joined_from: str | None = Query(None, alias="joinedFrom"),
        joined_to: str | None = Query(None, alias="joinedTo"),
        updated_from: str | None = Query(None, alias="updatedFrom"),
        updated_to: str | None = Query(None, alias="updatedTo"),
        field_key: str | None = Query(None, alias="fieldKey"),
        field_value: str | None = Query(None, alias="fieldValue"),
        incomplete: bool = False,
        not_printed: bool = Query(False, alias="notPrinted"),
        ready_not_printed: bool = Query(False, alias="readyNotPrinted"),
        approval: Approval = "approved",
        review: Review | None = None,
        shortlisted_by: str | None = Query(None, alias="shortlistedBy", max_length=64),
        sort: str = "joined",
        direction: Literal["asc", "desc"] = Query("desc", alias="dir"),
        page: int = Query(1, ge=1),
        per_page: int = Query(25, ge=1, le=100, alias="perPage"),
    ) -> dict[str, Any]:
        f = Filters(
            org=org, group=group, q=q, joined_from=joined_from, joined_to=joined_to, updated_from=updated_from,
            updated_to=updated_to, field_key=field_key, field_value=field_value, incomplete=incomplete,
            not_printed=not_printed, ready_not_printed=ready_not_printed, approval=approval, review=review,
            shortlisted_by=shortlisted_by,
        )  # fmt: skip
        rows = await _rows(db, scope, f, sort, direction)
        start = (page - 1) * per_page
        gmatch: dict[str, Any] = {"org_id": scope.org_id} if scope.org_id else {}
        if scope.group_ids is not None:
            gmatch["_id"] = {"$in": scope.group_ids}
        if org:
            gmatch["org_id"] = org
        if group:
            gmatch["_id"] = group
        fields: dict[str, dict[str, Any]] = {}
        for g in await db[ORG_GROUPS].find(gmatch, {"custom_fields": 1}).to_list(None):
            for d in g.get("custom_fields", []):
                fields.setdefault(d["key"], d)
        return {
            "total": len(rows),
            "page": page,
            "perPage": per_page,
            "rows": [row_out(r) for r in rows[start : start + per_page]],
            "fields": list(fields.values()),
            "role": scope.role,
        }

    @router.get("/shared-resumes/{membership_id}")
    async def shared_resume(membership_id: str, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        rows = await _selected(db, scope, [membership_id], with_data=True)
        if not rows:
            raise NOT_FOUND
        data = scope.audit_data(_orgs(rows), count=1)
        await audit(db, scope.actor_id, "view", target=membership_id, data=data, ip=_ip(request))
        brand = (await brands_for(db, [rows[0]["group_id"]])).get(rows[0]["group_id"])
        return {**row_out(rows[0]), "data": printable(rows[0]), "brand": brand}

    @router.post("/shared-resumes/export.csv")
    async def export_csv(
        body: Filters,
        request: Request,
        db: DB,
        scope: ScopeDep,
        sort: str = "name",
        direction: Literal["asc", "desc"] = Query("asc", alias="dir"),
    ) -> Response:
        scope.require("export")
        await _limit(db, f"org-export:{scope.actor_id}", EXPORT_RULES)
        rows = await _rows(db, scope, body, sort, direction, export=True)
        defs: dict[str, str] = {}
        for r in rows:
            for d in r["field_defs"]:
                defs.setdefault(d["key"], d["label"])
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([*CSV_HEAD, *defs.values(), *CSV_TAIL])
        safe = csv_safe  # no spreadsheet formulas: a leading =, +, -, @, tab or carriage return is quoted
        for r in rows:
            head = (
                r["name"],
                r["email"],
                r["phone"],
                r["org_name"],
                r["group_name"],
                *[r["fields"].get(k, "") for k in defs],
            )
            w.writerow(
                [safe(plain(x)) for x in head]  # never a bold marker in the sheet
                + [
                    safe(r["courses"]),
                    r["completeness"],
                    APPROVAL_TEXT[r["approval"]],
                    REVIEW_TEXT[r["review_status"]],
                    r["updated_at"].astimezone(IST).strftime("%Y-%m-%d %H:%M") if r["updated_at"] else "",
                    r["printed_at"].astimezone(IST).strftime("%Y-%m-%d") if r["printed_at"] else "No",
                ]
            )
        filters = body.model_dump(exclude_defaults=True, exclude={"q"})
        data = scope.audit_data(_orgs(rows), count=len(rows), filters=filters)
        await audit(db, scope.actor_id, "export_csv", data=data, ip=_ip(request))
        return Response(
            CSV_BOM + buf.getvalue(),  # the BOM makes Excel open Telugu / Hindi names as UTF-8
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="nm7-shared-resumes.csv"'},
        )

    @router.post("/shared-resumes/exports", status_code=201)
    async def start_export(body: ExportIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Starts a print / ZIP / single download: the ordered list of resumes and the file names (audited)."""
        scope.require("export" if body.kind == "export_zip" else "print")
        await _limit(db, f"org-export:{scope.actor_id}", EXPORT_RULES)
        rows = await _rows(db, scope, body.filters, body.sort, body.direction, export=True)
        if body.ids is not None:
            wanted = set(body.ids)
            rows = [r for r in rows if r["membership_id"] in wanted]
        if not rows:
            raise ApiError(400, "nothing_selected", "No shared resumes match. Change the filters or the selection.")
        names = unique_names([file_name(r["roll"], r["name"], r["membership_id"]) for r in rows])
        job = {
            "_id": secrets.token_urlsafe(12),
            "kind": body.kind,
            "actor_id": scope.actor_id,
            "membership_ids": [r["membership_id"] for r in rows],
            "created_at": now(),
            "done_at": None,
        }
        await db[EXPORT_JOBS].insert_one(job)
        data = scope.audit_data(_orgs(rows), count=len(rows), memberships=job["membership_ids"][:200])
        await audit(db, scope.actor_id, body.kind, target=job["_id"], data=data, ip=_ip(request))
        groups = sorted({(r["org_name"], r["group_name"]) for r in rows})
        brands = await brands_for(db, [r["group_id"] for r in rows])  # groups printing in the org's template
        return {
            "job": job["_id"],
            "kind": body.kind,
            "total": len(rows),
            "items": [
                {
                    "membershipId": r["membership_id"],
                    "name": r["name"],
                    "roll": r["roll"],
                    "fileName": n,
                    "brand": r["group_id"] if r["group_id"] in brands else None,
                }
                for r, n in zip(rows, names, strict=True)
            ],
            "brands": brands,
            "cover": {
                "orgs": sorted({g[0] for g in groups}),
                "groups": [f"{o} · {g}" for o, g in groups],
                "count": len(rows),
            },
        }

    async def _job(db, job_id: str, scope: Scope) -> dict[str, Any]:
        j = await db[EXPORT_JOBS].find_one({"_id": job_id, "actor_id": scope.actor_id})
        if not j:
            raise ApiError(404, "not_found", "This export has expired. Please start it again.")
        return j

    @router.get("/shared-resumes/exports/{job_id}/data")
    async def export_data(
        job_id: str, db: DB, scope: ScopeDep, offset: int = Query(0, ge=0), limit: int = Query(BATCH, ge=1, le=BATCH)
    ) -> list[dict[str, Any]]:
        """One batch of the job's resumes, as the member prints them (hidden entries and private details removed).
        Re-checked against the scope and approval now: someone who left or was rejected since comes back empty."""
        j = await _job(db, job_id, scope)
        ids = j["membership_ids"][offset : offset + limit]
        rows = {r["membership_id"]: r for r in await _selected(db, scope, ids, approved_only=True, with_data=True)}
        return [{"membershipId": i, "data": printable(rows[i]) if i in rows else None} for i in ids]

    @router.post("/shared-resumes/exports/{job_id}/done")
    async def export_done(job_id: str, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """The browser finished the file: printed / ZIP'd resumes are marked printed (once per job)."""
        # claimed atomically: a double click (or two tabs) marks the job done and counts the prints once
        j = await db[EXPORT_JOBS].find_one_and_update(
            {"_id": job_id, "actor_id": scope.actor_id, "done_at": None}, {"$set": {"done_at": now()}}
        )
        if j is None:
            await _job(db, job_id, scope)  # 404 unless it exists (then: already done)
            return {"ok": True, "marked": 0}
        marked = 0
        if j["kind"] in ("print_bulk", "export_zip", "print"):
            r = await db[MEMBERSHIPS].update_many(
                {**scope.match(), "_id": {"$in": j["membership_ids"]}},
                {"$set": {"printed_at": now()}, "$inc": {"printed_count": 1}},
            )
            marked = r.modified_count
        return {"ok": True, "marked": marked}

    @router.post("/shared-resumes/unprint")
    async def unprint(body: IdsIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Mark as not printed (for a reprint). The print count stays."""
        scope.require("unprint")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = await _selected(db, scope, body.ids)
        ids = [r["membership_id"] for r in rows]
        if ids:
            await db[MEMBERSHIPS].update_many({"_id": {"$in": ids}}, {"$set": {"printed_at": None}})
        data = scope.audit_data(_orgs(rows), count=len(ids), memberships=ids[:200])
        await audit(db, scope.actor_id, "unprint", data=data, ip=_ip(request))
        return {"updated": len(ids)}

    @router.post("/shared-resumes/approval")
    async def approval(body: ApprovalIn, request: Request, db: DB, scope: ScopeDep) -> dict[str, Any]:
        scope.require("approve")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = await _memberships(db, scope, body.ids)  # also a pending member whose resume is gone
        ids = [r["membership_id"] for r in rows]
        state = "approved" if body.action == "approve" else "rejected"
        if ids:
            t = now()
            await db[MEMBERSHIPS].update_many(
                {"_id": {"$in": ids}}, {"$set": {"approval": state, "approved_by": scope.actor_id, "approved_at": t}}
            )
        data = scope.audit_data(_orgs(rows), count=len(ids), memberships=ids[:200])
        await audit(db, scope.actor_id, body.action, data=data, ip=_ip(request))
        return {"updated": len(ids)}

    @router.post("/shared-resumes/review")
    async def review(body: ReviewIn, request: Request, db: DB, mailer: MailerDep, scope: ScopeDep) -> dict[str, Any]:
        """None → Needs changes (with a note; the member is emailed) → Ready."""
        scope.require("review")
        note = body.note.strip()
        if body.status == "needs_changes" and not note:
            raise ApiError(400, "note_required", "Please write what needs to change (the member sees this note).")
        await _limit(db, f"org-action:{scope.actor_id}", ACTION_RULES)
        rows = [r for r in await _selected(db, scope, body.ids) if r["approval"] != "rejected"]
        ids = [r["membership_id"] for r in rows]
        if ids:
            sets = {"review_status": body.status, "review_note": note if body.status == "needs_changes" else ""}
            await db[MEMBERSHIPS].update_many(
                {"_id": {"$in": ids}}, {"$set": {**sets, "reviewed_by": scope.actor_id, "reviewed_at": now()}}
            )
        emailed, skipped = 0, {}
        if body.status == "needs_changes" and rows:
            make = lambda r: emails.needs_changes(  # noqa: E731
                r["email"], r["name"] or "there", r["org_name"], r["group_name"], note, _stop_url(r["membership_id"])
            )
            emailed, skipped = await _email_members(db, mailer, rows, make, gap=False)  # an explicit note: no day gap
        data = scope.audit_data(_orgs(rows), count=len(ids), status=body.status, emailed=emailed, memberships=ids[:200])
        await audit(db, scope.actor_id, "review", data=data, ip=_ip(request))
        return {"updated": len(ids), "emailed": emailed, "skipped": sum(skipped.values()), "reasons": skipped}

    @router.post("/shared-resumes/remind")
    async def remind(body: RemindIn, request: Request, db: DB, mailer: MailerDep, scope: ScopeDep) -> dict[str, Any]:
        """Email a segment of one group (incomplete / needs changes / not updated since a day) or chosen members.
        At most one reminder per member per day (IST), 3 sends per group per day and 500 emails per send."""
        scope.require("remind")
        if body.segment == "selected":
            if not body.ids:
                raise ApiError(400, "nothing_selected", "Choose the members to remind.")
            rows = await _selected(db, scope, body.ids)
        else:
            if not body.group:
                raise ApiError(400, "group_required", "Choose a group to remind.")
            await scope.group(db, body.group)
            rows = await shared_rows(db, {**scope.match(), "group_id": body.group})
            if body.segment == "incomplete":
                rows = [r for r in rows if r["completeness"] < COMPLETE]
            elif body.segment == "needs_changes":
                rows = [r for r in rows if r["review_status"] == "needs_changes"]
            else:
                if not body.since:
                    raise ApiError(400, "since_required", "Choose the date: members not updated since then.")
                since = _day(body.since.isoformat())
                rows = [r for r in rows if not r["updated_at"] or r["updated_at"] < since]
        rows = [r for r in rows if r["approval"] != "rejected"]
        groups = sorted({r["group_id"] for r in rows})
        day = ist_day()
        for gid in groups:  # check every group first; the send counts against each once it went out
            await rate_limit.check(
                db, f"remind-group:{gid}:{day}", GROUP_REMIND_RULES,
                "This group already had 3 reminder sends today. Please try again tomorrow.",
            )  # fmt: skip
        note = body.note.strip()
        make = lambda r: emails.reminder(  # noqa: E731
            r["email"], r["name"] or "there", r["org_name"], r["group_name"], r["missing"], note,
            _stop_url(r["membership_id"]),
        )  # fmt: skip
        sent, skipped = await _email_members(db, mailer, rows, make)
        if sent or not skipped["failed"]:  # a send that failed outright doesn't use up one of the group's 3 a day
            for gid in groups:
                await rate_limit.record(db, f"remind-group:{gid}:{day}")
        data = scope.audit_data(_orgs(rows), segment=body.segment, groups=groups, sent=sent, skipped=skipped)
        await audit(db, scope.actor_id, "remind", data=data, ip=_ip(request))
        return {"sent": sent, "skipped": sum(skipped.values()), "reasons": skipped}

    @router.get("/groups/{group_id}/dashboard")
    async def group_dashboard(group_id: str, db: DB, scope: ScopeDep) -> dict[str, Any]:
        """Everything the group dashboard shows, from one membership query (+ the users / resumes it joins)."""
        g = await scope.group(db, group_id)
        rows = await shared_rows(db, {**scope.match(), "group_id": group_id})
        return {"group": group_out(g, await active_members(db, group_id)), "role": scope.role, **dashboard(rows)}
