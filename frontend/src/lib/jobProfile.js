// The Job Profile: one master career record per customer. Resumes are copies made from it.
// Same sections as the builder (so copying is exact), plus job preferences that are never printed or shared.
// Every list entry has a `pid` (stable id) and `pu` (last changed, ms); a resume entry copied from the profile
// keeps that `pid` and the `pv` it was copied at, which is how "Save this change to my Job Profile" and
// "Your profile has N updates" work.
import { DEFAULT_SKILL_GROUPS, DECL_TEXT, INITIAL, splitList } from '../pages/builder/schema';

export const PROFILE_LISTS = ['exp', 'intern', 'proj', 'edu', 'certs', 'ach', 'langs', 'extra'];
export const EXTRA_TITLE = 'Extracurricular Activities';
const META = ['pid', 'pv', 'pu', 'off'];
const uid = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const newPid = uid;

export function emptyProfile(u) {
  return {
    personal: { name: u?.name || '', headline: '', email: u?.email || '', phone: u?.phone || '', location: '' },
    links: { linkedin: '', github: '', portfolio: '' },
    summaries: [{ id: 's1', name: 'Main', text: '' }],
    exp: [], intern: [], proj: [], edu: [], certs: [], ach: [], langs: [], extra: [],
    skillGroups: DEFAULT_SKILL_GROUPS.map((g) => ({ id: g.id, label: g.label, value: '' })),
    hobbies: '', strengths: '', offLines: {},
    pinfo: { father: '', mother: '', dob: '', gender: '', marital: '', nationality: 'Indian', languages: '', address: '' },
    decl: { text: DECL_TEXT, place: '', date: '', name: '' },
    prefs: { targetRoles: '', cities: '', level: '', notice: '', salaryMin: '', salaryMax: '' }, // private
  };
}

/** Fills missing parts (old/partial records) and gives every entry a pid. */
export function normalizeProfile(p, u) {
  const base = emptyProfile(u);
  const out = { ...base, ...(p || {}) };
  ['personal', 'links', 'pinfo', 'decl', 'prefs'].forEach((k) => { out[k] = { ...base[k], ...(p?.[k] || {}) }; });
  PROFILE_LISTS.forEach((k) => { out[k] = (Array.isArray(p?.[k]) ? p[k] : []).map((x) => (x.pid ? x : { ...x, pid: uid(), pu: Date.now() })); });
  out.skillGroups = (Array.isArray(p?.skillGroups) && p.skillGroups.length ? p.skillGroups : base.skillGroups).map((x) => (x.pid ? x : { ...x, pid: uid(), pu: Date.now() }));
  out.summaries = Array.isArray(p?.summaries) && p.summaries.length ? p.summaries : base.summaries;
  out.offLines = p?.offLines || {};
  return out;
}

/* ---------- how complete is it ---------- */
const CHECKS = [
  ['Your name', (p) => p.personal.name.trim()],
  ['Headline / target role', (p) => p.personal.headline.trim() || p.prefs.targetRoles.trim()],
  ['Email', (p) => p.personal.email.trim()],
  ['Phone', (p) => p.personal.phone.trim()],
  ['City', (p) => p.personal.location.trim()],
  ['LinkedIn', (p) => p.links.linkedin.trim()],
  ['A summary', (p) => p.summaries.some((s) => s.text.trim().length > 40)],
  ['Experience or an internship', (p) => [...p.exp, ...p.intern].some((e) => e.company || e.role)],
  ['A project', (p) => p.proj.some((x) => x.title)],
  ['Education', (p) => p.edu.some((e) => e.institution || e.degree)],
  ['At least 5 skills', (p) => p.skillGroups.flatMap((g) => (g.value || '').split(',').map((x) => x.trim()).filter(Boolean)).length >= 5],
  ['A certification or achievement', (p) => p.certs.some((c) => c.name) || p.ach.some((a) => a.title)],
  ['Languages', (p) => p.langs.some((l) => l.name)],
  ['Job preferences', (p) => p.prefs.targetRoles.trim() && p.prefs.cities.trim()],
];
/** { pct, missing: ['Phone', …] } */
export function profileCompleteness(p) {
  const missing = CHECKS.filter(([, ok]) => !ok(p)).map(([l]) => l);
  return { pct: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100), missing };
}

