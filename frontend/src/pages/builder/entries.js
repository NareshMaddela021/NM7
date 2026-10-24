// Entries inside a resume section (Education 1, Experience 2, a hobby, a skill category, an extra link…):
// reorder, switch off and on, and the one filter every renderer uses so switched-off entries never print.
//
// Storage (saved with the resume, also on the server):
//   list entries (exp, edu, proj, certs, ach, langs, custom section items, skillGroups, linkExtras): `off: true`
//   one-per-line text sections (hobbies, strengths): the text keeps every line; `offLines[k]` lists the hidden ones
// Old resumes have neither, so everything in them is visible.
import { splitList } from './schema';

export const ENTRY_LISTS = ['exp', 'edu', 'proj', 'certs', 'ach', 'langs'];
export const LINE_SECTIONS = ['hobbies', 'strengths'];
const on = (x) => !x?.off;
const lc = (s) => (s || '').trim().toLowerCase();

/** A copy of the array with item i moved one place up (dir -1) or down (dir +1). Out of range: unchanged copy. */
export function moveItem(list, i, dir) {
  const a = [...(list || [])];
  const j = i + dir;
  if (i < 0 || i >= a.length || j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}
/** A copy with item i switched off (or back on). */
export const toggleItem = (list, i) => (list || []).map((x, j) => (j === i ? { ...x, off: !x.off } : x));
export const removeItem = (list, i) => (list || []).filter((_, j) => j !== i);

/* ---------- one-per-line sections (hobbies, strengths) ---------- */
/** [{ text, off }] in order. */
export function lineItems(d, k) {
  const hidden = new Set((d.offLines?.[k] || []).map(lc));
  return splitList(d[k]).map((text) => ({ text, off: hidden.has(lc(text)) }));
}
/** The data patch that stores these line items: { [k]: 'a\nb', offLines: { …, [k]: ['b'] } }. */
export function linesPatch(d, k, items) {
  return {
    [k]: items.map((x) => x.text).join('\n'),
    offLines: { ...(d.offLines || {}), [k]: items.filter((x) => x.off && x.text.trim()).map((x) => x.text.trim()) },
  };
}

/** How many entries of a section are switched off (for the sidebar: "Education · 1 hidden"). */
export function hiddenCount(d, id) {
  if (ENTRY_LISTS.includes(id)) return (d[id] || []).filter((x) => x.off).length;
  if (LINE_SECTIONS.includes(id)) return lineItems(d, id).filter((x) => x.off).length;
  if (id === 'skills') return (d.skillGroups || []).filter((x) => x.off).length;
  if (id === 'links') return (d.linkExtras || []).filter((x) => x.off).length;
  const c = (d.custom || []).find((x) => x.id === id);
  return c ? c.items.filter((x) => x.off).length : 0;
}

/** The resume as printed: switched-off entries removed. Used by the preview, PDF, Word, ATS score and share link. */
export function visibleResume(d) {
  if (!d) return d;
  const out = { ...d };
  ENTRY_LISTS.forEach((k) => { if (Array.isArray(d[k])) out[k] = d[k].filter(on); });
  if (Array.isArray(d.skillGroups)) out.skillGroups = d.skillGroups.filter(on);
  if (Array.isArray(d.linkExtras)) out.linkExtras = d.linkExtras.filter(on);
  if (Array.isArray(d.custom)) out.custom = d.custom.map((c) => ({ ...c, items: (c.items || []).filter(on) }));
  LINE_SECTIONS.forEach((k) => {
    if (d.offLines?.[k]?.length) out[k] = lineItems(d, k).filter((x) => !x.off).map((x) => x.text).join('\n');
  });
  return out;
}

/** Old resumes: nothing hidden. Normalises the flags so only `off: true` remains. */
export function migrateEntries(d) {
  if (!d) return d;
  const clean = (list) => (Array.isArray(list) ? list.map((x) => {
    if (!x || typeof x !== 'object' || !('off' in x)) return x;
    const { off, ...rest } = x;
    return off === true ? { ...rest, off: true } : rest;
  }) : list);
  const out = { ...d, offLines: d.offLines && typeof d.offLines === 'object' ? d.offLines : {} };
  [...ENTRY_LISTS, 'skillGroups', 'linkExtras'].forEach((k) => { if (k in d) out[k] = clean(d[k]); });
  if (Array.isArray(d.custom)) out.custom = d.custom.map((c) => ({ ...c, items: clean(c.items) }));
  return out;
}
