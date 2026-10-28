"""Eligibility filters per company (feature `eligibility`: Drive and Campus plans).

Rules a company can set on a drive day: CGPA (minimum), active backlogs (maximum), branch, passing year, 10th %
and 12th % (optional). There are deliberately no rules on gender, religion, caste or any other personal attribute —
the model has no such fields.

Students declare their CGPA, active backlogs, passing year and 10th / 12th % in their college profile
(/api/me/academic/{membership_id}); a coordinator can tick "verified". Changing a number clears the tick.

Staff (/api/org/{org_id}/drives/{drive_id}/companies/{company_id}/…):
  GET  eligibility                    the rules and every student: eligible or not, with the reasons ("CGPA 6.4 < 7.0")
  PUT  rules                          {cgpaMin, backlogsMax, branches, years, tenthMin, twelfthMin}
  PUT  exceptions/{membership_id}     {note}: include a student who doesn't meet a rule · DELETE removes it
  POST share                          {inviteId}: the eligible list becomes what that recruiter invite shows (only
                                      students who allowed recruiter sharing are ever shown, as before)
  PUT  /api/org/{org_id}/academic/{membership_id}/verify  {verified}
The drive's slots for the company take students from the eligible list (drives.audience_for).
"""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import Field

from app.auth.deps import CustomerAuth
from app.college.common import log, members_of, org_with, public, scoped_groups
from app.core.db import DB, DRIVES, MEMBERSHIPS, ORGANIZATIONS, RECRUITER_INVITES
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, OrgScope, features_of

staff = APIRouter(prefix="/api/org/{org_id}", tags=["eligibility"])
me = APIRouter(prefix="/api/me/academic", tags=["eligibility"])

FIELDS = ("cgpa", "backlogs", "year", "tenth", "twelfth")


class AcademicIn(CamelModel):
    cgpa: float | None = Field(None, ge=0, le=10)
    backlogs: int | None = Field(None, ge=0, le=60)  # active backlogs
    year: int | None = Field(None, ge=1990, le=2100)  # passing year
    tenth: float | None = Field(None, ge=0, le=100)
    twelfth: float | None = Field(None, ge=0, le=100)


class RulesIn(CamelModel):
    cgpa_min: float | None = Field(None, ge=0, le=10)
    backlogs_max: int | None = Field(None, ge=0, le=60)
    branches: list[str] = Field(default_factory=list, max_length=50)
    years: list[int] = Field(default_factory=list, max_length=10)
    tenth_min: float | None = Field(None, ge=0, le=100)
    twelfth_min: float | None = Field(None, ge=0, le=100)


class ExceptionIn(CamelModel):
    note: str = Field(min_length=3, max_length=200)


class ShareIn(CamelModel):
    invite_id: str = Field(max_length=64)


class VerifyIn(CamelModel):
    verified: bool


def _num(v: float | None) -> str:
    return f"{v:g}" if v is not None else ""


def check(rules: dict[str, Any], a: dict[str, Any], branch: str) -> list[str]:
    """Why a student doesn't meet the rules (empty: eligible). Missing numbers count as not meeting a rule."""
    out = []
    if rules.get("cgpa_min") is not None:
        if a.get("cgpa") is None:
            out.append("CGPA not given")
        elif a["cgpa"] < rules["cgpa_min"]:
            out.append(f"CGPA {_num(a['cgpa'])} < {rules['cgpa_min']:.1f}")
    if rules.get("backlogs_max") is not None:
        if a.get("backlogs") is None:
            out.append("Backlogs not given")
        elif a["backlogs"] > rules["backlogs_max"]:
            out.append(f"Backlogs {a['backlogs']} > {rules['backlogs_max']}")
    if rules.get("branches") and branch.lower() not in {b.lower() for b in rules["branches"]}:
        out.append(f"Branch {branch or '—'} not in {', '.join(rules['branches'])}")
    if rules.get("years") and a.get("year") not in rules["years"]:
        out.append(f"Passing year {a.get('year') or '—'} not in {', '.join(map(str, rules['years']))}")
    for k, label in (("tenth", "10th"), ("twelfth", "12th")):
        lim = rules.get(f"{k}_min")
        if lim is not None:
            if a.get(k) is None:
                out.append(f"{label} % not given")
            elif a[k] < lim:
                out.append(f"{label} {_num(a[k])}% < {_num(lim)}%")
    return out