/* ---------- profile → resume ---------- */
const strip = (x, keep = []) => Object.fromEntries(Object.entries(x).filter(([k]) => !META.includes(k) || keep.includes(k)));
/** A resume entry copied from a profile entry (remembers where it came from). */
export const copyEntry = (x) => ({ ...strip(x, ['off']), pid: x.pid, pv: x.pu || 0 });
const internAsExp = (x) => ({ ...copyEntry(x), employmentType: x.employmentType || 'Internship' });
/** Resume list → profile entries feeding it. */
export function sourcesFor(p, section) {
  switch (section) {
    case 'exp': return [...p.exp.map((x) => ({ x, list: 'exp' })), ...p.intern.map((x) => ({ x, list: 'intern' }))];
    case 'skills': return p.skillGroups.filter((g) => g.value?.trim()).map((x) => ({ x, list: 'skillGroups' }));
    case 'extra': return p.extra.map((x) => ({ x, list: 'extra' }));
    default: return (p[section] || []).map((x) => ({ x, list: section }));
  }
}
/** The resume copy of a profile entry, ready for that resume section. */
export const toResumeEntry = (src) => (src.list === 'intern' ? internAsExp(src.x) : copyEntry(src.x));

/** A full new resume pre-filled from the profile (job preferences stay private: salary is never copied). */
export function profileToResume(p, base = INITIAL) {
  const d = structuredClone(base);
  const summary = p.summaries.find((s) => s.text.trim()) || p.summaries[0];
  d.personal = { ...d.personal, ...p.personal, level: p.prefs.level || d.personal?.level || '' };
  d.summary = summary?.text || '';
  d.exp = sourcesFor(p, 'exp').map(toResumeEntry);
  ['proj', 'edu', 'certs', 'ach', 'langs'].forEach((k) => { d[k] = p[k].map(copyEntry); });
  d.skillGroups = p.skillGroups.map((g) => ({ ...copyEntry(g), id: g.id, label: g.label, value: g.value }));
  d.hobbies = p.hobbies; d.strengths = p.strengths; d.offLines = { ...(p.offLines || {}) };
  d.pinfo = { ...d.pinfo, ...p.pinfo }; d.decl = { ...d.decl, ...p.decl };
  d.links = { ...(d.links || {}), linkedin: p.links.linkedin, github: p.links.github, portfolio: p.links.portfolio };
  d.custom = p.extra.length ? [{ id: 'c_extra', title: EXTRA_TITLE, items: p.extra.map(copyEntry) }] : [];
  d.prefs = { ...(d.prefs || {}), locations: p.prefs.cities, notice: p.prefs.notice || d.prefs?.notice || '' }; // no salary
  d.hidden = { ...(d.hidden || {}), hobbies: !p.hobbies.trim(), strengths: !p.strengths.trim() };
  d.fromProfile = { personal: { ...d.personal }, summary: d.summary, at: Date.now() };
  return d;
}

/* ---------- resume / import → profile ---------- */
const lc = (s) => (s || '').toString().trim().toLowerCase();
const KEY = {
  exp: (x) => `${lc(x.company)}|${lc(x.role)}`, intern: (x) => `${lc(x.company)}|${lc(x.role)}`, proj: (x) => lc(x.title),
  edu: (x) => `${lc(x.institution)}|${lc(x.degree)}`, certs: (x) => lc(x.name), ach: (x) => lc(x.title), langs: (x) => lc(x.name), extra: (x) => lc(x.title),
};
const hasContent = (k, x) => !!KEY[k](x).replace(/\|/g, '');

/** Builder-shaped data (a resume, an imported file) as profile sections. */
export function resumeToProfileParts(d) {
  const exp = (d.exp || []).filter((e) => !/intern/i.test(e.employmentType || ''));
  const intern = (d.exp || []).filter((e) => /intern/i.test(e.employmentType || ''));
  const extra = (d.custom || []).filter((c) => /extra|activit|volunt|club|responsib/i.test(c.title || '')).flatMap((c) => c.items || []);
  return {
    personal: { name: d.personal?.name || '', headline: d.personal?.headline || '', email: d.personal?.email || '', phone: d.personal?.phone || '', location: d.personal?.location || '' },
    links: { linkedin: d.links?.linkedin || '', github: d.links?.github || '', portfolio: d.links?.portfolio || '' },
    summary: d.summary || '',
    exp, intern, proj: d.proj || [], edu: d.edu || [], certs: d.certs || [], ach: d.ach || [], langs: d.langs || [], extra,
    skillGroups: d.skillGroups || [], hobbies: d.hobbies || '', strengths: d.strengths || '', pinfo: d.pinfo || {}, level: d.personal?.level || '',
  };
}

