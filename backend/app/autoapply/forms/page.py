"""Reading a company's application page (Auto Apply 2.0, A5): the forms on it, what would stop automation (a CAPTCHA
or any challenge, a login, an account, a multi-step wizard, a payment, a page that needs JavaScript), the terms page
link, a text snapshot, and filling a simple form from the candidate's own facts.

Standard library only (html.parser): no browser, no JavaScript, nothing executed.
"""

import hashlib
import re
from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
from typing import Any

# any CAPTCHA or bot challenge, by widget, script or page (the form is never touched when one shows)
CAPTCHA = re.compile(
    r"g-recaptcha|grecaptcha|google\.com/recaptcha|recaptcha/(?:api|enterprise)|gstatic\.com/recaptcha|"
    r"h-captcha|hcaptcha\.com|data-hcaptcha|cf-turnstile|challenges\.cloudflare\.com|turnstile/v0|"
    r"cf-chl|cf_chl|__cf_chl|cf-challenge|checking your browser|just a moment\.\.\.|attention required! \| cloudflare|"
    r"arkoselabs|funcaptcha|friendlycaptcha|frc-captcha|geetest|mtcaptcha|px-captcha|perimeterx|captcha-delivery|"
    r"datadome|aws-waf-token|awswaf|captcha|are you a robot|verify you are human|i'm not a robot|i am not a robot",
    re.I,
)
LOGIN_URL = re.compile(r"(?:^|[/?&=._-])(log-?in|sign-?in|sign_in|signin|sso|oauth2?|auth|register|sign-?up|"
                       r"create-account|account/new)(?:$|[/?&=._-])", re.I)  # fmt: skip
NEEDS_JS = re.compile(r"enable javascript|javascript (?:is )?(?:required|disabled)|requires javascript|"
                      r"turn on javascript|you need to enable javascript", re.I)  # fmt: skip
STEP = re.compile(r"\b(?:step|wizard|multi-?step|stepper)\b", re.I)
NEXT = re.compile(r"^\s*(?:next|continue|proceed|save (?:and|&) continue|next step)\b", re.I)
PAYMENT = re.compile(r"cc-(?:number|csc|exp)|card.?number|\bcvv\b|\bcvc\b|\bupi\b|payment|\bpay now\b|"
                     r"application fee|razorpay|paytm|stripe", re.I)  # fmt: skip
TERMS_LINK = re.compile(r"terms|conditions|\btos\b|legal|acceptable.?use|website.?use", re.I)
BOT = re.compile(r"\b(?:automat\w*|bots?|robots?|scrap\w*|crawl\w*|spiders?|harvest\w*|data.?mining)\b", re.I)
NO = re.compile(
    r"\b(?:prohibit\w*|forbid\w*|not (?:be )?(?:permitted|allowed|authori[sz]ed)|may not|must not|shall not|cannot|"
    r"can ?not|do not|don't|disallow\w*|agree not|without (?:our |the )?(?:prior |express )?(?:written )?"
    r"(?:permission|consent|authori[sz]ation)|no (?:automated|bots?|robots?|scraping|crawling))\b",
    re.I,
)
SUCCESS = re.compile(r"thank you|thanks for|received your|been received|successfully|submitted|we will (?:be in touch|"
                     r"contact|review|get back)|we'll (?:be in touch|get back)|application (?:has been|was) (?:sent|"
                     r"received|submitted)|success", re.I)  # fmt: skip
FAILED = re.compile(r"\berror\b|is required|are required|invalid|please (?:correct|fix|fill|enter|try again)|"
                    r"something went wrong|failed|not valid", re.I)  # fmt: skip
SENSITIVE = re.compile(r"gender|\bsex\b|religion|caste|\bcategory\b(?! of)|marital|date of birth|\bdob\b|birth|"
                       r"\bage\b|aadha+r|\bpan\b|passport|photo|father|mother|husband|spouse|nationality|disab|"
                       r"\bbank\b|ifsc|account number", re.I)  # fmt: skip
SNAPSHOT_MAX = 4000


