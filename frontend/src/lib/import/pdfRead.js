// Reads a PDF into positioned text items + links. Works in the browser and in Node (pass the pdf.js module).
// Item: { str, x, y (from top), w, size, bold, italic, page }

export async function readPdf(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const pages = [];
  const items = [];
  const links = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ w: vp.width, h: vp.height });
    await page.getOperatorList(); // loads fonts so we can tell bold from regular
    const tc = await page.getTextContent();
    const fontName = {};
    const nameOf = (id) => {
      if (!(id in fontName)) { try { fontName[id] = page.commonObjs.get(id)?.name || ''; } catch { fontName[id] = ''; } }
      return fontName[id];
    };
    tc.items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b);
      const fn = nameOf(it.fontName);
      items.push({
        str: it.str, x: e, y: vp.height - f, w: it.width, size: Math.round(size * 10) / 10,
        bold: /bold|black|heavy|semibold|demi/i.test(fn), italic: /italic|oblique/i.test(fn), page: p,
      });
    });
    const ann = await page.getAnnotations().catch(() => []);
    ann.filter((a) => a.url).forEach((a) => {
      const [x1, y1, x2, y2] = a.rect;
      links.push({ url: a.url, page: p, x: x1, y: vp.height - y2, w: x2 - x1, h: y2 - y1 });
    });
  }
  return { meta: meta.info || {}, pages, items, links, doc };
}

/** Groups items into visual lines (same page, same baseline), left to right. */
export function toLines(items, { minX = -Infinity, maxX = Infinity } = {}) {
  const pick = items.filter((i) => i.x >= minX && i.x < maxX).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines = [];
  pick.forEach((it) => {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.3)) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  });
  return lines.map((l) => {
    const its = l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prev = null;
    const parts = []; // runs separated by a big gap (e.g. a right-aligned date)
    its.forEach((it) => {
      const s = it.str;
      if (prev) {
        const gap = it.x - (prev.x + prev.w);
        if (gap > it.size * 3) { parts.push(text); text = ''; } else if (gap > it.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(s)) text += ' ';
      }
      text += s;
      prev = it;
    });
    parts.push(text);
    const clean = parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const main = its.filter((i) => i.str.trim().length > 1);
    const sizeOf = main.length ? main : its;
    return {
      page: l.page, y: l.y, x: its[0].x, textX: (its.find((i) => i.str.trim().length > 1) || its[0]).x, xEnd: Math.max(...its.map((i) => i.x + i.w)),
      size: Math.max(...sizeOf.map((i) => i.size)),
      bold: sizeOf.filter((i) => i.bold).reduce((s, i) => s + i.str.length, 0) >= sizeOf.reduce((s, i) => s + i.str.length, 0) * 0.6,
      parts: clean, text: clean.join('   '),
    };
  });
}
