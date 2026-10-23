// Bold words in resume text: stored as **word** markers inside the existing strings (old resumes have none, so they
// render exactly as before; typing the markers by hand works too). Only the text that prints on the resume can
// carry bold: the summary and the descriptions of experience, projects, achievements and custom sections.
// Everything that is not a resume picture (ATS score, auto summary, AI, plain-text copies, CSV) uses the text
// without markers.

const MARK = '**';

/** "Led **12 people** and cut costs" → [{ t: 'Led ', b: false }, { t: '12 people', b: true }, { t: ' and cut costs', b: false }].
 * An unpaired ** is dropped (never printed). Adjacent pieces of the same weight are merged. */
export function parseBold(raw) {
  const s = String(raw ?? '');
  if (!s.includes(MARK)) return s ? [{ t: s, b: false }] : [];
  const parts = s.split(MARK);
  const paired = parts.length % 2 === 1; // an even count of pieces = an odd number of markers
  // a stray marker between two spaces ("a ** b") leaves one space, not two
  if (!paired && parts.length > 1 && / $/.test(parts[parts.length - 2]) && /^ /.test(parts[parts.length - 1])) parts[parts.length - 1] = parts[parts.length - 1].slice(1);
  const out = [];
  parts.forEach((t, i) => {
    if (!t) return;
    // with an unpaired marker, the text after the last marker is plain
    const b = i % 2 === 1 && (paired || i < parts.length - 1);
    const last = out[out.length - 1];
    if (last && last.b === b) last.t += t; else out.push({ t, b });
  });
  return out;
}

/** The text without markers. */
export const stripBold = (raw) => (typeof raw === 'string' && raw.includes(MARK) ? parseBold(raw).map((p) => p.t).join('') : raw);
export const hasBold = (raw) => parseBold(raw).some((p) => p.b && p.t.trim());

/** Pieces → marker text. Spaces at a bold piece's edges go outside the markers; bold never spans a line break. */
export function serializeBold(pieces) {
  let out = '';
  for (const { t, b } of pieces) {
    if (!b || !t.trim()) { out += t; continue; }
    out += t.split('\n').map((line) => {
      if (!line.trim()) return line;
      const lead = line.match(/^\s*/)[0];
      const trail = line.match(/\s*$/)[0];
      return `${lead}${MARK}${line.trim()}${MARK}${trail}`;
    }).join('\n');
  }
  return out;
}
/** Re-writes marker text in its tidy form (merged pieces, no empty or stray markers). */
export const normalizeBold = (raw) => serializeBold(parseBold(raw));

/** Every string in an object/array without markers (a copy; for ATS, AI, auto summary, plain text). */
export function plainResume(v) {
  if (typeof v === 'string') return stripBold(v);
  if (Array.isArray(v)) return v.map(plainResume);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainResume(x)]));
  return v;
}

/* ---------- editing: the B button and Ctrl/Cmd+B ---------- */

/** Plain characters with their weight; plainAt[r] = how many plain characters come before raw index r. Same
 * rules as parseBold: every ** is hidden, each one switches bold, except an unpaired last one. */
function charsOf(raw) {
  const s = String(raw ?? '');
  const total = s.split(MARK).length - 1;
  const chars = [];
  const plainAt = [];
  const rawOf = []; // raw index of each plain character
  let bold = false; let seen = 0; let r = 0;
  while (r < s.length) {
    if (s.startsWith(MARK, r)) {
      seen += 1;
      if (!(total % 2 === 1 && seen === total)) bold = !bold;
      plainAt[r] = chars.length; plainAt[r + 1] = chars.length; r += 2;
    } else {
      plainAt[r] = chars.length; rawOf.push(r); chars.push({ c: s[r], b: bold }); r += 1;
    }
  }
  plainAt[s.length] = chars.length;
  return { chars, plainAt, rawOf, length: s.length };
}

/**
 * Toggles bold on the selection [start, end) of the raw text. An empty selection uses the word around the cursor.
 * Returns { value, start, end } with the same words still selected.
 */
export function toggleBold(raw, start, end) {
  const { chars, plainAt } = charsOf(raw);
  let a = plainAt[Math.min(start, end)] ?? chars.length;
  let b = plainAt[Math.max(start, end)] ?? chars.length;
  const isWord = (i) => i >= 0 && i < chars.length && /\S/.test(chars[i].c);
  if (a === b) { // the word around the cursor
    while (isWord(a - 1)) a -= 1;
    while (isWord(b)) b += 1;
  }
  while (a < b && !/\S/.test(chars[a].c)) a += 1; // spaces at the edges are never bold
  while (b > a && !/\S/.test(chars[b - 1].c)) b -= 1;
  if (a === b) return { value: String(raw ?? ''), start, end };
  const allBold = chars.slice(a, b).filter((x) => /\S/.test(x.c)).every((x) => x.b);
  for (let i = a; i < b; i += 1) chars[i].b = !allBold;
  const pieces = [];
  chars.forEach((x) => { const last = pieces[pieces.length - 1]; if (last && last.b === x.b) last.t += x.c; else pieces.push({ t: x.c, b: x.b }); });
  const value = serializeBold(pieces);
  const { rawOf } = charsOf(value);
  return { value, start: rawOf[a] ?? value.length, end: (rawOf[b - 1] ?? value.length - 1) + 1 };
}

