// Builds a real text PDF (selectable, ATS-readable) from the same model and design the preview uses.
// Two drawing engines behind one small surface: jsPDF for resumes in Latin script (light, unchanged output), and
// pdf-lib + fontkit (pdfDoc.js) as soon as the text holds an Indian script — it shapes conjuncts and vowel signs and
// prints them with the Noto Sans font of that script, fetched from our origin only when a resume needs it.
import { loadScriptFonts, scriptsIn } from './indicFonts';
import { buildSections } from './resumeModel';
import { visibleResume } from './entries';
import { contactItems } from './ContactLine';
import { iconColor, iconPng } from './icons';
import { PAGE, headFontOf, marginOf } from './design';
import { isNumWord } from './resumeModel';
import { coverParts } from './cover';
import { shapePhoto } from './PhotoEditor';
import { loadFont, registerFont } from './pdfFonts';

const rgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tintRgb = (hex, a) => rgb(hex).map((c) => Math.round(c * a + 255 * (1 - a)));
const GREY = [90, 90, 90];

/**
 * brand (organization copies, see lib/branding.js prepareBrand): { img: { data, format, ratio } | null, header,
 * footer, color } — a header strip with the logo and header line, and the footer line on every page.
 * stamp: one more small line at the foot of every page (e.g. "Shared with … via Nm7 · expires …").
 */
