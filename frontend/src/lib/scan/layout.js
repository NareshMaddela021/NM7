// Layout signals from pdf.js text positions: two-column pages and table-like rows.
// Pure functions (no pdf.js needed), so they can be unit-tested with made-up positions.

const DATEISH = /^(\(?\s*)?((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?((19|20)\d{2}|present|current|now)?(\s*[-–—to]+\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?((19|20)\d{2}|present|current|now))?\s*\)?$/i;

/** Rows = items on the same page and baseline; runs = pieces of a row separated by a wide gap. */
export function rowsAndRuns(items) {
  const sorted = [...items].filter((i) => i.str && i.str.trim()).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const rows = [];
  sorted.forEach((it) => {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.3)) last.items.push(it);
    else rows.push({ page: it.page, y: it.y, items: [it] });
  });
  rows.forEach((r) => {
    r.items.sort((a, b) => a.x - b.x);
    r.runs = [];
    let run = null;
    r.items.forEach((it) => {
      const gap = run ? it.x - run.xEnd : Infinity;
      if (!run || gap > Math.max(14, it.size * 2.2)) { run = { x: it.x, xEnd: it.x + it.w, text: it.str }; r.runs.push(run); } else {
        run.text += (gap > it.size * 0.18 && !/\s$/.test(run.text) ? ' ' : '') + it.str;
        run.xEnd = it.x + it.w;
      }
    });
    r.runs.forEach((x) => { x.text = x.text.replace(/\s+/g, ' ').trim(); });
  });
  return rows;
}

/**
 * @param items  pdf.js items { str, x, y, w, size, page }
 * @param pages  [{ w, h }] page sizes
 * @returns {{ multiColumn: boolean, tableRows: {page:number,y:number}[], columnStarts: {page:number,y:number}[] }}
 */
export function detectPdfLayout(items, pages) {
  const rows = rowsAndRuns(items);
  let runCount = 0;
  const mid = [];
  const tableRows = [];
  rows.forEach((r) => {
    const W = pages[r.page - 1]?.w || 612;
    const real = r.runs.filter((x) => x.text.length >= 2);
    runCount += real.length;
    // text that starts in the middle band of the page and is more than a right-aligned date
    real.forEach((x) => { if (x.x > W * 0.3 && x.x < W * 0.72 && x.text.length >= 12 && !DATEISH.test(x.text)) mid.push({ page: r.page, y: r.y, x: x.x }); });
    if (real.filter((x) => !DATEISH.test(x.text)).length >= 3) tableRows.push({ page: r.page, y: r.y });
  });
  const multiColumn = mid.length >= 6 && mid.length >= runCount * 0.18;
  // where the second column starts: the most common start among those mid-page runs
  let splitX = null;
  if (multiColumn) {
    const xs = mid.map((m) => Math.round(m.x / 4) * 4);
    const freq = {};
    xs.forEach((x) => { freq[x] = (freq[x] || 0) + 1; });
    splitX = Math.min(...Object.entries(freq).filter(([, n]) => n >= Math.max(3, Math.max(...Object.values(freq)) * 0.5)).map(([x]) => +x)) - 4;
  }
  return { multiColumn, splitX, tableRows: tableRows.length >= 3 ? tableRows : [], columnStarts: multiColumn ? mid : [] };
}