@dataclass
class Field:
    tag: str
    type: str
    name: str
    id: str = ""
    value: str = ""
    required: bool = False
    label: str = ""
    placeholder: str = ""
    aria: str = ""
    auto: str = ""
    maxlength: int = 0
    checked: bool = False
    options: list[tuple[str, str]] = field(default_factory=list)  # (value, text)

    @property
    def text(self) -> str:
        """What a person reads for this field."""
        for t in (self.label, self.aria, self.placeholder):
            t = " ".join(t.replace("*", " ").split()).strip(" :")
            if t:
                return t[:160]
        return re.sub(r"[_\-\[\]]+", " ", self.name).strip().capitalize()[:160]

    @property
    def hint(self) -> str:
        return " ".join((self.label, self.aria, self.placeholder, self.name, self.id, self.auto)).lower()


@dataclass
class Form:
    action: str
    method: str
    enctype: str
    onsubmit: bool = False
    fields: list[Field] = field(default_factory=list)
    buttons: list[dict[str, str]] = field(default_factory=list)  # {type, name, value, text}
    marks: list[str] = field(default_factory=list)  # class / id / data-* attributes inside the form


class _Parser(HTMLParser):
    VOID_SKIP = ("script", "style", "noscript", "template", "svg")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms: list[Form] = []
        self.form: Form | None = None
        self.links: list[tuple[str, str]] = []
        self.scripts = 0
        self.noscript: list[str] = []
        self.text: list[str] = []
        self.title = ""
        self._skip = 0
        self._in = ""  # "title" / "noscript"
        self._labels: list[dict[str, Any]] = []
        self._for: dict[str, str] = {}
        self._select: Field | None = None
        self._option: list[Any] | None = None
        self._textarea: Field | None = None
        self._button: dict[str, str] | None = None
        self._a: list[Any] | None = None

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v if v is not None else "") for k, v in attrs}
        if tag in ("script",):
            self.scripts += 1
        if tag in self.VOID_SKIP:
            self._skip += 1
            if tag == "noscript":
                self._in = "noscript"
            return
        if tag == "title":
            self._in = "title"
        if self.form is not None:
            marks = " ".join(v for k, v in a.items() if k in ("class", "id") or k.startswith("data-"))
            if marks:
                self.form.marks.append(marks)
        if tag == "form":
            self.form = Form(
                action=a.get("action", ""),
                method=(a.get("method") or "get").lower(),
                enctype=(a.get("enctype") or "application/x-www-form-urlencoded").lower(),
                onsubmit=bool(a.get("onsubmit")),
            )
            self.forms.append(self.form)
        elif tag == "label":
            self._labels.append({"for": a.get("for", ""), "text": [], "fields": []})
        elif tag == "a":
            self._a = [a.get("href", ""), []]
        elif tag in ("input", "select", "textarea") and self.form is not None:
            typ = (a.get("type") or "text").lower() if tag == "input" else tag
            if tag == "input" and typ in ("submit", "image", "button", "reset"):
                if typ in ("submit", "image"):
                    self.form.buttons.append({"type": "submit", "name": a.get("name", ""),
                                              "value": a.get("value", ""), "text": a.get("value", "")})  # fmt: skip
                else:
                    self.form.buttons.append({"type": typ, "name": "", "value": "", "text": a.get("value", "")})
                return
            try:
                ml = int(a.get("maxlength") or 0)
            except ValueError:
                ml = 0
            f = Field(
                tag=tag,
                type=typ,
                name=a.get("name", ""),
                id=a.get("id", ""),
                value=a.get("value", ""),
                required="required" in a or a.get("aria-required") == "true",
                placeholder=a.get("placeholder", ""),
                aria=a.get("aria-label", ""),
                auto=a.get("autocomplete", ""),
                maxlength=ml,
                checked="checked" in a,
            )
            if "disabled" in a:
                return
            self.form.fields.append(f)
            if self._labels:
                self._labels[-1]["fields"].append(f)
            if tag == "select":
                self._select = f
            elif tag == "textarea":
                self._textarea = f
        elif tag == "option" and self._select is not None:
            self._option = [a.get("value"), [], "selected" in a]
        elif tag == "button" and self.form is not None:
            self._button = {"type": (a.get("type") or "submit").lower(), "name": a.get("name", ""),
                            "value": a.get("value", ""), "text": ""}  # fmt: skip

    def handle_endtag(self, tag):
        if tag in self.VOID_SKIP:
            self._skip = max(0, self._skip - 1)
            if tag == "noscript":
                self._in = ""
            return
        if tag == "title":
            self._in = ""
        elif tag == "form":
            self.form = None
        elif tag == "label" and self._labels:
            lab = self._labels.pop()
            text = " ".join("".join(lab["text"]).split())
            if lab["for"]:
                self._for[lab["for"]] = text
            for f in lab["fields"]:
                f.label = f.label or text
            if self._labels:
                self._labels[-1]["text"].append(text + " ")
        elif tag == "a" and self._a is not None:
            self.links.append((self._a[0], " ".join("".join(self._a[1]).split())))
            self._a = None
        elif tag == "option" and self._option is not None and self._select is not None:
            text = " ".join("".join(self._option[1]).split())
            val = self._option[0] if self._option[0] is not None else text
            self._select.options.append((val, text))
            if self._option[2]:
                self._select.value = val
            self._option = None
        elif tag == "select":
            self._select = None
        elif tag == "textarea":
            self._textarea = None
        elif tag == "button" and self._button is not None and self.form is not None:
            self._button["text"] = " ".join(self._button["text"].split())
            self.form.buttons.append(self._button)
            self._button = None

    def handle_data(self, data):
        if self._in == "noscript":
            self.noscript.append(data)
        if self._skip:
            return
        if self._in == "title":
            self.title += data
        if self._labels and self._option is None and self._textarea is None and self._select is None:
            self._labels[-1]["text"].append(data)
        if self._a is not None:
            self._a[1].append(data)
        if self._option is not None:
            self._option[1].append(data)
        if self._textarea is not None:
            self._textarea.value += data
        if self._button is not None:
            self._button["text"] += data
        self.text.append(data)

    def finish(self):
        for fm in self.forms:
            for f in fm.fields:
                if not f.label and f.id and f.id in self._for:
                    f.label = self._for[f.id]


