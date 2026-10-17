// Facts for the summary writer: from the resume's sections first, then from the note the person typed or spoke
// ("Tell us about yourself", any language, transliteration and misspellings included). The resume wins when the two
// disagree. Everything the note contributes comes from the word lists in dictionary.json.
import dictionary from './dictionary.json';
import { allSkills, real } from '../../pages/builder/schema';

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, oka: 1, rendu: 2, moodu: 3, mudu: 3, nalugu: 4, aidu: 5 };
const EDU_RANK = ['10th', '12th', 'iti', 'diploma', 'degree', 'pg'];
const DEGREE_NAME = {
  bsc: 'B.Sc', 'b.sc': 'B.Sc', 'b sc': 'B.Sc', bcom: 'B.Com', 'b.com': 'B.Com', 'b com': 'B.Com', 'b.a': 'B.A', bba: 'BBA', 'b.b.a': 'BBA', bca: 'BCA', 'b.c.a': 'BCA',
  btech: 'B.Tech', 'b.tech': 'B.Tech', 'b tech': 'B.Tech', 'b.e': 'B.E', bpharm: 'B.Pharm', 'b.pharm': 'B.Pharm', bed: 'B.Ed', 'b.ed': 'B.Ed', llb: 'LLB', 'bsc nursing': 'B.Sc Nursing', 'b.sc nursing': 'B.Sc Nursing',
  bds: 'BDS', mbbs: 'MBBS', bhm: 'BHM', bjmc: 'BJMC', mba: 'MBA', 'm.b.a': 'MBA', mca: 'MCA', 'm.c.a': 'MCA', msc: 'M.Sc', 'm.sc': 'M.Sc', 'm sc': 'M.Sc', mcom: 'M.Com', 'm.com': 'M.Com', 'm.a': 'M.A',
  mtech: 'M.Tech', 'm.tech': 'M.Tech', 'm tech': 'M.Tech', 'm.e': 'M.E', mpharm: 'M.Pharm', med: 'M.Ed', 'm.ed': 'M.Ed', llm: 'LLM', pgdm: 'PGDM', pgdca: 'PGDCA', dca: 'DCA', 'chartered accountant': 'CA', cma: 'CMA', phd: 'PhD', 'ph.d': 'PhD',
  iti: 'ITI', 'i.t.i': 'ITI', itc: 'ITI', polytechnic: 'Diploma', diplomo: 'Diploma', deploma: 'Diploma', diploma: 'Diploma',
};
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// whole-phrase match: not glued to another letter or digit on either side
const phraseRe = (phrases) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.map(ESC).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

const EDU_RES = dictionary.education.map((e) => ({ ...e, re: phraseRe(e.words) }));
const FIELD_RES = dictionary.educationFields.map((g) => ({ label: g[0], re: phraseRe(g) }));
const TITLE_RES = dictionary.titles.map((t) => ({ ...t, re: phraseRe([t.t, ...t.syn]) }));
const WORKER = new Set(dictionary.workerTitles);
const YEARS_RE = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2}(?:\\.\\d)?|${Object.keys(WORD_NUMBERS).join('|')})\\s*\\+?\\s*(?:${dictionary.experience.yearWords.map(ESC).join('|')})(?![\\p{L}])`, 'iu');
const MONTHS_RE = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2}|${Object.keys(WORD_NUMBERS).join('|')})\\s*\\+?\\s*(?:${dictionary.experience.monthWords.map(ESC).join('|')})(?![\\p{L}])`, 'iu');
const YEARS_RE_G = new RegExp(YEARS_RE.source, 'giu');
const MONTHS_RE_G = new RegExp(MONTHS_RE.source, 'giu');
const FRESHER_RE = phraseRe(dictionary.experience.fresher);
const RETURNING_RE = phraseRe(dictionary.experience.returning);
const CHANGING_RE = phraseRe(dictionary.experience.changing);
const WANT_RE = phraseRe(dictionary.wantedRole.triggers);
const WANT_AFTER_RE = phraseRe(dictionary.wantedRole.triggersAfter);
const WORKED_AFTER_RE = phraseRe(dictionary.experience.workedAfter);
const FIELD_WORDS = new Set(dictionary.educationFields.flat());
const WORKED_RE = phraseRe(['worked as', 'working as', 'work as', 'experience as', 'experience in', 'job as', 'as a', 'as an', 'years as', 'yrs as', 'i am a', 'i am an', 'i was a', 'i was an', 'am a', 'am an', 'currently a', 'currently an', 'i do', 'doing']);
const YEAR_RE = /^\d{4}/;
const NUMBERISH = /\d|%|₹|\brs\.?\b|\blakh|\bcrore|\bx\b|×/i;
const ID_LIKE = /(?<!\d)\d(?:[ \-.]?\d){8,}(?!\d)|\b[A-Za-z]{5}\d{4}[A-Za-z]\b|@|\bwww\.|https?:/i;
export const CONTACT_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b\d{4}\s?\d{4}\s?\d{4}\b|\b[A-Z]{5}\d{4}[A-Z]\b/g;

