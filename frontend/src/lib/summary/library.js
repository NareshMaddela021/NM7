// "Pick a ready summary" (freshers, the builder's Summary step): 12 hand-picked summaries from summaries.json.
// They are used as written: they are not run through the writer's banned-phrase check. On tap, only two small
// personal touches, and only where the resume has the data: the listed tools become the person's own skills
// (#3, #4, #8, #12) and "English and Hindi" becomes their languages (#11).
import LIBRARY from './summaries.json';
import { allSkills, real } from '../../pages/builder/schema';

export const READY = LIBRARY.summaries;
export const READY_FILTERS = [['all', 'All'], ['tech', 'Tech'], ['data', 'Data'], ['business', 'Business'], ['nontech', 'Non-technical']];
export const READY_TIP = 'Change it to match your real skills, projects and target role. Remove anything that doesn’t describe you.';

/** The card's heading in the page language (Telugu / Hindi when set, else English). */
export const headingOf = (s, lang = 'en') => (lang !== 'en' && s[`heading_${lang}`]) || s.heading;

const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** The card that matches the person's target role (headline), or null. The longest matching role phrase wins. */
export function matchFor(d, list = READY) {
  const target = words(d?.personal?.headline);
  if (!target.trim()) return null;
  let best = null; let len = 0;
  for (const s of list) {
    for (const r of s.roles || []) {
      if (target.includes(words(r)) && r.length > len) { best = s; len = r.length; }
    }
  }
  return best;
}

/** The cards in order: the one matching the target role first, otherwise #1 first; the rest as numbered. */
export function orderFor(d, filter = 'all', list = READY) {
  const first = matchFor(d, list) || list[0];
  const rest = list.filter((s) => s !== first);
  return [first, ...rest].filter((s) => filter === 'all' || s.tags.includes(filter));
}

/** The person's skills in the order they added them (the skills section is on, groups switched off left out). */
export function skillsOf(d) {
  if (!d || d.hidden?.skills) return [];
  return allSkills((d.skillGroups || []).filter((g) => !g.off)).map(real).filter(Boolean);
}
/** The person's languages: the Languages section, else the "Languages known" line of Personal information. */
export function languagesOf(d) {
  const list = (d?.langs || []).filter((l) => l && !l.off).map((l) => real(l.name)).filter(Boolean);
  if (list.length) return list;
  return String(d?.pinfo?.languages || '').split(/\s*(?:,|\/|\band\b|&)\s*/i).map((x) => x.trim()).filter(Boolean);
}

const JOIN = {
  oxford: (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`),
  and: (a) => (a.length <= 1 ? a[0] || '' : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`),
  comma: (a) => a.join(', '),
};

/** The text that goes into the summary box: the card's text, with the person's own skills or languages if they have any. */
export function textFor(s, d) {
  const p = s.personalize;
  if (!p || !s.text.includes(p.find)) return s.text;
  const own = (p.kind === 'languages' ? languagesOf(d) : skillsOf(d)).slice(0, p.count);
  if (!own.length) return s.text;
  return s.text.replace(p.find, (JOIN[p.join] || JOIN.and)(own));
}
