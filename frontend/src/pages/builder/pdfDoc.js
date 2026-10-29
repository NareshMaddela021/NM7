// A small drawing surface on pdf-lib with the jsPDF conventions the resume maker was written for: points, y from
// the top of the page, text placed by its baseline, fonts by family + style. Every string is shaped through the
// font's OpenType tables (@pdf-lib/fontkit), so Telugu, Hindi, Tamil, Kannada, Malayalam and Bengali print as real,
// selectable text with correct conjuncts and vowel signs; each run of Indic text uses the Noto Sans font of its
// script, everything else the template's font.
import 'regenerator-runtime/runtime.js'; // fontkit's Indic shaper is compiled to generators that need it
import fontkit from '@pdf-lib/fontkit';
import { LineCapStyle, PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, PDFString, StandardFonts, endMarkedContent, rgb, setCharacterSpacing } from 'pdf-lib';
import { splitRuns } from './indicFonts';
import { iconSegments } from './vectorIcons';

// Glyph positions are not part of a PDF text string (viewers place glyphs by their advance widths), so the
// positioning features are switched off: measuring then matches what is drawn, and the Noto fonts are designed so
// their marks sit right without them. Ligatures stay off too, so Latin text keeps one glyph per letter (as the
// jsPDF output had), which text extractors and tracking systems read most reliably.
const OFF = { liga: false, clig: false, calt: false, kern: false, mark: false, mkmk: false, abvm: false, blwm: false, dist: false, curs: false };
const shaping = {
  create(bytes) {
    const f = fontkit.create(bytes);
    const layout = f.layout.bind(f);
    f.layout = (text, features, ...rest) => layout(text, { ...(features || {}), ...OFF }, ...rest);
    return f;
  },
};

const STANDARD = {
  helvetica: { normal: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold, italic: StandardFonts.HelveticaOblique },
  times: { normal: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold, italic: StandardFonts.TimesRomanItalic },
};
const col = ([r, g, b]) => rgb(r / 255, g / 255, b / 255);
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s]);

class PdfDoc {
  static async create(w, h) {
    const d = new PdfDoc();
    d.doc = await PDFDocument.create();
    d.doc.registerFontkit(shaping);
    d.w = w; d.h = h;
    d.families = {}; // id → { normal, bold, italic } PDFFont
    d.scripts = {}; // script → { normal, bold } PDFFont
    d.standard = {}; // embedded built-in fonts
    d.images = new Map();
    d.font = { family: 'helvetica', style: 'normal', size: 10 };
    d.textColor = col([0, 0, 0]); d.fillColor = col([0, 0, 0]); d.drawColor = col([0, 0, 0]);
    d.lineWidth = 1; d.charSpace = 0;
    d.addPage();
    return d;
  }

