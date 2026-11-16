# ruff: noqa: E501
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
from pymongo import UpdateMany, UpdateOne
from pymongo.errors import BulkWriteError

from app.core.db import SKILL_QUESTIONS, VETTING_BANKS
from app.core.time import now
from app.hire.vetting.roles import BY_TEST, ROLES
from app.hire.vetting.validate import BANKS, validate

log = logging.getLogger(__name__)
_FILES: dict[str, dict[str, Any]] | None = None  # the bank files, read and validated once per process


def qid(bank_id: str) -> ObjectId:
    """A fixed id for a bank question, from its bank id (so loading twice never adds it twice)."""
    return ObjectId(hashlib.sha1(f"v2|{bank_id}".encode()).hexdigest()[:24])


def read_banks(fresh: bool = False) -> dict[str, dict[str, Any]]:
    """{slug: bank} for every bank file that passes the validator (a file with problems is skipped and logged).
    Read once per process: the files only change with a deploy."""
    global _FILES
    if _FILES is not None and not fresh:
        return _FILES
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
    _FILES = out
    return out


def _tr(item: dict[str, Any]) -> dict[str, Any]:
    return {lang: item[lang] for lang in ("te", "hi") if isinstance(item.get(lang), dict)}


async def ensure_banks(db, *, force: bool = False) -> dict[str, int]:
    """Load the bank files whose version is newer than the stored one. Returns {slug: questions added or updated}."""
    done: dict[str, int] = {}
    t = now()
    stored = {
        b["_id"]: b async for b in db[VETTING_BANKS].find({}, {"version": 1, "rubric_version": 1, "rubric_edited": 1})
    }
    for slug, bank in read_banks(fresh=force).items():
        role = next(r for r in ROLES if r["slug"] == slug)
        have = stored.get(slug)
        if have and have.get("version", 0) >= bank["version"]:
            continue  # one small query per request when nothing is new
        docs = {
            qid(q["id"]): {
                "skill": role["test"], "role": role["role"], "slug": slug, "bank_id": q["id"], "topic": q["topic"],
                "difficulty": q["difficulty"], "kind": q["kind"], "question": q["q"], "options": q["options"],
                "answer": q["answer"], "tr": _tr(q), "needs_review": bool(_tr(q)), "version": bank["version"],
                "updated_at": t,
            }
            for q in bank["questions"]
        }  # fmt: skip
        old = {d["_id"]: d async for d in db[SKILL_QUESTIONS].find({"_id": {"$in": list(docs)}}, {"edited": 1})}
        new = [{"_id": k, **v, "active": True, "seed": True, "created_at": t} for k, v in docs.items() if k not in old]
        ups = [
            UpdateOne({"_id": k}, {"$set": docs[k]}) for k, d in old.items() if not d.get("edited")
        ]  # Admin's wording wins
        if new:
            try:
                await db[SKILL_QUESTIONS].insert_many(new, ordered=False)
            except BulkWriteError:  # another request loaded the same bank at the same moment
                pass
        if ups:
            await db[SKILL_QUESTIONS].bulk_write(ups, ordered=False)
        n = len(new) + len(ups)
        retag = [
            UpdateMany(
                {"skill": role["test"], "question": text, "edited": {"$ne": True}},
                {
                    "$set": {
                        "topic": v["topic"],
                        "slug": slug,
                        "kind": "mcq",
                        "tr": _tr(v),
                        "needs_review": bool(_tr(v)),
                        "version": bank["version"],
                    }
                },
            )
            for text, v in (bank.get("existing") or {}).items()
        ]  # fmt: skip  (the H3 questions: topic and translations)
        if retag:
            n += (await db[SKILL_QUESTIONS].bulk_write(retag, ordered=False)).modified_count
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
