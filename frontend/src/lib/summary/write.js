// Layer A of the summary writer: fills the templates in templates.json with facts. No network, instant, and the
// fallback whenever AI is off. Nothing is invented: every blank comes from the resume or the person's note, a
// sentence whose blank is missing is left out, and an empty blank is never printed.
import templates from './templates.json';
import dictionary from './dictionary.json';
import { gatherFacts, CONTACT_RE } from './facts';
import { bareRole, dropLastSentence, graduateOf, hasFirstPerson, joinList, roleNoun, sentences, tidy, trimTo, withArticle } from './grammar';

export const STYLES = Object.keys(templates.styles); // role_first, skills_first, simple
export const STYLE_LABEL = templates.styles;
export const MAX_CHARS = 400;
export const MIN_CHARS = 150;
const BANNED_RE = new RegExp(`\\b(?:${dictionary.banned.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const BLANK_RE = /\{\??(\w+)\}/g;

/** The blanks a template can use, built from the facts. */
export function blanksOf(f) {
  const roleText = f.role || '';
  const target = f.target || '';
  const targetRole = roleNoun(target, 'role');
  return {
    degreeFull: f.degreeFull || '', eduLabel: f.eduLabel || '', eduYear: f.eduYear || '',
    gradOf: graduateOf(f), gradOfYear: f.eduYear ? graduateOf(f, f.eduYear) : '',
    years: f.years || '', role: roleText, aRole: withArticle(bareRole(roleText)), prevRole: roleText,
    company: f.company || '', atCompanyComma: f.company ? `, most recently at ${f.company}` : '', atCompanyPlain: f.company ? ` at ${f.company}` : '',
    skills: joinList((f.skills || []).slice(0, 3)), skills2: joinList((f.skills || []).slice(0, 2)),
    // "as {aTarget}" (a Data Analyst) · "looking for {aTargetRole}" (a Data Analyst role) · "{targetWork}" (driver work)
    target, aTarget: withArticle(bareRole(target)), aTargetRole: withArticle(targetRole), targetWork: roleNoun(target, 'work'),
    strengths: joinList((f.strengths || []).slice(0, 3)),
    cert: f.cert || '', achievement: f.achievement || '', languages: joinList((f.languages || []).slice(0, 3)),
  };
}

/** Fills one template: sentences with a missing (non-optional) blank are left out. */
export function fillTemplate(sentencesIn, blanks) {
  const out = [];
  for (const s of sentencesIn) {
    let missing = false;
    const filled = s.replace(BLANK_RE, (m, name) => {
      const v = blanks[name] ?? '';
      if (!v && !m.startsWith('{?')) missing = true;
      return v;
    });
    if (!missing) out.push(tidy(filled));
  }
  return out.filter(Boolean);
}

/** Quality gate for both layers: no empty blanks, banned clichés, first person, contact details or ID numbers. */
export function problems(text) {
  const t = text || '';
  const found = [];
  if (/\{\??\w*\}|\[[^\]]*\]/.test(t)) found.push('blank');
  if (BANNED_RE.test(t)) found.push('cliche');
  if (hasFirstPerson(t)) found.push('first_person');
  if (CONTACT_RE.test(t)) found.push('contact');
  if (t.length > MAX_CHARS) found.push('long');
  return found;
}

const pick = (list, seed) => list[((seed % list.length) + list.length) % list.length];

/**
 * Writes one summary in one style. `seed` rotates the template variant ("Try again"). Falls back to the "unknown"
 * persona's templates when the persona's own leave too little, then to the closers, so the result is never empty.
 */
export function writeOne(facts, style, seed = 0) {
  const blanks = blanksOf(facts);
  const own = templates.personas[facts.persona] || templates.personas.unknown;
  const tries = [...own[style], ...(facts.persona === 'unknown' ? [] : templates.personas.unknown[style])];
  const order = tries.map((_, i) => tries[(i + seed) % tries.length]);
  let best = [];
  for (const tpl of order) {
    const got = fillTemplate(tpl, blanks);
    if (got.length >= 2 && got.join(' ').length >= 60) { best = got; break; }
    if (got.length > best.length) best = got;
  }
  if (best.length < 2) best = [...best, pick(templates.closers, seed + style.length)];
  let text = trimTo(best.join(' '), MAX_CHARS);
  // the quality gate: drop any sentence that fails it rather than show it
  if (problems(text).length) {
    text = trimTo(sentences(text).filter((s) => !problems(s).some((p) => p !== 'long')).join(' '), MAX_CHARS) || pick(templates.closers, seed);
  }
  return text;
}

/** The three cards: [{ style, label, text }]. */
export function writeSummaries(resume, note, { seed = 0, persona } = {}) {
  const facts = gatherFacts(resume, note, { persona });
  return { facts, options: STYLES.map((style) => ({ style, label: STYLE_LABEL[style], text: writeOne(facts, style, seed) })) };
}

/** "Shorter": one sentence fewer. */
export const shorter = (text) => dropLastSentence(text);

/** The length meter's verdict, shared by the builder and the kiosk. */
export function lengthNote(n) {
  if (n < MIN_CHARS) return { ok: false, text: `${MIN_CHARS - n} more characters recommended` };
  if (n > MAX_CHARS) return { ok: false, text: 'Consider trimming' };
  return { ok: true, text: '✓ Great length' };
}

/** Every number in `text` must appear in the facts or the note (nothing invented). */
export function numbersCovered(text, facts, note = '') {
  const source = `${JSON.stringify(facts)} ${note}`;
  return (text.match(/\d+(?:[.,]\d+)?/g) || []).every((n) => source.includes(n));
}
