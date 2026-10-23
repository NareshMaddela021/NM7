"""The LinkedIn pack written from fixed patterns (no AI): every item, from the person's own facts only. Used as the
whole pack when AI is off, busy or over the daily limit, and for any piece AI wrote that failed a check.

Nothing is invented: no number, company, degree, certificate or skill that isn't in what the person gave. No
phone, email, link or ID number in any text (contact details are removed from the inputs before anything here
runs). LinkedIn's limits: headline 220, About 2,600, each experience 2,000 characters.
"""

import re
from typing import Any

HEADLINE_MAX = 220
ABOUT_MAX = 2600
EXP_MAX = 2000
SKILLS_MAX = 50

# target role → the words recruiters search for (the same list as frontend/src/lib/linkedin/keywords.js)
ROLES: list[tuple[str, str, list[str]]] = [
    ("Data Analyst", r"data analy|business intelligence|\bbi analyst|mis analyst|reporting analyst",
     ["SQL", "Excel", "Power BI", "Tableau", "Python", "Dashboards", "Data Visualization", "Statistics",
      "Data Cleaning", "Reporting"]),
    ("Data Scientist", r"data scien|machine learning|\bml engineer|\bai engineer",
     ["Python", "Machine Learning", "SQL", "Statistics", "Pandas", "Scikit-learn", "Deep Learning",
      "Data Visualization", "NLP", "Model Deployment"]),
    ("Business Analyst", r"business analy",
     ["Requirements Gathering", "SQL", "Excel", "Stakeholder Management", "Process Mapping", "Power BI",
      "User Stories", "Documentation", "Agile", "JIRA"]),
    ("Software Developer", r"software (dev|eng)|\bsde\b|programmer|backend|java dev|python dev",
     ["Java", "Python", "Data Structures", "Algorithms", "SQL", "Git", "REST APIs", "OOP", "Problem Solving",
      "Debugging"]),
    ("Web Developer", r"web dev|front ?end|full ?stack|react dev|mern",
     ["HTML", "CSS", "JavaScript", "React", "Node.js", "REST APIs", "Git", "Responsive Design", "TypeScript",
      "MongoDB"]),
    ("Mobile App Developer", r"mobile|android|ios dev|flutter|app dev",
     ["Android", "Kotlin", "Flutter", "Dart", "Java", "Firebase", "REST APIs", "Git", "UI Design", "Play Store"]),
    ("DevOps Engineer", r"devops|cloud eng|site reliab|\bsre\b",
     ["AWS", "Docker", "Kubernetes", "Linux", "CI/CD", "Terraform", "Jenkins", "Git", "Monitoring",
      "Shell Scripting"]),
    ("Software Tester", r"test(er|ing)|\bqa\b|quality assurance|automation eng",
     ["Manual Testing", "Selenium", "Test Cases", "Bug Tracking", "JIRA", "API Testing", "SQL",
      "Regression Testing", "Agile", "Automation"]),
    ("UI/UX Designer", r"\bui\b|\bux\b|product design|graphic design|visual design",
     ["Figma", "User Research", "Wireframing", "Prototyping", "Design Systems", "Usability Testing", "Adobe XD",
      "Typography", "Accessibility", "Portfolio"]),
    ("Digital Marketer", r"digital market|\bseo\b|social media|content market|performance market",
     ["SEO", "Google Ads", "Social Media Marketing", "Content Marketing", "Google Analytics", "Email Marketing",
      "Meta Ads", "Copywriting", "Campaigns", "Canva"]),
    ("Sales Executive", r"sales|business develop|\bbde\b|inside sales",
     ["Lead Generation", "Negotiation", "CRM", "Client Relationships", "Cold Calling", "Targets", "B2B Sales",
      "Communication", "Presentations", "Follow-ups"]),
    ("HR Executive", r"\bhr\b|human resource|recruit|talent acq",
     ["Recruitment", "Onboarding", "Payroll", "HR Policies", "Employee Engagement", "Sourcing", "Interviewing",
      "HRMS", "Excel", "Communication"]),
    ("Accountant", r"account|finance exec|\bca\b|tally|bookkeep",
     ["Tally", "GST", "Excel", "Accounts Payable", "Accounts Receivable", "Bank Reconciliation", "TDS",
      "Financial Reporting", "Bookkeeping", "Auditing"]),
    ("Customer Support Executive", r"customer (support|service|care)|call cent|bpo|voice process|chat process",
     ["Customer Service", "Communication", "CRM", "Problem Solving", "Ticketing", "Email Support",
      "Chat Support", "English", "Typing", "Escalations"]),
    ("Mechanical Engineer", r"mechanical|design eng|production eng",
     ["AutoCAD", "SolidWorks", "CATIA", "GD&T", "Manufacturing", "Quality Control", "Lean", "ANSYS",
      "Maintenance", "Six Sigma"]),
    ("Civil Engineer", r"civil|site eng|structural",
     ["AutoCAD", "Site Supervision", "Estimation", "STAAD Pro", "Quantity Surveying", "Revit",
      "Project Planning", "Quality Control", "BOQ", "Safety"]),
    ("Electronics Engineer", r"electronic|\bece\b|embedded|vlsi",
     ["Embedded C", "Microcontrollers", "PCB Design", "VLSI", "Verilog", "Arduino", "IoT", "MATLAB",
      "Circuit Design", "Testing"]),
    ("Teacher", r"teach|tutor|lecturer|faculty|educator",
     ["Lesson Planning", "Classroom Management", "Curriculum", "Student Assessment", "Communication",
      "Online Teaching", "Mentoring", "Subject Knowledge", "Parent Communication", "MS Office"]),
    ("Nurse", r"nurs|staff nurse|\bgnm\b|\banm\b",
     ["Patient Care", "Vital Signs", "Medication Administration", "BLS", "Infection Control", "Documentation",
      "ICU", "Wound Care", "Communication", "Emergency Care"]),
]  # fmt: skip

