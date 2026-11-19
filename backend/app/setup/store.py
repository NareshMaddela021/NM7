"""One place for each person's setup answers and progress, per role (P1 quick start; P2's checklist builds on it).

Stored on the account: users.setup[role] = {answers, step, skipped, started_at, done_at, updated_at, edu_pid}.
Additive: older accounts simply have no `setup`, nothing is rewritten at startup.

Answers are mapped onto the fields the site already has, never duplicating them and never overwriting what the
person already has there:
  job seeker   job → users.target_role and the job alert's roles; cities → users.cities and the job alert's cities
               (Remote → the alert's "remote" when the alert is new); experience → users.level and the job alert's
               experience; Fresher's college / course / passing year → the Job Profile's education
  student      college / course / year → the Job Profile's education
  expert       expertise → the expert application's domains (while it can be edited)
The job alert stays as the person left it (off by default): turning email alerts on is always their own choice.

Answers already found in existing data (the Job Profile, the job alert, a college group joined, the expert
application, the Trust age check) count as answered, so existing users are never asked again.
"""

import secrets
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core.db import EXPERT_PROFILES, JOB_PROFILES, MEMBERSHIPS, ORGANIZATIONS, USERS
from app.core.time import now
from app.me.service import ms
from app.setup import steps as S

# the Job Profile's experience levels (frontend pages/builder/schema.js EXP_LEVELS) → a quick-start band
LEVEL_BAND = {"fresher": "fresher", "junior": "1_3", "mid": "3_5", "senior": "5_8", "lead": "8_plus"}
ALERT_BANDS = {"8_plus": ["8_12", "12_15", "15_plus"]}


def _first_word(v: str) -> str:
    return (v or "").strip().lower().split(" ")[0].split("/")[0]


def _band_from_text(v: str) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    for label, band in S.EXPERIENCE_LABEL.items():
        if v == band:
            return label
    return LEVEL_BAND.get(_first_word(v))


def _alert_band(levels: list[str]) -> str | None:
    if not levels:
        return None
    if set(levels) >= {"8_12"}:
        return "8_plus"
    return levels[0] if levels[0] in S.EXPERIENCE else None


def _year(to: str) -> int | None:
    t = str(to or "")[:4]
    return int(t) if t.isdigit() else None


async def _job_profile(db, uid: str) -> dict[str, Any]:
    doc = await db[JOB_PROFILES].find_one({"_id": uid}, {"data": 1})
    return (doc or {}).get("data") or {}


def _profile_has_work(p: dict[str, Any]) -> bool:
    """Something "Fill your profile faster" would have added: a job, internship, project, certificate or summary."""
    if any(p.get(k) for k in ("exp", "intern", "proj", "certs")):
        return True
    return any(len(str((s or {}).get("text", "")).strip()) > 40 for s in p.get("summaries") or [])


async def _college_joined(db, uid: str) -> str:
    m = await db[MEMBERSHIPS].find_one({"user_id": uid, "left_at": None}, {"org_id": 1}, sort=[("joined_at", -1)])
    if not m:
        return ""
    o = await db[ORGANIZATIONS].find_one({"_id": m["org_id"], "type": {"$in": ["college", "institute"]}}, {"name": 1})
    return (o or {}).get("name", "")


