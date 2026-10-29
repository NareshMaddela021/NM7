// The sample person (Sai Varsha, schema INITIAL) is only ever shown — "how this template looks when filled" — and
// never saved. Older versions seeded new resumes and browser drafts from it, so some saved resumes still hold its
// exact values. These helpers find and remove exactly those values and nothing else: a real "Lakeview" college,
// a real "English" language or the person's own Python skill stay. The backend cleanup
// (backend/app/maintenance/sample_data.py) uses the same list, kept in sample_values.json.
import { INITIAL } from '../pages/builder/schema';

const S = INITIAL;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? '']));
const EDU_KEYS = ['institution', 'degree', 'field', 'from', 'to', 'grade'];
const EXP_KEYS = ['company', 'role', 'from', 'to'];
const PROJ_KEYS = ['title', 'tagline'];
const CERT_KEYS = ['name', 'issuer', 'issueDate'];
const LANG_KEYS = ['name', 'level'];

/** Markers that only the sample has: one of these means the resume was seeded from it. */
export function sampleMarkers(d) {
  if (!d) return [];
  const out = [];
  if (d.links?.linkedin === S.links.linkedin) out.push('links.linkedin');
  if (d.links?.github === S.links.github) out.push('links.github');
  if (d.pinfo?.father === S.pinfo.father && d.pinfo?.mother === S.pinfo.mother) out.push('pinfo.parents');
  if (d.personal?.email === S.personal.email) out.push('personal.email');
  if ((d.edu || []).some((e) => same(pick(e, EDU_KEYS), pick(S.edu[0], EDU_KEYS)))) out.push('edu');
  if ((d.exp || []).some((e) => same(pick(e, EXP_KEYS), pick(S.exp[0], EXP_KEYS)))) out.push('exp');
  return out;
}
export const hasSample = (d) => sampleMarkers(d).length > 0;

/**
 * The resume without the sample's exact values. Only applied when the resume carries a sample marker; then every
 * field that still equals the sample value exactly is emptied (or the entry removed), and nothing else changes.
 */
export function stripSample(d) {
  if (!hasSample(d)) return d;
  const x = structuredClone(d);
  const clear = (obj, key, value) => { if (obj && obj[key] === value) obj[key] = ''; };
  for (const k of ['name', 'headline', 'email', 'phone', 'location']) clear(x.personal, k, S.personal[k]); // level and nationality are not the sample's own
  for (const k of ['father', 'mother', 'dob', 'languages']) clear(x.pinfo, k, S.pinfo[k]);
  for (const k of ['linkedin', 'github']) clear(x.links, k, S.links[k]);
  clear(x, 'hobbies', S.hobbies);
  clear(x, 'strengths', S.strengths);
  x.edu = (x.edu || []).filter((e) => !same(pick(e, EDU_KEYS), pick(S.edu[0], EDU_KEYS)));
  x.exp = (x.exp || []).filter((e) => !same(pick(e, EXP_KEYS), pick(S.exp[0], EXP_KEYS)));
  x.proj = (x.proj || []).filter((p) => !same(pick(p, PROJ_KEYS), pick(S.proj[0], PROJ_KEYS)));
  x.certs = (x.certs || []).filter((c) => !same(pick(c, CERT_KEYS), pick(S.certs[0], CERT_KEYS)));
  if (same((x.langs || []).map((l) => pick(l, LANG_KEYS)), S.langs.map((l) => pick(l, LANG_KEYS)))) x.langs = [];
  x.skillGroups = (x.skillGroups || []).map((g) => { const sg = S.skillGroups.find((s) => s.id === g.id); return sg && sg.value && g.value === sg.value ? { ...g, value: '' } : g; });
  if (same(x.prefs, S.prefs)) x.prefs = { jobTypes: [], salary: '', notice: '', locations: '', remote: false, relocation: false, industries: [] };
  return x;
}

/** True when nothing of the person's own is left (an untouched sample draft). */
export function isEmptyResume(d) {
  if (!d) return true;
  const p = d.personal || {};
  const text = [p.name, p.headline, p.email, p.phone, p.location, d.summary, d.hobbies, d.strengths, ...Object.values(d.links || {}), ...['father', 'mother', 'dob', 'gender', 'marital', 'languages', 'address'].map((k) => d.pinfo?.[k]), ...(d.skillGroups || []).map((g) => g.value)];
  return text.every((v) => !String(v || '').trim()) && ['exp', 'edu', 'proj', 'certs', 'ach', 'langs', 'custom'].every((k) => !(d[k] || []).some((e) => Object.values(e || {}).some((v) => typeof v === 'string' && v.trim())));
}

export const DRAFTS_CLEARED = 'nm7-sample-drafts-cleared';
const DRAFT_PREFIX = 'asuraa-builder-draft-v6';
/**
 * Once per browser: browser drafts saved by older versions that hold the example person lose those exact values;
 * a draft with nothing of the person's own left is removed. Returns how many drafts changed.
 */
export function scrubSampleDrafts(store = localStorage) {
  let changed = 0;
  const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
  for (const k of keys.filter((x) => x?.startsWith(DRAFT_PREFIX))) {
    try {
      const d = JSON.parse(store.getItem(k));
      if (!hasSample(d)) continue;
      const clean = stripSample(d);
      if (isEmptyResume(clean)) store.removeItem(k); else store.setItem(k, JSON.stringify(clean));
      changed += 1;
    } catch { /* not a draft: left alone */ }
  }
  store.setItem(DRAFTS_CLEARED, '1');
  return changed;
}
