// Cover letter: a draft written from the profile (rule-based for now — the AI version comes with the backend),
// plus a job-description check that lists skills the job asks for that the profile doesn't mention.
import { ALL_SKILLS, allSkills, isFresher, real } from './schema';
import { monthsBetween } from '../../lib/import/dates';

export const COVER_BLANK = { company: '', role: '', manager: '', jd: '', body: '', subject: true };

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const lowerFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const has = (hay, w) => new RegExp(`(^|[^a-z0-9+#])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`).test(hay);

export function today() {
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Skills from the job description: which ones the profile has, and which it doesn't mention. */
export function jdMatch(d, jd) {
  const t = (jd || '').toLowerCase();
  if (!t.trim()) return { matched: [], missing: [] };
  const mine = allSkills(d.skillGroups);
  const matched = mine.filter((s) => has(t, s));
  const missing = ALL_SKILLS.filter((s) => has(t, s) && !mine.some((m) => m.toLowerCase() === s.toLowerCase()));
  return { matched, missing };
}

/** The best result line from experience or projects (one with a number wins). */
function bestLine(d) {
  const lines = [...d.exp, ...d.proj].flatMap((e) => (e.description || '').split('\n'))
    .map((l) => l.replace(/^[•\-*▸–]\s*/, '').replace(/^[A-Z][\w &/]{2,30}:\s*/, '').trim()).filter((l) => l.length > 30);
  return lines.find((l) => /\d/.test(l)) || lines[0] || '';
}

/** The resume with empty and placeholder (“[College]”) values blanked, so the draft never repeats them. */
function cleaned(d) {
  const strs = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'string' ? real(v) : v]));
  return { ...d, personal: strs(d.personal), exp: (d.exp || []).map(strs), edu: (d.edu || []).map(strs), proj: (d.proj || []).map(strs),
    skillGroups: (d.skillGroups || []).map((g) => ({ ...g, value: allSkills([g]).filter((x) => real(x)).join(', ') })) };
}

export function draftCover(d0, c0) {
  const d = cleaned(d0);
  const c = { ...c0, role: real(c0.role), company: real(c0.company) };
  const P = d.personal;
  const role = c.role || (P.headline || '').split(/\s[·|@]\s/)[0].trim() || 'the open';
  const company = c.company || 'your company';
  const { matched } = jdMatch(d, c.jd);
  const skills = (matched.length ? matched : allSkills(d.skillGroups)).slice(0, 4);
  const exp = d.exp.find((e) => e.company || e.role);
  const edu = d.edu.find((e) => e.degree || e.institution);
  const proj = d.proj.find((p) => p.title);
  const months = d.exp.reduce((s, e) => s + monthsBetween(e.from, e.current ? '' : e.to), 0);
  const yrs = Math.round(months / 12);

  const p1 = [`I am writing to apply for the ${role} position at ${company}.`];
  if (isFresher(d) || !yrs) {
    if (edu) p1.push(`I ${edu.current ? 'am completing' : 'recently completed'} my ${[edu.degree, edu.field && `in ${edu.field}`].filter(Boolean).join(' ')}${edu.institution ? ` at ${edu.institution}` : ''}, and I am keen to start my career with a team like yours.`);
  } else {
    p1.push(`I bring ${yrs} year${yrs > 1 ? 's' : ''} of experience${exp ? `, most recently as ${exp.role}${exp.company ? ` at ${exp.company}` : ''}` : ''}.`);
  }

  const p2 = [];
  if (skills.length) p2.push(`My strongest skills are ${list(skills)}.`);
  const best = bestLine(d);
  if (best) p2.push(`For example, I ${lowerFirst(best).replace(/\.$/, '')}.`);
  if (proj) p2.push(`I also built ${proj.title}${proj.tagline ? ` — ${proj.tagline.replace(/\.$/, '')}` : ''}.`);

  const p3 = matched.length >= 2 ? [`Your job description asks for ${list(matched.slice(0, 3))}, and these are areas I have worked in directly. I would bring the same care and ownership to ${company}.`] : [];
  const p4 = [`I would welcome the chance to discuss how I can contribute to ${company}. Thank you for your time and consideration.`];
  return [p1, p2, p3, p4].filter((p) => p.length).map((p) => p.join(' ')).join('\n\n');
}

/** Parts of the letter, shared by the preview, the PDF and the Word file. */
export function coverParts(d, c) {
  const name = d.personal.name || 'Your Name';
  return {
    date: today(),
    to: ['The Hiring Manager', c.company].filter(Boolean),
    subject: c.subject !== false && c.role ? `Subject: Application for the ${c.role} position` : '',
    greeting: `Dear ${c.manager ? c.manager.trim() : 'Hiring Manager'},`,
    body: (c.body || '').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean),
    close: c.close || 'Yours sincerely,',
    name,
  };
}
