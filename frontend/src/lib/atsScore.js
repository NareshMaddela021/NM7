// A rule-based ATS score for builder data (0–100) and a job-description keyword match.
// Same rules for the original resume and the expert's draft, so "54 → 86" is a fair comparison.
import { ALL_SKILLS, allSkills } from '../pages/builder/schema';
import { atsCheck, DEFAULT_DESIGN } from '../pages/builder/design';

const ACTION = /^(built|led|created|improved|reduced|increased|designed|automated|analy[sz]ed|delivered|launched|managed|developed|cut|grew|drove|owned|optimi[sz]ed|implemented|migrated|trained|mentored|negotiated|achieved|won|streamlined|planned|wrote|researched|tested|deployed|scaled|saved|resolved|coordinated|organi[sz]ed|presented|prepared|conducted|established|generated|handled|supported|collaborated|identified|elevated|utili[sz]ed|ran|made)\b/i;
const EXTRA_TERMS = ['dashboard', 'dashboards', 'kpi', 'stakeholder', 'a/b testing', 'etl', 'data cleaning', 'data visualization', 'reporting', 'forecasting', 'excel', 'pivot', 'vlookup', 'communication', 'presentation', 'agile', 'api', 'rest', 'microservices', 'ci/cd', 'testing', 'unit testing', 'debugging', 'data structures', 'algorithms', 'customer', 'sales', 'operations', 'inventory', 'supply chain', 'recruitment', 'onboarding', 'payroll', 'accounting', 'gst', 'tally', 'figma', 'user research', 'wireframes', 'seo', 'content', 'social media', 'campaigns'];

/** Every printed word of the resume, lower-case (for keyword search). */
export function resumeText(d) {
  const parts = [d.personal?.headline, d.summary, ...allSkills(d.skillGroups || []),
    ...(d.exp || []).flatMap((e) => [e.role, e.company, e.description]), ...(d.proj || []).flatMap((p) => [p.title, p.tagline, p.description, p.tech]),
    ...(d.edu || []).flatMap((e) => [e.degree, e.field]), ...(d.certs || []).map((c) => c.name), ...(d.ach || []).flatMap((a) => [a.title, a.description]),
    ...(d.custom || []).flatMap((c) => c.items.flatMap((x) => [x.title, x.description]))];
  return parts.filter(Boolean).join(' \n ').toLowerCase();
}
const esc = (w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (hay, w) => new RegExp(`(^|[^a-z0-9+#])${esc(w)}($|[^a-z0-9+#])`).test(hay);

/** Keywords the job asks for, split into found / missing in the resume. */
export function jobMatch(d, jd) {
  const t = (jd || '').toLowerCase();
  if (!t.trim()) return { keywords: [], found: [], missing: [] };
  const keywords = [...new Set([...ALL_SKILLS, ...EXTRA_TERMS].filter((k) => has(t, k)).map((k) => k.toLowerCase()))];
  const text = resumeText(d);
  const found = keywords.filter((k) => has(text, k));
  return { keywords, found, missing: keywords.filter((k) => !found.includes(k)) };
}

export function atsScore(d, jd = '') {
  const ds = { ...DEFAULT_DESIGN, ...(d.design || {}) };
  const bullets = [...(d.exp || []), ...(d.proj || [])].flatMap((e) => (e.description || '').split('\n')).map((b) => b.replace(/^[•\-*▸–]\s*/, '').trim()).filter((b) => b.length > 12);
  const withNum = bullets.filter((b) => /\d/.test(b)).length;
  const strong = bullets.filter((b) => ACTION.test(b) && !/^(made|handled|ran)\b/i.test(b)).length;
  const skills = allSkills(d.skillGroups || []).length;
  const words = resumeText(d).split(/\s+/).length;
  const m = jobMatch(d, jd);
  const P = d.personal || {};
  const checks = [
    ['Name, email and phone', 10, !!(P.name && P.email && P.phone), 'Add your full contact details.'],
    ['LinkedIn link', 5, !!d.links?.linkedin, 'Add a LinkedIn link — recruiters check it.'],
    ['Summary of 150–450 characters', 10, (d.summary || '').length >= 150 && (d.summary || '').length <= 450, 'Write a 3–4 sentence summary with one result.'],
    ['Experience or projects', 10, (d.exp || []).some((e) => e.role || e.company) || (d.proj || []).some((p) => p.title), 'Add internships or projects.'],
    ['Results with numbers', 15, bullets.length > 0 && withNum / bullets.length >= 0.5, `${withNum} of ${bullets.length} bullets have a number — aim for half.`, bullets.length ? Math.round(15 * Math.min(1, withNum / Math.max(1, bullets.length) / 0.5)) : 0],
    ['Bullets start with strong action verbs', 10, bullets.length > 0 && strong / bullets.length >= 0.7, 'Start bullets with verbs like Built, Reduced, Led.', bullets.length ? Math.round(10 * Math.min(1, strong / bullets.length / 0.7)) : 0],
    ['8+ relevant skills', 10, skills >= 8, `${skills} skills listed — add the ones the job asks for.`, Math.round(10 * Math.min(1, skills / 8))],
    ['Education with dates', 5, (d.edu || []).some((e) => e.degree && (e.to || e.from)), 'Add your degree with years.'],
    ['ATS-safe layout', 10, atsCheck(ds, d).score >= 90, 'One column and no photo read best in tracking systems.'],
    ['Fits about one page', 5, words <= 650, 'Trim to the strongest points (about 1 page for 0–3 years).'],
  ];
  if (m.keywords.length) checks.push(['Matches the job description', 10, m.found.length / m.keywords.length >= 0.7, `${m.found.length} of ${m.keywords.length} job keywords found.`, Math.round(10 * (m.found.length / m.keywords.length))]);
  const max = checks.reduce((s, c) => s + c[1], 0);
  const got = checks.reduce((s, [, w, ok, , partial]) => s + (partial !== undefined ? partial : ok ? w : 0), 0);
  return { score: Math.round((got / max) * 100), checks: checks.map(([label, w, ok, tip]) => ({ label, ok, tip, weight: w })), match: m };
}