@dataclass
class Page:
    html: str
    forms: list[Form]
    links: list[tuple[str, str]]
    text: str
    title: str
    scripts: int
    noscript: str


def parse(html: str) -> Page:
    p = _Parser()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001 — broken HTML: whatever was read so far
        pass
    p.finish()
    text = " ".join(" ".join(p.text).split())
    return Page(html, p.forms, p.links, text, " ".join(p.title.split()), p.scripts, " ".join(p.noscript))


def snapshot(html_or_text: str, limit: int = SNAPSHOT_MAX) -> str:
    """A plain text copy of a page (scripts and styles left out), at most `limit` characters."""
    if "<" in html_or_text:
        pg = parse(html_or_text)
        t = (pg.title + " — " if pg.title else "") + pg.text
    else:
        t = " ".join(html_or_text.split())
    t = unescape(t)
    return t if len(t) <= limit else t[: limit - 1] + "…"


def captcha(html: str) -> bool:
    return bool(CAPTCHA.search(html))


def login_url(url: str) -> bool:
    from urllib.parse import urlsplit

    p = urlsplit(url)
    return bool(LOGIN_URL.search(p.path + "?" + p.query))


def has_password(pg: Page) -> bool:
    return any(f.type == "password" for fm in pg.forms for f in fm.fields)


def terms_links(pg: Page) -> list[str]:
    out = []
    for href, text in pg.links:
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        if TERMS_LINK.search(text) or TERMS_LINK.search(href.rsplit("/", 1)[-1] or href):
            if "privacy" in href.lower() and "terms" not in href.lower() and "terms" not in text.lower():
                continue
            out.append(href)
    return out[:2]