/** Adds what the profile doesn't have yet (never overwrites what's there). Returns { profile, added }. */
export function mergeIntoProfile(p, parts) {
  const out = structuredClone(p);
  let added = 0;
  ['name', 'headline', 'email', 'phone', 'location'].forEach((k) => { if (!out.personal[k] && parts.personal[k]) { out.personal[k] = parts.personal[k]; added += 1; } });
  ['linkedin', 'github', 'portfolio'].forEach((k) => { if (!out.links[k] && parts.links[k]) { out.links[k] = parts.links[k]; added += 1; } });
  if (parts.summary?.trim() && !out.summaries.some((s) => lc(s.text) === lc(parts.summary))) {
    const empty = out.summaries.find((s) => !s.text.trim());
    if (empty) empty.text = parts.summary;
    else if (out.summaries.length < 3) out.summaries.push({ id: uid(), name: `Version ${out.summaries.length + 1}`, text: parts.summary });
    added += 1;
  }
  PROFILE_LISTS.forEach((k) => {
    const have = new Set(out[k].map(KEY[k]));
    (parts[k] || []).filter((x) => hasContent(k, x) && !have.has(KEY[k](x))).forEach((x) => {
      out[k].push({ ...strip(x), pid: uid(), pu: Date.now() }); have.add(KEY[k](x)); added += 1;
    });
  });
  (parts.skillGroups || []).forEach((g) => {
    const items = (g.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const target = out.skillGroups.find((x) => x.id === g.id) || out.skillGroups.find((x) => lc(x.label) === lc(g.label));
    const known = new Set(out.skillGroups.flatMap((x) => (x.value || '').split(',').map((s) => lc(s))));
    const fresh = items.filter((s) => !known.has(lc(s)));
    if (!fresh.length) return;
    if (target) target.value = [...(target.value || '').split(',').map((s) => s.trim()).filter(Boolean), ...fresh].join(', ');
    else out.skillGroups.push({ id: g.id || uid(), label: g.label || 'Skills', value: fresh.join(', '), pid: uid(), pu: Date.now() });
    added += fresh.length;
  });
  ['hobbies', 'strengths'].forEach((k) => {
    const have = new Set(splitList(out[k]).map(lc));
    const fresh = splitList(parts[k]).filter((x) => !have.has(lc(x)));
    if (fresh.length) { out[k] = [...splitList(out[k]), ...fresh].join('\n'); added += fresh.length; }
  });
  Object.entries(parts.pinfo || {}).forEach(([k, v]) => { if (v && !out.pinfo[k]) { out.pinfo[k] = v; added += 1; } });
  if (parts.level && !out.prefs.level) out.prefs.level = parts.level;
  return { profile: out, added };
}

/* ---------- keeping resumes and the profile in step ---------- */
export const sameEntry = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const LIST_OF = { exp: ['exp', 'intern'], proj: ['proj'], edu: ['edu'], certs: ['certs'], ach: ['ach'], langs: ['langs'], skills: ['skillGroups'] };
/** The profile entry a resume entry was copied from, if any: { list, x } */
export function profileEntryFor(p, pid) {
  if (!pid || !p) return null;
  for (const k of [...PROFILE_LISTS, 'skillGroups']) { const x = (p[k] || []).find((y) => y.pid === pid); if (x) return { list: k, x }; }
  return null;
}
/** The resume entry differs from the profile (or isn't in it yet): offer "Save this change to my Job Profile". */
export function entryChanged(p, entry) {
  const src = profileEntryFor(p, entry.pid);
  if (!src) return true;
  const mine = src.list === 'intern' ? { ...strip(src.x), employmentType: src.x.employmentType || 'Internship' } : strip(src.x);
  return JSON.stringify(strip(entry)) !== JSON.stringify(mine);
}
/** Writes a resume entry into the profile (updating its source, or adding it to `list`). Returns { profile, pid, pu }. */
export function saveEntryToProfile(p, entry, list) {
  const out = structuredClone(p);
  const now = Date.now();
  const src = profileEntryFor(out, entry.pid);
  const body = strip(entry);
  if (src) {
    out[src.list] = out[src.list].map((x) => (x.pid === entry.pid ? { ...body, pid: x.pid, pu: now, ...(x.off ? { off: true } : {}) } : x));
    return { profile: out, pid: entry.pid, pu: now };
  }
  const pid = uid();
  const target = list === 'exp' && /intern/i.test(entry.employmentType || '') ? 'intern' : list === 'skills' ? 'skillGroups' : list;
  out[target] = [...(out[target] || []), { ...body, pid, pu: now }];
  return { profile: out, pid, pu: now };
}

/** Profile changes a resume hasn't taken yet: [{ key, section, index, label, from, to }] */
export function profileUpdates(d, p) {
  if (!p) return [];
  const out = [];
  const lists = { exp: d.exp, proj: d.proj, edu: d.edu, certs: d.certs, ach: d.ach, langs: d.langs, skills: d.skillGroups };
  (d.custom || []).forEach((c) => { lists[`custom:${c.id}`] = c.items; });
  Object.entries(lists).forEach(([section, list]) => (list || []).forEach((e, index) => {
    const src = profileEntryFor(p, e.pid);
    if (!src || (src.x.pu || 0) <= (e.pv || 0)) return;
    const to = src.list === 'intern' ? { ...strip(src.x), employmentType: src.x.employmentType || 'Internship' } : strip(src.x);
    if (JSON.stringify(strip(e)) === JSON.stringify(to)) return;
    out.push({ key: `${section}:${e.pid}`, section, index, pid: e.pid, pu: src.x.pu, label: entryLabel(to), from: strip(e), to });
  }));
  const snap = d.fromProfile?.personal;
  if (snap) {
    ['name', 'headline', 'email', 'phone', 'location'].forEach((k) => {
      const now = p.personal[k] || '';
      if (now !== (snap[k] || '') && (d.personal?.[k] || '') === (snap[k] || '')) out.push({ key: `personal:${k}`, section: 'personal', field: k, label: k[0].toUpperCase() + k.slice(1), from: d.personal?.[k] || '', to: now });
    });
  }
  return out;
}
/** Takes one update into the resume (accept) or marks it seen (skip). Returns the new resume data. */
export function applyUpdate(d, u, accept) {
  const out = structuredClone(d);
  if (u.section === 'personal') {
    if (accept) out.personal[u.field] = u.to;
    out.fromProfile = { ...(out.fromProfile || {}), personal: { ...(out.fromProfile?.personal || {}), [u.field]: u.to } };
    return out;
  }
  const set = (list) => list.map((e) => (e.pid === u.pid ? { ...(accept ? { ...u.to } : e), pid: e.pid, pv: u.pu, ...(e.off ? { off: true } : {}) } : e));
  if (u.section.startsWith('custom:')) { const id = u.section.slice(7); out.custom = out.custom.map((c) => (c.id === id ? { ...c, items: set(c.items) } : c)); } else if (u.section === 'skills') out.skillGroups = set(out.skillGroups);
  else out[u.section] = set(out[u.section]);
  return out;
}
export const entryLabel = (x) => x.title || x.name || [x.role, x.company].filter(Boolean).join(' · ') || [x.degree, x.institution].filter(Boolean).join(' · ') || x.label || 'Entry';
export { LIST_OF };

/* ---------- cover letters ---------- */
/** The role a cover letter is for, when the user hasn't typed one: first target role, else the headline. */
export const targetRoleOf = (p) => (p ? (p.prefs.targetRoles.split(',')[0] || '').trim() || (p.personal.headline.split(/[·|]/)[0] || '').trim() : '');
/** Resume data whose empty name / contact fields are taken from the profile (for the cover letter header). */
export function withProfileContact(d, p) {
  if (!p || !d) return d;
  const personal = { ...d.personal };
  ['name', 'email', 'phone', 'location'].forEach((k) => { if (!(personal[k] || '').trim() && p.personal[k]) personal[k] = p.personal[k]; });
  return { ...d, personal };
}
