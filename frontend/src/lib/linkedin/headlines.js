// Headlines from fixed patterns (no AI): the target role first, then 2-4 skills the person really has, then one
// proof point from their own facts (degree, current job, a project or a certificate). Always English, at most 220
// characters, never a phone / email / ID number, and never a number that isn't in the facts. Used for the free
// "before → after" in the check, the 5 options for a new profile, and whenever AI is off, busy or over the limit.
import { factsFromNote } from '../summary/facts';
import { LIMITS } from './profile';
import { roleInfo } from './keywords';
import { hasPrivate, stripPrivate } from './privacy';

export const HEADLINE_MAX = LIMITS.headline;
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u; // English letters only (no Telugu / Hindi script)
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const title = (s) => tidy(s).replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
const latin = (s) => { const t = tidy(stripPrivate(s)); return t && LATIN.test(t) ? t : ''; };
const shortDegree = (d) => tidy(d).split(/,|\s+in\s+|\s+-\s+/)[0];

/** A role typed in any language → an English role ("డేటా అనలిస్ట్" isn't readable here, so it falls back to the note). */
export function englishRole(raw, note = '') {
  const t = latin(raw);
  if (t) return title(t);
  const n = factsFromNote(`${raw || ''} ${note || ''}`);
  return n.target ? title(n.target) : n.role ? title(n.role) : '';
}

/**
 * Facts for headlines, from profile sections (see profile.js) and/or the "Create" details, plus the note.
 * Only English text the person gave; nothing invented. → { target, skills, degree, current, projects, certs, city, year }
 */
export function headlineFacts({ sections, details, role = '', note = '' } = {}) {
  const s = sections || {};
  const d = details || {};
  const fromNote = factsFromNote(note);
  const target = englishRole(role || d.role, note) || (fromNote.target ? title(fromNote.target) : '');
  const info = roleInfo(target);
  const skillList = [
    ...(s.skills || []),
    ...String(d.skills || '').split(/[,\n;]+/),
  ].map(latin).filter((x) => x && x.length <= 40);
  // role keywords the person has first, in the order recruiters care about
  const ranked = info ? [...info.words.filter((w) => skillList.some((x) => x.toLowerCase() === w.toLowerCase())), ...skillList] : skillList;
  const skills = [...new Map(ranked.map((x) => [x.toLowerCase(), info?.words.find((w) => w.toLowerCase() === x.toLowerCase()) || x])).values()];
  const edu = [...(s.education || []), ...(d.education || []).map((e) => ({ degree: [e.degree, e.field].filter(Boolean).join(', '), school: e.school, year: e.year }))].filter((e) => latin(e.degree));
  const jobs = [...(s.experience || []), ...(d.work || []).map((w) => ({ title: w.title, company: w.company, dates: w.current ? 'Present' : '' }))].filter((e) => latin(e.title));
  const now = jobs.find((e) => /present/i.test(e.dates || '')) || null;
  return {
    target,
    skills: skills.slice(0, 6),
    degree: edu[0] ? latin(shortDegree(edu[0].degree)) : (fromNote.degree || ''),
    field: edu[0] ? latin(edu[0].degree.split(/,|\s+in\s+/)[1] || '') : '',
    year: edu[0] ? String(edu[0].year || '').slice(0, 4) : '',
    current: now ? [latin(now.title), latin(now.company)].filter(Boolean).join(' at ') : '',
    projects: [...(s.projects || []), ...String(d.projects || '').split(/[\n;]+/)].map(latin).filter((x) => x && x.length <= 60).slice(0, 2),
    certs: [...(s.certs || []), ...String(d.certs || '').split(/[\n;]+/)].map(latin).filter((x) => x && x.length <= 60).slice(0, 2),
    city: latin(d.city || s.location || '').split(',')[0],
  };
}

/** Joins parts with " | " and drops parts from the end until it fits in 220 characters. */
function fit(parts) {
  const p = parts.map(tidy).filter(Boolean);
  while (p.length > 1 && p.join(' | ').length > HEADLINE_MAX) p.pop();
  const out = p.join(' | ');
  return out.length <= HEADLINE_MAX ? out : out.slice(0, HEADLINE_MAX).replace(/\s+\S*$/, '');
}

/** Every number in a headline must be in the facts. */
export const numbersCovered = (h, facts) => (h.match(/\d+(?:[.,]\d+)?/g) || []).every((n) => JSON.stringify(facts).includes(n));

/** True when a headline is safe to show: English, 10-220 characters, nothing private, no invented number. */
export function headlineOk(h, facts) {
  const t = tidy(h);
  return t.length >= 10 && t.length <= HEADLINE_MAX && LATIN.test(t) && !hasPrivate(t) && !/\p{Extended_Pictographic}/u.test(t) && numbersCovered(t, facts);
}

/** Up to `count` different headlines from the facts. Empty when there is no role, skill or degree to work with. */
export function headlineOptions(facts, count = 5) {
  const f = facts || {};
  const role = f.target || (f.degree ? `${f.degree}${f.field ? ` ${f.field}` : ''} graduate` : '');
  if (!role && !f.skills?.length) return [];
  const sk = f.skills || [];
  const deg = f.degree ? `${f.degree}${f.field ? ` ${f.field}` : ''}${f.year ? ` (${f.year})` : ''}` : '';
  const proof = f.current || (f.projects?.[0] ? `Built ${f.projects[0]}` : '') || f.certs?.[0] || deg;
  const fresher = !f.current;
  const R = role || 'Fresher';
  const candidates = [
    fit([R, sk.slice(0, 3).join(' · '), proof]),
    fit([`${fresher && f.target ? 'Aspiring ' : ''}${R}${sk.length >= 2 ? ` skilled in ${sk.slice(0, 2).join(' and ')}` : ''}`, deg || f.certs?.[0] || '']),
    fit([R, f.projects?.[0] ? `Built ${f.projects[0]}` : '', sk.slice(0, 4).join(' · ')]),
    fit([deg && f.target ? `${deg} | ${R}` : R, f.certs?.[0] || '', sk.slice(0, 2).join(' · ')]),
    fit([R, sk.slice(0, 4).join(', '), f.target ? `Open to ${f.target} roles${f.city ? ` in ${f.city}` : ''}` : '']),
    fit([f.current || R, sk.slice(0, 3).join(' · ')]),
    fit([R, deg]),
    // fewer facts: still 5 different ones, from the same facts
    fit([sk.slice(0, 2).join(' & '), R]),
    fit([`${fresher && f.target ? 'Aspiring ' : ''}${R}`, sk.slice(0, 3).join(' | ')]),
    fit([`${R} skilled in ${sk.slice(0, 3).join(', ')}`]),
  ];
  const seen = new Set();
  const out = [];
  for (const h of candidates) {
    const k = h.toLowerCase();
    if (!h || seen.has(k) || !headlineOk(h, f) || h === R) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= count) break;
  }
  return out;
}

/** The free "before → after": the first option that is different from (and longer than a bare copy of) the current. */
export function improveHeadline(current, facts) {
  const cur = tidy(current).toLowerCase();
  return headlineOptions(facts, 7).find((h) => h.toLowerCase() !== cur) || '';
}
