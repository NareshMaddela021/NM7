"""How well one resume fits one job post, out of 100, with the same numbers every time for the same inputs.

    must-have skills       35   found in a bullet = full, only in the skills list = half ("weak")
    role / title fit       15   the job title's words in the headline, the roles held, the summary
    experience             15   years (internships count); a fresher post (0-1 yrs) is full marks for anyone
    nice-to-have skills    10   like must-haves
    education              10   the lowest level the post accepts vs the highest on the resume
    duties in the bullets  10   the words of the duties found in the work and project bullets
    ATS basics              5   email, phone, a summary or headline, at least one bullet, a skills list

Every skill, certification and language the post asks for is Found (proven in a bullet, a project or the
certifications), Weak (only listed: skills, headline, summary) or Missing, each with an honest next step. Nothing
here ever suggests claiming something the person hasn't done.
"""

import re
from datetime import date
from typing import Any

from app.jobsearch import skills as dictionary
from app.jobsearch.parse import EDU_LEVELS, Parsed

WEIGHTS = {"must": 35, "title": 15, "experience": 15, "nice": 10, "education": 10, "duties": 10, "ats": 5}
LABELS = {
    "must": "Must-have skills",
    "title": "Role / title fit",
    "experience": "Experience",
    "nice": "Nice-to-have skills",
    "education": "Education",
    "duties": "Duties in your bullets",
    "ats": "ATS basics",
}
SENIORITY = {
    "senior",
    "sr",
    "junior",
    "jr",
    "lead",
    "trainee",
    "intern",
    "fresher",
    "associate",
    "assistant",
    "head",
    "principal",
    "chief",
    "staff",
    "i",
    "ii",
    "iii",
    "level",
    "grade",
    "urgent",
    "required",
    "needed",
}
SAME_ROLE = {
    "engineer": "developer",
    "programmer": "developer",
    "dev": "developer",
    "coder": "developer",
    "officer": "executive",
    "associate": "executive",
    "representative": "executive",
    "rep": "executive",
    "agent": "executive",
    "analytics": "analyst",
    "analysis": "analyst",
    "js": "javascript",
    "reactjs": "react",
    "nodejs": "node",
    "frontend": "front-end",
    "backend": "back-end",
}
TITLE_STOP = {"a", "an", "the", "and", "or", "of", "for", "in", "at", "with", "to", "-", "&", "/"}


