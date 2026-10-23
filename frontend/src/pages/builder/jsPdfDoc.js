// The light drawing engine for resumes without Indian-script text: jsPDF, with the same surface as pdfDoc.js
// (points, y from the top, text by its baseline), so the resume maker draws on either without knowing which.
// jsPDF cannot shape Telugu, Hindi, … (no OpenType substitution), so any such text switches the maker to pdfDoc.js.
import { jsPDF } from 'jspdf';
import { iconSegments } from './vectorIcons';

class JsPdfDoc {
  constructor(w, h) { this.doc = new jsPDF({ unit: 'pt', format: [w, h] }); this.w = w; this.h = h; }

  /* ---------- fonts ---------- */
  async addFamily(id, files) {
    ['normal', 'bold', 'italic'].forEach((style) => {
      const file = `${id}-${style}.ttf`;
      this.doc.addFileToVFS(file, files[style]);
      this.doc.addFont(file, id, style);
    });
    return id;
  }
  async addStandard(id) { return id; } // 'helvetica' | 'times' are built in
  async addScript() { throw new Error('jsPDF cannot shape Indian scripts'); }
  setFont(family, style = 'normal') { this.doc.setFont(family, style); }
  setFontSize(n) { this.doc.setFontSize(n); }
  setTextColor(...c) { this.doc.setTextColor(...c); }
  setCharSpace(n) { this.doc.setCharSpace(n || 0); }
  getTextWidth(str) { return this.doc.getTextWidth(str); }
  splitTextToSize(str, maxW) { return this.doc.splitTextToSize(str, maxW); }
  text(str, x, y, opts) { this.doc.text(str, x, y, opts); }

  /* ---------- pages ---------- */
  addPage() { this.doc.addPage([this.w, this.h]); return this; }
  setPage(n) { this.doc.setPage(n); }
  getNumberOfPages() { return this.doc.getNumberOfPages(); }

  /* ---------- shapes ---------- */
  setDrawColor(...c) { this.doc.setDrawColor(...c); }
  setFillColor(...c) { this.doc.setFillColor(...c); }
  setLineWidth(n) { this.doc.setLineWidth(n); }
  rect(x, y, w, h, style = 'S') { this.doc.rect(x, y, w, h, style); }
  roundedRect(x, y, w, h, rx, ry, style = 'S') { this.doc.roundedRect(x, y, w, h, rx, ry, style); }
  circle(cx, cy, r, style = 'S') { this.doc.circle(cx, cy, r, style); }
  triangle(x1, y1, x2, y2, x3, y3, style = 'F') { this.doc.triangle(x1, y1, x2, y2, x3, y3, style); }
  line(x1, y1, x2, y2) { this.doc.line(x1, y1, x2, y2); }

  /** A contact icon as vector shapes: `size` points square, top-left at (x, y), in one colour. */
  vectorIcon(key, x, y, size, color) {
    const { fill, paths } = iconSegments(key);
    const k = size / 24; const X = (v) => x + v * k; const Y = (v) => y + v * k;
    const d = this.doc;
    if (fill) d.setFillColor(...color); else { d.setDrawColor(...color); d.setLineWidth(2 * k); d.setLineCap('round'); d.setLineJoin('round'); }
    paths.forEach((segs) => {
      segs.forEach((s) => {
        if (s[0] === 'M') d.moveTo(X(s[1]), Y(s[2]));
        else if (s[0] === 'L') d.lineTo(X(s[1]), Y(s[2]));
        else if (s[0] === 'C') d.curveTo(X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6]));
        else d.close();
      });
      if (fill) d.fill(); else d.stroke();
    });
    if (!fill) { d.setLineCap('butt'); d.setLineJoin('miter'); }
  }

  /* ---------- images and links ---------- */
  async image(data, format = 'PNG') { return { data, format }; }
  addImage(img, x, y, w, h) { if (img) this.doc.addImage(img.data, img.format, x, y, w, h, undefined, 'FAST'); }
  link(x, y, w, h, opts) { this.doc.link(x, y, w, h, opts); }

  /* ---------- output ---------- */
  setProperties(p) { this.doc.setProperties(p); }
  async output() { return this.doc.output('blob'); }
}

/** A document with one page of w × h points. */
export const createDoc = async (w, h) => new JsPdfDoc(w, h);