export async function buildResumePdf({ data, design: ds, photo, cover, brand = null, stamp = '', engine = null }) {
  const d = visibleResume(data); // switched-off entries are not printed
  const page = PAGE[ds.pageSize] || PAGE.a4;
  const scripts = scriptsIn([d, cover, brand?.header, brand?.footer, stamp]);
  const shaped = engine === 'pdflib' || (engine !== 'jspdf' && scripts.length > 0); // `engine` forces one (tests)
  const { createDoc } = await (shaped ? import('./pdfDoc') : import('./jsPdfDoc'));
  const doc = await createDoc(page.w, page.h);
  const SERIF = ['source-serif-4', 'lora', 'merriweather'];
  const safeFont = async (id) => {
    try { await registerFont(doc, id, await loadFont(id)); return id; } catch { return doc.addStandard(SERIF.includes(id) ? 'times' : 'helvetica'); } // built-in fallback
  };
  const bodyFont = await safeFont(ds.font);
  const headId = headFontOf(ds);
  const headFont = headId === ds.font ? bodyFont : await safeFont(headId);
  // Telugu, Hindi, … anywhere in the text: the Noto Sans font of each script, loaded on demand (a script whose
  // font cannot be fetched is drawn with the template font instead, so the download still works)
  const scriptFonts = shaped ? await loadScriptFonts(scripts) : {};
  for (const [k, files] of Object.entries(scriptFonts)) { try { await doc.addScript(k, files); } catch { /* template font */ } }

  const M = marginOf(ds);
  const W = page.w - M * 2;
  const text = rgb(ds.textColor);
  const accent = rgb(ds.accent);
  const lineCol = ds.accentOn.lines ? accent : [184, 184, 184];
  const lh = (size) => size * ds.lineHeight;
  const set = (size, style = 'normal', color = text, family = bodyFont) => { doc.setFont(family, style); doc.setFontSize(size); doc.setTextColor(...color); };

  /* ---------- page-aware column cursor ---------- */
  let onNewPage = () => {};
  const goto = (col) => { while (doc.getNumberOfPages() < col.page) { doc.addPage(); onNewPage(doc.getNumberOfPages()); } doc.setPage(col.page); };
  const ensure = (col, h) => { if (col.y + h > page.h - M) { col.page += 1; col.y = M; } goto(col); };

  /* ---------- header (drawn twice when it has a colour band: once to measure, once to draw) ---------- */
  const SIDE_W = W * 0.32;
  const tintRgbA = tintRgb(ds.accent, 0.07);
  goto({ page: 1 });
  // photo: baked into its shape (transparent corners) so it looks the same in every PDF viewer
  let portrait = null;
  if (d.showPhoto && photo && !cover) { try { portrait = await doc.image(await shapePhoto(photo, ds.photoShape || 'circle'), 'PNG'); } catch { portrait = null; } }
  const withPhoto = !!portrait;
  const pos = withPhoto ? ds.photoPos || 'left' : null;
  const PS = ds.photoSize || 62;
  const center = pos === 'top' || (ds.headerAlign === 'center' && !withPhoto);
  const band = ds.headerStyle === 'band';
  // contact icons as sharp PNGs (brand logos in brand colours or one colour)
  const rgbHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const monoIcon = rgbHex(ds.accentOn.links || ds.accentOn.headings ? accent : [68, 68, 68]);
  const contactRows = contactItems(d, ds.contactLines);
  const icons = {};
  if (ds.icons) {
    await Promise.all(contactRows.flat().map(async (it) => {
      try { icons[it.kind] = await doc.image(await iconPng(it.kind, iconColor(it.kind, ds, monoIcon), 96), 'PNG'); } catch { /* draw without icon */ }
    }));
  }
  const header = (draw, top) => {
    let y = top;
    let x0 = M;
    let hw = W;
    if (withPhoto) {
      const px = pos === 'right' ? page.w - M - PS : pos === 'top' ? (page.w - PS) / 2 : M;
      if (draw) {
        doc.addImage(portrait, px, y, PS, PS);
        const bw = { none: 0, thin: 1, thick: 2.5 }[ds.photoBorder || 'none'];
        if (bw) {
          doc.setDrawColor(...(ds.photoBorderColor === 'grey' ? [184, 184, 184] : accent)); doc.setLineWidth(bw);
          if (ds.photoShape === 'square') doc.rect(px + bw / 2, y + bw / 2, PS - bw, PS - bw, 'S');
          else if (ds.photoShape === 'rounded') doc.roundedRect(px + bw / 2, y + bw / 2, PS - bw, PS - bw, PS * 0.14, PS * 0.14, 'S');
          else doc.circle(px + PS / 2, y + PS / 2, PS / 2 - bw / 2, 'S');
        }
      }
      if (pos === 'top') y += PS + 8;
      else if (pos === 'right') hw = W - PS - 14;
      else { x0 = M + PS + 14; hw = W - PS - 14; }
    }
    const hx = center ? page.w / 2 : x0;
    const hAlign = center ? 'center' : 'left';
    set(ds.nameSize, 'bold', ds.accentOn.name ? accent : text, headFont);
    if (draw) doc.text(d.personal.name || 'Your Name', hx, y + ds.nameSize * 0.85, { align: hAlign });
    y += ds.nameSize * 1.15;
    if (d.personal.headline) {
      set(ds.bodySize + 1.5, 'normal', ds.accentOn.name ? accent : [68, 68, 68]);
      if (draw) doc.text(d.personal.headline, hx, y + ds.bodySize + 0.5, { align: hAlign });
      y += lh(ds.bodySize + 1.5);
    }
    const cSize = ds.bodySize - 1;
    const linkCol = ds.accentOn.links ? accent : text;
    const sepTxt = ds.icons ? '' : '  ·  ';
    const gap = ds.icons ? 10 : 0;
    const itemW = (it) => { set(cSize); return (ds.icons ? cSize * 1.1 + 3 : 0) + doc.getTextWidth(it.text); };
    contactRows.forEach((row) => {
      const lines = [[]];
      let w = 0;
      row.forEach((it) => {
        const add = itemW(it) + (lines[lines.length - 1].length ? gap + doc.getTextWidth(sepTxt) : 0);
        if (w + add > hw && lines[lines.length - 1].length) { lines.push([]); w = 0; }
        w += itemW(it) + (lines[lines.length - 1].length ? gap + doc.getTextWidth(sepTxt) : 0);
        lines[lines.length - 1].push(it);
      });
      lines.forEach((ln) => {
        if (!ln.length) return;
        const total = ln.reduce((acc, it, i) => acc + itemW(it) + (i ? gap + doc.getTextWidth(sepTxt) : 0), 0);
        let x = center ? (page.w - total) / 2 : x0;
        const base = y + cSize;
        ln.forEach((it, i) => {
          if (i) { if (sepTxt) { set(cSize, 'normal', [150, 150, 150]); if (draw) doc.text(sepTxt, x, base); x += doc.getTextWidth(sepTxt); } x += gap; }
          const start = x;
          if (ds.icons) {
            const sz = cSize * 1.1;
            if (draw && icons[it.kind]) doc.addImage(icons[it.kind], x, base - sz + 1.2, sz, sz);
            x += sz + 3;
          }
          set(cSize, 'normal', it.link ? linkCol : [74, 74, 74]);
          if (draw) doc.text(it.text, x, base);
          x += doc.getTextWidth(it.text);
          if (draw && it.url) doc.link(start, base - cSize, x - start, cSize + 3, { url: it.url });
        });
        y += lh(cSize) + 1;
      });
    });
    if (withPhoto && pos !== 'top') y = Math.max(y, top + PS + 4);
    return y + 4;
  };
  // the organization's strip: logo + header line in its colour, above the resume (all text stays selectable)
  let top = M;
  if (brand && !cover) {
    const sy = M * 0.6;
    const LH = 26;
    let x = M;
    if (brand.img) {
      const w = Math.min(LH * brand.img.ratio, 170);
      const h = w / brand.img.ratio;
      try { doc.addImage(await doc.image(brand.img.data, brand.img.format), M, sy + (LH - h) / 2, w, h); x = M + w + 10; } catch { /* drawn without the logo */ }
    }
    const bc = rgb(brand.color || '#1F3A8A');
    if (brand.header) { set(10, 'bold', bc); doc.text(doc.splitTextToSize(brand.header, page.w - M - x)[0], x, sy + LH / 2 + 3.5); }
    doc.setDrawColor(...bc); doc.setLineWidth(1.2); doc.line(M, sy + LH + 6, page.w - M, sy + LH + 6);
    top = sy + LH + 16;
  }
  let y;
  if (band && top === M) {
    const top = M * 0.75;
    const bottom = header(false, top) + 6;
    doc.setFillColor(...tintRgb(ds.accent, 0.1)); doc.rect(0, 0, page.w, bottom, 'F');
    header(true, top);
    y = bottom + 4;
  } else {
    y = header(true, top);
    if (ds.headerStyle !== 'none') {
      doc.setDrawColor(...(ds.accentOn.lines ? accent : [207, 207, 207])); doc.setLineWidth(ds.accentOn.lines ? 1.5 : 1);
      doc.line(M, y, page.w - M, y);
    }
  }
  // pale side panel on every page (two columns)
  const sideTint = ds.layout === 'two' && ds.sideTint && !cover;
  const paintSide = (p, from) => { if (!sideTint) return; doc.setPage(p); doc.setFillColor(...tintRgbA); doc.roundedRect(M - 8, from - 6, SIDE_W + 16, page.h - M + 6 - (from - 6), 4, 4, 'F'); };
  paintSide(1, y + ds.sectionGap);
  onNewPage = (p) => paintSide(p, M);
  y += ds.sectionGap;

  /* ---------- body ---------- */
  const para = (col, str, size, style, color, indent = 0, extra = 0) => {
    set(size, style, color);
    doc.splitTextToSize(str, col.w - indent).forEach((p) => {
      ensure(col, lh(size));
      doc.text(p, col.x + indent, col.y + size * 0.9);
      col.y += lh(size);
    });
    col.y += extra;
  };

  const heading = (col, title) => {
    const hs = ds.headSize;
    ensure(col, hs * 3.2);
    const col1 = ds.accentOn.headings ? accent : text;
    set(hs, 'bold', col1, headFont);
    doc.setCharSpace(ds.headingStyle === 'caps' ? hs * 0.16 : hs * 0.06);
    const t = title.toUpperCase();
    const tw = doc.getTextWidth(t) + t.length * (ds.headingStyle === 'caps' ? hs * 0.16 : hs * 0.06);
    const base = col.y + hs * 0.9;
    if (ds.headingStyle === 'bar') {
      doc.setFillColor(...tintRgb(ds.accentOn.lines ? ds.accent : '#777777', 0.12));
      doc.roundedRect(col.x, col.y - 1, col.w, hs * 1.6, 2, 2, 'F');
      doc.text(t, col.x + 6, col.y + hs * 1.1);
      col.y += hs * 1.6 + 3;
    } else if (ds.headingStyle === 'left') {
      doc.setFillColor(...lineCol); doc.rect(col.x, col.y - 1, 3, hs * 1.25, 'F');
      doc.text(t, col.x + 9, base);
      col.y += hs * 1.25 + 3;
    } else {
      doc.text(t, col.x, base);
      doc.setDrawColor(...lineCol); doc.setLineWidth(0.8);
      if (ds.headingStyle === 'underline') { doc.line(col.x, base + 3, col.x + col.w, base + 3); col.y += hs * 1.2 + 5; }
      else if (ds.headingStyle === 'rule') { if (tw + 6 < col.w) doc.line(col.x + tw + 6, base - hs * 0.32, col.x + col.w, base - hs * 0.32); col.y += hs * 1.2 + 3; }
      else col.y += hs * 1.2 + 3;
    }
    doc.setCharSpace(0);
  };

  // bullet with numbers in bold, wrapped word by word (Impact template)
  const drawBulletMark = (col) => {
    const bs = ds.bodySize;
    if (ds.bullet === 'none') return;
    if (ds.bullet === '▸') { doc.setFillColor(...text); const cy = col.y + bs * 0.55; doc.triangle(col.x + 1, cy - 2.4, col.x + 1, cy + 2.4, col.x + 5, cy, 'F'); } else { set(bs, 'normal', text); doc.text(ds.bullet, col.x, col.y + bs * 0.9); }
  };
  const richBullet = (col, t) => {
    const bs = ds.bodySize;
    const ind = ds.bullet === 'none' ? 0 : 10;
    const words = t.split(/\s+/).filter(Boolean).map((w) => ({ w, b: isNumWord(w) }));
    const widthOf = (x) => { set(bs, x.b ? 'bold' : 'normal', text); return doc.getTextWidth(x.w); };
    set(bs, 'normal', text);
    const space = doc.getTextWidth(' ');
    const rows = [[]];
    let w = 0;
    words.forEach((x) => {
      const ww = widthOf(x);
      if (rows[rows.length - 1].length && w + space + ww > col.w - ind) { rows.push([]); w = 0; }
      w += (rows[rows.length - 1].length ? space : 0) + ww;
      rows[rows.length - 1].push({ ...x, ww });
    });
    rows.forEach((r, i) => {
      ensure(col, lh(bs));
      if (i === 0) drawBulletMark(col);
      let x = col.x + ind;
      r.forEach((x2) => { set(bs, x2.b ? 'bold' : 'normal', text); doc.text(x2.w, x, col.y + bs * 0.9); x += x2.ww + space; });
      col.y += lh(bs);
    });
    return undefined;
  };

  const line = (col, l) => {
    const bs = ds.bodySize;
    if (typeof l === 'string') return para(col, l, bs, 'normal', text);
    if (l.bullet) {
      if (ds.bullet === 'none') return para(col, l.t, bs, 'normal', text);
      if (ds.boldNumbers) return richBullet(col, l.t);
      set(bs, 'normal', text);
      const parts = doc.splitTextToSize(l.t, col.w - 10);
      parts.forEach((p, i) => {
        ensure(col, lh(bs));
        if (i === 0) {
          if (ds.bullet === '▸') { doc.setFillColor(...text); const cy = col.y + bs * 0.55; doc.triangle(col.x + 1, cy - 2.4, col.x + 1, cy + 2.4, col.x + 5, cy, 'F'); }
          else doc.text(ds.bullet, col.x, col.y + bs * 0.9);
        }
        doc.text(p, col.x + 10, col.y + bs * 0.9);
        col.y += lh(bs);
      });
      return undefined;
    }
    if (l.kv) {
      const lw = bs * 9.5;
      set(bs, 'normal', text);
      const vals = l.kv[1].split('\n').flatMap((v) => doc.splitTextToSize(v.trim(), col.w - lw - 8));
      ensure(col, lh(bs));
      doc.text(l.kv[0], col.x, col.y + bs * 0.9);
      doc.text(':', col.x + lw, col.y + bs * 0.9);
      vals.forEach((v, i) => {
        if (i) ensure(col, lh(bs));
        set(bs, 'normal', l.url && ds.accentOn.links ? accent : text);
        doc.text(v, col.x + lw + 8, col.y + bs * 0.9);
        if (l.url && i === 0) doc.link(col.x + lw + 8, col.y, doc.getTextWidth(v), bs + 2, { url: l.url });
        col.y += lh(bs);
      });
      return undefined;
    }
    if (l.sign) {
      col.y += bs * 1.2;
      ensure(col, lh(bs) * l.sign.left.length);
      set(bs, 'normal', text);
      l.sign.left.forEach((t, i) => { doc.text(t, col.x, col.y + bs * 0.9 + i * lh(bs)); });
      set(bs, 'bold', text);
      if (l.sign.right) doc.text(l.sign.right, col.x + col.w, col.y + bs * 0.9 + (l.sign.left.length - 1) * lh(bs), { align: 'right' });
      col.y += lh(bs) * l.sign.left.length;
      return undefined;
    }
    if (l.chips) {
      if (l.label) para(col, l.label, bs, 'bold', text);
      set(bs - 0.5, 'normal', text);
      let cx = col.x;
      const ch = (bs - 0.5) * 1.5;
      ensure(col, ch + 3);
      l.chips.forEach((c) => {
        const cw = doc.getTextWidth(c) + 8;
        if (cx + cw > col.x + col.w) { cx = col.x; col.y += ch + 3; ensure(col, ch + 3); }
        doc.setDrawColor(...(ds.accentOn.lines ? accent : [170, 170, 170])); doc.setLineWidth(0.7);
        doc.roundedRect(cx, col.y, cw, ch, 3, 3, 'S');
        doc.text(c, cx + 4, col.y + ch * 0.68);
        cx += cw + 3;
      });
      col.y += ch + 4;
      return undefined;
    }
    // bold label + text, wrapping
    set(bs, 'bold', text);
    const label = `${l.bold} `;
    const lw = doc.getTextWidth(label);
    set(bs, 'normal', text);
    // fill the rest of the label's line word by word (never split a word), then wrap normally
    const words = l.text.split(' ');
    let firstLine = '';
    while (words.length && doc.getTextWidth(firstLine ? `${firstLine} ${words[0]}` : words[0]) <= col.w - lw) firstLine = firstLine ? `${firstLine} ${words.shift()}` : words.shift();
    ensure(col, lh(bs));
    set(bs, 'bold', text); doc.text(label, col.x, col.y + bs * 0.9);
    set(bs, 'normal', text); if (firstLine) doc.text(firstLine, col.x + lw, col.y + bs * 0.9);
    col.y += lh(bs);
    if (words.length) para(col, words.join(' '), bs, 'normal', text);
    return undefined;
  };

  const item = (col, it) => {
    const bs = ds.bodySize;
    if (it.head || (it.date && ds.datePos === 'right')) {
      ensure(col, lh(bs) * 2);
      set(bs - 0.5, 'normal', GREY);
      const dw = it.date && ds.datePos === 'right' ? doc.getTextWidth(it.date) + 10 : 0;
      if (dw) doc.text(it.date, col.x + col.w, col.y + bs * 0.9, { align: 'right' });
      // title, then " | Live Demo | GitHub" as clickable words on the same line (own line if there's no room)
      const links = it.links || [];
      const sep = ' | ';
      set(bs, 'normal', text);
      const sepW = doc.getTextWidth(sep);
      const linksW = links.reduce((w, l) => w + sepW + doc.getTextWidth(l.label), 0);
      set(bs, 'bold', text);
      const room = col.w - dw;
      const inline = linksW < room * 0.45;
      const heads = doc.splitTextToSize(it.head || '', room - (inline ? linksW : 0));
      heads.forEach((h, i) => {
        ensure(col, lh(bs));
        set(bs, 'bold', text);
        doc.text(h, col.x, col.y + bs * 0.9);
        const last = i === heads.length - 1;
        if (last && links.length) {
          let x = inline ? col.x + doc.getTextWidth(h) : col.x;
          if (!inline) { col.y += lh(bs); ensure(col, lh(bs)); }
          const linkCol = ds.accentOn.links ? accent : text;
          links.forEach((l, j) => {
            if (inline || j) { set(bs, 'normal', [154, 154, 154]); doc.text(sep, x, col.y + bs * 0.9); x += sepW; }
            set(bs, 'normal', linkCol);
            const w = doc.getTextWidth(l.label);
            doc.text(l.label, x, col.y + bs * 0.9);
            doc.setDrawColor(...linkCol); doc.setLineWidth(0.5); doc.line(x, col.y + bs * 1.02, x + w, col.y + bs * 1.02);
            doc.link(x, col.y, w, bs * 1.1, { url: l.url });
            x += w;
          });
        }
        col.y += lh(bs);
      });
    }
    if (it.date && ds.datePos === 'below') para(col, it.date, bs - 0.5, 'normal', GREY);
    if (it.sub) para(col, it.sub, bs, 'italic', GREY);
    (it.lines || []).forEach((l) => line(col, l));
  };

  const run = (col, sections) => sections.forEach((sec, si) => {
    if (si) col.y += ds.sectionGap;
    heading(col, sec.title);
    sec.items.forEach((it, i) => { if (i) col.y += ds.itemGap; item(col, it); });
  });

  const { main, side } = buildSections(d, ds);
  if (cover) {
    // cover letter: same header, then date, addressee, subject, greeting, paragraphs, sign-off
    const c = coverParts(d, cover);
    const col = { x: M, w: W, y: y + 4, page: 1 };
    const bs = ds.bodySize;
    const gapL = bs * 1.1;
    para(col, c.date, bs, 'normal', text, 0, gapL);
    c.to.forEach((t) => para(col, t, bs, 'normal', text));
    col.y += gapL;
    if (c.subject) para(col, c.subject, bs, 'bold', text, 0, gapL);
    para(col, c.greeting, bs, 'normal', text, 0, bs * 0.9);
    c.body.forEach((p) => para(col, p, bs, 'normal', text, 0, bs * 0.9));
    col.y += bs * 0.7;
    para(col, c.close, bs, 'normal', text, 0, bs * 0.4);
    para(col, c.name, bs, 'bold', text);
    doc.setProperties({ title: `${d.personal.name || ''} — Cover letter`, creator: 'Nm7 Resume Builder' });
    return doc.output();
  }
  if (ds.layout === 'two') {
    const sw = SIDE_W;
    run({ x: M, w: sw, y, page: 1 }, side);
    run({ x: M + sw + 18, w: W - sw - 18, y, page: 1 }, main);
  } else {
    run({ x: M, w: W, y, page: 1 }, main);
  }

  // foot of every page: the organization's footer line and / or a stamp, small and grey
  const feet = [!cover && brand?.footer, stamp].filter(Boolean);
  if (feet.length) {
    for (let p = 1; p <= doc.getNumberOfPages(); p++) {
      doc.setPage(p);
      set(7.5, 'normal', [110, 110, 110]);
      feet.forEach((t, i) => doc.text(doc.splitTextToSize(t, W)[0], page.w / 2, page.h - M / 2 - (feet.length - 1 - i) * 9, { align: 'center' }));
    }
  }
  doc.setProperties({ title: `${d.personal.name || 'Resume'} — Resume`, creator: 'Nm7 Resume Builder' });
  return doc.output();
}

/** Saves the PDF. Inside a Claude artifact preview it goes through the viewer's save prompt; elsewhere a normal download. */
export async function savePdf(blob, filename) {
  const c = typeof window !== 'undefined' ? window.claude : null;
  if (c?.use) {
    const downloads = await c.use('downloads');
    if (downloads) { await downloads.save({ filename, data: blob }); return 'saved'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
