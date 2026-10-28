// Resume version compare: section by section, lines aligned (a longest-common-subsequence match), similar lines
// shown as one "changed" row with word-level highlights; template / design changes listed on their own.
import { sectionLines } from '../pages/builder/Compare';
import { TEMPLATE_PRESETS } from '../pages/builder/design';

/** Longest common subsequence of two lists → [{ op: 'same' | 'del' | 'add', a?, b? }] in order. */
export function align(A, B, eq = (x, y) => x === y) {
  const n = A.length; const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { out.push({ op: 'same', a: A[i], b: B[j] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: 'del', a: A[i++] });
    else out.push({ op: 'add', b: B[j++] });
  }
  while (i < n) out.push({ op: 'del', a: A[i++] });
  while (j < m) out.push({ op: 'add', b: B[j++] });
  return out;
}

const toks = (s) => String(s ?? '').split(/(\s+)/).filter((x) => x !== '');
const wordsOf = (s) => String(s ?? '').toLowerCase().split(/\W+/).filter(Boolean);
/** How alike two lines are (shared words / all words): 0..1 */
export function similarity(a, b) {
  const A = new Set(wordsOf(a)); const B = new Set(wordsOf(b));
  if (!A.size && !B.size) return 1;
  let both = 0;
  A.forEach((w) => { if (B.has(w)) both++; });
  return both / (A.size + B.size - both);
}

/** Word-level changes inside one line → { a: [{ t, op }], b: [{ t, op }] } (op: same | del | add) */
export function wordDiff(a, b) {
  const steps = align(toks(a), toks(b));
  return {
    a: steps.filter((s) => s.op !== 'add').map((s) => ({ t: s.a, op: s.op })),
    b: steps.filter((s) => s.op !== 'del').map((s) => ({ t: s.b, op: s.op })),
  };
}

/**
 * One section's rows: { op: 'same' | 'del' | 'add' | 'change', a?, b?, words? }. Removed and added lines next to
 * each other that are alike (half the words or more) become one "changed" row.
 */
export function sectionRows(la, lb) {
  const steps = align(la, lb);
  const rows = [];
  for (let k = 0; k < steps.length; k++) {
    if (steps[k].op !== 'del') { rows.push(steps[k]); continue; }
    // a run of removed lines followed by a run of added lines: pair the alike ones
    const dels = []; while (k < steps.length && steps[k].op === 'del') dels.push(steps[k++]);
    const adds = []; while (k < steps.length && steps[k].op === 'add') adds.push(steps[k++]);
    k--;
    const used = new Set();
    for (const d of dels) {
      let best = -1; let score = 0.5;
      adds.forEach((a, i) => { const s = similarity(d.a, a.b); if (!used.has(i) && s >= score) { best = i; score = s; } });
      if (best >= 0) { used.add(best); rows.push({ op: 'change', a: d.a, b: adds[best].b, words: wordDiff(d.a, adds[best].b) }); } else rows.push(d);
    }
    adds.forEach((a, i) => { if (!used.has(i)) rows.push(a); });
  }
  return rows;
}

/** Every section of two resumes: [{ title, rows, changed, counts: { add, del, change } }] in the newer order. */
export function compareResumes(a, b) {
  const A = sectionLines(a || {}); const B = sectionLines(b || {});
  const titles = [...new Set([...B.map((s) => s.title), ...A.map((s) => s.title)])];
  return titles.map((title) => {
    const rows = sectionRows(A.find((s) => s.title === title)?.lines || [], B.find((s) => s.title === title)?.lines || []);
    const counts = { add: 0, del: 0, change: 0 };
    rows.forEach((r) => { if (r.op !== 'same') counts[r.op]++; });
    return { title, rows, counts, changed: counts.add + counts.del + counts.change > 0 };
  });
}

const DESIGN_NAMES = {
  font: 'Font', headFont: 'Heading font', nameSize: 'Name size', headSize: 'Heading size', bodySize: 'Text size',
  lineHeight: 'Line spacing', sectionGap: 'Space between sections', itemGap: 'Space between entries', accent: 'Accent colour',
  textColor: 'Text colour', pageSize: 'Page size', margin: 'Margins', marginPt: 'Margin size', layout: 'Layout (columns)',
  headerAlign: 'Header alignment', contactLines: 'Contact lines', headingStyle: 'Heading style', bullet: 'Bullet', dateFormat: 'Date format',
  datePos: 'Date position', icons: 'Icons', skillsStyle: 'Skills style', headerStyle: 'Header style', sideTint: 'Side column shade',
  boldNumbers: 'Bold numbers', photoShape: 'Photo shape', photoSize: 'Photo size', photoPos: 'Photo position', photoBorder: 'Photo border',
  printLinks: 'Print web addresses', entryStyle: 'Entry style', contactSep: 'Contact separator', contactOrder: 'Contact order',
};
const show = (v) => (v === true ? 'on' : v === false ? 'off' : v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const templateName = (d) => TEMPLATE_PRESETS[d?.design?.preset || d?.preset]?.name || d?.design?.preset || d?.preset || '—';

/** Template / look changes (not content): [{ what, from, to }] */
export function designChanges(a, b) {
  const out = [];
  if (templateName(a) !== templateName(b)) out.push({ what: 'Template', from: templateName(a), to: templateName(b) });
  const da = a?.design || {}; const db = b?.design || {};
  for (const k of Object.keys(DESIGN_NAMES)) if (show(da[k]) !== show(db[k]) && (k in da || k in db)) out.push({ what: DESIGN_NAMES[k], from: show(da[k]), to: show(db[k]) });
  if (show(!!a?.showPhoto) !== show(!!b?.showPhoto)) out.push({ what: 'Photo', from: a?.showPhoto ? 'shown' : 'hidden', to: b?.showPhoto ? 'shown' : 'hidden' });
  if ((a?.contactIcons || '') !== (b?.contactIcons || '')) out.push({ what: 'Contact icons', from: show(a?.contactIcons), to: show(b?.contactIcons) });
  const hid = (d) => Object.keys(d?.hidden || {}).filter((k) => d.hidden[k]).sort().join(', ');
  if (hid(a) !== hid(b)) out.push({ what: 'Hidden sections', from: hid(a) || 'none', to: hid(b) || 'none' });
  const ord = (d) => (d?.order || []).join(' › ');
  if (ord(a) && ord(b) && ord(a) !== ord(b)) out.push({ what: 'Section order', from: ord(a), to: ord(b) });
  return out;
}