def _words(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[a-z0-9+#.]+", text.lower()):
        w = w.strip(".")
        if not w or w in TITLE_STOP:
            continue
        out.append(SAME_ROLE.get(w, w))
    return out


def _month(v: str | None) -> tuple[int, int] | None:
    m = re.match(r"^(\d{4})(?:-(\d{1,2}))?", str(v or ""))
    if not m:
        return None
    return int(m.group(1)), int(m.group(2) or 1)


class Resume:
    """The parts of a resume (builder data) the score reads."""

    def __init__(self, data: dict[str, Any], today: date | None = None):
        d = data or {}
        self.data = d
        p = d.get("personal") or {}
        self.headline = str(p.get("headline") or "")
        self.summary = str(d.get("summary") or "")
        self.email = str(p.get("email") or "")
        self.phone = str(p.get("phone") or "")
        self.level_text = str(p.get("level") or "")
        exp = [e for e in d.get("exp") or [] if isinstance(e, dict)]
        proj = [x for x in d.get("proj") or [] if isinstance(x, dict)]
        ach = [x for x in d.get("ach") or [] if isinstance(x, dict)]
        self.roles = [str(e.get("role") or "") for e in exp if e.get("role")]
        self.companies = [str(e.get("company") or "") for e in exp if e.get("company")]
        self.bullets: list[str] = []
        for e in exp:
            self.bullets += [ln.strip() for ln in str(e.get("description") or "").split("\n") if ln.strip()]
        for x in proj:
            self.bullets += [ln.strip() for ln in str(x.get("description") or "").split("\n") if ln.strip()]
            for k in ("tagline", "tech"):
                if x.get(k):
                    self.bullets.append(str(x[k]))
        for x in ach:
            for k in ("title", "description"):
                if x.get(k):
                    self.bullets.append(str(x[k]))
        self.project_titles = [str(x.get("title") or "") for x in proj if x.get("title")]
        groups = [g for g in d.get("skillGroups") or [] if isinstance(g, dict)]
        listed = [str(g.get("value") or "") for g in groups]
        if isinstance(d.get("skills"), str):
            listed.append(d["skills"])
        elif isinstance(d.get("skills"), list):
            listed += [str(x) for x in d["skills"]]
        self.skills_text = ", ".join(x for x in listed if x.strip())
        self.certs = [
            " ".join(str(c.get(k) or "") for k in ("name", "issuer")).strip()
            for c in d.get("certs") or []
            if isinstance(c, dict) and c.get("name")
        ]
        self.langs = [
            str(lg.get("name") or "") for lg in d.get("langs") or [] if isinstance(lg, dict) and lg.get("name")
        ]
        self.edu = [e for e in d.get("edu") or [] if isinstance(e, dict) and (e.get("degree") or e.get("institution"))]
        # where each skill shows up
        self.proven = set(dictionary.find("\n".join(self.bullets)))
        self.cert_skills = set(dictionary.find("\n".join(self.certs)))
        self.listed = set(dictionary.find("\n".join([self.skills_text, self.headline, self.summary, *self.roles])))
        self.lang_skills = set(dictionary.find(", ".join(self.langs)))
        self.proof_text = "\n".join([*self.bullets, *self.certs]).lower()
        self.listed_text = "\n".join([self.skills_text, self.headline, self.summary, *self.roles]).lower()
        self.years = self._years(exp, today or date.today())

    @staticmethod
    def _years(exp: list[dict[str, Any]], today: date) -> float:
        months = 0
        for e in exp:
            a = _month(e.get("from"))
            b = (today.year, today.month) if e.get("current") else _month(e.get("to"))
            if a and b:
                months += max(0, (b[0] - a[0]) * 12 + (b[1] - a[1]))
        return round(months / 12, 1)

    def edu_level(self) -> int:
        best = 0
        for e in self.edu:
            text = " ".join(str(e.get(k) or "") for k in ("degree", "field"))
            for level, _, pat in EDU_LEVELS:
                if pat.search(text):
                    best = max(best, level)
                    break
        return best

    def role_text(self) -> str:
        return " ".join([self.headline, *self.roles, self.summary[:200]])


def _status(name: str, r: Resume) -> str:
    """found (proven in a bullet / project / certificate), weak (only listed) or missing."""
    if dictionary.skill(name) is None:  # a skill the dictionary doesn't know: its own words, as written
        pat = rf"(?<![a-z0-9]){re.escape(name.lower())}(?![a-z0-9])"
        return "found" if re.search(pat, r.proof_text) else "weak" if re.search(pat, r.listed_text) else "missing"
    if name in r.proven or name in r.cert_skills:
        return "found"
    if dictionary.kind(name) == "lang" and name in r.lang_skills:
        return "found"
    if name in r.listed:
        return "weak"
    return "missing"


def _step(name: str, kind: str, status: str, group: str) -> str:
    if status == "found":
        return ""
    if kind == "cert":
        if status == "weak":
            return f"Add {name} under Certifications with the issuer and year."
        return f"If you have the {name}, add it under Certifications. Not done it? Leave it out."
    if kind == "lang":
        return f"If you speak {name}, add it under Languages. Not true? Leave it out."
    if status == "weak":
        return f"Show {name} in a work or project bullet: what you did with it and what changed."
    if group == "nice":
        return f"Nice to have. If you have used {name}, add it to a project or work bullet. If not, leave it out."
    return (
        f"If you have used {name}, add it to a project or work bullet that shows how. "
        "Not something you've done? Leave it out."
    )


def _ratio(items: list[dict[str, Any]]) -> float:
    if not items:
        return 1.0
    return sum(1.0 if i["status"] == "found" else 0.5 if i["status"] == "weak" else 0.0 for i in items) / len(items)


def score(parsed: Parsed, data: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    r = Resume(data, today)
    nice_extra = set(parsed.nice_extra)
    must_names = [
        *parsed.must,
        *[c for c in parsed.certs if c not in nice_extra],
        *[lg for lg in parsed.languages if lg not in nice_extra],
    ]
    nice_names = [*parsed.nice, *[x for x in parsed.nice_extra if dictionary.kind(x) in ("cert", "lang")]]
    items: list[dict[str, Any]] = []
    for group, names in (("must", must_names), ("nice", nice_names)):
        for n in names:
            k = dictionary.kind(n)
            st = _status(n, r)
            items.append({"name": n, "kind": k, "group": group, "status": st, "step": _step(n, k, st, group)})
    must_items = [i for i in items if i["group"] == "must"]
    nice_items = [i for i in items if i["group"] == "nice"]

    parts: dict[str, dict[str, Any]] = {}

    def put(key: str, frac: float, note: str) -> None:
        frac = max(0.0, min(1.0, frac))
        parts[key] = {
            "key": key,
            "label": LABELS[key],
            "max": WEIGHTS[key],
            "points": round(WEIGHTS[key] * frac, 1),
            "note": note,
        }

    found_must = sum(1 for i in must_items if i["status"] == "found")
    weak_must = sum(1 for i in must_items if i["status"] == "weak")
    put(
        "must",
        _ratio(must_items),
        f"{found_must} found, {weak_must} only listed, {len(must_items) - found_must - weak_must} missing of "
        f"{len(must_items)}"
        if must_items
        else "The post names no must-have skills.",
    )

    tw = [w for w in _words(parsed.title) if w not in SENIORITY]
    if not tw:
        put("title", 1.0, "No job title found in the post.")
    else:
        have = set(_words(r.role_text()))
        hit = [w for w in tw if w in have]
        put(
            "title",
            len(hit) / len(tw),
            f"Your headline and roles share {len(hit)} of {len(tw)} words with “{parsed.title}”.",
        )

    if parsed.exp_min is None or parsed.fresher or parsed.exp_min == 0:
        put(
            "experience",
            1.0,
            "Freshers can apply."
            if parsed.fresher or parsed.exp_min == 0
            else "The post doesn't ask for a number of years.",
        )
    else:
        need = parsed.exp_min
        put(
            "experience",
            r.years / need if need else 1.0,
            f"They ask for {need:g}+ years; your resume shows about {r.years:g}.",
        )

    found_nice = sum(1 for i in nice_items if i["status"] == "found")
    put(
        "nice",
        _ratio(nice_items),
        f"{found_nice} of {len(nice_items)} found" if nice_items else "The post names no nice-to-have skills.",
    )

    if not parsed.edu_level:
        put("education", 1.0, "The post doesn't ask for a degree.")
    else:
        have_level = r.edu_level()
        need_name = next((n for lv, n, _ in EDU_LEVELS if lv == parsed.edu_level), "")
        frac = 1.0 if have_level >= parsed.edu_level else 0.4 if have_level == parsed.edu_level - 1 else 0.0
        put(
            "education",
            frac,
            f"They ask for {need_name} or above." + ("" if frac == 1 else " Check your Education section."),
        )

    kws = parsed.keywords
    if not kws:
        put("duties", 1.0, "No duties listed in the post.")
    else:
        text = "\n".join(r.bullets).lower()
        proven = {s.lower() for s in r.proven}
        hits = [k for k in kws if k.lower() in proven or re.search(rf"(?<![a-z]){re.escape(k.lower())}", text)]
        put("duties", len(hits) / len(kws), f"{len(hits)} of {len(kws)} duty words appear in your bullets.")

    checks = [
        bool(r.email.strip()),
        bool(r.phone.strip()),
        bool(r.summary.strip() or r.headline.strip()),
        bool(r.bullets),
        bool(r.skills_text.strip()),
    ]
    put(
        "ats",
        sum(checks) / len(checks),
        f"{sum(checks)} of 5 basics in place (email, phone, summary, bullets, skills).",
    )

    total = round(sum(p["points"] for p in parts.values()))
    weak = [i for i in items if i["status"] == "weak"]
    # the fixes that use only what is already true: show the weak skills in bullets, use the job's words
    fixes_list = [f"Show {i['name']} in a bullet" for i in weak]
    if parts["title"]["points"] < WEIGHTS["title"] / 2 and parsed.title:
        fixes_list.append("Use the job title in your headline if it describes what you do")
    if parts["duties"]["points"] < WEIGHTS["duties"] / 2 and kws:
        fixes_list.append("Describe your real work with the job post's words")
    if parts["ats"]["points"] < WEIGHTS["ats"]:
        fixes_list.append("Fill in the ATS basics (email, phone, summary, bullets, skills)")
    gain = sum(
        WEIGHTS[i["group"]] / max(1, len(must_items if i["group"] == "must" else nice_items)) * 0.5 for i in weak
    )
    if total >= 75:
        verdict, text = "strong", "Strong match - apply"
    elif total >= 45 and (total + gain >= 60 or total >= 60) and fixes_list:
        n = len(fixes_list)
        verdict, text = "good", f"Good after {n} fix{'es' if n != 1 else ''}"
    elif total >= 60:
        verdict, text = "good", "Good match - apply"
    else:
        verdict, text = "stretch", "Stretch role"
    return {
        "score": total,
        "breakdown": [parts[k] for k in WEIGHTS],
        "items": items,
        "soft": parsed.soft,
        "verdict": verdict,
        "verdictText": text,
        "fixes": fixes_list,
        "resumeYears": r.years,
    }
