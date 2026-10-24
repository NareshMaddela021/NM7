"""Reads a pasted job post with fixed rules (no AI): title, company, location, experience needed, education,
must-have vs nice-to-have skills, tools, certifications, soft skills, languages and the key duties.

Posts are messy (WhatsApp forwards, Naukri copies, Hindi-English mixes), so every part is optional and the result
says how sure it is (`confidence`): when the rules find little (no title, or fewer than two skills in a long post),
the router may ask Claude to read it instead (ai_parse.py) and keeps only what the post really says.

Rules for must vs nice:
- a skill under a "Good to have / Nice to have / Preferred / Plus / Bonus / Desirable" heading, or on a line that
  says so ("Power BI is a plus", "accha hoga"), is nice to have;
- everything else the post asks for is a must-have (that's how recruiters read their own posts).
"""

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from app.jobsearch import skills as dictionary

MAX_TEXT = 20_000

NICE_HEAD = re.compile(
    r"\b(good|nice)[\s-]*to[\s-]*have|preferred|preferable|desirable|desired|bonus|added advantage|"
    r"advantageous|plus points?|optional|accha hoga|accha rahega|achha hoga|behtar hoga|अच्छा होगा",
    re.I,
)
NICE_LINE = re.compile(
    r"\b(good|nice)[\s-]*to[\s-]*have|\bpreferred\b|\bpreferably\b|\bis a plus\b|\ba plus\b|\bplus point|"
    r"\bbonus\b|added advantage|\bdesirable\b|\bwill be an advantage|\bwould be an advantage|\boptional\b|"
    r"accha hoga|accha rahega|achha hoga|behtar hoga|अच्छा होगा",
    re.I,
)
MUST_HEAD = re.compile(
    r"requirements?|required|must[\s-]*haves?|mandatory|eligibility|qualifications?|skills?( required| needed)?|"
    r"key skills|technical skills|desired profile|candidate profile|who (can|should) apply|what we('re| are) "
    r"looking for|you (should|must) have|zaroori|zaruri|chahiye|आवश्यक|ज़रूरी|जरूरी|योग्यता",
    re.I,
)
DUTY_HEAD = re.compile(
    r"responsibilit|duties|what you('ll| will) do|role (and|&) responsibilit|job description|job profile|"
    r"key result|kra|your role|day[\s-]to[\s-]day|kaam|काम|जिम्मेदारी",
    re.I,
)
OTHER_HEAD = re.compile(
    r"about (us|the company|company)|benefits|perks|why join|salary|ctc|compensation|how to apply|"
    r"interview (process|details)|contact|walk[\s-]?in|venue|timings?|shift timings?",
    re.I,
)
TITLE_KEY = re.compile(
    r"^\s*(?:(?:job\s*title|position|post|role|designation|opening|vacancy|job role|profile|पद)\s*[:\-–—]|"
    r"(?:we\s*are\s*|we're\s*|urgent(?:ly)?\s*)?hiring(?:\s*for)?\s*[:\-–—]?)\s*(.+)$",
    re.I,
)
DUTY_KEY = re.compile(r"^\s*(?:kaam|kaam kya hoga|work|duties|job duties|role|काम)\s*[:\-–—]\s*(.+)$", re.I)
COMPANY_KEY = re.compile(r"^\s*(?:company(?:\s*name)?|organi[sz]ation|employer|client|कंपनी)\s*[:\-–—]\s*(.+)$", re.I)
HINGLISH_COMPANY = re.compile(
    r"\b(?i:hamari|humari|hamaari|our)\s+(?i:company)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,4})"
)
ROLE_WORD = re.compile(
    r"\b(developer|engineer|analyst|executive|manager|associate|assistant|officer|specialist|consultant|designer|"
    r"accountant|nurse|driver|electrician|technician|operator|teacher|trainer|tutor|clerk|cashier|agent|"
    r"representative|intern|trainee|lead|architect|administrator|admin|supervisor|coordinator|advisor|counsellor|"
    r"writer|editor|tester|scientist|chef|cook|helper|fitter|welder|plumber|mechanic|guard|receptionist|"
    r"telecaller|marketer|recruiter|pharmacist|doctor|therapist|beautician|tailor|salesman|boy|girl|staff|head|"
    r"partner|programmer|merchandiser|surveyor|draftsman|foreman|storekeeper|packer|picker|rider|caretaker)s?\b",
    re.I,
)
LOCATION_KEY = re.compile(
    r"^\s*(?:job\s*)?(?:location|work\s*location|place of work|city|based in|posting|जगह|स्थान)\s*[:\-–—]\s*(.+)$",
    re.I,
)
EXP_KEY = re.compile(r"^\s*(?:experience|exp|work experience|अनुभव|anubhav)\s*(?:required)?\s*[:\-–—]\s*(.+)$", re.I)
EDU_KEY = re.compile(r"^\s*(?:education|qualification|educational qualification|शिक्षा|योग्यता)\s*[:\-–—]\s*(.+)$", re.I)
HIRING = re.compile(r"^(.{2,60}?)\s+(?:is|are)\s+(?:hiring|looking for|recruiting)\b(.*)$", re.I)
AT_COMPANY = re.compile(r"\b(?:at|@|(?i:join))\s+([A-Z][\w&.\- ]{1,40}?)(?:[,.!]|\s+(?:as|is|in|for|we)\b|$)")