LATIN = re.compile(r"^[\x20-\x7e -ɏ‐-‧₹]*$")  # English letters and common punctuation


def tidy(s: Any) -> str:
    return " ".join(str(s or "").split())


def latin(s: Any) -> str:
    t = tidy(s)
    return t if t and LATIN.match(t) else ""


def role_info(role: str) -> tuple[str, list[str]] | None:
    for name, pattern, words in ROLES:
        if re.search(pattern, role or "", re.I):
            return name, words
    return None


def has_word(text: str, w: str) -> bool:
    return re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", text or "", re.I) is not None


def sentences(text: str) -> list[str]:
    parts = re.split(r"\n+|(?<=[.!?])\s+(?=[A-Z])", text or "")
    return [tidy(re.sub(r"^[\-•*▸–➢✓]\s*", "", p)) for p in parts if tidy(p)]


def cut(text: str, limit: int) -> str:
    """At most `limit` characters, ending at a sentence (or word) boundary."""
    text = text.strip()
    if len(text) <= limit:
        return text
    head = text[:limit]
    stop = max(head.rfind(". "), head.rfind(".\n"))
    return head[: stop + 1] if stop > limit * 0.5 else head.rsplit(" ", 1)[0].rstrip(",;:") + "."


def join_list(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


# ---------- facts ----------


def facts_of(profile: dict[str, Any], details: dict[str, Any], role: str) -> dict[str, Any]:
    """Everything the rules (and AI) may use, from the profile sections and the "create" details. English only."""
    p = profile or {}
    d = details or {}
    target = latin(role) or latin(d.get("role"))
    info = role_info(target)
    skills_in = [*(p.get("skills") or []), *re.split(r"[,\n;]+", str(d.get("skills") or ""))]
    skills = []
    seen = set()
    for s in skills_in:
        s = latin(s)
        if s and len(s) <= 40 and s.lower() not in seen:
            seen.add(s.lower())
            skills.append(s)
    edu = [
        {
            "school": latin(e.get("school")),
            "degree": latin(e.get("degree")),
            "year": latin(str(e.get("year") or ""))[:4],
        }
        for e in [*(p.get("education") or []), *(d.get("education") or [])]
        if isinstance(e, dict) and (latin(e.get("school")) or latin(e.get("degree")))
    ]
    exp = [
        {
            "title": latin(e.get("title")),
            "company": latin(e.get("company")),
            "dates": latin(e.get("dates")),
            "text": str(e.get("text") or "").strip(),
            "current": bool(e.get("current")) or "present" in str(e.get("dates") or "").lower(),
        }
        for e in [*(p.get("experience") or []), *(d.get("work") or [])]
        if isinstance(e, dict) and (latin(e.get("title")) or latin(e.get("company")))
    ]
    projects = []
    for pr in [*(p.get("projects") or []), *re.split(r"\n+", str(d.get("projects") or ""))]:
        name, text = (pr.get("name"), pr.get("text")) if isinstance(pr, dict) else (pr, "")
        if latin(name):
            projects.append({"name": latin(name)[:80], "text": str(text or "").strip()})
    certs = [latin(c) for c in [*(p.get("certs") or []), *re.split(r"\n+", str(d.get("certs") or ""))] if latin(c)]
    return {
        "target": target or (info[0] if info else ""),
        "role_words": info[1] if info else [],
        "skills": skills,
        "education": edu,
        "experience": exp,
        "projects": projects[:6],
        "certs": certs[:6],
        "city": latin(str(d.get("city") or p.get("location") or "").split(",")[0]),
        "headline": latin(p.get("headline")),
        "about": str(p.get("about") or "").strip(),
        "name": latin(d.get("name") or p.get("name")),
    }


def ranked_skills(f: dict[str, Any]) -> list[str]:
    """The person's skills, the target role's key words they have first (in the order recruiters care about)."""
    words = f["role_words"]
    have = [w for w in words if any(s.lower() == w.lower() for s in f["skills"])]
    rest = [s for s in f["skills"] if s.lower() not in {w.lower() for w in have}]
    return (have + rest)[:SKILLS_MAX]


def degree_line(e: dict[str, Any]) -> str:
    return " ".join(x for x in (e["degree"], f"({e['year']})" if e.get("year") else "") if x)


# ---------- items ----------


def headlines(f: dict[str, Any], count: int = 5, seed: int = 0) -> list[str]:
    role = f["target"] or (f["education"][0]["degree"] + " graduate" if f["education"] else "")
    sk = ranked_skills(f)
    if not role and not sk:
        return []
    r = role or "Fresher"
    deg = degree_line(f["education"][0]) if f["education"] else ""
    now = next((e for e in f["experience"] if e["current"]), None)
    current = " at ".join(x for x in ((now or {}).get("title"), (now or {}).get("company")) if x)
    proj = f["projects"][0]["name"] if f["projects"] else ""
    cert = f["certs"][0] if f["certs"] else ""
    proof = current or (f"Built {proj}" if proj else "") or cert or deg
    aspiring = "Aspiring " if not current and f["target"] else ""

    def fit(parts: list[str]) -> str:
        ps = [tidy(p) for p in parts if tidy(p)]
        while len(ps) > 1 and len(" | ".join(ps)) > HEADLINE_MAX:
            ps.pop()
        return cut(" | ".join(ps), HEADLINE_MAX)

    cands = [
        fit([r, " · ".join(sk[:3]), proof]),
        fit([f"{aspiring}{r}" + (f" skilled in {' and '.join(sk[:2])}" if len(sk) >= 2 else ""), deg or cert]),
        fit([r, f"Built {proj}" if proj else "", " · ".join(sk[:4])]),
        fit([f"{deg} | {r}" if deg and f["target"] else r, cert, " · ".join(sk[:2])]),
        fit([r, ", ".join(sk[:4]), f"Open to {f['target']} roles" + (f" in {f['city']}" if f["city"] else "")
             if f["target"] else ""]),
        fit([current or r, " · ".join(sk[:3])]),
        fit([" & ".join(sk[:2]), r]),
        fit([f"{aspiring}{r}", " | ".join(sk[:3])]),
        fit([f"{r} skilled in {', '.join(sk[:3])}"]),
        fit([r, deg]),
    ]  # fmt: skip
    cands = cands[seed * 3 :] + cands[: seed * 3]  # a regenerate starts further down the list
    out, seen = [], set()
    for h in cands:
        if len(h) >= 10 and h.lower() not in seen and h != r:
            seen.add(h.lower())
            out.append(h)
        if len(out) == count:
            break
    return out


def about(f: dict[str, Any], seed: int = 0) -> dict[str, str]:
    """Simple, professional and story, from the facts; each at most 2,600 characters."""
    r = f["target"] or "a new role"
    sk = ranked_skills(f)[:6]
    e0 = f["education"][0] if f["education"] else None
    edu = f"{e0['degree']}{' from ' + e0['school'] if e0['school'] else ''}" if e0 and e0["degree"] else ""
    year = f" ({e0['year']})" if e0 and e0.get("year") else ""
    jobs = f["experience"][:3]
    job_lines = [" at ".join(x for x in (j["title"], j["company"]) if x) for j in jobs]
    proj = [p["name"] for p in f["projects"][:3]]
    certs = f["certs"][:3]
    where = f" in {f['city']}" if f["city"] else ""
    asks = (
        (f"I am open to {r} roles{where}. Happy to connect.", "Happy to connect."),
        (f"Looking for {r} opportunities{where}. Feel free to message me.", "Feel free to message me."),
    )[seed % 2]
    ask = asks[0] if f["target"] else asks[1]

    simple = [
        f"I am looking for {'a ' + r if f['target'] else r} role." if f["target"] else "",
        f"I studied {edu}{year}." if edu else "",
        f"My skills: {join_list(sk)}." if sk else "",
        f"I have worked as {join_list(job_lines)}." if job_lines else "",
        f"Projects: {join_list(proj)}." if proj else "",
        f"Certificates: {join_list(certs)}." if certs else "",
        ask,
    ]
    professional = [
        f"{r} with {edu}{year}." if edu and f["target"] else (f"{r}." if f["target"] else ""),
        f"I work with {join_list(sk)}." if sk else "",
        "Experience: " + "; ".join(job_lines) + "." if job_lines else "",
        "Selected projects: " + "; ".join(proj) + "." if proj else "",
        "Certifications: " + "; ".join(certs) + "." if certs else "",
        ask,
    ]
    story = [
        f"My journey started with {edu}{year}." if edu else "",
        f"Along the way I learned {join_list(sk)}." if sk else "",
        f"I have worked as {join_list(job_lines)}, where I put these skills to use." if job_lines else "",
        f"I built {join_list(proj)}." if proj else "",
        f"I also completed {join_list(certs)}." if certs else "",
        f"Now I want to grow as {'a ' + r if f['target'] else 'a professional'}{where}. Let's connect.",
    ]
    return {k: cut("\n\n".join(x for x in v if x), ABOUT_MAX) for k, v in
            (("simple", simple), ("professional", professional), ("story", story))}  # fmt: skip


def exp_good(e: dict[str, Any]) -> bool:
    """Already good for LinkedIn: 2+ lines, a result (a number), within the limit."""
    t = e.get("text") or ""
    return 120 <= len(t) <= EXP_MAX and len(sentences(t)) >= 2 and bool(re.search(r"\d", t))


def experience_entry(e: dict[str, Any], skills: list[str]) -> str:
    lines = sentences(e["text"])
    results = [s for s in lines if re.search(r"\d", s)]
    others = [s for s in lines if s not in results]
    keep = (others[:3] + results[:2])[:4] if lines else []
    used = [s for s in skills if has_word(e["text"], s)][:5]
    out = [f"• {s.rstrip('.')}." for s in keep]
    if used:
        out.append(f"Tools: {', '.join(used)}.")
    if not out:
        out = [f"{' at '.join(x for x in (e['title'], e['company']) if x)}."]
    return cut("\n".join(out), EXP_MAX)


def experience(f: dict[str, Any], path: str) -> list[dict[str, Any]]:
    """Each job / internship for LinkedIn; freshers with none get their projects as experience-style entries."""
    sk = ranked_skills(f)
    out = []
    for e in f["experience"][:8]:
        keep = path == "fix" and exp_good(e)
        out.append({
            "kind": "job",
            "title": e["title"],
            "company": e["company"],
            "dates": e["dates"],
            "before": e["text"][:EXP_MAX] if path == "fix" else "",
            "text": e["text"][:EXP_MAX] if keep else experience_entry(e, sk),
            "keep": keep,
        })  # fmt: skip
    if not out:
        for p in f["projects"][:4]:
            lines = sentences(p["text"])
            used = [s for s in sk if has_word(p["text"], s)][:5]
            body = [f"• {s.rstrip('.')}." for s in lines[:4]] or [f"Built {p['name']}."]
            if used:
                body.append(f"Tools: {', '.join(used)}.")
            out.append({"kind": "project", "title": p["name"], "company": "Project", "dates": "", "before": "",
                        "text": cut("\n".join(body), EXP_MAX), "keep": False})  # fmt: skip
    return out


def education(f: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "school": e["school"],
            "degree": e["degree"],
            "year": e.get("year", ""),
            "text": " · ".join(x for x in (e["degree"], e["school"], e.get("year", "")) if x),
        }  # fmt: skip
        for e in f["education"][:4]
    ]