def eligible_people(comp: dict[str, Any], people: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The company's eligible students among `people` (everyone when it has no rules)."""
    rules = comp.get("rules")
    if not rules:
        return people
    exc = comp.get("exceptions") or {}
    return [p for p in people if p["id"] in exc or not check(rules, p["_m"].get("academic") or {}, p["branch"])]


def rules_out(r: dict[str, Any] | None) -> dict[str, Any]:
    r = r or {}
    return {
        "cgpaMin": r.get("cgpa_min"),
        "backlogsMax": r.get("backlogs_max"),
        "branches": r.get("branches", []),
        "years": r.get("years", []),
        "tenthMin": r.get("tenth_min"),
        "twelfthMin": r.get("twelfth_min"),
    }


def academic_out(a: dict[str, Any] | None) -> dict[str, Any]:
    a = a or {}
    return {
        **{k: a.get(k) for k in FIELDS},
        "verified": bool(a.get("verified_at")),
        "verifiedAt": ms(a.get("verified_at")),
    }


async def _drive_company(db, scope, drive_id: str, company_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    from app.college.drives import _drive

    d = await _drive(db, scope, drive_id)
    comp = next((c for c in d["companies"] if c["id"] == company_id), None)
    if not comp:
        raise NOT_FOUND
    return d, comp


async def _people(db, scope, d: dict[str, Any]) -> list[dict[str, Any]]:
    gids = [g for g in d["group_ids"] if scope.group_ids is None or g in scope.group_ids]
    return await members_of(db, await scoped_groups(db, scope, gids))


async def _set_company(
    db, drive_id: str, company_id: str, sets: dict[str, Any], unset: dict[str, Any] | None = None
) -> None:
    upd: dict[str, Any] = {"$set": {f"companies.$.{k}": v for k, v in sets.items()}}
    if unset:
        upd["$unset"] = {f"companies.$.{k}": "" for k in unset}
    await db[DRIVES].update_one({"_id": drive_id, "companies.id": company_id}, upd)


# ---------- staff ----------
@staff.get("/drives/{drive_id}/companies/{company_id}/eligibility")
async def eligibility(drive_id: str, company_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "eligibility")
    d, comp = await _drive_company(db, scope, drive_id, company_id)
    rules = comp.get("rules") or {}
    exc = comp.get("exceptions") or {}
    rows = []
    for p in await _people(db, scope, d):
        a = p["_m"].get("academic") or {}
        reasons = check(rules, a, p["branch"]) if rules else []
        rows.append(
            {
                **public(p),
                "academic": academic_out(a),
                "reasons": reasons,
                "exception": exc.get(p["id"], {}).get("note"),
                "eligible": not reasons or p["id"] in exc,
                "recruiterOk": bool(p["_m"].get("recruiter_opt_in")) and p["_m"].get("approval") == "approved",
            }
        )
    rows.sort(key=lambda r: (not r["eligible"], r["roll"] or "~", r["name"].lower()))
    invites = [
        {
            "id": i["_id"],
            "company": i["company"],
            "shared": bool(
                i.get("member_ids") is not None and (i.get("eligible_from") or {}).get("company") == company_id
            ),
        }
        async for i in db[RECRUITER_INVITES]
        .find({"org_id": scope.org_id, "revoked_at": None}, {"company": 1, "member_ids": 1, "eligible_from": 1})
        .sort("created_at", -1)
        .limit(50)
    ]
    return {
        "company": {"id": comp["id"], "name": comp["name"]},
        "rules": rules_out(rules),
        "hasRules": bool(rules),
        "rows": rows,
        "counts": {"eligible": sum(r["eligible"] for r in rows), "total": len(rows)},
        "invites": invites
        if features_of(await db[ORGANIZATIONS].find_one({"_id": scope.org_id}))["recruiter_links"]
        else [],
    }


@staff.put("/drives/{drive_id}/companies/{company_id}/rules")
async def set_rules(
    drive_id: str, company_id: str, body: RulesIn, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    await org_with(db, scope, "eligibility")
    scope.require("manage")
    await _drive_company(db, scope, drive_id, company_id)
    rules = body.model_dump()
    rules["branches"] = list(dict.fromkeys(" ".join(b.split()) for b in rules["branches"] if b.strip()))
    rules = {k: v for k, v in rules.items() if v not in (None, [])}
    if rules:
        await _set_company(db, drive_id, company_id, {"rules": rules})
    else:
        await _set_company(db, drive_id, company_id, {}, unset={"rules": 1})
    await log(db, scope, request, "eligibility_rules", drive_id, company=company_id, rules=rules)
    return await eligibility(drive_id, company_id, db, scope)


@staff.put("/drives/{drive_id}/companies/{company_id}/exceptions/{membership_id}")
async def add_exception(
    drive_id: str, company_id: str, membership_id: str, body: ExceptionIn, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    await org_with(db, scope, "eligibility")
    scope.require("manage")
    d, _ = await _drive_company(db, scope, drive_id, company_id)
    if membership_id not in {p["id"] for p in await _people(db, scope, d)}:
        raise NOT_FOUND
    note = " ".join(body.note.split())
    await _set_company(
        db, drive_id, company_id, {f"exceptions.{membership_id}": {"note": note, "by": scope.actor_id, "at": now()}}
    )
    await log(
        db, scope, request, "eligibility_exception", drive_id, company=company_id, member=membership_id, note=note
    )
    return await eligibility(drive_id, company_id, db, scope)


@staff.delete("/drives/{drive_id}/companies/{company_id}/exceptions/{membership_id}")
async def remove_exception(
    drive_id: str, company_id: str, membership_id: str, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    await org_with(db, scope, "eligibility")
    scope.require("manage")
    await _drive_company(db, scope, drive_id, company_id)
    await _set_company(db, drive_id, company_id, {}, unset={f"exceptions.{membership_id}": 1})
    await log(
        db, scope, request, "eligibility_exception", drive_id, company=company_id, member=membership_id, removed=True
    )
    return await eligibility(drive_id, company_id, db, scope)


@staff.post("/drives/{drive_id}/companies/{company_id}/share")
async def share(
    drive_id: str, company_id: str, body: ShareIn, request: Request, db: DB, scope: OrgScope
) -> dict[str, Any]:
    """The eligible list becomes what this recruiter invite shows. The invite's own rules still apply on top: only
    approved students who allowed recruiter sharing, in groups that share with recruiters, are ever visible."""
    o = await org_with(db, scope, "eligibility")
    if not features_of(o)["recruiter_links"]:
        raise NOT_FOUND
    scope.require("manage")
    d, comp = await _drive_company(db, scope, drive_id, company_id)
    inv = await db[RECRUITER_INVITES].find_one({"_id": body.invite_id, "org_id": scope.org_id, "revoked_at": None})
    if not inv or (scope.group_ids is not None and not set(inv["group_ids"]) <= set(scope.group_ids)):
        raise NOT_FOUND
    people = eligible_people(comp, await _people(db, scope, d))
    ok = [
        p
        for p in people
        if p["_m"].get("recruiter_opt_in")
        and p["_m"].get("approval") == "approved"
        and p["group_id"] in inv["group_ids"]
    ]
    await db[RECRUITER_INVITES].update_one(
        {"_id": inv["_id"]},
        {
            "$set": {
                "member_ids": [p["id"] for p in ok],
                "eligible_from": {"drive": drive_id, "company": company_id, "at": now()},
            }
        },
    )
    await log(db, scope, request, "eligibility_share", drive_id, company=company_id, invite=inv["_id"], count=len(ok))
    return {"shared": len(ok), "eligible": len(people), "notOptedIn": len(people) - len(ok), "invite": inv["company"]}


@staff.put("/academic/{membership_id}/verify")
async def verify(membership_id: str, body: VerifyIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "eligibility")
    scope.require("manage")
    m = await db[MEMBERSHIPS].find_one({"_id": membership_id, **scope.match(), "left_at": None, "consent.given": True})
    if not m:
        raise NOT_FOUND
    if body.verified and not any((m.get("academic") or {}).get(k) is not None for k in FIELDS):
        raise ApiError(400, "nothing_to_verify", "The student hasn’t filled in their marks yet.")
    sets = (
        {"academic.verified_at": now(), "academic.verified_by": scope.actor_id}
        if body.verified
        else {"academic.verified_at": None, "academic.verified_by": None}
    )
    await db[MEMBERSHIPS].update_one({"_id": membership_id}, {"$set": sets})
    await log(db, scope, request, "academic_verify", membership_id, verified=body.verified)
    m = await db[MEMBERSHIPS].find_one({"_id": membership_id})
    return academic_out(m.get("academic"))


# ---------- students ----------
async def _mine(db, user_id: str, membership_id: str) -> dict[str, Any]:
    m = await db[MEMBERSHIPS].find_one({"_id": membership_id, "user_id": user_id, "left_at": None})
    if not m:
        raise NOT_FOUND
    return m


@me.get("/{membership_id}")
async def my_academic(membership_id: str, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    return academic_out((await _mine(db, auth.user.id, membership_id)).get("academic"))


@me.put("/{membership_id}")
async def set_my_academic(membership_id: str, body: AcademicIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    """Self-declared marks. A change to any number clears the coordinator's "verified" tick."""
    m = await _mine(db, auth.user.id, membership_id)
    old = m.get("academic") or {}
    new = body.model_dump()
    changed = any(old.get(k) != new[k] for k in FIELDS)
    sets = {f"academic.{k}": v for k, v in new.items()} | {"academic.updated_at": now()}
    if changed:
        sets |= {"academic.verified_at": None, "academic.verified_by": None}
    await db[MEMBERSHIPS].update_one({"_id": membership_id}, {"$set": sets})
    m = await db[MEMBERSHIPS].find_one({"_id": membership_id})
    return academic_out(m.get("academic"))