YEARS = r"(?:years?|yrs?\.?|saal|sal|वर्ष|साल)"
RANGE = re.compile(rf"(\d{{1,2}}(?:\.\d)?)\s*(?:-|–|—|to|se)\s*(\d{{1,2}}(?:\.\d)?)\s*\+?\s*{YEARS}", re.I)
PLUS = re.compile(rf"(?:min(?:imum)?\.?\s*(?:of\s*)?)?(\d{{1,2}}(?:\.\d)?)\s*\+?\s*{YEARS}", re.I)
MONTHS = re.compile(r"(\d{1,2})\s*(?:months?|mahine|महीने)", re.I)
FRESHER = re.compile(
    r"\bfreshers?\b|\bno experience\b|\b0\s*(?:-|to)\s*1\b|entry[\s-]level|graduates? (?:can|may) apply|"
    r"anubhav (?:ki )?zaroorat nahi|naye log|नए लोग|अनुभव की ज़रूरत नहीं",
    re.I,
)
EXP_CONTEXT = re.compile(r"experience|exp\b|anubhav|अनुभव|work(?:ed|ing)? (?:in|on|with)|background", re.I)

# education: the level (for scoring) and the words that name it
EDU_LEVELS: list[tuple[int, str, re.Pattern]] = [
    (7, "PhD", re.compile(r"\bph\.?\s?d\b|doctorate", re.I)),
    (
        6,
        "Post-graduate",
        re.compile(
            r"\bm\.?\s?tech\b|(?-i:\bM\.?\s?E\b)(?!\w)|\bmba\b|\bpgdm\b|\bmca\b|\bm\.?\s?sc\b|\bm\.?\s?com\b|(?-i:\bM\.?\s?A\b)(?!\w)|"
            r"post[\s-]?graduat|master'?s|\bpg\b|\bm\.?\s?pharm\b|\bmd\b|\bms\b(?= in)|\bllm\b|\bmsw\b",
            re.I,
        ),
    ),
    (
        5,
        "Graduate",
        re.compile(
            r"\bb\.?\s?tech\b|(?-i:\bB\.?\s?E\b)(?!\w)|\bbca\b|\bbba\b|\bb\.?\s?sc\b|\bb\.?\s?com\b|"
            r"(?-i:\bB\.?\s?A\b)(?!\w)|"
            r"bachelor'?s?|\bgraduat(?:e|ion)\b|any degree|\bdegree\b|\bllb\b|\bmbbs\b|\bbds\b|\bb\.?\s?pharm\b|"
            r"\bbhm\b|\bb\.?\s?ed\b|\bb\.?\s?arch\b|\bca\b(?= |$)|chartered accountant|"
            r"\bb\.?\s?sc\.?\s?nursing\b|स्नातक",
            re.I,
        ),
    ),
    (4, "Diploma", re.compile(r"\bdiploma\b|\bpolytechnic\b|\bd\.?\s?pharm\b|\banm\b|\bgnm\b", re.I)),
    (3, "ITI", re.compile(r"\biti\b|\bncvt\b|\bscvt\b", re.I)),
    (
        2,
        "12th",
        re.compile(
            r"\b12(?:th)?\b(?=.{0,12}(?:pass|class|std|standard|grade))|\bhsc\b|\bintermediate\b|"
            r"\bpuc\b|\b12th\b|\+2\b|higher secondary|बारहवीं|12वीं",
            re.I,
        ),
    ),
    (
        1,
        "10th",
        re.compile(
            r"\b10(?:th)?\b(?=.{0,12}(?:pass|class|std|standard|grade))|\bssc\b|\bmatric|\b10th\b|"
            r"secondary school|दसवीं|10वीं",
            re.I,
        ),
    ),
]
FIELD = re.compile(
    r"(?:in|of)\s+(computer science|cs|it|information technology|electronics|ece|eee|electrical|mechanical|civil|"
    r"commerce|finance|accounting|marketing|hr|human resources|statistics|mathematics|economics|chemistry|physics|"
    r"biology|pharmacy|nursing|hotel management|fashion|design|journalism|mass communication|law)\b",
    re.I,
)

