// One shape for a LinkedIn profile, whichever way it arrived: the LinkedIn "Save to PDF" file (read by the
// existing parser in lib/import/linkedin.js), the sections the person pasted, or one of their Nm7 resumes.
//   { headline, about, experience: [{ title, company, dates, text }], skills: [..], education: [{ school, degree }],
//     certs: [..], projects: [..], location }
// Nothing here is fetched from linkedin.com: a pasted profile link is only stored and shown.
import { stripBold } from '../bold';

export const LIMITS = { headline: 220, about: 2600, experience: 2000 };
export const PROFILE_URL_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%.]{3,100})\/?(?:\?.*)?$/i;

const clean = (s) => String(stripBold(s) ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,\n;•·|]+/)).map((x) => clean(x).replace(/^[-*]\s*/, '')).filter(Boolean);
const ym = (v) => { const m = String(v || '').match(/^(\d{4})(?:-(\d{2}))?/); return m ? m[1] : ''; };

/** 'linkedin.com/in/ravi-kumar' → 'https://www.linkedin.com/in/ravi-kumar'; '' for an empty box; null when invalid. */
export function normalizeUrl(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  const m = t.match(PROFILE_URL_RE);
  return m ? `https://www.linkedin.com/in/${m[1].replace(/\/+$/, '')}` : null;
}
export const URL_ERROR = 'Paste your profile link, like linkedin.com/in/your-name.';

/** LinkedIn's own address ends in a random code ("ravi-kumar-4b2a91a3"); a custom one reads like a name. */
export function isCustomUrl(url) {
  const m = String(url || '').match(/\/in\/([^/?#]+)/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  return !(/-[a-z0-9]{6,}$/.test(slug) && /\d/.test(slug.split('-').pop())) && !/^\d+$/.test(slug);
}

/** Resume-shaped data (an Nm7 resume, or what the LinkedIn PDF reader returns) → profile sections. */
export function fromResumeData(d) {
  if (!d) return emptySections();
  const on = (arr, sec) => (d.hidden?.[sec] ? [] : (arr || []).filter((x) => x && !x.off));
  return {
    headline: clean(d.personal?.headline),
    about: clean(d.summary),
    location: clean(d.personal?.location),
    experience: on(d.exp, 'exp').filter((e) => clean(e.role) || clean(e.company)).map((e) => ({
      title: clean(e.role), company: clean(e.company),
      dates: [ym(e.from), e.current ? 'Present' : ym(e.to)].filter(Boolean).join(' - '),
      text: clean(e.description),
    })),
    skills: [...new Set((d.hidden?.skills ? [] : d.skillGroups || []).flatMap((g) => list(g.value)))],
    education: on(d.edu, 'edu').filter((e) => clean(e.institution) || clean(e.degree)).map((e) => ({
      school: clean(e.institution), degree: [clean(e.degree), clean(e.field)].filter(Boolean).join(', '), year: ym(e.to),
    })),
    certs: on(d.certs, 'certs').map((c) => clean(c.name)).filter(Boolean),
    projects: on(d.proj, 'proj').map((p) => clean(p.name || p.title)).filter(Boolean),
  };
}

export const emptySections = () => ({ headline: '', about: '', location: '', experience: [], skills: [], education: [], certs: [], projects: [] });

/** Pasted boxes → sections. Experience: one role per block (a blank line between roles); the first line is the title. */
export function fromPaste({ headline = '', about = '', experience = '', skills = '', education = '' } = {}) {
  const blocks = String(experience || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return {
    ...emptySections(),
    headline: clean(headline).replace(/\n+/g, ' '),
    about: clean(about),
    experience: blocks.map((b) => {
      const [first, ...rest] = b.split('\n');
      const [title, company = ''] = first.split(/\s+(?:at|@|-|–|\|)\s+/);
      return { title: clean(title), company: clean(company), dates: '', text: clean(rest.join('\n')) };
    }),
    skills: [...new Set(list(skills))],
    education: String(education || '').split('\n').map(clean).filter(Boolean).map((l) => ({ school: l, degree: '', year: '' })),
  };
}

/** Pasted sections fill what the PDF / resume left empty. */
export function mergeSections(a, b) {
  const x = a || emptySections(), y = b || emptySections();
  const pick = (k) => (Array.isArray(x[k]) ? (x[k].length ? x[k] : y[k] || []) : x[k] || y[k] || '');
  return Object.fromEntries(Object.keys(emptySections()).map((k) => [k, pick(k)]));
}

/** True when there is something to check (a link alone is not enough). */
export const hasContent = (s) => !!(s && (s.headline || s.about || s.experience?.length || s.skills?.length || s.education?.length));

/** All the profile's words, for the keyword match. */
export const profileText = (s) => [s.headline, s.about, ...(s.skills || []), ...(s.experience || []).flatMap((e) => [e.title, e.text]), ...(s.certs || []), ...(s.projects || [])].join('\n');