/** Share of a line's letters that are bold (0–1). */
export function boldShare(line) {
  const pieces = parseBold(line);
  const total = pieces.reduce((n, p) => n + p.t.replace(/\s/g, '').length, 0);
  const bold = pieces.filter((p) => p.b).reduce((n, p) => n + p.t.replace(/\s/g, '').length, 0);
  return total ? bold / total : 0;
}
export const TOO_MUCH_BOLD = 0.3;
/** The gentle tip when a bullet is mostly bold. */
export const tooMuchBold = (raw) => String(raw ?? '').split('\n').some((l) => l.replace(/[*\s]/g, '').length >= 12 && boldShare(l) > TOO_MUCH_BOLD);
export const BOLD_TIP = 'Bold a few key words, like results and tools.';

/* ---------- paste and save: text + bold only ---------- */

// formatting and layout tags that come with pasted or typed HTML (a word like "<Button>" in a developer's bullet stays)
const TAG = /<\/?(?:b|strong|i|em|u|s|strike|del|ins|mark|small|big|sup|sub|span|font|div|p|br|hr|a|ul|ol|li|dl|dt|dd|h[1-6]|table|thead|tbody|tfoot|tr|td|th|section|article|header|footer|blockquote|pre|code|img|meta|link|style|script|o:p|w:[a-z]+)(?:\s[^>]*)?\/?>/gi;
/** Removes HTML/markup tags (keeps the text, keeps "<5 years"-style text that isn't a tag) and tidies markers. */
// <b>…</b> / <strong>…</strong> typed or saved as HTML become bold markers, every other tag is left out
const BOLD_TAG = /<\/?(?:b|strong)(?:\s[^>]*)?>/gi;
const BREAK = /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)>/gi; // a line break or the end of a block
export function sanitizeRich(raw) {
  if (typeof raw !== 'string' || !/[<*]/.test(raw)) return raw;
  const out = raw.replace(BOLD_TAG, MARK).replace(BREAK, '\n').replace(TAG, '');
  return normalizeBold(out === raw ? raw : out.replace(/\n{3,}/g, '\n\n').trim());
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE']);
const isBoldEl = (el) => el.tagName === 'B' || el.tagName === 'STRONG' || /font-weight\s*:\s*(bold|[6-9]00)/i.test(el.getAttribute?.('style') || '');
/** Clipboard HTML (Word, Google Docs, a website) → text with **bold** markers and line breaks; nothing else. */
export function htmlToRich(html, parse = (h) => new DOMParser().parseFromString(h, 'text/html')) {
  const doc = parse(html);
  const pieces = [];
  const push = (t, b) => { if (t) pieces.push({ t, b }); };
  const walk = (node, b) => {
    if (node.nodeType === 3) { push(node.nodeValue.replace(/[\r\n\t ]+/g, ' '), b); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META'].includes(tag)) return;
    // Google Docs wraps everything in <b style="font-weight:normal">
    const bold = /font-weight\s*:\s*(normal|[1-5]00)/i.test(node.getAttribute('style') || '') ? false : b || isBoldEl(node);
    if (tag === 'BR') { push('\n', false); return; }
    if (BLOCK.has(tag) && pieces.length && !pieces[pieces.length - 1].t.endsWith('\n')) push('\n', false);
    node.childNodes.forEach((c) => walk(c, bold));
    if (BLOCK.has(tag)) push('\n', false);
  };
  walk(doc.body || doc, false);
  return serializeBold(pieces.map((p) => ({ ...p, t: p.t }))).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

/* ---------- rewrites: keep bold on the words that survive ---------- */

/** Bold phrases of the old text that are still in the new text (same words) are bold again; the rest is plain. */
export function carryBold(oldRaw, newText) {
  const plain = stripBold(newText);
  const phrases = [...new Set(parseBold(oldRaw).filter((p) => p.b).map((p) => p.t.trim()).filter(Boolean))].sort((x, y) => y.length - x.length);
  if (!phrases.length) return plain;
  const marks = new Array(plain.length).fill(false);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const ph of phrases) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(ph)}(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of plain.matchAll(re)) for (let i = m.index; i < m.index + m[0].length; i += 1) marks[i] = true;
  }
  const pieces = [];
  [...plain].forEach((c, i) => { const last = pieces[pieces.length - 1]; if (last && last.b === marks[i]) last.t += c; else pieces.push({ t: c, b: marks[i] }); });
  return serializeBold(pieces);
}
