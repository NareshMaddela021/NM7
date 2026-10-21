// "Write it from my resume" (the builder's Summary step): a summary built only from what the resume already says.
// No AI, no network. Reads, in this order: target role (headline), experience level, the latest internship or job
// (role + company), the top 3 skills (in the order added), the first project, a certification, languages, and
// the course only when "Mention my course" is on. Three sentences at most — who they are, one proof (project,
// certification or internship, whichever exists first), the goal — and a sentence whose facts are missing is left
// out: never an empty blank, nothing invented, numbers only as the person typed them. Same quality gate as the
// summary writer: no I / me / my, no banned clichés, no phone, email, address or ID numbers, at most 400 characters.
import { real } from '../../pages/builder/schema';
import { CONTACT_RE } from './facts';
import { bareRole, joinList, trimTo } from './grammar';
import { languagesOf, skillsOf } from './library';
import { MAX_CHARS, problems } from './write';

export const FROM_RESUME_STYLES = [['role_first', 'Role-first'], ['skills_first', 'Skills-first'], ['simple', 'Simple']];
export const WRITTEN_NOTE = 'Written from your resume, edit anything';

const ID_LIKE = /(?<!\d)\d(?:[ \-.]?\d){8,}(?!\d)|\b[A-Za-z]{5}\d{4}[A-Za-z]\b|@|\bwww\.|https?:/i;
/** A value safe to print: real text, no contact details or ID-like numbers. */
const safe = (v) => {
  const t = real(v).replace(/\s+/g, ' ').replace(/[.;:,]+$/, '');
  CONTACT_RE.lastIndex = 0;
  return !t || ID_LIKE.test(t) || CONTACT_RE.test(t) ? '' : t;
};
const on = (d, list, section) => (d.hidden?.[section] ? [] : (d[list] || []).filter((x) => x && !x.off));
const latest = (a, b) => (b.current ? '9999' : b.to || b.from || '').localeCompare(a.current ? '9999' : a.to || a.from || '');

/** The facts, in the order the summary uses them. */
export function resumeFacts(d, { course = false } = {}) {
  if (!d) return {};
  const target = safe(bareRole(real(d.personal?.headline).split(/\s*[·|•,/]\s*/)[0]));
  const level = real(d.personal?.level);
  const jobs = on(d, 'exp', 'exp').map((e) => ({ role: safe(e.role), company: safe(e.company), from: e.from, to: e.to, current: e.current })).filter((e) => e.role && e.company).sort(latest);
  const job = jobs[0] || null;
  const proj = on(d, 'proj', 'proj').map((p) => safe(p.title)).find(Boolean) || '';
  const cert = on(d, 'certs', 'certs').map((c) => safe(c.name)).find(Boolean) || '';
  const edu = on(d, 'edu', 'edu').filter((e) => real(e.degree)).sort(latest)[0];
  const degree = course && edu ? [safe(edu.degree), safe(edu.field)].filter(Boolean).join(' in ') : '';
  return {
    target, level, fresher: level.startsWith('Fresher'), job,
    intern: !!job && /\bintern(ship)?\b|\btrainee\b|\bapprentice\b/i.test(job.role),
    skills: skillsOf(d).map(safe).filter(Boolean).slice(0, 3),
    project: proj, cert, languages: languagesOf(d).map(safe).filter(Boolean).slice(0, 3), degree,
  };
}

/** What the update prompt watches: skills, role and experience. */
export const summaryBasis = (d) => {
  const f = resumeFacts(d);
  return JSON.stringify([f.skills, f.target, f.level, f.job ? [f.job.role, f.job.company] : null]);
};

const sentence = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : '');
const goal = (f) => (f.target ? `Looking for ${f.fresher || f.intern || !f.job ? 'an entry-level' : 'a'} ${f.target} role` : '');
// the one proof: a project, else a certification, else an internship (unless the first sentence already names it)
function proof(f, jobUsed) {
  if (f.project) return `Project work includes ${f.project}`;
  if (f.cert) return `Completed ${f.cert}`;
  if (f.job && f.intern && !jobUsed) return `Interned as ${f.job.role} at ${f.job.company}`;
  return '';
}
const withLangs = (f) => (f.languages.length > 1 ? `communicates in ${joinList(f.languages)}` : '');

function who(f, style) {
  const skills = f.skills.length ? joinList(f.skills) : '';
  const grad = f.degree ? `${f.degree} graduate` : f.fresher ? 'Fresher' : '';
  if (style === 'skills_first') {
    if (!skills) return f.job ? `${f.job.role} at ${f.job.company}` : grad;
    return `Skilled in ${skills}${f.job ? `, with experience as ${f.job.role} at ${f.job.company}` : ''}`;
  }
  if (style === 'simple') {
    if (f.job) return `${f.job.role} at ${f.job.company}`;
    return skills ? `${grad || 'Candidate'} with skills in ${joinList(f.skills.slice(0, 2))}` : grad;
  }
  // role-first
  if (f.job) return `${f.job.role} at ${f.job.company}${skills ? `, skilled in ${skills}` : ''}`;
  if (grad) return `${grad}${skills ? ` skilled in ${skills}` : ''}${!skills && withLangs(f) ? ` who ${withLangs(f)}` : ''}`;
  return skills ? `Skilled in ${skills}` : '';
}

/** One version: up to 3 sentences, each only when its facts exist. */
export function writeFromResume(d, style = 'role_first', opts = {}) {
  const f = resumeFacts(d, opts);
  const first = who(f, style);
  const jobUsed = !!f.job && /\bat\b/.test(first);
  const parts = style === 'simple' ? [first, goal(f)] : [first, proof(f, jobUsed), goal(f)];
  let out = parts.map(sentence).filter(Boolean);
  // the quality gate: a sentence that fails it is dropped, never shown
  out = out.filter((s) => !problems(s).some((p) => p !== 'long'));
  return trimTo(out.join(' '), MAX_CHARS);
}

/** The three versions to pick from: [{ style, label, text }] (empty texts left out). */
export const versionsFromResume = (d, opts = {}) => FROM_RESUME_STYLES.map(([style, label]) => ({ style, label, text: writeFromResume(d, style, opts) })).filter((v) => v.text);