const toNum = (s) => (WORD_NUMBERS[s.toLowerCase()] ?? parseFloat(s));
const monthsBetween = (from, to) => {
  const [fy, fm = 1] = from.split('-').map(Number);
  const [ty, tm = 12] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
};
const nowYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
const lc = (s) => clean(s).toLowerCase();

/** From the resume's own sections. Entries switched off, and sections hidden from the resume, are left out. */
export function factsFromResume(d) {
  if (!d) return {};
  const on = (list, section) => (d.hidden?.[section] ? [] : (list || []).filter((x) => x && !x.off));
  const exp = on(d.exp, 'exp').filter((e) => real(e.company) || real(e.role));
  const edu = on(d.edu, 'edu').filter((e) => real(e.degree) || real(e.institution));
  const certs = on(d.certs, 'certs').filter((c) => real(c.name));
  const langs = on(d.langs, 'langs').map((l) => real(l.name)).filter(Boolean);
  const skills = d.hidden?.skills ? [] : allSkills(d.skillGroups || []).map(real).filter(Boolean);
  // highest education: the latest finished entry
  const sorted = [...edu].sort((a, b) => (b.to || b.from || '').localeCompare(a.to || a.from || ''));
  const e0 = sorted[0];
  // total experience in months; the latest job first
  const jobs = [...exp].sort((a, b) => (b.current ? '9999' : b.to || b.from || '').localeCompare(a.current ? '9999' : a.to || a.from || ''));
  const months = exp.reduce((n, e) => (e.from ? n + monthsBetween(e.from, e.current || !e.to ? nowYm() : e.to) : n), 0);
  const j0 = jobs[0];
  const headline = real(d.personal?.headline).split(/\s*[·|•,/]\s*/)[0];
  const achievement = findAchievement([
    ...exp.map((e) => e.description),
    ...on(d.proj, 'proj').map((p) => p.description),
    ...on(d.ach, 'ach').map((a) => [a.title, a.description].filter(Boolean).join('. ')),
  ]);
  return strip({
    degree: real(e0?.degree), field: real(e0?.field), eduYear: YEAR_RE.test(e0?.to || '') ? e0.to.slice(0, 4) : '',
    months: months || 0, hasExperience: exp.length > 0,
    role: real(j0?.role), company: real(j0?.company),
    skills: skills.slice(0, 5), target: headline, certs: certs.map((c) => real(c.name)).slice(0, 2),
    achievement, languages: langs.slice(0, 3),
    fresherLevel: (d.personal?.level || '').startsWith('Fresher'),
  });
}

/** The first bullet with a number in it (a %, rupees, "3x", "40 managers"), cleaned; never an ID or contact. */
export function findAchievement(texts) {
  for (const t of texts) {
    for (const raw of (t || '').split('\n')) {
      const line = clean(raw.replace(/^[•\-*▸–➢✓]\s*/, '')).replace(/[.;]+$/, '');
      if (line.length < 12 || line.length > 160 || !NUMBERISH.test(line) || ID_LIKE.test(line) || CONTACT_RE.test(line)) continue;
      return line;
    }
  }
  return '';
}

