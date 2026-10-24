"""The example person ("Sai Varsha") in saved resumes.

Older builder versions seeded new resumes from the example person, so some saved resumes still hold its exact
values. `has_sample` finds them (one marker that only the example has is enough) and `strip_sample` removes exactly
those values and nothing else: a real "Lakeview" college, a real English language entry or the person's own Python
skill stay. Same rules as the frontend (frontend/src/lib/sampleData.js); the values are in sample_values.json.
"""

import copy
import json
from pathlib import Path
from typing import Any

S: dict[str, Any] = json.loads((Path(__file__).parent / "sample_values.json").read_text(encoding="utf-8"))
EMPTY_PREFS = {
    "jobTypes": [],
    "salary": "",
    "notice": "",
    "locations": "",
    "remote": False,
    "relocation": False,
    "industries": [],
}


def _pick(o: Any, keys: list[str]) -> dict[str, Any]:
    return {k: (o.get(k) if isinstance(o, dict) and o.get(k) is not None else "") for k in keys}


def _matches(entry: Any, sample: dict[str, Any]) -> bool:
    return _pick(entry, list(sample)) == sample


def _list(d: dict[str, Any], key: str) -> list[Any]:
    v = d.get(key)
    return v if isinstance(v, list) else []


def _obj(d: dict[str, Any], key: str) -> dict[str, Any]:
    v = d.get(key)
    return v if isinstance(v, dict) else {}


def sample_markers(d: dict[str, Any] | None) -> list[str]:
    """Values only the example person has; any one means the resume was seeded from it."""
    if not isinstance(d, dict):
        return []
    out = []
    links, pinfo = _obj(d, "links"), _obj(d, "pinfo")
    for k in ("linkedin", "github"):
        if links.get(k) == S["links"][k]:
            out.append(f"links.{k}")
    if pinfo.get("father") == S["pinfo"]["father"] and pinfo.get("mother") == S["pinfo"]["mother"]:
        out.append("pinfo.parents")
    if _obj(d, "personal").get("email") == S["personal"]["email"]:
        out.append("personal.email")
    if any(_matches(e, S["edu"]) for e in _list(d, "edu")):
        out.append("edu")
    if any(_matches(e, S["exp"]) for e in _list(d, "exp")):
        out.append("exp")
    return out


def has_sample(d: dict[str, Any] | None) -> bool:
    return bool(sample_markers(d))


def strip_sample(d: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """(the resume without the example's exact values, the fields that changed). Unchanged without a marker."""
    if not has_sample(d):
        return d, []
    x = copy.deepcopy(d)
    changed: list[str] = []

    def clear(section: str | None, key: str, value: Any) -> None:
        obj = x if section is None else x.get(section)
        if isinstance(obj, dict) and obj.get(key) == value and value:
            obj[key] = ""
            changed.append(f"{section}.{key}" if section else key)

    for k, v in S["personal"].items():
        clear("personal", k, v)
    for k, v in S["pinfo"].items():
        clear("pinfo", k, v)
    for k, v in S["links"].items():
        clear("links", k, v)
    clear(None, "hobbies", S["hobbies"])
    clear(None, "strengths", S["strengths"])
    for key, sample in (("edu", S["edu"]), ("exp", S["exp"]), ("proj", S["proj"]), ("certs", S["cert"])):
        if isinstance(x.get(key), list):
            kept = [e for e in x[key] if not _matches(e, sample)]
            if len(kept) != len(x[key]):
                x[key] = kept
                changed.append(key)
    langs = _list(x, "langs")
    if langs and [_pick(lang, ["name", "level"]) for lang in langs] == S["langs"]:
        x["langs"] = []
        changed.append("langs")
    if isinstance(x.get("skillGroups"), list):
        groups = []
        for g in x["skillGroups"]:
            sv = S["skillGroups"].get(g.get("id")) if isinstance(g, dict) else None
            if sv and g.get("value") == sv:
                g = {**g, "value": ""}
                changed.append(f"skillGroups.{g['id']}")
            groups.append(g)
        x["skillGroups"] = groups
    if x.get("prefs") == S["prefs"]:
        x["prefs"] = dict(EMPTY_PREFS)
        changed.append("prefs")
    return x, changed