BULLET = re.compile(r"^\s*(?:[-*•●▪◦·►➤✓✔→]+|\d{1,2}[.)]|[a-z][.)])\s+")
CITIES = (
    "Bengaluru|Bangalore|Mumbai|Navi Mumbai|Thane|Pune|Hyderabad|Secunderabad|Chennai|Kolkata|Delhi|New Delhi|"
    "Noida|Greater Noida|Gurugram|Gurgaon|Faridabad|Ghaziabad|Ahmedabad|Gandhinagar|Surat|Vadodara|Rajkot|Jaipur|"
    "Lucknow|Kanpur|Indore|Bhopal|Nagpur|Nashik|Aurangabad|Coimbatore|Madurai|Tiruchirappalli|Trichy|Salem|Kochi|"
    "Cochin|Thiruvananthapuram|Trivandrum|Kozhikode|Calicut|Thrissur|Mysuru|Mysore|Mangaluru|Mangalore|Hubli|"
    "Belagavi|Visakhapatnam|Vizag|Vijayawada|Guntur|Tirupati|Nellore|Kurnool|Anantapur|Warangal|Karimnagar|"
    "Bhubaneswar|Cuttack|Raipur|Ranchi|Jamshedpur|Patna|Guwahati|Chandigarh|Mohali|Ludhiana|Amritsar|Dehradun|"
    "Varanasi|Prayagraj|Allahabad|Agra|Meerut|Jodhpur|Udaipur|Kota|Goa|Panaji|Puducherry|Pondicherry|Srinagar|"
    "Jammu|Shimla|Siliguri|Durgapur|Asansol|Remote|Work from home|WFH|Hybrid|Pan India|Anywhere in India"
)
CITY = re.compile(rf"\b({CITIES})\b", re.I)
WORDS_STOP = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "for",
    "in",
    "on",
    "at",
    "to",
    "with",
    "we",
    "are",
    "is",
    "our",
    "you",
    "your",
    "will",
    "be",
    "as",
    "by",
    "from",
    "this",
    "that",
    "who",
    "can",
    "must",
    "should",
    "have",
    "has",
}


@dataclass
class Parsed:
    title: str = ""
    company: str = ""
    location: str = ""
    exp_min: float | None = None  # years
    exp_max: float | None = None
    fresher: bool = False
    education: list[str] = field(default_factory=list)  # "Graduate", "Diploma", ...
    edu_level: int = 0  # the lowest level the post accepts (0 = not said)
    edu_fields: list[str] = field(default_factory=list)
    must: list[str] = field(default_factory=list)  # skills (tech + tool), canonical names
    nice: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)  # the tools among must + nice
    certs: list[str] = field(default_factory=list)
    soft: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    nice_extra: list[str] = field(default_factory=list)  # the certifications / languages / soft skills marked nice
    duties: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)  # duty words for the "duties in your bullets" part
    confidence: str = "high"  # high / low (the router may ask AI to read a low one)
    source: str = "rules"  # rules / ai

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


