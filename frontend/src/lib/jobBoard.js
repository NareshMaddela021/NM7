// The public job board (J3): nm7.si/jobs and nm7.si/jobs/<slug>. The API calls, the filters as URL query values (so
// a filtered list can be shared), the small text helpers (salary, "posted 2 days ago") and the Google JobPosting
// structured data for a job page. Demo jobs never come from these calls; an email-apply address is not public.
import { useEffect, useSyncExternalStore } from 'react';
import { http, LIVE } from '../services/http';

export const ORIGIN = 'https://nm7.si';
export const EXPERIENCE = ['internship', 'fresher', '0_1', '1_3', '3_plus'];
export const JOB_TYPES = ['full_time', 'internship', 'contract', 'part_time'];
export const WORK_TYPES = ['onsite', 'hybrid', 'remote'];
export const POSTED = ['6h', '24h', '7d'];
export const SALARIES = [200000, 300000, 500000, 800000, 1200000]; // "at least … a year"

const EMPTY = { items: [], total: 0, page: 1, pages: 1, cities: [] };

/** One page of public jobs for these filters. Offline (no API): an empty board. */
export function searchJobs(filters = {}, page = 1) {
  if (!LIVE) return Promise.resolve(EMPTY);
  const qs = new URLSearchParams(toQuery(filters));
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return http(`/api/jobs${s ? `?${s}` : ''}`);
}

export const getJob = (slug) => http(`/api/jobs/${encodeURIComponent(slug)}`);

/* ---------- filters ⇄ URL ---------- */

const KEYS = ['q', 'experience', 'city', 'jobType', 'workType', 'salary', 'posted', 'support', 'sort'];
// Phase 6 S9: returning after a break, immediate joiners, inclusive employers (declared by the company), accessible workplaces
export const SUPPORT = ['returners', 'immediate', 'inclusive', 'accessible'];

/** The filters from the page's URL (unknown values dropped). `city` "remote" means remote jobs. */
export function fromQuery(search) {
  const p = new URLSearchParams(search);
  const get = (k) => (p.get(k) || '').trim();
  const f = { q: get('q').slice(0, 80), city: get('city').slice(0, 60) };
  if (EXPERIENCE.includes(get('experience'))) f.experience = get('experience');
  if (JOB_TYPES.includes(get('jobType'))) f.jobType = get('jobType');
  if (WORK_TYPES.includes(get('workType'))) f.workType = get('workType');
  if (SALARIES.includes(Number(get('salary')))) f.salary = Number(get('salary'));
  if (POSTED.includes(get('posted'))) f.posted = get('posted');
  if (SUPPORT.includes(get('support'))) f.support = get('support');
  if (get('sort') === 'match') f.sort = 'match';
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
}

/** Filters → URL query values (only the ones set), in a fixed order. */
export function toQuery(f = {}) {
  const out = {};
  for (const k of KEYS) {
    const v = f[k];
    if (!v) continue;
    if (k === 'city' && v === 'remote') out.remote = 'true';
    else out[k] = String(v);
  }
  return out;
}

/** The page's own URL query (the same as the API's, except remote stays city=remote). */
export const pageQuery = (f = {}) => new URLSearchParams(Object.fromEntries(KEYS.filter((k) => f[k]).map((k) => [k, String(f[k])]))).toString();

/* ---------- text ---------- */

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** "₹3,00,000 – ₹4,50,000 a year", "₹25,000 a month", "From ₹3,00,000 a year", "" when not given. */
export function salaryText(s, t = (k) => ({ 'jobs.perYear': 'a year', 'jobs.perMonth': 'a month', 'jobs.from': 'From', 'jobs.upTo': 'Up to' }[k])) {
  if (!s || (s.min == null && s.max == null)) return '';
  const per = t(s.period === 'monthly' ? 'jobs.perMonth' : 'jobs.perYear');
  if (s.min != null && s.max != null) return s.min === s.max ? `${inr(s.min)} ${per}` : `${inr(s.min)} – ${inr(s.max)} ${per}`;
  return s.min != null ? `${t('jobs.from')} ${inr(s.min)} ${per}` : `${t('jobs.upTo')} ${inr(s.max)} ${per}`;
}

