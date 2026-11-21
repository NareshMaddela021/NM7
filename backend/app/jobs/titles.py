"""Batch B: human job titles and clean role names.

clean_title(): a careers-site title is often a code line ("Manager - SaT - National - CBS - MGT - Hyderabad",
"Senior Data Analyst | Payments Team | Bengaluru", "Software Engineer II (R-123456)"). The board shows the human part
("Manager", "Senior Data Analyst", "Software Engineer II"); the stored title is never changed, so search still finds
every word of it. Only the human words are kept, never invented: the answer is always a piece of the title.

role_names() / suggest_roles(): the quick start's "What job do you want?" and Auto Apply's "Your rules" suggest only
clean common role names (the role finder's list, the skill-check roles and a short list of common jobs), never raw
titles from the board.

SENIOR / is_senior_for(): the levels a junior person (fresher to 3 years) is not shown in the quick start's results.
"""

from __future__ import annotations

import re

from app.jobsearch.parse import CITY, NOT_A_CITY

# a part between dashes or pipes that is a code, a place or a team, not the job
_SEP = re.compile(r"\s+[-–—|/]\s+|\s*\|\s*")
_REQ = re.compile(
    r"\(?\s*(?:req(?:uisition)?\.?\s*(?:id|no\.?|#)?\s*:?\s*|job\s*(?:id|code)\s*:?\s*|#\s*|\b[A-Z]{1,4}-?)\d{3,}\s*\)?",
    re.I,
)
_PLACE_WORDS = re.compile(
    r"^(?:india|national|pan[\s-]?india|all\s+india|anywhere\s+in\s+india|remote|hybrid|on[\s-]?site|onsite|wfh|"
    r"work\s+from\s+(?:home|office)|multiple\s+locations|various\s+locations|apac|emea|global|gds|"
    r"[a-z]{2,3}-[a-z]{2}(?:-[a-z]+)?)$",
    re.I,
)
_TEAM = re.compile(r"\b(team|squad|pod|tribe|vertical|bu|business\s+unit|department|dept|division|practice)\b", re.I)
_TRAIL_PLACE = re.compile(
    rf"(?:\s*[,(\[]\s*|\s+(?:in|at|-)\s+)(?:{CITY.pattern[3:-3]})(?:\s*,\s*[A-Za-z .]+)?\s*[)\]]?\s*$", re.I
)
_TRAIL_INDIA = re.compile(r"(?:\s*[,(\[]\s*|\s+-\s+)(?:india|remote|hybrid|wfh)\s*[)\]]?\s*$", re.I)
MAX_PARTS = 2  # "Associate - Business Consulting Risk": a rank and one human part at most


def _is_code(part: str) -> bool:
    """A short code such as "SaT", "CBS", "MGT", "TCF", "GDS-IN" (one word, few letters, several capitals)."""
    p = part.strip(" .")
    if " " in p or not p:
        return False
    if re.fullmatch(r"[A-Z0-9&/._-]{2,8}", p):
        return True
    return len(p) <= 5 and sum(c.isupper() for c in p) >= 2


def _is_place(part: str) -> bool:
    p = part.strip(" .,()")
    if not p:
        return True
    if p.lower() in NOT_A_CITY or _PLACE_WORDS.match(p):
        return True
    # every word is a city or a state/country word ("Hyderabad", "Bengaluru, Karnataka", "Pune / Mumbai")
    rest = CITY.sub("", p)
    rest = re.sub(
        r"\b(india|karnataka|maharashtra|telangana|tamil\s+nadu|andhra\s+pradesh|kerala|gujarat|west\s+bengal|"
        r"uttar\s+pradesh|haryana|delhi\s+ncr|ncr|ind|in)\b",
        "",
        rest,
        flags=re.I,
    )
    return CITY.search(p) is not None and not re.search(r"[A-Za-z]", rest)


def clean_title(title: str) -> str:
    """The human part of a job title (the title itself when it is already clean)."""
    raw = " ".join(str(title or "").split())
    if not raw:
        return ""
    t = _REQ.sub(" ", raw)
    t = " ".join(t.split()).strip(" -|,")
    parts = [p.strip() for p in _SEP.split(t) if p and p.strip()]
    if len(parts) > 1:
        kept: list[str] = []
        piped = "|" in t
        for i, p in enumerate(parts):
            if _is_code(p) or _is_place(p) or (i and _TEAM.search(p)):
                if kept:
                    break  # the codes start: the rest is the team, office and city
                continue
            kept.append(p)
            if piped or len(kept) >= MAX_PARTS:
                break
        t = " - ".join(kept) if kept else parts[0]
    for _ in range(2):  # "Data Analyst (Hyderabad)", "Data Analyst, Pune, Maharashtra", "Sales Executive - India"
        t = _TRAIL_INDIA.sub("", _TRAIL_PLACE.sub("", t)).strip(" -|,")
    t = re.sub(r"\(\s*\)", "", t).strip(" -|,")
    return t or raw