EMAIL_OR_LINK = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|https?://\S+|www\.\S+", re.I)


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = EMAIL_OR_LINK.sub(" ", text)
    text = re.sub(r"[  ]{2,}", " ", text)
    return text[:MAX_TEXT].strip()


def _clean_value(v: str, limit: int = 80) -> str:
    v = re.sub(r"[*_#|]+", " ", v)
    v = " ".join(v.split()).strip(" -–—:,.;")
    return v[:limit]


def _years(text: str) -> tuple[float | None, float | None, bool]:
    """(min, max, fresher) from the whole post."""
    fresher = bool(FRESHER.search(text))
    for line in text.split("\n"):
        if not (EXP_CONTEXT.search(line) or EXP_KEY.match(line) or re.search(YEARS, line, re.I)):
            continue
        m = RANGE.search(line)
        if m:
            lo, hi = float(m.group(1)), float(m.group(2))
            if lo <= hi <= 40:
                return lo, hi, fresher or lo == 0
        m = PLUS.search(line)
        if m and (EXP_CONTEXT.search(line) or EXP_KEY.match(line)):
            n = float(m.group(1))
            if n <= 40:
                return n, None, fresher or n == 0
        m = MONTHS.search(line)
        if m and EXP_CONTEXT.search(line):
            return round(int(m.group(1)) / 12, 1), None, fresher
    if fresher:
        return 0.0, 1.0, True
    return None, None, False


def _education(text: str) -> tuple[list[str], int, list[str]]:
    found: list[tuple[int, str]] = []
    for level, name, pat in EDU_LEVELS:
        if pat.search(text):
            found.append((level, name))
    fields = []
    for m in FIELD.finditer(text):
        f = m.group(1).strip()
        f = {
            "cs": "Computer Science",
            "it": "Information Technology",
            "ece": "Electronics",
            "eee": "Electrical",
            "hr": "Human Resources",
        }.get(f.lower(), f.title())
        if f not in fields:
            fields.append(f)
    if not found:
        return [], 0, fields
    return [n for _, n in sorted(found, reverse=True)], min(lv for lv, _ in found), fields[:4]


def _heading(line: str) -> str | None:
    """'nice' / 'must' / 'duty' / 'other' when the line is a section heading, else None."""
    if BULLET.match(line):
        return None
    head = line.split(":", 1)[0] if ":" in line else line
    s = head.strip().strip("*#_-–— ").strip()
    if not s or len(s) > 70:
        return None
    # a heading is short: "Requirements", "About us: …", "Good to have: …"
    if len(s.split()) > 6 and not line.rstrip().endswith(":"):
        return None
    if NICE_HEAD.search(s):
        return "nice"
    if DUTY_HEAD.search(s):
        return "duty"
    if MUST_HEAD.search(s):
        return "must"
    if OTHER_HEAD.search(s):
        return "other"
    return None


TITLE_NOISE = re.compile(
    r"\s*(?:[-–—|:,(]\s*(?:fresher|freshers|urgent|immediate joiner|wfh|remote|hybrid|"
    rf"{CITIES}).*$|\d{{1,2}}\s*(?:-|–|to)?\s*\d{{0,2}}\s*\+?\s*{YEARS}.*$|\s+(?:chahiye|ki zaroorat hai|"
    r"needed|wanted|required)\b.*$|[!*🔥]+.*$)",
    re.I,
)


def _tidy_title(v: str) -> str:
    v = TITLE_NOISE.sub("", _clean_value(v)).strip(" -–—:,.")
    v = re.split(r"\s+(?:for our|for a|to join|in our|at|@|with)\s+", v, maxsplit=1, flags=re.I)[0]
    v = re.sub(r"^(?:an?|the)\s+", "", v, flags=re.I).strip()
    if v and v == v.lower():  # "react js developer" → "React Js Developer"
        v = " ".join(w[:1].upper() + w[1:] for w in v.split())
    return v if 1 <= len(v.split()) <= 8 else ""


