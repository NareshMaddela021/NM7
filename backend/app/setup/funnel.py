# ruff: noqa: E501  (dense response shapes)
"""Profile setup P4: the setup funnel on Admin -> Daily report. For each role (job seekers, freshers, students, experts,
companies, colleges): how many reached each checklist step, and how many dropped off between one step and the next.

Counts only: no names, emails or ids leave this file. The same registry and detectors as the checklist itself
(registry.py, checklist.facts, teams.company_facts / college_facts), so a step means the same thing everywhere.

Cheap on purpose (Render has 2 GB):
- worked out inside the daily snapshot's heavy job (once a day from 06:30 IST, or "Refresh now"), stored in the
  snapshot (daily_reports.setupFunnel) and only read back by the report: nothing at startup, nothing per page view
- per role at most CAP people / companies / colleges, the newest first (the total is counted too, and the page says
  "the newest N" when it was capped), one at a time, and at most ROLE_SECONDS per role (then "partial")
- demo people, test users, an admin's personas (demo / test_user / owner_admin_id, made-up .invalid addresses),
  admins, deleted and disabled accounts, demo companies and demo colleges are never counted

The steps are the ones a normal person sees: a step behind a switch that is off for everyone is left out (named in
`hidden`). A step a person doesn't get at all (a fresher step for someone with experience, a college plan without
drives, under-18s and the ID step) is not counted for them ("shown" says for how many it was).

  done      finished this step (in any order)
  waiting   sent, waiting for review
  skipped   pressed "Skip for now" and it is still open
  reached   finished this step and every required step above it (required steps only): the funnel
  dropOff   reached the step above (or signed up, for the first) but not this one; dropPct is its share
"""

import logging
import re
import time
from datetime import datetime
from typing import Any

from app.core.db import COMPANIES, ORGANIZATIONS, USERS
from app.core.time import now
from app.setup import registry as R

log = logging.getLogger("nm7.setup")

CAP = 200
ROLE_SECONDS = 20.0
NE = {"$ne": True}
ROLE_ORDER = ("jobseeker", "fresher", "student", "expert", "company", "college")
LABELS = {
    "jobseeker": "Job seekers with experience",
    "fresher": "Freshers (job seekers)",
    "student": "Students",
    "expert": "Experts",
    "company": "Companies",
    "college": "Colleges",
}
START = {"company": "Signed up", "college": "Signed up"}
SWITCH_WORDS = {"vetting": "Vetting", "trust": "Vetting Trust", "hire": "Hire now", "payments": "Payments", "autoapply2": "Auto Apply 2.0"}  # fmt: skip

# real people only (the Daily report's other numbers leave the same accounts out)
PEOPLE = {"role": {"$ne": "admin"}, "demo": NE, "test_user": NE, "owner_admin_id": None, "deleted_at": None, "disabled_at": None,
          "email_lc": {"$not": re.compile(r"\.invalid$")}}  # fmt: skip
WHO = {
    "jobseeker": {"$or": [{"roles": "jobseeker"}, {"role": "customer", "roles": {"$nin": ["jobseeker", "student"]}}]},
    "student": {"roles": "student"},
    "expert": {"$or": [{"role": "expert"}, {"roles": "expert"}]},
}
USER_FIELDS = {"role": 1, "roles": 1, "setup": 1, "auto_apply": 1, "level": 1, "vetting_l3_until": 1, "created_at": 1}


def individual_roles(u: dict[str, Any]) -> list[str]:
    """The same rule as User.individual_roles, on a raw document (older accounts have no stored roles)."""
    if u.get("role") == "admin":
        return []
    have = set(u.get("roles") or []) & set(R.ROLES)
    if u.get("role") == "expert":
        have.add("expert")
    elif not have & {"jobseeker", "student"}:
        have.add("jobseeker")
    return [r for r in R.ROLES if r in have]


async def public_switches(db) -> dict[str, dict[str, bool]]:
    """What a normal person sees: each switch as it is for everyone (testers' early access is not counted)."""
    from app.autoapply import access as aa
    from app.site import get_site
    from app.wapay.settings import payments_on

    site = await get_site(db)
    pay = await payments_on(db)
    flags = {
        "vetting": bool(site["vetting"].get("public")),
        "trust": bool(site["trust"].get("public")),
        "hire": bool(site["hire"]["on"]),
        "payments": pay,
        "autoapply2": await aa.is_public(db),
    }
    return {k: {"on": v, "public": v} for k, v in flags.items()}