def terms_forbid(text: str) -> str | None:
    """The sentence of a terms page that rules out automated use (bots, scraping, crawling …), or None."""
    for s in re.split(r"(?<=[.!?;])\s+|\n+", " ".join(text.split())):
        if BOT.search(s) and NO.search(s):
            return s.strip()[:300]
    return None


def _visible(f: Field) -> bool:
    return f.type not in ("hidden",)


def _score(fm: Form) -> int:
    vis = [f for f in fm.fields if _visible(f)]
    if not vis:
        return -1
    s = 0
    s += 3 * any(f.type == "file" for f in vis)
    s += 2 * any(f.type == "email" or "email" in f.hint for f in vis)
    s += any("name" in f.hint for f in vis)
    s += any(f.tag == "textarea" for f in vis)
    s += any(re.search(r"phone|mobile|tel", f.hint) for f in vis)
    s += any(f.type == "password" for f in vis) * 2  # a login form still counts, so it is seen (and refused)
    if len(vis) <= 2 and not any(f.type == "file" for f in vis):
        s -= 3  # a search box or a newsletter sign-up
    return s


def application_form(pg: Page) -> Form | None:
    """The page's application form: the best scoring one (an email, a name, a resume upload …), or None."""
    best = sorted(((_score(f), i) for i, f in enumerate(pg.forms)), reverse=True)
    if not best or best[0][0] < 3:
        return None
    return pg.forms[best[0][1]]


def blocker(pg: Page, fm: Form | None) -> str | None:
    """Why this page can't be filled by plain HTTP: captcha, login, multi_step, payment, needs_js, not_post."""
    if captcha(pg.html):
        return "captcha"
    if fm is None:
        if has_password(pg):
            return "login"
        if NEEDS_JS.search(pg.noscript + " " + pg.text[:2000]) or (pg.scripts >= 3 and len(pg.text) < 400):
            return "needs_js"
        return None
    vis = [f for f in fm.fields if _visible(f)]
    if any(f.type == "password" for f in fm.fields):
        return "login"
    if any(PAYMENT.search(f.hint) for f in vis) or any(PAYMENT.search(b["text"]) for b in fm.buttons):
        return "payment"
    submits = [b for b in fm.buttons if b["type"] == "submit"]
    if any(NEXT.search(b["text"] or b["value"]) for b in fm.buttons) or any(STEP.search(m) for m in fm.marks):
        return "multi_step"
    if any(f.name.lower() in ("step", "page", "wizard_step", "current_step") for f in fm.fields):
        return "multi_step"
    if fm.onsubmit or not submits:
        return "needs_js"
    named = [f for f in vis if f.name]
    if len(named) < len(vis) / 2 or not named:
        return "needs_js"
    if fm.method != "post":
        return "not_post"
    return None


def success(text: str) -> bool:
    return bool(SUCCESS.search(text))


def failed(text: str) -> bool:
    return bool(FAILED.search(text)) and not success(text)


# ---------- filling ----------


def qid(text: str) -> str:
    return "f" + hashlib.sha1(text.lower().encode()).hexdigest()[:10]


@dataclass
class Facts:
    """Only what the candidate's own resume, saved answers and Nm7 profile say. Nothing is ever invented."""

    first: str
    last: str
    email: str
    phone: str
    city: str
    links: dict[str, str]
    current_company: str
    current_title: str
    degree: str
    college: str
    grad_year: str
    notice: str
    salary: str
    cover: str
    job_title: str
    profile: str
    saved: dict[str, Any]
    resume_name: str