  /* ---------- fonts ---------- */
  /** Registers a family's three styles from TTF bytes (Uint8Array or base64). */
  async addFamily(id, files) {
    const f = {};
    for (const st of ['normal', 'bold', 'italic']) f[st] = await this.doc.embedFont(files[st], { subset: true });
    this.families[id] = f;
    return id;
  }
  /** A built-in font ('helvetica' | 'times'): nothing to download, Latin-1 only. */
  async addStandard(id) {
    if (!this.standard[id]) {
      const f = {};
      for (const st of ['normal', 'bold', 'italic']) f[st] = await this.doc.embedFont(STANDARD[id][st]);
      this.standard[id] = f; this.families[id] = f;
    }
    return id;
  }
  /** The Noto Sans font of one Indic script ({ normal, bold } bytes); italic runs use the regular face. */
  async addScript(script, files) {
    const normal = await this.doc.embedFont(files.normal, { subset: true });
    const bold = files.bold ? await this.doc.embedFont(files.bold, { subset: true }) : normal;
    this.scripts[script] = { normal, bold, italic: normal };
  }
  setFont(family, style = 'normal') { this.font.family = family; this.font.style = style; }
  setFontSize(n) { this.font.size = n; }
  setTextColor(...c) { this.textColor = col(c); }
  setCharSpace(n) { this.charSpace = n || 0; }
  fontFor(run) {
    const { family, style } = this.font;
    const fam = this.families[family] || Object.values(this.families)[0];
    const fs = run.script && this.scripts[run.script];
    return fs ? fs[style] || fs.normal : fam[style] || fam.normal;
  }
  runsOf(str) {
    return splitRuns(String(str ?? '').replace(/[\r\n\t]+/g, ' ')).map((r) => {
      const font = this.fontFor(r);
      let text = r.text;
      if (Object.values(this.standard).some((f) => Object.values(f).includes(font))) {
        // a built-in font knows Latin-1 only: anything else becomes '?', the download never fails
        try { font.encodeText(text); } catch { text = [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join(''); }
      }
      return { text, font, script: r.script };
    });
  }
  widthOfRun(r) { return r.font.widthOfTextAtSize(r.text, this.font.size) + this.charSpace * [...r.text].length; }
  /** Width of `str` in the current font and size (like jsPDF, the letter spacing counts once per character). */
  getTextWidth(str) { return this.runsOf(str).reduce((w, r) => w + this.widthOfRun(r), 0); }

  /** Word-wraps `str` to `maxW` points: an array of lines (a word wider than the line breaks by character). */
  splitTextToSize(str, maxW) {
    const out = [];
    String(str ?? '').split(/\r?\n/).forEach((para) => {
      let line = '';
      para.split(' ').forEach((w) => {
        const cand = line ? `${line} ${w}` : w;
        if (this.getTextWidth(cand) <= maxW) { line = cand; return; }
        if (line) out.push(line);
        line = '';
        if (this.getTextWidth(w) <= maxW) { line = w; return; }
        graphemes(w).forEach((g) => { if (line && this.getTextWidth(line + g) > maxW) { out.push(line); line = ''; } line += g; });
      });
      out.push(line);
    });
    return out;
  }

  /** Draws `str` with its baseline at y (from the top). align: 'left' | 'center' | 'right'. */
  text(str, x, y, { align = 'left' } = {}) {
    const runs = this.runsOf(str).filter((r) => r.text);
    if (!runs.length) return;
    const total = runs.reduce((w, r) => w + this.widthOfRun(r), 0);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    if (this.charSpace) this.page.pushOperators(setCharacterSpacing(this.charSpace));
    runs.forEach((r) => {
      // an Indic run's glyphs sit in visual order (a vowel sign may come before the consonants it follows in the
      // text), so the run carries its text as ActualText: copy, search and text extraction read it as typed
      const actual = r.script ? this.doc.context.obj({ ActualText: PDFHexString.fromText(r.text) }) : null;
      if (actual) this.page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), actual]));
      this.page.drawText(r.text, { x: cx, y: this.h - y, size: this.font.size, font: r.font, color: this.textColor });
      if (actual) this.page.pushOperators(endMarkedContent());
      cx += this.widthOfRun(r);
    });
    if (this.charSpace) this.page.pushOperators(setCharacterSpacing(0));
  }

  /* ---------- pages ---------- */
  addPage() { this.page = this.doc.addPage([this.w, this.h]); return this; }
  setPage(n) { this.page = this.doc.getPage(n - 1); }
  getNumberOfPages() { return this.doc.getPageCount(); }

  /* ---------- shapes (y from the top, like the text) ---------- */
  setDrawColor(...c) { this.drawColor = col(c); }
  setFillColor(...c) { this.fillColor = col(c); }
  setLineWidth(n) { this.lineWidth = n; }
  paint(style) { return style === 'F' ? { color: this.fillColor, borderWidth: 0 } : { borderColor: this.drawColor, borderWidth: this.lineWidth }; }
  rect(x, y, w, h, style = 'S') { this.page.drawRectangle({ x, y: this.h - y - h, width: w, height: h, ...this.paint(style) }); }
  roundedRect(x, y, w, h, rx, ry, style = 'S') {
    const r = Math.min(rx, w / 2, h / 2);
    const a = (dx, dy) => `A ${r} ${r} 0 0 1 ${dx} ${dy}`;
    const p = `M ${x + r} ${y} H ${x + w - r} ${a(x + w, y + r)} V ${y + h - r} ${a(x + w - r, y + h)} H ${x + r} ${a(x, y + h - r)} V ${y + r} ${a(x + r, y)} Z`;
    this.page.drawSvgPath(p, { x: 0, y: this.h, ...this.paint(style) });
  }
  circle(cx, cy, r, style = 'S') { this.page.drawCircle({ x: cx, y: this.h - cy, size: r, ...this.paint(style) }); }
  triangle(x1, y1, x2, y2, x3, y3, style = 'F') { this.page.drawSvgPath(`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} Z`, { x: 0, y: this.h, ...this.paint(style) }); }
  line(x1, y1, x2, y2) { this.page.drawLine({ start: { x: x1, y: this.h - y1 }, end: { x: x2, y: this.h - y2 }, thickness: this.lineWidth, color: this.drawColor }); }

  /** A contact icon as vector shapes: `size` points square, top-left at (x, y) from the top, in one colour. */
  vectorIcon(key, x, y, size, color) {
    const { fill, paths } = iconSegments(key);
    const k = size / 24; const f = (n) => +n.toFixed(3);
    const X = (v) => f(x + v * k); const Y = (v) => f(y + v * k);
    paths.forEach((segs) => {
      const d = segs.map((s) => (s[0] === 'M' ? `M${X(s[1])} ${Y(s[2])}` : s[0] === 'L' ? `L${X(s[1])} ${Y(s[2])}` : s[0] === 'C' ? `C${X(s[1])} ${Y(s[2])} ${X(s[3])} ${Y(s[4])} ${X(s[5])} ${Y(s[6])}` : 'Z')).join('');
      this.page.drawSvgPath(d, fill ? { x: 0, y: this.h, color: col(color), borderWidth: 0 }
        : { x: 0, y: this.h, borderColor: col(color), borderWidth: 2 * k, borderLineCap: LineCapStyle.Round });
    });
  }

  /* ---------- images and links ---------- */
  /** Embeds a PNG / JPEG (data URL, base64 or bytes) once; returns the handle `addImage` takes. */
  async image(data, format = 'PNG') {
    if (!this.images.has(data)) this.images.set(data, await (format === 'JPEG' ? this.doc.embedJpg(data) : this.doc.embedPng(data)));
    return this.images.get(data);
  }
  addImage(img, x, y, w, h) { if (img) this.page.drawImage(img, { x, y: this.h - y - h, width: w, height: h }); }
  link(x, y, w, h, { url }) {
    if (!url) return;
    const ref = this.doc.context.register(this.doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x, this.h - y - h, x + w, this.h - y], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(String(url)) },
    }));
    this.page.node.addAnnot(ref);
  }

  /* ---------- output ---------- */
  setProperties({ title, creator }) {
    if (title) this.doc.setTitle(title);
    if (creator) { this.doc.setCreator(creator); this.doc.setProducer(creator); }
  }
  /** The finished file as a Blob (fonts are subset to the glyphs used). */
  async output() { return new Blob([await this.doc.save({ useObjectStreams: false })], { type: 'application/pdf' }); }
}

/** A document with one page of w × h points. */
export const createDoc = (w, h) => PdfDoc.create(w, h);