def featured(f: dict[str, Any], share_link: str) -> list[dict[str, str]]:
    out = []
    for p in f["projects"][:2]:
        out.append({"kind": "project", "title": p["name"], "why": "Shows what you can build. Add a link or images."})
    for c in f["certs"][:2]:
        out.append({"kind": "certificate", "title": c, "why": "Proof of a skill recruiters search for."})
    if share_link:
        out.append({"kind": "resume", "title": "Your Nm7 resume link", "link": share_link,
                    "why": "One tap for recruiters to see your full resume."})  # fmt: skip
    else:
        out.append({"kind": "resume", "title": "Your Nm7 resume link", "link": "",
                    "why": "Turn on your resume link in My dashboard → Share link, then pin it here."})  # fmt: skip
    return out


def slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")


def url_ideas(f: dict[str, Any]) -> list[str]:
    name = slug(f["name"])
    first = name.split("-")[0] if name else ""
    role = slug(f["target"])
    deg = slug(f["education"][0]["degree"]) if f["education"] else ""
    city = slug(f["city"])
    cands = [f"{first}-{role}" if first and role else "", name, f"{name}-{city}" if name and city else "",
             f"{name}-{role}" if name and role else "", f"{first}-{deg}" if first and deg else ""]  # fmt: skip
    out = []
    for c in cands:
        c = c[:100].strip("-")
        if 3 <= len(c) and c not in out:
            out.append(c)
    return [f"linkedin.com/in/{c}" for c in out[:3]]