def _first_line_title(line: str) -> str:
    """The post's first line, when it is a short job title ("Senior Java Developer", "Delivery Driver chahiye")."""
    if COMPANY_KEY.match(line) or LOCATION_KEY.match(line) or EXP_KEY.match(line) or BULLET.match(line):
        return ""
    v = _tidy_title(line)
    if not v or re.search(r"[.!?]$", line.strip()) or re.search(r"\d{5,}", v):
        return ""
    if ROLE_WORD.search(v) or (len(v.split()) <= 4 and not _heading(line)):
        return v
    return ""


def _title(lines: list[str]) -> str:
    for line in lines[:30]:  # "Job title: …", "Position: …", "Hiring for …"
        m = TITLE_KEY.match(line)
        if m:
            v = _tidy_title(m.group(1))
            if v:
                return v
    for line in lines[:3]:  # the first line is usually the title
        v = _first_line_title(line)
        if v:
            return v
    for line in lines[:8]:  # "Acme is hiring a Senior Java Developer for …"
        m = HIRING.match(line.strip())
        if m:
            v = _tidy_title(re.sub(r"^\s*(?:for\s+)?(?:an?\s+)?", "", m.group(2), flags=re.I))
            if v:
                return v
    for line in lines[:12]:  # any early line that names a role
        v = _tidy_title(line)
        if v and ROLE_WORD.search(v) and not _heading(line) and not BULLET.match(line):
            return v
    return ""


NOT_A_COMPANY = re.compile(r"^(?:we|our|us|what|who|the|this|a|an|you|your|client|company|team|hiring)\b", re.I)


def _company(lines: list[str], text: str) -> str:
    for line in lines[:40]:
        m = COMPANY_KEY.match(line)
        if m:
            return _clean_value(m.group(1), 60)
    for line in lines[:8]:
        m = HIRING.match(line.strip())
        if m:
            name = _clean_value(m.group(1), 60)
            if name and not NOT_A_COMPANY.match(name) and not ROLE_WORD.search(name):
                return name
    m = HINGLISH_COMPANY.search(text)
    if m:
        return _clean_value(m.group(1), 60)
    for line in lines[:40]:
        m = re.match(r"^\s*about\s+([A-Z][\w&.\- ]{1,40})\s*:?\s*$", line)
        if (
            m
            and not NOT_A_COMPANY.match(m.group(1).strip())
            and m.group(1).strip().lower() not in ("the role", "the job")
        ):
            return _clean_value(m.group(1), 60)
    m = AT_COMPANY.search("\n".join(lines[:6]))
    if m:
        name = _clean_value(m.group(1), 60)
        if name and not NOT_A_COMPANY.match(name) and not CITY.fullmatch(name):
            return name
    return ""


def _location(lines: list[str], text: str) -> str:
    for line in lines[:60]:
        m = LOCATION_KEY.match(line)
        if m:
            return _clean_value(m.group(1), 60)
    found = []
    for m in CITY.finditer(text):
        c = m.group(1)
        if c.lower() not in [x.lower() for x in found]:
            found.append(c)
    return ", ".join(found[:3])


def _duty_keywords(duties: list[str]) -> list[str]:
    """The words a recruiter scans for in the bullets: skills named in the duties first, then strong verbs/nouns."""
    out: list[str] = []
    for d in duties:
        for s in dictionary.find(d):
            if s not in out:
                out.append(s)
    for d in duties:
        for w in re.findall(r"[A-Za-z][A-Za-z+#.\-]{3,}", d):
            lw = w.lower().strip(".")
            if lw in WORDS_STOP or lw in COMMON_DUTY_FILLER or len(lw) < 4:
                continue
            if not any(lw == o.lower() for o in out):
                out.append(lw)
    return out[:20]