# --- clean role names ----------------------------------------------------------------------------------------------

COMMON_ROLES = (
    "Software engineer", "Software developer", "Java developer", "Full stack developer", "Back-end developer",
    "Mobile app developer", "Android developer", "DevOps engineer", "Cloud engineer", "Data scientist",
    "Data engineer", "Machine learning engineer", "Business analyst", "Product manager", "UI/UX designer",
    "Graphic designer", "Network engineer", "System administrator", "Cyber security analyst",
    "Technical support engineer",
    "Digital marketing executive", "Content writer", "Social media executive", "Marketing executive",
    "Business development executive", "Telecaller", "Receptionist", "Front office executive", "Admin executive",
    "Accountant", "Financial analyst", "Bank clerk", "Insurance advisor", "Teacher", "Tutor", "Pharmacist",
    "Lab technician", "Medical coder", "Mechanical engineer", "Civil engineer", "Electrical engineer",
    "Site engineer", "Quality inspector", "Production supervisor", "Machine operator", "Welder", "Plumber",
    "Driver", "Security guard", "Cook", "Housekeeping staff", "Store keeper", "Logistics executive",
    "Operations executive", "Procurement executive",
)  # fmt: skip


def role_names() -> list[str]:
    """Every clean role name, once: the role finder's roles, the skill-check roles, then common jobs."""
    from app.hire.vetting.roles import ROLES as CHECKS
    from app.seek.catalogue import ROLES as FINDER

    out: list[str] = []
    seen: set[str] = set()
    for name in [*(r["title"] for r in FINDER), *(r["role"] for r in CHECKS), *COMMON_ROLES]:
        name = " ".join(str(name).split())
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def suggest_roles(q: str = "", n: int = 8) -> list[str]:
    """Role names for what was typed: names starting with it first, then a word starting with it, then any match."""
    names = role_names()
    q = " ".join(q.lower().split())
    if not q:
        return names[:n]
    starts = [x for x in names if x.lower().startswith(q)]
    words = [x for x in names if x not in starts and re.search(rf"\b{re.escape(q)}", x.lower())]
    inside = [x for x in names if x not in starts and x not in words and q in x.lower()]
    return [*starts, *words, *inside][:n]


def roles_for_resume(skills: set[str], text: str, n: int = 6) -> list[str]:
    """Clean role names that fit a resume: the role finder's roles by the skills they share, then any role name the
    resume's titles and summary use ("Data scientist")."""
    from app.seek.catalogue import ROLES as FINDER

    have = {s.lower() for s in skills}
    low = (text or "").lower()
    scored = []
    for r in FINDER:
        pts = sum(s.lower() in have for s in r["skills"]) * 2 + sum(w in low for w in r["words"]) * 3
        if pts:
            scored.append((-pts, r["title"]))
    out = [t for _, t in sorted(scored)]
    for name in role_names():
        if name not in out and re.search(rf"\b{re.escape(name.lower())}\b", low):
            out.insert(0, name)
    return out[:n]


# --- levels a junior person isn't shown -----------------------------------------------------------------------------

SENIOR = re.compile(
    r"\b(lead|senior|sr|manager|head|principal|director|architect|vp|vice\s+president|chief|avp|staff\s+engineer)\b",
    re.I,
)
TOP = re.compile(r"\b(head|principal|director|vp|vice\s+president|chief|avp)\b", re.I)
JUNIOR = ("internship", "fresher", "0_1", "1_3")


def level_filter(level: str) -> list[dict]:
    """Extra job board filters for a person at this level (the quick start's results): nothing for other levels."""
    if level in JUNIOR:
        return [{"title": {"$not": SENIOR}}, {"experience": {"$nin": ["5_8", "8_12", "12_15", "15_plus"]}}]
    if level == "3_5":
        return [{"title": {"$not": TOP}}, {"experience": {"$nin": ["8_12", "12_15", "15_plus"]}}]
    return []


def display_title(j: dict) -> str:
    """The title a page shows: a careers-site (collector) job's human part; a company's own title as they typed it."""
    title = str(j.get("title") or "")
    return clean_title(title) if j.get("source") == "collector" else title
