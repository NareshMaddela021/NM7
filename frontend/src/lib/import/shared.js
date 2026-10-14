// Pieces both importers use: the result shape, skill grouping, degree splitting, and the final checks.
import { DEFAULT_SKILL_GROUPS, EXP_LEVELS } from '../../pages/builder/schema';
import { monthsBetween } from './dates';
import { skillGroupOf } from './vocab';

export function emptyResult(source) {
  return {
    source,
    data: {
      personal: { name: '', headline: '', email: '', phone: '', location: '', level: '' },
      summary: '', exp: [], edu: [], skillGroups: [], proj: [], certs: [], ach: [], langs: [], custom: [],
      links: {}, hobbies: '', strengths: '', pinfo: {}, decl: null,
    },
    notes: [], // { kind: 'warn' | 'tip' | 'info', sec, msg }
    extraLinks: [],
    suggest: 'fresher',
  };
}

/** Sorts a flat skill list into the builder's 4 categories (unknown ones go to Core). */
export function groupSkills(R, list, label) {
  const clean = list.map((s) => s.replace(/^[•●▪■◦‣\-*➢➤✓✔►▶]\s*/, '').replace(/[.;]$/, '').trim()).filter((s) => s && s.length < 60);
  if (!clean.length) return;
  if (label) { R.data.skillGroups.push({ id: `g_${R.data.skillGroups.length}_${Date.now()}`, label, value: clean.join(', ') }); return; }
  const by = {};
  clean.forEach((s) => { const g = skillGroupOf(s) || 'core'; (by[g] = by[g] || []).push(s); });
  DEFAULT_SKILL_GROUPS.forEach((g) => {
    if (!by[g.id]) return;
    const existing = R.data.skillGroups.find((x) => x.id === g.id);
    if (existing) existing.value = [existing.value, ...by[g.id]].filter(Boolean).join(', ');
    else R.data.skillGroups.push({ id: g.id, label: g.label, value: by[g.id].join(', ') });
  });
}

/** "B. Tech in ECE" / "Bachelor of Technology - BTech, Electronics" → { degree, field } */
export function splitDegree(text) {
  const t = text.replace(/\s+/g, ' ').replace(/[,\s·-]+$/, '').trim();
  const fix = (x) => x.replace(/\b([BM])\.\s+(Tech|Sc|Com|E|A)\b/g, '$1.$2');
  let m = t.match(/^(.*?)\s+in\s+(.+)$/i);
  if (m && m[1].length < 50) return { degree: fix(m[1].trim()), field: m[2].trim() };
  m = t.match(/^([^,]+),\s*(.+)$/);
  if (m) return { degree: m[1].replace(/\s+-\s+(\S+)$/, ' ($1)').trim(), field: m[2].trim() };
  return { degree: fix(t), field: '' };
}

export function noteLongHeadline(R) {
  const h = R.data.personal.headline || '';
  if (h.length > 70) {
    const short = h.split(/\s[|•·]\s/)[0].trim();
    R.notes.push({ kind: 'tip', sec: 'personal', msg: `Your LinkedIn headline is long for a resume. We used “${short}” — you can change it.` });
    R.data.personal.headline = short;
  }
}

const NUM = /\d|%|₹|\blakh|\bcrore/i;

/** Final checks that turn a raw read into useful advice. */
export function finish(R, { pages = 1 } = {}) {
  const d = R.data;
  // experience level from dates
  const months = d.exp.reduce((s, e) => s + monthsBetween(e.from, e.current ? '' : e.to), 0);
  const yrs = months / 12;
  d.personal.level = yrs < 1 ? EXP_LEVELS[0] : yrs < 3 ? EXP_LEVELS[1] : yrs < 6 ? EXP_LEVELS[2] : yrs < 10 ? EXP_LEVELS[3] : EXP_LEVELS[4];
  if (months) R.notes.push({ kind: 'info', sec: 'personal', msg: `About ${yrs.toFixed(1)} years of work found — experience level set to “${d.personal.level}”.` });

  const bullets = d.exp.flatMap((e) => e.description.split('\n')).filter((b) => b.trim().length > 25);
  const noNum = bullets.filter((b) => !NUM.test(b));
  if (bullets.length && noNum.length) R.notes.push({ kind: 'tip', sec: 'exp', msg: `${noNum.length} of ${bullets.length} experience bullets have no numbers. Adding a result (%, time saved, count) makes them much stronger.` });
  if (d.summary.length > 450) R.notes.push({ kind: 'tip', sec: 'summary', msg: `Your summary is ${d.summary.length} characters. 150–400 reads best — try 3–4 sentences.` });
  if (!d.proj.length) R.notes.push({ kind: 'tip', sec: 'proj', msg: 'No projects found. For freshers and career switchers, 2–3 projects with results matter a lot.' });
  if (!d.personal.phone) R.notes.push({ kind: 'warn', sec: 'personal', msg: 'Phone number not found — please add it.' });
  if (!d.personal.email) R.notes.push({ kind: 'warn', sec: 'personal', msg: 'Email not found — please add it.' });
  if (pages > 1 && yrs < 3) R.notes.push({ kind: 'tip', sec: 'review', msg: `Your old resume is ${pages} pages. With under 3 years of experience, 1 page works best — the builder can fit it for you.` });
  // links that didn't fit a named slot become "more profile links" (up to 3)
  R.data.linkExtras = R.extraLinks.slice(0, 3).map((t) => ({ url: t.replace(/\s*\(.*\)$/, ''), label: '', icon: 'auto' }));
  if (R.data.linkExtras.length) R.notes.push({ kind: 'info', sec: 'links', msg: `Added as extra links: ${R.data.linkExtras.map((x) => x.url).join(', ')}.` });
  if (R.extraLinks.length > 3) R.notes.push({ kind: 'info', sec: 'links', msg: `Not added (only 3 extra links fit): ${R.extraLinks.slice(3).join(', ')}.` });

  // template suggestion
  if (d.decl || Object.values(d.pinfo || {}).some(Boolean)) R.suggest = 'kio';
  else if (yrs < 1) R.suggest = 'fresher';
  else R.suggest = 'modern';
  return R;
}
