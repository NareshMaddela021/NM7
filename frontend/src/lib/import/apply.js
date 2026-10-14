// Puts reviewed import results into the builder draft — either replacing it or adding to it.
import { DEFAULT_SKILL_GROUPS, DECL_TEXT, INITIAL, splitSkills } from '../../pages/builder/schema';

const LIST_KEYS = ['exp', 'edu', 'proj', 'certs', 'ach', 'langs'];
const strip = (o) => { const { _conf, _why, _on, _open, ...rest } = o; return rest; };
const low = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const KEY = {
  exp: (e) => low(e.company) + low(e.role),
  edu: (e) => low(e.institution) + low(e.degree),
  proj: (p) => low(p.title),
  certs: (c) => low(c.name),
  ach: (a) => low(a.title),
  langs: (l) => low(l.name),
};

/** An empty profile that keeps the user's design and job preferences. */
function blankFrom(d) {
  return {
    ...INITIAL,
    personal: { name: '', headline: '', email: '', phone: '', location: '', level: '' },
    summary: '', exp: [], edu: [], proj: [], certs: [], ach: [], langs: [], custom: [],
    skillGroups: DEFAULT_SKILL_GROUPS.map((g) => ({ id: g.id, label: g.label, value: '' })),
    links: Object.fromEntries(Object.keys(INITIAL.links).map((k) => [k, ''])),
    hobbies: '', strengths: '', pinfo: { ...Object.fromEntries(Object.keys(INITIAL.pinfo).map((k) => [k, ''])), nationality: '' }, decl: { text: DECL_TEXT, place: '', date: '', name: '' },
    prefs: d.prefs, design: d.design, linkStyle: d.linkStyle, hidden: { ...INITIAL.hidden }, order: null, titles: {},
  };
}

/**
 * @param d     current builder draft
 * @param x     reviewed import data (R.data with _on flags on list items)
 * @param how   'replace' | 'merge'
 */
export function applyImport(d, x, how) {
  const base = how === 'replace' ? blankFrom(d) : { ...d, personal: { ...d.personal }, links: { ...d.links }, pinfo: { ...d.pinfo } };
  const out = { ...base };

  // personal + links: replace fills everything; merge only fills what's empty
  Object.entries(x.personal).forEach(([k, v]) => { if (v && (how === 'replace' || !out.personal[k])) out.personal[k] = v; });
  Object.entries(x.links).forEach(([k, v]) => { if (v && (how === 'replace' || !out.links[k])) out.links[k] = v; });
  const ex = how === 'replace' ? [] : [...(out.linkExtras || [])];
  (x.linkExtras || []).forEach((l) => { if (ex.length < 3 && !ex.some((e) => e.url === l.url) && !Object.values(out.links).includes(l.url)) ex.push(l); });
  out.linkExtras = ex;
  if (x.summary && (how === 'replace' || !out.summary)) out.summary = x.summary;

  LIST_KEYS.forEach((k) => {
    const incoming = (x[k] || []).filter((o) => o._on !== false).map(strip);
    const have = new Set((out[k] || []).map(KEY[k]));
    out[k] = [...(out[k] || []), ...incoming.filter((o) => !have.has(KEY[k](o)))];
  });

  // skills: merge into groups by id (or label), never duplicate a skill
  const groups = (out.skillGroups || []).map((g) => ({ ...g }));
  (x.skillGroups || []).filter((g) => g._on !== false).forEach((g) => {
    const target = groups.find((t) => t.id === g.id || low(t.label) === low(g.label));
    if (target) {
      const seen = new Set(splitSkills(target.value).map(low));
      target.value = [...splitSkills(target.value), ...splitSkills(g.value).filter((s) => !seen.has(low(s)))].join(', ');
    } else groups.push({ id: g.id.startsWith('g_') ? g.id : `g_${Date.now()}_${groups.length}`, label: g.label, value: g.value });
  });
  out.skillGroups = groups;

  // custom sections become builder sections
  const custom = (x.custom || []).filter((c) => c._on !== false);
  out.custom = [...(out.custom || []), ...custom.map((c, i) => ({ id: `c_${Date.now()}_${i}`, title: c.title, items: c.items.map(strip) }))];

  // closing sections: switch them on when the file had them
  const hidden = { ...out.hidden };
  if (x.hobbies) { out.hobbies = how === 'replace' || !out.hobbies ? x.hobbies : `${out.hobbies}\n${x.hobbies}`; hidden.hobbies = false; }
  if (x.strengths) { out.strengths = how === 'replace' || !out.strengths ? x.strengths : `${out.strengths}\n${x.strengths}`; hidden.strengths = false; }
  if (Object.values(x.pinfo || {}).some(Boolean)) {
    out.pinfo = { ...out.pinfo };
    Object.entries(x.pinfo).forEach(([k, v]) => { if (v && (how === 'replace' || !out.pinfo[k])) out.pinfo[k] = v; });
    hidden.pinfo = false;
  }
  if (x.decl) { out.decl = { ...x.decl }; hidden.decl = false; }
  out.hidden = hidden;
  return out;
}

/** Counts for the summary card. */
export function counts(x) {
  const on = (a) => (a || []).filter((o) => o._on !== false).length;
  const skills = (x.skillGroups || []).filter((g) => g._on !== false).reduce((s, g) => s + splitSkills(g.value).length, 0);
  return [
    [on(x.exp), 'job', 'jobs'], [on(x.edu), 'education entry', 'education entries'], [skills, 'skill', 'skills'], [on(x.proj), 'project', 'projects'],
    [on(x.certs), 'certification', 'certifications'], [on(x.ach), 'achievement', 'achievements'], [on(x.langs), 'language', 'languages'],
    [on(x.custom), 'extra section', 'extra sections'],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
}
