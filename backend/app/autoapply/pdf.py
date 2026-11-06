"""A plain, ATS-friendly PDF of a resume, made on the server (Phase 3, A4: the file attached to an email application
and the "Download the tailored resume" button in "Ready to apply").

One column, real text (no images), the student's own sections in the usual order: name, headline, contact line,
summary, experience, projects, education, skills, certifications, languages. Hidden entries are left out and ID
numbers never appear (the same visible / printed view the ATS check reads). Fonts: the invoices' DejaVu Sans with Noto
fallbacks, so Telugu, Hindi and the ₹ sign print.
"""

from typing import Any

from fpdf.enums import XPos, YPos

from app.billing.pdf import _Doc
from app.core.pii import scrub_id_numbers
from app.core.richtext import plain
from app.orgs.ats import printed

ACCENT = (17, 24, 39)


def _s(v: Any) -> str:
    return plain(str(v or "")).strip()


def _when(e: dict[str, Any]) -> str:
    a, b = _s(e.get("from")), "Present" if e.get("current") else _s(e.get("to"))
    return " – ".join(x for x in (a, b) if x)


class _Resume(_Doc):
    def heading(self, text: str) -> None:
        self.ln(2)
        self.set_text_color(*ACCENT)
        self.line_text(text.upper(), size=9.5, bold=True, h=5)
        y = self.get_y()
        self.set_draw_color(200, 200, 200)
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(1.2)
        self.set_text_color(17, 17, 17)

    def bullet(self, text: str) -> None:
        self.set_font("main", "", 9.3)
        self.set_x(self.l_margin + 3)
        self.multi_cell(0, 4.6, f"• {text}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def row(self, left: str, right: str) -> None:
        self.set_font("main", "B", 9.6)
        w = self.w - self.l_margin - self.r_margin
        rw = self.get_string_width(right) + 2 if right else 0
        y = self.get_y()
        self.multi_cell(w - rw, 4.8, left, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if right:
            end = self.get_y()
            self.set_xy(self.w - self.r_margin - rw, y)
            self.set_font("main", "", 8.8)
            self.cell(rw, 4.8, right, align="R")
            self.set_xy(self.l_margin, end)


def render(data: dict[str, Any]) -> bytes:
    d = scrub_id_numbers(printed(data), strict=True)[0]
    p = d.get("personal") or {}
    links = d.get("links") if isinstance(d.get("links"), dict) else {}
    pdf = _Resume()
    pdf.set_title(f"{_s(p.get('name')) or 'Resume'} – Resume")
    pdf.set_text_color(17, 17, 17)
    pdf.line_text(_s(p.get("name")) or "Resume", size=17, bold=True, h=8)
    if _s(p.get("headline")):
        pdf.line_text(_s(p.get("headline")), size=10, h=5)
    contact = [_s(p.get(k)) for k in ("email", "phone", "location")] + [_s(v) for v in links.values() if _s(v)]
    if any(contact):
        pdf.line_text(" · ".join(x for x in contact if x), size=8.8, h=4.6)
    if _s(d.get("summary")):
        pdf.heading("Summary")
        pdf.line_text(_s(d.get("summary")), size=9.3, h=4.7)
    exp = [e for e in d.get("exp") or [] if isinstance(e, dict) and (e.get("role") or e.get("company"))]
    if exp:
        pdf.heading("Experience")
        for e in exp:
            pdf.row(" – ".join(x for x in (_s(e.get("role")), _s(e.get("company"))) if x), _when(e))
            for line in str(e.get("description") or "").split("\n"):
                if _s(line):
                    pdf.bullet(_s(line).lstrip("•-*– ").strip())
            pdf.ln(1)
    proj = [x for x in d.get("proj") or [] if isinstance(x, dict) and x.get("title")]
    if proj:
        pdf.heading("Projects")
        for x in proj:
            pdf.row(_s(x.get("title")), _s(x.get("tech")))
            for line in [_s(x.get("tagline")), *str(x.get("description") or "").split("\n")]:
                if _s(line):
                    pdf.bullet(_s(line).lstrip("•-*– ").strip())
            pdf.ln(1)
    edu = [e for e in d.get("edu") or [] if isinstance(e, dict) and (e.get("institution") or e.get("degree"))]
    if edu:
        pdf.heading("Education")
        for e in edu:
            deg = " ".join(x for x in (_s(e.get("degree")), _s(e.get("field"))) if x)
            pdf.row(" – ".join(x for x in (deg, _s(e.get("institution"))) if x), _when(e))
            if _s(e.get("grade")):
                pdf.line_text(_s(e.get("grade")), size=8.8, h=4.4)
    groups = [g for g in d.get("skillGroups") or [] if isinstance(g, dict) and _s(g.get("value"))]
    if groups:
        pdf.heading("Skills")
        for g in groups:
            pdf.line_text(
                f"{_s(g.get('label'))}: {_s(g.get('value'))}" if _s(g.get("label")) else _s(g["value"]), size=9.3, h=4.7
            )
    certs = [c for c in d.get("certs") or [] if isinstance(c, dict) and c.get("name")]
    if certs:
        pdf.heading("Certifications")
        for c in certs:
            pdf.bullet(" · ".join(x for x in (_s(c.get("name")), _s(c.get("issuer")), _s(c.get("issueDate"))) if x))
    langs = [x for x in d.get("langs") or [] if isinstance(x, dict) and x.get("name")]
    if langs:
        pdf.heading("Languages")
        pdf.line_text(
            ", ".join(f"{_s(x['name'])} ({_s(x.get('level'))})" if x.get("level") else _s(x["name"]) for x in langs),
            size=9.3,
            h=4.7,
        )
    return bytes(pdf.output())


def file_name(data: dict[str, Any]) -> str:
    name = _s((data.get("personal") or {}).get("name")) or "Resume"
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in name).strip().replace(" ", "_")
    return f"{safe or 'Resume'}_Resume.pdf"