async def existing(db, u: dict[str, Any], role: str, switches: dict[str, bool]) -> dict[str, Any]:
    """The answers the person's existing data already gives (shown pre-filled; those steps are skipped)."""
    out: dict[str, Any] = {}
    uid = u["_id"]
    if role in ("jobseeker", "student"):
        jp = await _job_profile(db, uid)
        personal = jp.get("personal") or {}
        edu = next((e for e in jp.get("edu") or [] if (e or {}).get("institution") or (e or {}).get("degree")), None)
        if edu:
            if edu.get("institution"):
                out["college"] = edu["institution"]
            if edu.get("degree"):
                out["course"] = edu["degree"]
            if y := _year(edu.get("to", "")):
                out["year"] = y
        if role == "student" and not out.get("college") and (name := await _college_joined(db, uid)):
            out["college"] = name
        if _profile_has_work(jp):
            out["faster"] = "used"
        if role == "jobseeker":
            alert = u.get("job_alert") or {}
            job = u.get("target_role") or next(iter(alert.get("roles") or []), "") or personal.get("headline", "")
            if job:
                out["job"] = job[:80]
            cities = alert.get("cities") or [c.strip() for c in (u.get("cities") or "").split(",") if c.strip()]
            if not cities and personal.get("location"):
                cities = [personal["location"]]
            if cities:
                out["cities"] = cities[: S.MAX_CITIES]
            band = _alert_band(alert.get("experience") or []) or _band_from_text(u.get("level", ""))
            band = band or _band_from_text(personal.get("level", ""))
            if band:
                out["experience"] = band
        if role == "student" and switches.get("trust"):
            from app.trust import age

            st = await age.state(db, uid)
            if st["checked"]:
                parent = (st.get("parent") or {}).get("status")
                out["age"] = (
                    ("parent_ok" if st.get("parentOk") else "parent_asked" if parent == "pending" else "minor")
                    if st["minor"]
                    else "adult"
                )
    if role == "expert":
        doc = await db[EXPERT_PROFILES].find_one({"_id": uid}, {"profile": 1})
        prof = (doc or {}).get("profile") or {}
        domains = [d for d in (prof.get("expertise") or {}).get("domains") or [] if d in S.DOMAINS]
        if domains:
            out["expertise"] = domains[:5]
        proof = prof.get("proof") or {}
        if proof.get("experience") or proof.get("linkedin"):
            out["faster"] = "used"
    return out


async def switches_for(db, uid: str) -> dict[str, bool]:
    """Hidden switches: steps and choices for features whose switch is off are left out for normal users (testers,
    demo people and an admin's personas see them, as the switches themselves decide)."""
    from app.hire.vetting import access as vetting
    from app.trust import access as trust

    return {"trust": await trust.for_user(db, uid), "vetting": await vetting.for_user(db, uid)}


def state_out(role: str, saved: dict[str, Any], found: dict[str, Any], switches: dict[str, bool]) -> dict[str, Any]:
    stored = saved.get("answers") or {}
    answers = {**found, **stored}
    steps = S.steps_for(role, answers, switches)
    skipped = [s for s in saved.get("skipped") or [] if s in S.ALL_STEPS[role]]
    done = bool(saved.get("done_at"))
    at = S.resume(steps, answers, skipped, saved.get("step"), done)
    pending = [s for s in steps if not S.answered(s, answers) and s not in skipped]
    return {
        "role": role,
        "steps": steps,
        "answers": answers,
        "prefilled": sorted(k for k in found if k not in stored),
        "skipped": skipped,
        "step": at,
        "savedStep": saved.get("step"),
        "pending": len(pending),
        "done": done,
        "startedAt": ms(saved.get("started_at")),
        "doneAt": ms(saved.get("done_at")),
        "switches": switches,
    }


# ---------- mapping answers onto existing fields (never overwriting) ----------


async def _map_jobseeker(db, u: dict[str, Any], a: dict[str, Any], ours: bool) -> dict[str, Any]:
    """ours: the job alert was made by the quick start (and is still off), so its "remote" may follow the answer."""
    from app.jobs.alerts import DEFAULT

    sets: dict[str, Any] = {}
    if a.get("job") and not u.get("target_role"):
        sets["target_role"] = a["job"]
    if a.get("cities") and not u.get("cities"):
        sets["cities"] = ", ".join(a["cities"])
    if a.get("experience") and not u.get("level"):
        sets["level"] = S.EXPERIENCE_LABEL[a["experience"]]
    had = u.get("job_alert")
    alert = {**DEFAULT, **(had or {})}
    changed = False
    if a.get("job") and not alert.get("roles"):
        alert["roles"], changed = [a["job"]], True
    if a.get("cities") and not alert.get("cities"):
        alert["cities"], changed = list(a["cities"]), True
    if a.get("experience") and not alert.get("experience"):
        alert["experience"], changed = ALERT_BANDS.get(a["experience"], [a["experience"]]), True
    if (
        a.get("remote") is not None
        and (had is None or (ours and not alert.get("on")))
        and alert["remote"] != a["remote"]
    ):
        alert["remote"], changed = bool(a["remote"]), True
    if changed:
        sets["job_alert"] = alert  # "on" stays as it was: email alerts are turned on only by the person
    return sets