# (pattern on the field's label / name / id / placeholder / autocomplete) → the fact it asks for. First match wins.
RULES: tuple[tuple[str, str], ...] = (
    (r"confirm.?e-?mail|e-?mail.?(?:again|confirm)|re-?enter.?e-?mail", "email"),
    (r"e-?mail", "email"),
    (r"first.?name|given.?name|\bfname\b|forename", "first"),
    (r"last.?name|surname|family.?name|\blname\b", "last"),
    (r"middle.?name", "skip"),
    (r"user.?name|login", "unknown"),
    (r"company.?name|employer|current.?(?:company|organi[sz]ation)", "current_company"),
    (r"(?:current|present).?(?:title|designation|role|position)|designation", "current_title"),
    (r"linked.?in", "linkedin"),
    (r"git.?hub", "github"),
    (r"portfolio|personal.?(?:web)?site|website|\burl\b|blog", "website"),
    (r"full.?name|your.?name|candidate.?name|applicant.?name|^\s*name\b|\bname\b", "name"),
    (r"phone|mobile|\btel\b|contact.?(?:no|number)|whats.?app", "phone"),
    (r"notice", "notice"),
    (r"expected.?(?:ctc|salary|pay|compensation)|salary.?expect", "salary"),
    (r"current.?(?:ctc|salary)|present.?(?:ctc|salary)", "unknown"),
    (
        r"cover.?(?:letter|note)|message|why.?(?:do )?you|about.?(?:yourself|you)|introduc|motivation|"
        r"additional.?(?:info|information|details)|comments?|anything.?else",
        "cover",
    ),
    (r"(?:position|job|role|post).?(?:applied|title|interested)|applying.?for|^\s*position\b|^\s*role\b", "job_title"),
    (r"degree|qualification|education", "degree"),
    (r"college|university|institut|school", "college"),
    (r"graduat|passing.?year|year.?of.?(?:passing|completion)", "grad_year"),
    (r"\bcity\b|current.?location|^\s*location\b|\blocation\b|town", "city"),
    (r"how.?did.?you.?(?:hear|find|know)|source|referr", "source"),
    (r"profile.?link|nm7", "profile"),
)


def _rule(f: Field) -> str:
    h = f.hint
    if f.type == "email" or f.auto == "email":
        return "email"
    if f.type == "tel" or f.auto == "tel":
        return "phone"
    if f.auto in ("given-name",):
        return "first"
    if f.auto in ("family-name",):
        return "last"
    if f.auto == "name":
        return "name"
    if SENSITIVE.search(h):
        return "sensitive"
    for rx, what in RULES:
        if re.search(rx, h, re.I):
            return what
    return "unknown"


def _fact(what: str, f: Facts) -> str:
    return {
        "email": f.email,
        "first": f.first,
        "last": f.last,
        "name": " ".join(x for x in (f.first, f.last) if x),
        "phone": f.phone,
        "linkedin": f.links.get("linkedin", ""),
        "github": f.links.get("github", ""),
        "website": f.links.get("portfolio") or f.links.get("website") or "",
        "current_company": f.current_company,
        "current_title": f.current_title,
        "notice": f.notice,
        "salary": f.salary,
        "cover": f.cover,
        "job_title": f.job_title,
        "degree": f.degree,
        "college": f.college,
        "grad_year": f.grad_year,
        "city": f.city,
        "source": "Nm7 (nm7.si)",
        "profile": f.profile,
    }.get(what, "")


def _norm(text: str) -> str:
    from app.autoapply.engine import norm

    return norm(text)


def _pick(options: list[tuple[str, str]], want: str) -> str | None:
    w = want.strip().lower()
    if not w:
        return None
    for v, t in options:
        if w in (str(v).lower(), t.lower()):
            return v
    for v, t in options:
        if t and v not in ("", None) and (w in t.lower() or t.lower() in w) and len(t) > 1:
            return v
    return None


def _yes(v: Any) -> bool:
    return str(v).strip().lower() in ("yes", "true", "1", "y", "agree", "i agree")


@dataclass
class Filled:
    data: list[tuple[str, str]]
    files: list[tuple[str, tuple[str, bytes, str]]]
    proof: list[dict[str, Any]]
    missing: list[dict[str, Any]]  # questions for "Waiting for you": {id, text, kind, options}
    needs_file: bool = False


