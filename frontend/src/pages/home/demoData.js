// Sample resumes for the home page demos (a made-up candidate, clearly sample data).
import { INITIAL, ALL_SKILLS } from '../builder/schema';
import { TEMPLATE_PRESETS } from '../builder/design';

export const DEMO_JD = 'Data Analyst (0–1 years): SQL, Python, Pandas, Excel, Power BI or Tableau, dashboards, KPI tracking, data cleaning, stakeholder communication.';

const base = structuredClone(INITIAL);
export const BEFORE = {
  ...base,
  personal: { ...base.personal, name: 'Sai Varsha', headline: '' },
  summary: 'Seeking a challenging role in a reputed organisation where I can grow my skills and contribute to the company.',
  exp: [{ ...base.exp[0], description: 'made dashboards in power bi for sales team\ncleaned csv files in python\nhelped with weekly reports' }],
  proj: [{ ...base.proj[0], tagline: '', description: 'made a dashboard for college fest', tech: 'Power BI' }],
  skillGroups: base.skillGroups.map((g) => ({ ...g, value: g.id === 'core' ? 'Python, SQL, Excel' : '' })),
  certs: [], links: { ...base.links, linkedin: '' },
  design: { ...TEMPLATE_PRESETS.fresher.design, preset: 'fresher' },
};
export const AFTER = {
  ...base,
  personal: { ...base.personal, name: 'Sai Varsha', headline: 'Data Analyst · SQL · Python · Power BI' },
  summary: 'Data analyst fresher who turns raw sales data into dashboards teams use every week. Skilled in SQL, Python (Pandas), Excel and Power BI. Cut weekly reporting from 5 hours to 30 minutes during my internship. Looking for a Data Analyst role in a product-led team.',
  exp: [{ ...base.exp[0], description: 'Built 6 Power BI dashboards for a 12-person sales team, cutting weekly reporting from 5 hours to 30 minutes\nCleaned and merged 40+ CSV files (1.2 lakh rows) in Python (Pandas), removing 3,000 duplicate records\nPresented weekly KPI trends to the sales head; 2 insights fed into the next quarter’s targets' }],
  proj: [{ ...base.proj[0], description: 'Built a sponsor-sales dashboard used by a 15-member fest committee to track ₹4 lakh in sponsorships\nModelled data in SQL and automated daily refresh from Google Sheets' }],
  design: { ...TEMPLATE_PRESETS.fresher.design, preset: 'fresher' },
};

/* ---------- "Try it" bullet improver: real rules, no AI ---------- */
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