async def _map_education(db, uid: str, a: dict[str, Any], pid: str | None) -> str | None:
    """College / course / passing year into the Job Profile's education: a new entry only when it has none; later
    answers fill only the empty fields of that same entry. Returns the entry's pid."""
    fields = {"institution": a.get("college") or "", "degree": a.get("course") or "",
              "to": f"{a['year']}-05" if a.get("year") else ""}  # fmt: skip
    if not any(fields.values()):
        return pid
    doc = await db[JOB_PROFILES].find_one({"_id": uid}, {"data": 1, "version": 1, "privacy": 1})
    data = (doc or {}).get("data") or {}
    edu = list(data.get("edu") or [])
    t = now()
    if edu:
        i = next((n for n, e in enumerate(edu) if pid and (e or {}).get("pid") == pid), None)
        if i is None:
            return pid  # they have their own education: never touched
        e = dict(edu[i])
        fill = {k: v for k, v in fields.items() if v and not e.get(k)}
        if not fill:
            return pid
        edu[i] = {**e, **fill, "pu": ms(t)}
    else:
        pid = f"p{secrets.token_hex(6)}"
        edu = [{"institution": fields["institution"], "degree": fields["degree"], "field": "", "from": "",
                "to": fields["to"], "current": False, "grade": "", "links": [], "pid": pid, "pu": ms(t)}]  # fmt: skip
    if doc is None:
        from app.profile.service import privacy_of

        try:
            await db[JOB_PROFILES].insert_one(
                {"_id": uid, "data": {"edu": edu}, "privacy": privacy_of(None), "version": 1, "updated_at": t}
            )
        except DuplicateKeyError:  # their first save at the same moment: theirs wins
            return None
    else:  # the version moves on, so an open Job Profile tab reloads instead of saving over it
        await db[JOB_PROFILES].update_one(
            {"_id": uid, "version": doc.get("version", 0)},
            {"$set": {"data.edu": edu, "updated_at": t}, "$inc": {"version": 1}},
        )
    return pid


async def _map_expert(db, uid: str, a: dict[str, Any]) -> None:
    from app.experts.service import EDITABLE, seal_payout

    if not a.get("expertise"):
        return
    doc = await db[EXPERT_PROFILES].find_one({"_id": uid}, {"status": 1, "profile.expertise": 1})
    if doc and doc.get("status") not in EDITABLE:
        return
    if ((doc or {}).get("profile") or {}).get("expertise", {}).get("domains"):
        return
    t = now()
    await db[EXPERT_PROFILES].update_one(
        {"_id": uid},
        {
            "$set": {"profile.expertise.domains": list(a["expertise"]), "updated_at": t},
            "$setOnInsert": {
                "status": "draft",
                "note": "",
                "test": None,
                "created_at": t,
                "payout_enc": seal_payout({}),
            },
        },
        upsert=True,
    )


async def save(db, u: dict[str, Any], role: str, new: dict[str, Any], skip: list[str], step: str | None,
               done: bool) -> dict[str, Any]:  # fmt: skip
    """Saves one change of a role's quick start and maps the answers onto the existing fields."""
    uid = u["_id"]
    saved = dict((u.get("setup") or {}).get(role) or {})
    answers = dict(saved.get("answers") or {})
    for k, v in new.items():
        if v is None or v == []:
            answers.pop(k, None)
        else:
            answers[k] = v
    skipped = [s for s in saved.get("skipped") or [] if not S.answered(s, answers)]
    skipped += [s for s in skip if s not in skipped and not S.answered(s, answers)]
    t = now()
    rec: dict[str, Any] = {**saved, "answers": answers, "skipped": skipped, "updated_at": t}
    rec.setdefault("started_at", t)
    if step:
        rec["step"] = step
    if done and not saved.get("done_at"):
        rec["done_at"] = t
    sets: dict[str, Any] = {f"setup.{role}": rec}
    if role == "jobseeker":
        sets |= await _map_jobseeker(db, u, answers, bool(saved.get("alert_made")))
        if "job_alert" in sets and not u.get("job_alert"):
            rec["alert_made"] = True
        if answers.get("experience") == "fresher":
            rec["edu_pid"] = await _map_education(db, uid, answers, saved.get("edu_pid"))
    elif role == "student":
        rec["edu_pid"] = await _map_education(db, uid, answers, saved.get("edu_pid"))
    else:
        await _map_expert(db, uid, answers)
    sets["updated_at"] = t
    await db[USERS].update_one({"_id": uid}, {"$set": sets})
    return rec