def banner(f: dict[str, Any]) -> dict[str, str]:
    return {"name": f["name"], "role": f["target"], "line": " · ".join(ranked_skills(f)[:3])}


def headline_keep(f: dict[str, Any]) -> bool:
    """A current headline that already does the job: the role, 2+ key skills, 40-220 characters."""
    h = f["headline"]
    if not h or not 40 <= len(h) <= HEADLINE_MAX:
        return False
    role_ok = not f["target"] or has_word(h, f["target"])
    words = f["role_words"] or f["skills"]
    return role_ok and sum(1 for w in words if has_word(h, w)) >= 2


def about_keep(f: dict[str, Any]) -> bool:
    a = f["about"]
    return 600 <= len(a) <= ABOUT_MAX and (not f["target"] or has_word(a[:300], f["target"]))


def pack(f: dict[str, Any], path: str, share_link: str = "") -> dict[str, Any]:
    return {
        "headline": {"before": f["headline"] if path == "fix" else "", "options": headlines(f),
                     "keep": path == "fix" and headline_keep(f)},
        "about": {"before": f["about"] if path == "fix" else "", **about(f), "keep": path == "fix" and about_keep(f)},
        "experience": experience(f, path),
        "education": education(f),
        "skills": {"ranked": ranked_skills(f), "missing": [w for w in f["role_words"] if not any(
            s.lower() == w.lower() for s in f["skills"])]},
        "featured": featured(f, share_link),
        "banner": banner(f),
        "urls": url_ideas(f),
    }  # fmt: skip