COMMON_DUTY_FILLER = {
    "work",
    "working",
    "team",
    "teams",
    "ensure",
    "ensuring",
    "various",
    "other",
    "related",
    "including",
    "responsible",
    "responsibilities",
    "required",
    "requirements",
    "candidate",
    "candidates",
    "should",
    "would",
    "their",
    "they",
    "them",
    "also",
    "well",
    "good",
    "strong",
    "ability",
    "able",
    "using",
    "within",
    "across",
    "daily",
    "basis",
    "time",
    "times",
    "need",
    "needs",
    "help",
    "helping",
    "make",
    "making",
    "take",
    "taking",
    "provide",
    "providing",
    "support",
    "supporting",
    "handle",
    "handling",
    "manage",
    "managing",
    "maintain",
    "maintaining",
    "company",
    "business",
    "job",
    "role",
    "about",
    "like",
    "more",
    "than",
    "into",
    "over",
    "under",
    "such",
    "each",
    "every",
    "where",
    "when",
    "what",
    "which",
    "while",
    "will",
    "your",
    "with",
    # Hindi-English words that are not duties
    "karna",
    "karni",
    "karne",
    "aur",
    "hoga",
    "hogi",
    "hain",
    "mein",
    "bhejna",
    "dena",
    "lena",
    "wala",
    "wale",
    "apni",
    "apna",
    "sabhi",
    "roz",
    "rozana",
}


def parse(text: str) -> Parsed:
    text = clean_text(text)
    lines = [ln for ln in text.split("\n")]
    p = Parsed()
    p.title = _title([ln for ln in lines if ln.strip()])
    p.company = _company([ln for ln in lines if ln.strip()], text)
    p.location = _location(lines, text)
    p.exp_min, p.exp_max, p.fresher = _years(text)
    p.education, p.edu_level, p.edu_fields = _education(text)

    section = "must"  # text before any heading counts as what they ask for
    must: list[str] = []
    nice: list[str] = []
    duties: list[str] = []
    other_skills: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        h = _heading(line)
        if h:
            section = h
            # "Skills: Python, SQL" or "good to have nextjs, jest": the heading line's own skills count too
            line = line.split(":", 1)[1] if ":" in line else line
            if not line.strip():
                continue
        dk = DUTY_KEY.match(line)
        if dk:  # "Kaam: orders deliver karna" is a duty, whatever section it is in
            duties.append(_clean_value(dk.group(1), 220))
        # an education line names degree subjects ("B.Sc in Statistics or Mathematics"), not skills
        if EDU_KEY.match(line) or (FIELD.search(line) and any(pat.search(line) for _, _, pat in EDU_LEVELS)):
            continue
        line_skills = dictionary.find(line)
        if section == "other":
            other_skills += line_skills  # e.g. "About us: we build Python tools" is not a requirement
            continue
        is_nice = section == "nice" or bool(NICE_LINE.search(line))
        if section == "duty":
            d = _clean_value(BULLET.sub("", line), 220)
            if len(d.split()) >= 3:
                duties.append(d)
        for s in line_skills:
            (nice if is_nice else must).append(s)

    def uniq(xs: list[str]) -> list[str]:
        out: list[str] = []
        for x in xs:
            if x not in out:
                out.append(x)
        return out

    must = uniq(must)
    nice = [s for s in uniq(nice) if s not in must]
    kinds = {s: dictionary.kind(s) for s in must + nice}
    p.certs = [s for s in must + nice if kinds[s] == "cert"]
    p.soft = [s for s in must + nice if kinds[s] == "soft"]
    p.languages = [s for s in must + nice if kinds[s] == "lang"]
    hard = ("tech", "tool")
    p.must = [s for s in must if kinds[s] in hard]
    p.nice = [s for s in nice if kinds[s] in hard]
    p.tools = [s for s in p.must + p.nice if kinds[s] == "tool"]
    p.nice_extra = [s for s in nice if kinds[s] not in hard]
    if not duties:  # no duties heading: sentences that start with a verb-like word are the duties
        for line in lines:
            s = _clean_value(BULLET.sub("", line), 220)
            if BULLET.match(line) and len(s.split()) >= 4 and not _heading(line):
                duties.append(s)
    p.duties = uniq(duties)[:12]
    p.keywords = _duty_keywords(p.duties)
    long_post = len(text) > 400
    if not p.title or (long_post and len(p.must) + len(p.nice) < 2):
        p.confidence = "low"
    return p