class Tally:
    """One role's numbers, filled in person by person."""

    def __init__(self, kind: str):
        self.kind = kind  # the registry's checklist (fresher uses the job seeker's)
        self.people = 0
        self.complete = 0
        self.quick = 0
        self.rows = {s.id: {"shown": 0, "done": 0, "waiting": 0, "skipped": 0, "reached": 0} for s in R.STEPS[kind]}

    def add(self, visible: list[R.Step], f: dict[str, Any], saved: dict[str, Any]) -> None:
        self.people += 1
        if saved.get("done_at"):
            self.quick += 1
        skipped = set(saved.get("check_skipped") or [])
        chain = True  # every required step above was done
        all_req = True
        for s in visible:
            st = s.detect(f)
            row = self.rows[s.id]
            row["shown"] += 1
            row["done"] += st == "done"
            row["waiting"] += st == "waiting"
            row["skipped"] += st == "todo" and s.id in skipped
            if s.required:
                if chain and st == "done":
                    row["reached"] += 1
                chain = chain and st == "done"
                all_req = all_req and st == "done"
        if all_req and any(s.required for s in visible):
            self.complete += 1

    def out(self, role: str, total: int, sw: dict[str, dict[str, bool]], partial: bool) -> dict[str, Any]:
        steps = []
        prev = self.people
        for s in R.STEPS[self.kind]:
            if s.switch and not sw.get(s.switch, {}).get("on"):
                continue  # hidden for everyone: listed in `hidden`
            if role == "jobseeker" and s.only == "fresher":
                continue
            r = self.rows[s.id]
            row = {
                "id": s.id,
                "title": s.title,
                "required": s.required,
                **{k: r[k] for k in ("shown", "done", "waiting", "skipped")},
            }
            if s.required:
                drop = max(prev - r["reached"], 0)
                row.update(reached=r["reached"], dropOff=drop, dropPct=round(100 * drop / prev) if prev else None)
                prev = r["reached"]
            else:
                row.update(reached=None, dropOff=None, dropPct=None)
            steps.append(row)
        return {
            "role": role,
            "label": LABELS[role],
            "start": START.get(role, "Signed up with this role"),
            "total": total,  # everyone with this role (not capped)
            "looked": self.people,  # the newest ones whose steps were worked out
            "capped": total > self.people,
            "partial": partial,
            "quickStart": self.quick if role in ("jobseeker", "fresher", "student", "expert") else None,
            "complete": self.complete,
            "steps": steps,
        }


async def _people(db, role: str, sw, deadline: float) -> tuple[list[Tally], int, bool]:
    from app.setup.checklist import facts, visible_steps

    q = {**PEOPLE, **WHO[role]}
    total = await db[USERS].count_documents(q)
    tallies = [Tally(role)] if role != "jobseeker" else [Tally("jobseeker"), Tally("jobseeker")]  # experienced, fresher
    partial = False
    async for u in db[USERS].find(q, USER_FIELDS).sort("created_at", -1).limit(CAP):
        if time.monotonic() > deadline:
            partial = True
            break
        if role not in individual_roles(u):
            continue
        try:
            f = await facts(db, u, role, sw)
        except Exception:  # noqa: BLE001  (an odd old account is skipped, never a failed snapshot)
            log.warning("setup funnel: skipped one %s", role)
            continue
        saved = (u.get("setup") or {}).get(role) or {}
        vis = [s for s, _ in visible_steps(role, f, sw)]
        (tallies[1] if role == "jobseeker" and f.get("fresher") else tallies[0]).add(vis, f, saved)
    return tallies, total, partial


async def _teams(db, kind: str, sw, deadline: float) -> tuple[Tally, int, bool]:
    from app.setup.checklist import visible_steps
    from app.setup.teams import college_facts, company_facts

    coll, q = (COMPANIES, {"demo": NE}) if kind == "company" else (ORGANIZATIONS, {"type": "college", "demo": NE})
    total = await db[coll].count_documents(q)
    t = Tally(kind)
    partial = False
    async for doc in db[coll].find(q).sort("created_at", -1).limit(CAP):
        if time.monotonic() > deadline:
            partial = True
            break
        try:
            f = await (company_facts(db, doc, None) if kind == "company" else college_facts(db, doc))
        except Exception:  # noqa: BLE001
            log.warning("setup funnel: skipped one %s", kind)
            continue
        t.add([s for s, _ in visible_steps(kind, f, sw)], f, doc.get("setup") or {})
    return t, total, partial


async def section(db, t: datetime | None = None) -> dict[str, Any]:
    """The Daily report's setup funnel (stored in the snapshot as setupFunnel)."""
    t = t or now()
    sw = await public_switches(db)
    roles: list[dict[str, Any]] = []
    for role in ("jobseeker", "student", "expert"):
        tallies, total, partial = await _people(db, role, sw, time.monotonic() + ROLE_SECONDS)
        if role == "jobseeker":
            fresh = tallies[1].people
            # the total split in the same proportion as the newest ones (only the newest are looked at)
            seen = tallies[0].people + fresh
            fresh_total = round(total * fresh / seen) if seen else 0
            roles.append(tallies[0].out("jobseeker", max(total - fresh_total, tallies[0].people), sw, partial))
            roles.append(tallies[1].out("fresher", max(fresh_total, fresh), sw, partial))
        else:
            roles.append(tallies[0].out(role, total, sw, partial))
    for kind in ("company", "college"):
        tally, total, partial = await _teams(db, kind, sw, time.monotonic() + ROLE_SECONDS)
        roles.append(tally.out(kind, total, sw, partial))
    hidden = sorted({f"{s.title} ({SWITCH_WORDS.get(s.switch, s.switch)} is off)" for steps in R.STEPS.values() for s in steps
                     if s.switch and not sw.get(s.switch, {}).get("on")})  # fmt: skip
    return {"at": int(t.timestamp() * 1000), "cap": CAP, "roles": roles, "hidden": hidden}