function matchAll(re, text) {
  const out = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) { out.push({ text: m[0], start: m.index, end: m.index + m[0].length }); if (!re.global) break; }
  return out;
}

/** From the note: education words, experience, roles mentioned, the role wanted, strengths of those roles. */
export function factsFromNote(note) {
  const text = clean(note);
  if (!text) return {};
  const t = text.toLowerCase();
  // education: the highest level mentioned, with the degree name as written when it is a known abbreviation
  let eduLevel = '', eduWord = '';
  for (const e of EDU_RES) {
    const m = matchAll(e.re, t);
    if (m.length && (!eduLevel || EDU_RANK.indexOf(e.level) > EDU_RANK.indexOf(eduLevel))) { eduLevel = e.level; eduWord = m[0].text; }
  }
  const field = FIELD_RES.find((f) => matchAll(f.re, t).length)?.label || '';
  const breaks = matchAll(RETURNING_RE, t);
  const notBreak = (m) => !breaks.some((b) => (b.end <= m.start && m.start - b.end <= 20) || (b.start >= m.end && b.start - m.end <= 12));
  const yearMatches = matchAll(YEARS_RE_G, t).filter(notBreak);
  const ym = yearMatches[0];
  const mm = matchAll(MONTHS_RE_G, t).filter(notBreak)[0];
  const years = ym ? toNum(YEARS_RE.exec(ym.text)[1]) : 0;
  const months = mm ? toNum(MONTHS_RE.exec(mm.text)[1]) : 0;
  const fresher = !!matchAll(FRESHER_RE, t).length;
  const returning = breaks.length > 0;
  const changing = !!matchAll(CHANGING_RE, t).length;
  // roles: every title phrase found, in order, without overlaps (the longest phrase at a spot wins)
  const found = [];
  for (const title of TITLE_RES) for (const m of matchAll(title.re, t)) found.push({ ...m, title });
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const roles = [];
  let last = -1;
  for (const f of found) { if (f.start >= last) { roles.push(f); last = f.end; } }
  const wants = matchAll(WANT_RE, t);
  const wantsAfter = matchAll(WANT_AFTER_RE, t);
  const worked = matchAll(WORKED_RE, t);
  const workedAfter = matchAll(WORKED_AFTER_RE, t);
  const eduSpots = EDU_RES.flatMap((e) => matchAll(e.re, t));
  const near = (list, pos, dist) => list.some((w) => w.end <= pos && pos - w.end <= dist);
  const after = (list, pos, dist) => list.some((w) => w.start >= pos && w.start - pos <= dist);
  let wanted = null;
  const had = [];
  roles.forEach((r, i) => { r.gap = (roles[i + 1]?.start ?? t.length) - r.end; }); // a word after a role belongs to it only up to the next role
  for (const r of roles) {
    // "diploma in mechanical", "btech ece": the branch of a course, not a job
    if (FIELD_WORDS.has(r.text) && near(eduSpots, r.start, 4)) continue;
    const didIt = near(worked, r.start, 12) || after(workedAfter, r.end, Math.min(20, r.gap));
    const wantedHere = (near(wants, r.start, 40) || after(wantsAfter, r.end, Math.min(25, r.gap))) && !didIt;
    if (!wanted && wantedHere) wanted = r;
    else had.push(r);
  }
  // one role, no experience words: a fresher means the role they want
  if (!wanted && had.length === 1 && (fresher || (!years && !months && !worked.length))) wanted = had.shift();
  // the role they had: one said to be worked ("worked as receptionist") beats a bare mention; "homemaker" and
  // "student" only count when nothing else was said
  const weak = (r) => r.title.t === 'homemaker' || r.title.t === 'student';
  const did = (r) => near(worked, r.start, 12) || after(workedAfter, r.end, Math.min(20, r.gap)) || after(yearMatches, r.end, Math.min(20, r.gap));
  had.sort((a, b) => did(b) - did(a) || weak(a) - weak(b) || a.start - b.start);
  const strengths = [...new Set([...(wanted ? [wanted] : []), ...had].flatMap((r) => r.title.s))].slice(0, 4);
  return strip({
    eduLevel, eduLabel: eduLevel ? EDU_RES.find((e) => e.level === eduLevel).label : '',
    degree: DEGREE_NAME[eduWord] || (eduLevel === 'degree' || eduLevel === 'pg' ? eduWord.toUpperCase().replace(/\s/g, '') : ''),
    field: field ? field.replace(/\b\w/g, (c) => c.toUpperCase()) : '',
    years, months: months || 0, fresher, returning, changing,
    role: had[0]?.title.t || '', target: wanted?.title.t || '',
    worker: [wanted, ...had].some((r) => r && WORKER.has(r.title.t)),
    strengths,
  });
}