def fill(fm: Form, facts: Facts, resume_pdf: bytes) -> Filled:
    """Fill the form from the candidate's facts. Anything required that Nm7 doesn't know becomes a question for the
    candidate (never guessed); a required file other than the resume can't be supplied (needs_file)."""
    out = Filled([], [], [], [])
    saved = facts.saved
    radios: dict[str, list[Field]] = {}
    files = [f for f in fm.fields if f.type == "file"]
    for f in fm.fields:
        if f.type == "radio":
            radios.setdefault(f.name, []).append(f)
            continue
        if not f.name:
            continue
        if f.type == "hidden":
            out.data.append((f.name, f.value))
            out.proof.append({"label": f.name, "name": f.name, "value": "", "kind": "hidden"})
            continue
        text = f.text
        key = _norm(text)
        what = _rule(f)
        if f.type == "file":
            is_resume = re.search(r"resume|\bcv\b|curriculum|bio.?data", f.hint) or (
                len(files) == 1 and not re.search(r"cover|photo|picture|image|certificate|id proof", f.hint)
            )
            if is_resume:
                out.files.append((f.name, (facts.resume_name, resume_pdf, "application/pdf")))
                out.proof.append({"label": text, "name": f.name, "value": facts.resume_name, "kind": "file",
                                  "size": len(resume_pdf)})  # fmt: skip
            elif f.required:
                out.needs_file = True
            continue
        answer = saved.get(key)
        value = ""
        kind = "profile"
        if what in ("skip",) and not f.required:
            continue
        if what not in ("sensitive", "unknown", "skip") and what != "cover":
            value = _fact(what, facts)
        elif what == "cover":
            value, kind = facts.cover, "cover"
        if answer not in (None, "") and (not value or what in ("unknown", "sensitive")):
            value, kind = str(answer), "saved"
        if f.type == "checkbox":
            if answer is not None and _yes(answer):
                out.data.append((f.name, f.value or "on"))
                out.proof.append({"label": text, "name": f.name, "value": "Yes", "kind": "saved"})
            elif f.required and answer is None:
                out.missing.append({"id": qid(text), "text": text, "kind": "yesno", "options": []})
            continue
        if f.tag == "select":
            real = [(v, t) for v, t in f.options if str(v).strip() != ""]
            chosen = _pick(real, value) if value else None
            if chosen is None and f.value and not f.required:
                chosen = f.value
            if chosen is None:
                if f.required:
                    opts = [t or str(v) for v, t in real][:20]
                    out.missing.append({"id": qid(text), "text": text, "kind": "choice", "options": opts})
                continue
            out.data.append((f.name, chosen))
            shown = next((t for v, t in f.options if v == chosen), chosen)
            out.proof.append({"label": text, "name": f.name, "value": shown, "kind": kind})
            continue
        if not value:
            if f.required:
                out.missing.append({"id": qid(text), "text": text,
                                    "kind": "number" if f.type == "number" else "text", "options": []})  # fmt: skip
            continue
        cap = f.maxlength or (4000 if f.tag == "textarea" else 300)
        value = value[:cap]
        out.data.append((f.name, value))
        out.proof.append({"label": text, "name": f.name, "value": value[:600], "kind": kind})
    for name, group in radios.items():
        if not name:
            continue
        text = next((g.label for g in group if g.label and len(group) == 1), "") or name
        legend = group[0].aria or re.sub(r"[_\-\[\]]+", " ", name).strip().capitalize()
        text = legend if len(group) > 1 else text
        opts = [(g.value, g.label or g.value) for g in group]
        answer = saved.get(_norm(text))
        chosen = _pick(opts, str(answer)) if answer not in (None, "") else None
        if chosen is None:
            pre = next((g.value for g in group if g.checked), None)
            if pre is not None and not any(g.required for g in group):
                chosen = pre
        if chosen is None:
            if any(g.required for g in group):
                out.missing.append({"id": qid(text), "text": text, "kind": "choice", "options": [t for _, t in opts]})
            continue
        out.data.append((name, chosen))
        out.proof.append({"label": text, "name": name, "value": next(t for v, t in opts if v == chosen),
                          "kind": "saved"})  # fmt: skip
    sub = next((b for b in fm.buttons if b["type"] == "submit"), None)
    if sub and sub.get("name"):
        out.data.append((sub["name"], sub.get("value") or ""))
    return out
