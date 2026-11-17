"""The truth check of Auto Apply 2.0: a tailored version may reorder and rephrase, never invent.

Every line of the tailored output (rephrased bullets, the summary, the cover note, the ready answers, the skills
order) is compared with the ORIGINAL resume (plus the candidate's own profile answers, e.g. their notice period):

- every number, percentage and year must be on the resume (facts.problems, "5" is not backed by "2025");
- every skill, tool or certification it names must be on the resume (the skills dictionary);
- every name-like word (a company, a college, a product, a city) must be on the resume, or, only in the cover note
  and the answers, be a word of the job it is for (its title, company, city);
- no degree the resume doesn't have (B.Tech, MBA, PhD, "master's", ...);
- no job title word it doesn't have (Senior, Lead, Manager, Head, ...);
- no counting word it doesn't have ("ten projects", "a dozen", "two lakh");
- no phone number, email address or ID number.

A line that fails is removed (the original line stays, or the rules version is used). The whole tailored resume is
then checked once more against the original; if anything new is still there the AI version is BLOCKED and marked,
never sent: the rules version (the resume's own lines, only reordered) is used instead.
"""

import re
from typing import Any

from app.jobsearch import facts
from app.jobsearch import skills as dictionary

# degrees, written with or without dots ("B.Tech", "btech"); the short ones only with dots or in capitals
DEGREES = {
    "btech", "mtech", "mba", "pgdm", "phd", "bsc", "msc", "bca", "mca", "bcom", "mcom", "bba", "llb", "llm", "mbbs",
    "bpharm", "mpharm", "barch", "bdes", "mdes", "diploma", "iti", "bachelor", "bachelors", "master", "masters",
    "doctorate", "postgraduate", "postgraduation", "graduation",
}  # fmt: skip
SHORT_DEGREES = {"be", "me", "ba", "ma", "ca", "bed", "med", "ms", "bs"}
FAMILY = {  # "bachelor's" is backed by any bachelor's degree on the resume, "master's" by any master's
    "bachelor": {"btech", "be", "bsc", "bca", "bcom", "bba", "ba", "bs", "bpharm", "barch", "bdes", "bed", "llb",
                 "bachelor", "bachelors", "mbbs"},
    "master": {"mtech", "me", "msc", "mca", "mcom", "mba", "ma", "ms", "mpharm", "mdes", "med", "llm", "pgdm",
               "master", "masters"},
    "doctorate": {"phd", "doctorate"},
    "postgraduate": {"mtech", "me", "msc", "mca", "mcom", "mba", "ma", "ms", "pgdm", "postgraduate"},
}  # fmt: skip
TITLE_WORDS = {
    "senior", "sr", "lead", "manager", "head", "director", "principal", "chief", "architect", "vp", "president",
    "founder", "cofounder", "co-founder", "cto", "ceo", "cfo", "coo", "supervisor", "consultant", "officer",
    "specialist", "expert",
}  # fmt: skip
COUNT_WORDS = {
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty",
    "thirty", "fifty", "hundred", "hundreds", "thousand", "thousands", "dozen", "dozens", "lakh", "lakhs", "crore",
    "crores", "million", "millions", "billion", "double", "doubled", "triple", "tripled", "half",
}  # fmt: skip
TOKEN = re.compile(r"[A-Za-z][A-Za-z.\-']*")


def _norm(tok: str) -> str:
    return re.sub(r"[.\-']", "", tok).lower()


def _degrees(text: str) -> set[str]:
    out = set()
    for tok in TOKEN.findall(text):
        n = _norm(tok.rstrip("'s") if tok.lower().endswith("'s") else tok)
        if n in DEGREES:
            out.add(n)
        elif n in SHORT_DEGREES and ("." in tok or tok.isupper()):
            out.add(n)
    return out


def _words(text: str) -> set[str]:
    return {_norm(t) for t in TOKEN.findall(text)}


def _degree_backed(d: str, have: set[str]) -> bool:
    if d in have:
        return True
    fam = "bachelor" if d.startswith("bachelor") else "master" if d.startswith("master") else d
    if fam in ("graduation",):
        return bool(have)
    return bool(FAMILY.get(fam, set()) & have)


def problems(text: str, original: str, allowed: str = "", typed: str = "") -> list[str]:
    """What in `text` isn't backed by the original resume (`original` = facts.resume_text(data)). `allowed`: the
    job's own words (only for the cover note and answers); `typed`: the candidate's own profile answers."""
    found = list(facts.problems(text, original, allowed, typed))
    backing = f"{original}\n{typed}"
    have_deg = _degrees(backing)
    for d in sorted(_degrees(text)):
        if not _degree_backed(d, have_deg):
            found.append(f"the degree {d}")
    words = _words(text)
    known = _words(f"{backing}\n{allowed}")
    for w in sorted(words & TITLE_WORDS):
        if w not in known:
            found.append(f"the title word {w}")
    for w in sorted(words & COUNT_WORDS):
        if w not in _words(backing):
            found.append(f"the number word {w}")
    return list(dict.fromkeys(found))


def ok(text: str, original: str, allowed: str = "", typed: str = "") -> bool:
    return not problems(text, original, allowed, typed)


def skill_items(data: dict[str, Any]) -> list[str]:
    """Every item of the resume's skills lists, as written."""
    out: list[str] = []
    for g in data.get("skillGroups") or []:
        if isinstance(g, dict):
            out += [x.strip() for x in re.split(r"[,;\n]", str(g.get("value") or "")) if x.strip()]
    return out


def _entries(data: dict[str, Any], key: str, fields: tuple[str, ...]) -> set[str]:
    return {
        " ".join(str(e.get(f) or "").split()).lower()
        for e in data.get(key) or []
        if isinstance(e, dict)
        for f in fields
        if str(e.get(f) or "").strip()
    }


def _leaves(v: Any) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [x for y in v.values() for x in _leaves(y)]
    if isinstance(v, list):
        return [x for y in v for x in _leaves(y)]
    return []


def doc_problems(new: dict[str, Any], original: dict[str, Any]) -> list[str]:
    """The whole tailored resume against the original: nothing new anywhere (text, skills items, companies, job
    titles, degrees, colleges)."""
    orig_text = facts.resume_text(original)
    # only what changed is read (the resume's own contact details and builder dates are facts already)
    same = set(_leaves(original))
    changed = "\n".join(x for x in _leaves(new) if x not in same)
    found = problems(changed, orig_text) if changed.strip() else []
    if (new.get("personal") or {}) != (original.get("personal") or {}):
        found.append("changed contact details")
    have = {s.lower() for s in skill_items(original)}
    for s in skill_items(new):
        if s.lower() not in have:
            found.append(f"the skills item {s}")
    for key, fields, what in (
        ("exp", ("company",), "company"),
        ("exp", ("role",), "job title"),
        ("edu", ("degree", "field"), "degree"),
        ("edu", ("institution",), "college"),
        ("certs", ("name",), "certificate"),
    ):
        extra = _entries(new, key, fields) - _entries(original, key, fields)
        found += [f"the {what} {x}" for x in sorted(extra)]
    if set(dictionary.find(facts.resume_text(new))) - set(dictionary.find(orig_text)):
        found.append("a skill not on the resume")
    return list(dict.fromkeys(found))
