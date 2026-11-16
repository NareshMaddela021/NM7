"""The V2 question banks in MongoDB: the bank files (banks/*.json, made once by the generator script and checked by
validate.py) are loaded into the H3 questions collection, each with a version. A newer file version adds its new
questions and updates the ones Admin hasn't edited; Admin's edits and switched-off questions are never overwritten.
Per role (vetting_banks): the version, topics, the practical task and the rubric with its history (Admin can edit the
rubric; each change is a new rubric version, and every graded task records the rubric version it was graded with).

Translations (Telugu, Hindi) come in marked "needs native review" until Admin ticks them reviewed.
"""

import hashlib
import json
import logging
from typing import Any

from bson import ObjectId

from app.core.db import SKILL_QUESTIONS, VETTING_BANKS
from app.core.time import now
from app.hire.vetting.roles import BY_TEST, ROLES
from app.hire.vetting.validate import BANKS, validate

log = logging.getLogger(__name__)
_LOADED: set[str] = set()  # "<db name>" once loaded in this process (a cheap check on every request otherwise)


def qid(bank_id: str) -> ObjectId:
    """A fixed id for a bank question, from its bank id (so loading twice never adds it twice)."""
    return ObjectId(hashlib.sha1(f"v2|{bank_id}".encode()).hexdigest()[:24])


def read_banks() -> dict[str, dict[str, Any]]:
    """{slug: bank} for every bank file that passes the validator (a file with problems is skipped and logged)."""
    out = {}
    for r in ROLES:
        f = BANKS / f"{r['slug']}.json"
        if not f.exists():
            continue
        bank = json.loads(f.read_text(encoding="utf-8"))
        problems = validate(bank, r)
        if problems:
            log.warning("vetting bank %s skipped: %d problems (first: %s)", r["slug"], len(problems), problems[0])
            continue
        out[r["slug"]] = bank
    return out


def _tr(item: dict[str, Any]) -> dict[str, Any]:
    return {lang: item[lang] for lang in ("te", "hi") if isinstance(item.get(lang), dict)}


async def ensure_banks(db, *, force: bool = False) -> dict[str, int]:
    """Load the bank files whose version is newer than the stored one. Returns {slug: questions added or updated}."""
    key = db.name
    if key in _LOADED and not force:
        return {}
    done: dict[str, int] = {}
    t = now()
    stored = {b["_id"]: b async for b in db[VETTING_BANKS].find({}, {"version": 1, "rubric_version": 1})}
    for slug, bank in read_banks().items():
        role = next(r for r in ROLES if r["slug"] == slug)
        have = stored.get(slug)
        if have and have.get("version", 0) >= bank["version"]:
            continue
        n = 0
        for q in bank["questions"]:
            doc = {
                "skill": role["test"], "role": role["role"], "slug": slug, "bank_id": q["id"], "topic": q["topic"],
                "difficulty": q["difficulty"], "kind": q["kind"], "question": q["q"], "options": q["options"],
                "answer": q["answer"], "tr": _tr(q), "needs_review": bool(_tr(q)), "version": bank["version"],
                "updated_at": t,
            }  # fmt: skip
            old = await db[SKILL_QUESTIONS].find_one({"_id": qid(q["id"])}, {"edited": 1})
            if old is None:
                await db[SKILL_QUESTIONS].insert_one(
                    {"_id": qid(q["id"]), **doc, "active": True, "seed": True, "created_at": t}
                )
            elif not old.get("edited"):  # Admin's wording wins; on/off is Admin's too ("active" isn't touched)
                await db[SKILL_QUESTIONS].update_one({"_id": old["_id"]}, {"$set": doc})
            else:
                continue
            n += 1
        for text, v in (bank.get("existing") or {}).items():  # the H3 questions: topic and translations
            r = await db[SKILL_QUESTIONS].update_many(
                {"skill": role["test"], "question": text, "edited": {"$ne": True}},
                {"$set": {"topic": v["topic"], "slug": slug, "kind": "mcq", "tr": _tr(v), "needs_review": bool(_tr(v)),
                          "version": bank["version"]}},
            )  # fmt: skip
            n += r.modified_count
        task = bank["task"]
        sets = {"version": bank["version"], "topics": bank["topics"], "test": role["test"], "loaded_at": t,
                "task": {k: v for k, v in task.items() if k != "rubric"}}  # fmt: skip
        if not have or not have.get("rubric_edited"):
            rv = int((have or {}).get("rubric_version") or 0) + 1
            sets.update(rubric=task["rubric"], rubric_version=rv)
            await db[VETTING_BANKS].update_one(
                {"_id": slug},
                {
                    "$set": sets,
                    "$push": {"rubric_history": {"version": rv, "rubric": task["rubric"], "at": t, "by": "bank"}},
                },
                upsert=True,
            )
        else:
            await db[VETTING_BANKS].update_one({"_id": slug}, {"$set": sets}, upsert=True)
        done[slug] = n
    _LOADED.add(key)
    if done:
        log.info("vetting banks loaded: %s", done)
    return done


async def bank_meta(db, test: str) -> dict[str, Any] | None:
    role = BY_TEST.get(test)
    return await db[VETTING_BANKS].find_one({"_id": role["slug"]}) if role else None


def localized(q: dict[str, Any], lang: str) -> tuple[str, list[str]]:
    """The question and options in `lang` when the question has that translation, else English."""
    tr = (q.get("tr") or {}).get(lang) if lang != "en" else None
    if tr and tr.get("q") and len(tr.get("options") or []) == len(q["options"]):
        return tr["q"], tr["options"]
    return q["question"], q["options"]
