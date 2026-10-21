"""Invoice, credit note and proforma PDFs, drawn on the server from the frozen snapshot only (never from live data),
so a document looks the same every time it is downloaded.

Fonts: DejaVu Sans (Latin, the ₹ sign) with Noto Sans fallbacks for Devanagari, Bengali, Tamil, Telugu, Kannada and
Malayalam, shaped with HarfBuzz — an organization or address written in an Indian script prints correctly.
GST off: a plain "Invoice" with no GSTIN, tax columns or tax lines.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONTS = Path(__file__).parent / "fonts"
FALLBACKS = ["deva", "beng", "taml", "telu", "knda", "mlym"]
FALLBACK_FILES = {
    "deva": "NotoSansDevanagari-Regular.ttf",
    "beng": "NotoSansBengali-Regular.ttf",
    "taml": "NotoSansTamil-Regular.ttf",
    "telu": "NotoSansTelugu-Regular.ttf",
    "knda": "NotoSansKannada-Regular.ttf",
    "mlym": "NotoSansMalayalam-Regular.ttf",
}
TITLE = {"invoice": "Tax Invoice", "credit_note": "Credit Note", "proforma": "Proforma Invoice"}

_ONES = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen " \
    "Seventeen Eighteen Nineteen".split()  # fmt: skip
_TENS = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()


def _below_1000(n: int) -> str:
    words = []
    if n >= 100:
        words += [_ONES[n // 100], "Hundred"]
        n %= 100
    if n >= 20:
        words.append(_TENS[n // 10])
        n %= 10
    if n:
        words.append(_ONES[n])
    return " ".join(words)


def _indian(n: int) -> str:
    """Words in the Indian system (crore, lakh, thousand)."""
    parts = []
    for size, name in ((10_000_000, "Crore"), (100_000, "Lakh"), (1000, "Thousand")):
        if n >= size:
            parts.append(f"{_indian(n // size)} {name}")
            n %= size
    if n:
        parts.append(_below_1000(n))
    return " ".join(parts)


def in_words(paise: int) -> str:
    """4,99,900 paise → "Rupees Four Thousand Nine Hundred Ninety Nine Only"."""
    rupees, p = divmod(int(paise), 100)
    text = _indian(rupees) or "Zero"
    return f"Rupees {text}" + (f" and {_below_1000(p)} Paise" if p else "") + " Only"


def money(paise: int | None) -> str:
    p = int(paise or 0)
    sign = "-" if p < 0 else ""
    r, f = divmod(abs(p), 100)
    s = str(r)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        s = ",".join(([head] if head else []) + groups) + "," + tail
    return f"{sign}₹{s}.{f:02d}"


@lru_cache(maxsize=1)
def _font_paths() -> dict[str, Path]:
    return {"main": FONTS / "DejaVuSans.ttf", "bold": FONTS / "DejaVuSans-Bold.ttf"} | {
        k: FONTS / v for k, v in FALLBACK_FILES.items()
    }


class _Doc(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        p = _font_paths()
        self.add_font("main", "", p["main"])
        self.add_font("main", "B", p["bold"])
        for k in FALLBACKS:
            self.add_font(k, "", p[k])
        self.set_fallback_fonts(FALLBACKS, exact_match=False)
        self.set_text_shaping(True)
        self.set_auto_page_break(True, margin=18)
        self.set_margins(14, 14, 14)
        self.add_page()

    def line_text(self, text: str, size: float = 9, bold: bool = False, h: float = 4.6, align: str = "L") -> None:
        self.set_font("main", "B" if bold else "", size)
        self.multi_cell(0, h, text, align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _party(pdf: _Doc, x: float, y: float, w: float, title: str, lines: list[str]) -> float:
    pdf.set_xy(x, y)
    pdf.set_font("main", "B", 8)
    pdf.cell(w, 4.5, title.upper(), new_x=XPos.LEFT, new_y=YPos.NEXT)
    for i, line in enumerate(lines):
        pdf.set_x(x)
        pdf.set_font("main", "B" if i == 0 else "", 9.5 if i == 0 else 8.6)
        pdf.multi_cell(w, 4.4, line, new_x=XPos.LEFT, new_y=YPos.NEXT)
    return pdf.get_y()


def render(snap: dict[str, Any]) -> bytes:
    """The PDF for one document's snapshot (see invoices.snapshot())."""
    pdf = _Doc()
    gst = bool(snap.get("gst_on"))
    kind = snap["kind"]
    title = TITLE[kind] if (gst or kind != "invoice") else "Invoice"
    sup, rec = snap["supplier"], snap["recipient"]
    pdf.set_title(f"{title} {snap['number']}")
    pdf.set_author(sup["legal_name"])

    # header: supplier on the left, title and number on the right
    top = pdf.get_y()
    pdf.set_font("main", "B", 13)
    pdf.multi_cell(110, 6, sup["legal_name"], new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("main", "", 8.6)
    sup_lines = [x for x in [sup.get("trade_name") and f"Trade name: {sup['trade_name']}", sup.get("address")] if x]
    if gst and sup.get("gstin"):
        sup_lines.append(f"GSTIN: {sup['gstin']}")
    if sup.get("state_code"):
        sup_lines.append(f"State: {sup.get('state_name', '')} (code {sup['state_code']})")
    if sup.get("email"):
        sup_lines.append(sup["email"])
    for line in sup_lines:
        pdf.multi_cell(110, 4.3, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    left_bottom = pdf.get_y()
    pdf.set_xy(130, top)
    pdf.set_font("main", "B", 15)
    pdf.cell(66, 7, title, align="R", new_x=XPos.LEFT, new_y=YPos.NEXT)
    meta = [("No.", snap["number"]), ("Date", snap["date_text"])]
    if kind == "credit_note" and snap.get("original"):
        meta += [("Against invoice", snap["original"]["number"]), ("Invoice date", snap["original"]["date_text"])]
    if gst:
        meta += [("Place of supply", f"{snap['place_of_supply']['name']} ({snap['place_of_supply']['code']})")]
        meta += [("Reverse charge", "No")]
    for k, v in meta:
        pdf.set_x(130)
        pdf.set_font("main", "", 8.6)
        pdf.cell(30, 4.6, k, new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_font("main", "B", 8.6)
        pdf.cell(36, 4.6, v, align="R", new_x=XPos.LEFT, new_y=YPos.NEXT)
    y = max(left_bottom, pdf.get_y()) + 5
    pdf.set_draw_color(200, 200, 200)
    pdf.line(14, y - 2, 196, y - 2)

    # bill to
    rec_lines = [rec["name"], rec.get("address", "")]
    if rec.get("gstin"):
        rec_lines.append(f"GSTIN: {rec['gstin']}")
    if rec.get("state_code"):
        rec_lines.append(f"State: {rec.get('state_name', '')} (code {rec['state_code']})")
    y = _party(pdf, 14, y + 1, 120, "Bill to", [x for x in rec_lines if x]) + 4

    # lines
    pdf.set_xy(14, y)
    cols = [("#", 7, "L"), ("Description", 74 if gst else 92, "L")]
    if gst:
        cols.append(("SAC", 18, "L"))
    cols += [
        ("Qty", 10, "R"),
        ("Unit", 12, "L"),
        ("Rate", 22, "R"),
        ("Discount", 20, "R"),
        ("Taxable value" if gst else "Amount", 19 if gst else 25, "R"),
    ]
    pdf.set_fill_color(242, 242, 242)
    pdf.set_font("main", "B", 8)
    for name, w, a in cols:
        pdf.cell(w, 7, name, border=0, align=a, fill=True)
    pdf.ln(7)
    pdf.set_font("main", "", 8.6)
    for i, ln in enumerate(snap["lines"], start=1):
        values = [str(i), ln["description"]] + ([snap.get("sac") or ""] if gst else [])
        values += [str(ln["qty"]), ln["unit"], money(ln["rate"]), money(ln["discount"]), money(ln["taxable"])]
        row_y = pdf.get_y()
        x = 14
        bottom = row_y
        for (_name, w, a), v in zip(cols, values, strict=True):
            pdf.set_xy(x, row_y)
            pdf.multi_cell(w, 4.6, v, align=a, new_x=XPos.LEFT, new_y=YPos.NEXT)
            bottom = max(bottom, pdf.get_y())  # the tallest cell (a long description wraps) sets the row height
            x += w
        pdf.set_y(bottom + 2.4)
    pdf.line(14, pdf.get_y(), 196, pdf.get_y())
    pdf.ln(2)

    # totals
    t = snap["totals"]
    rows = [("Taxable value" if gst else "Total", t["taxable"])]
    if gst:
        for tax in snap["tax_lines"]:
            rows.append((f"{tax['label']} @ {tax['rate_bp'] / 100:g}%", tax["amount"]))
        rows.append(("Total", t["total"]))
    for i, (k, v) in enumerate(rows):
        last = i == len(rows) - 1
        pdf.set_x(120)
        pdf.set_font("main", "B" if last else "", 9.5 if last else 8.6)
        pdf.cell(46, 5.6, k, align="R")
        pdf.cell(30, 5.6, money(v), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)
    pdf.line_text(f"Amount in words: {t['in_words']}", size=8.6, bold=True)
    if kind == "credit_note" and snap.get("reason"):
        pdf.line_text(f"Reason: {snap['reason']}", size=8.6)
    if kind == "proforma":
        pdf.line_text("This is a proforma invoice (a request for payment), not a tax invoice. The tax invoice is "
                      "issued when the payment is received.", size=8)  # fmt: skip
        if snap.get("payment_link"):
            pdf.line_text(f"Pay online: {snap['payment_link']}", size=8.6)
    if snap.get("notes"):
        pdf.line_text(snap["notes"], size=8)
    if snap.get("irn"):
        pdf.line_text(f"IRN: {snap['irn']}   Ack No.: {snap.get('ack_no') or ''}", size=8)

    # signature
    pdf.ln(8)
    pdf.set_x(120)
    pdf.set_font("main", "", 8.6)
    pdf.cell(76, 4.6, f"For {sup['legal_name']}", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(10)
    pdf.set_x(120)
    pdf.set_font("main", "B", 8.6)
    pdf.cell(76, 4.6, sup.get("signatory") or "Authorised signatory", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(120)
    pdf.set_font("main", "", 8)
    pdf.cell(76, 4.2, "Authorised signatory", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(6)
    pdf.set_font("main", "", 7.4)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(0, 3.8, "This is a computer-generated document. Nm7 · nm7.si", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    return bytes(pdf.output())