/** "Posted today" / "Posted 3 hours ago" / "Posted 1 day ago" / "Posted 12 days ago". */
export function postedAgo(at, t, nowMs = Date.now()) {
  if (!at) return '';
  const hours = Math.max(0, Math.floor((nowMs - at) / 3_600_000));
  if (hours < 1) return t('jobs.posted.now');
  if (hours < 24) return t(hours === 1 ? 'jobs.posted.hour' : 'jobs.posted.hours', { n: hours });
  const days = Math.floor(hours / 24);
  return t(days === 1 ? 'jobs.posted.day' : 'jobs.posted.days', { n: days });
}

/** "Hyderabad, Pune", "Remote", "Remote · Chennai". */
export function placeText(j, t) {
  const cities = (j.locations || []).join(', ');
  if (!j.remote) return cities;
  return cities ? `${t('jobs.remote')} · ${cities}` : t('jobs.remote');
}

/* ---------- Google JobPosting (https://developers.google.com/search/docs/appearance/structured-data/job-posting) ---------- */

const EMPLOYMENT = { full_time: 'FULL_TIME', internship: 'INTERN', contract: 'CONTRACTOR', part_time: 'PART_TIME' };
const MONTHS = { '1_3': 12, '3_plus': 36 };
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = (ms) => new Date(ms).toISOString();

/** Plain text with line breaks → simple HTML paragraphs (Google shows the description as HTML). */
export const descriptionHtml = (text) => String(text || '').trim().split(/\n\s*\n/).map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

/** The JobPosting for an active job; null for a closed one (Google: take the markup off a job that has ended). */
export function jobPostingJsonLd(j, origin = ORIGIN) {
  if (!j || j.status !== 'active') return null;
  const org = { '@type': 'Organization', name: j.company.name };
  if (j.company.website) org.sameAs = j.company.website;
  if (j.company.logo) org.logo = j.company.logo;
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: descriptionHtml(j.description),
    datePosted: iso(j.postedAt),
    employmentType: EMPLOYMENT[j.jobType] || 'FULL_TIME',
    hiringOrganization: org,
    identifier: { '@type': 'PropertyValue', name: 'Nm7', value: j.id },
    url: `${origin}/jobs/${j.slug}`,
  };
  if (j.closesAt) ld.validThrough = iso(j.closesAt);
  const places = (j.locations || []).map((city) => ({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'IN' } }));
  if (places.length) ld.jobLocation = places.length === 1 ? places[0] : places;
  if (j.remote) {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'India' };
  }
  const s = j.salary;
  if (s && (s.min != null || s.max != null)) {
    const value = { '@type': 'QuantitativeValue', unitText: s.period === 'monthly' ? 'MONTH' : 'YEAR' };
    if (s.min != null && s.max != null && s.min !== s.max) Object.assign(value, { minValue: s.min, maxValue: s.max });
    else value.value = s.min ?? s.max;
    ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'INR', value };
  }
  ld.experienceRequirements = MONTHS[j.experience]
    ? { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: MONTHS[j.experience] }
    : 'no requirements';
  if (j.apply?.method === 'nm7') ld.directApply = true;
  if (j.skills?.length) ld.skills = j.skills.join(', ');
  return ld;
}

/** What Google's Rich Results test needs before it shows a job (used by the tests): missing field names. */
export function jobPostingProblems(ld) {
  const need = ['title', 'description', 'datePosted', 'hiringOrganization'];
  const out = need.filter((k) => !ld?.[k]);
  if (ld && !ld.jobLocation && ld.jobLocationType !== 'TELECOMMUTE') out.push('jobLocation');
  if (ld?.jobLocationType === 'TELECOMMUTE' && !ld.applicantLocationRequirements) out.push('applicantLocationRequirements');
  if (ld?.hiringOrganization && !ld.hiringOrganization.name) out.push('hiringOrganization.name');
  if (ld?.validThrough && Number.isNaN(Date.parse(ld.validThrough))) out.push('validThrough');
  return out;
}