/** Resume facts win; the note fills what the resume doesn't say. Also decides the persona. */
export function mergeFacts(fromResume, fromNote, hints = {}) {
  const r = fromResume || {}, n = fromNote || {};
  const months = r.hasExperience ? r.months : (n.years || 0) * 12 + (n.months || 0);
  const years = Math.floor(months / 12);
  const yearsText = months >= 12 ? `${years} year${years === 1 ? '' : 's'}` : months > 0 ? `${months} month${months === 1 ? '' : 's'}` : '';
  const degree = r.degree || n.degree || '';
  const field = r.field || n.field || '';
  const eduLevel = r.degree ? levelOfDegree(r.degree) : n.eduLevel || '';
  const eduLabel = eduLevel === '10th' ? '10th class' : eduLevel === '12th' ? 'Intermediate (12th)' : degree || n.eduLabel || '';
  const degreeFull = degree && field && !/^(10th|12th)/.test(eduLabel) ? `${degree} in ${field}` : degree || eduLabel;
  const role = r.role || n.role || '';
  const target = r.target || n.target || '';
  const facts = {
    degreeFull, degree, field, eduLabel, eduYear: r.eduYear || '', eduLevel,
    years: yearsText, months, role, company: r.company || '', target,
    skills: r.skills || [], strengths: n.strengths || [], cert: r.certs?.[0] || '', achievement: r.achievement || '',
    languages: r.languages || [],
  };
  const hasExp = months > 0 || !!role;
  const worker = !!n.worker || WORKER.has(lc(role)) || WORKER.has(lc(target));
  let persona = 'unknown';
  if (hints.persona === 'returning' || n.returning) persona = 'returning';
  else if (hints.persona === 'changing' || n.changing) persona = 'changer';
  else if (hasExp && !(hints.persona === 'fresher' || n.fresher) && !(r.fresherLevel && months < 12)) persona = worker ? 'skilled' : 'experienced';
  else if (eduLevel === 'degree' || eduLevel === 'pg') persona = 'fresher_grad';
  else if (eduLevel || hints.persona === 'fresher' || n.fresher) persona = 'fresher_school';
  else if (!role && !target && !degree && !facts.skills.length) persona = 'unknown';
  else persona = worker ? 'skilled' : 'unknown';
  facts.persona = persona;
  return facts;
}

function levelOfDegree(degree) {
  const d = lc(degree).replace(/[^a-z0-9. ]/g, '');
  if (/\b(10th|ssc|sslc|matric|x)\b/.test(d)) return '10th';
  if (/\b(12th|inter|intermediate|hsc|puc|xii)\b/.test(d)) return '12th';
  if (/\biti\b/.test(d)) return 'iti';
  if (/diploma|polytechnic/.test(d)) return 'diploma';
  if (/^(m\.?|mba|mca|msc|mcom|mtech|me|ma|llm|pgd|pg|phd|ca\b|cma)/.test(d) || /master|post ?grad/.test(d)) return 'pg';
  return 'degree';
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));

/** Everything in one call: the merged facts (with persona) for a resume and a note. */
export const gatherFacts = (resume, note, hints) => mergeFacts(factsFromResume(resume), factsFromNote(note), hints);
