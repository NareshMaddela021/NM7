// The home page's "fix a weak line" demo: real rules, no AI, and no builder code (only the skill names).
import { ALL_SKILLS } from '../builder/skillNames';

const VERB_FOR = { made: 'Built', did: 'Completed', handled: 'Managed', 'worked on': 'Developed', 'helped with': 'Supported', 'helped in': 'Supported', 'responsible for': 'Owned', 'involved in': 'Contributed to', 'assisted with': 'Supported' };
const STRONG = /^(built|led|created|improved|reduced|increased|designed|automated|analy[sz]ed|delivered|launched|managed|developed|cut|grew|owned|optimi[sz]ed|implemented|presented|cleaned|supported|completed|contributed)\b/i;
const skillCase = (t) => ALL_SKILLS.reduce((s, k) => s.replace(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), k), t);

export function improveBullet(raw) {
  let t = (raw || '').trim().replace(/^[•\-*▸–]\s*/, '').replace(/\.$/, '').replace(/\b(I|we|my|our)\s+/gi, '');
  const weak = Object.keys(VERB_FOR).find((w) => t.toLowerCase().startsWith(`${w} `));
  if (weak) t = `${VERB_FOR[weak]} ${t.slice(weak.length + 1)}`;
  t = skillCase(t).replace(/\bteam\b/i, 'team').replace(/\s{2,}/g, ' ');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const tips = [];
  if (!/\d/.test(t)) tips.push('Add a number — how many, how much, or how often? e.g. “6 dashboards”, “for 12 people”.');
  if (!/(cutting|saving|reducing|increasing|so that|which|, )/i.test(t)) tips.push('Add the result — what got faster, cheaper or better because of it?');
  if (t.split(/\s+/).length < 6) tips.push('Say what it was for and who used it.');
  return { text: t, tips };
}
export function bulletScore(t) {
  const s = (t || '').trim();
  if (!s) return 0;
  let n = 20;
  if (STRONG.test(s)) n += 25;
  if (/\d/.test(s)) n += 25;
  if (ALL_SKILLS.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s))) n += 15;
  const w = s.split(/\s+/).length;
  if (w >= 8 && w <= 24) n += 15;
  return Math.min(100, n);
}
export const EXAMPLES = ['made dashboards in power bi for sales team', 'responsible for handling social media of college club', 'worked on backend of canteen app using spring boot'];