/** Puts one JSON-LD block in <head> while the page shows (none when `data` is null). */
export function useJsonLd(data) {
  const json = data ? JSON.stringify(data) : '';
  useEffect(() => {
    if (!json) return undefined;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.dataset.nm7 = 'jobposting';
    el.textContent = json;
    document.head.appendChild(el);
    return () => el.remove();
  }, [json]);
}

/* ---------- saved jobs (signed in) ---------- */

let saved = null; // Set of job ids, or null until loaded
let savedVersion = 0;
const subs = new Set();
const emit = () => { savedVersion += 1; subs.forEach((f) => f()); };

export const listSaved = () => http('/api/me/saved-jobs');

/** Loads the signed-in person's saved job ids once (again after `reset`). */
export async function loadSaved(force = false) {
  if (!LIVE || (saved && !force)) return saved;
  try { saved = new Set((await listSaved()).items.map((j) => j.id)); } catch { saved = new Set(); }
  emit();
  return saved;
}
export function resetSaved() { saved = null; emit(); }

export async function toggleSaved(id) {
  const on = !saved?.has(id);
  await http(`/api/me/saved-jobs/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' });
  saved = new Set(saved || []);
  if (on) saved.add(id); else saved.delete(id);
  emit();
  return on;
}

/** [is this job saved?, how many are saved] — re-renders when it changes. */
export function useSaved() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => savedVersion, () => 0);
  return { has: (id) => !!saved?.has(id), count: saved ? saved.size : 0, loaded: !!saved };
}

/* ---------- the match score (J4) ---------- */

/** A match → { good: ["Matches 4 of 5 skills", "Fresher OK", "In Hyderabad"], gaps: ["Asks for 3+ years"] }. */
export function matchReasons(m, t) {
  const good = []; const gaps = [];
  if (!m) return { good, gaps };
  const total = (m.found?.length || 0) + (m.missing?.length || 0);
  if (total) (m.found.length ? good : gaps).push(t('jobs.match.skills', { found: m.found.length, total }));
  if (m.experience === 'ok') good.push(t(`jobs.match.exp.${m.level}`));
  else gaps.push(t('jobs.match.expGap', { level: t(`jobs.exp.${m.level}`) }));
  if (m.place === 'remote') good.push(t('jobs.match.remote'));
  else if (m.place === 'city') { if (m.city) good.push(t('jobs.match.city', { city: m.city })); } // no city known: leave the part out
  else if (m.place === 'other') gaps.push(t('jobs.match.otherCity'));
  const need = m.educationNeed ? t(`jobs.edu.${m.educationNeed}`) : '';
  if (m.education === 'ok') good.push(t('jobs.match.edu', { level: need }));
  else if (m.education === 'near' || m.education === 'below') gaps.push(t('jobs.match.eduGap', { level: need }));
  return { good, gaps };
}

/* ---------- Manual Apply (J5) ---------- */

/** Applies (signed in). → { method, created, application, url? (link), email? {to, subject, body} } */
export const applyToJob = (id, resumeId = null, extra = {}) => http(`/api/jobs/${encodeURIComponent(id)}/apply`, { method: 'POST', body: { resumeId, ...extra } }); // extra: {consent, answers} for company jobs (C5)

/** The mailto: link for an email application (subject and letter filled in). */
export const mailtoLink = ({ to, subject, body }) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/* ---------- Jobs for you (J6) ---------- */

/** The dashboard card: { state: on | no_resume, items (top 3 with match), saved, applications }. Offline: nothing. */
export const jobsForYou = () => (LIVE ? http('/api/me/jobs-for-you') : Promise.resolve(null));

/** "Report this job" (C4): one report per person per job; three from different people pause it for our team. */
export const REPORT_REASONS = ['scam', 'fake', 'unfair', 'wrong_info', 'expired', 'other'];
export const reportJob = (id, reason, note = '') => http(`/api/jobs/${encodeURIComponent(id)}/report`, { method: 'POST', body: { reason, note } });
