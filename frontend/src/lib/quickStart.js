// Profile setup P1: each role's quick start (job seeker, student, expert) — the step machine and the API.
// The server has the same rules (backend app/setup/steps.py); answers are saved one at a time
// (PUT /api/me/setup/{role}) and the person picks up where they stopped. Every step can be skipped: only name,
// contact and role are required (sign-up and the picker). Loaded only by the quick start pages, the account menu
// and the dashboard's "Pick up where you left off" card — never by the Easy dashboard.
import { LIVE, http } from '../services/http';
import { currentUser } from './auth';

export const QS_ROLES = ['jobseeker', 'student', 'expert'];
export const startPath = (role, all = false) => `/start/${role}${all ? '?all=1' : ''}`;
export const resultsPath = (role) => `/start/${role}/results`;

export const EXPERIENCE = [['fresher', 'Fresher'], ['0_1', '0–1 years'], ['1_3', '1–3 years'], ['3_5', '3–5 years'], ['5_8', '5–8 years'], ['8_plus', '8+ years']];
export const LOOKING = [['internship', 'An internship'], ['first_job', 'My first job'], ['live_project', 'A live project'], ['learning', 'Learning new skills']];
export const YEARS = [['1_3', '1–3 years'], ['3_5', '3–5 years'], ['5_8', '5–8 years'], ['8_12', '8–12 years'], ['12_plus', '12+ years']];
export const SERVICES = [['resume_review', 'Resume review'], ['mock_interview', 'Mock interview'], ['career_guidance', 'Career guidance'], ['l4_reviewer', 'Skill verification reviewer (L4)']];
export const CITIES = ['Hyderabad', 'Bengaluru', 'Chennai', 'Pune', 'Mumbai', 'Delhi', 'Kolkata', 'Visakhapatnam'];
export const MAX_CITIES = 3;
export const COURSES = ['B.Tech', 'B.Com', 'B.Sc', 'BCA', 'BBA', 'B.A', 'Diploma', 'ITI', 'Intermediate / 12th', 'MBA', 'MCA', 'M.Tech'];

/** The question and its one-line reward (never a made-up number). */
export const STEP_TEXT = {
  job: ['What job do you want?', 'So we show jobs that match it.'],
  city: ['Where do you want to work?', 'So we show jobs in your city.'],
  experience: ['How much work experience do you have?', 'So we show jobs at your level.'],
  college: ['Which college are you at (or did you finish)?', 'It goes straight into your profile, so you type it once.'],
  course: ['Your course and the year you finish', 'So we show openings that fit your course.'],
  looking: ['What are you looking for?', 'So we show the right things first.'],
  age: ['Your date of birth', 'If you are under 18, the law asks a parent or guardian to agree before skill checks and AI interviews.'],
  faster: ['Fill your profile faster', 'We add only what your profile doesn’t have yet. Nothing you typed is changed.'],
  expertise: ['What are you an expert in?', 'So we match you with the right people.'],
  years: ['How many years of work experience do you have?', 'It goes on your expert application.'],
  services: ['Which services would you like to offer?', 'So we send you only the work you want.'],
};
export const RESULTS_TITLE = { jobseeker: 'Jobs matched for you', student: 'Internships and projects for you', expert: 'Your expert application' };

/* ---------- the step machine (pure: tested in quickStart.test.js) ---------- */

/** The steps this person sees now, in order. switches: { trust, vetting } from the server. */
export function stepsFor(role, a = {}, switches = {}) {
  if (role === 'jobseeker') return ['job', 'city', 'experience', ...(a.experience === 'fresher' ? ['college', 'course'] : []), 'faster'];
  if (role === 'student') return ['college', 'course', 'looking', ...(switches.trust ? ['age'] : []), 'faster'];
  return ['expertise', 'years', 'services', 'faster'];
}

export function answered(step, a = {}) {
  if (step === 'city') return !!(a.cities?.length || a.remote);
  if (step === 'age') return ['adult', 'parent_ok', 'parent_asked'].includes(a.age);
  const v = a[step];
  return Array.isArray(v) ? v.length > 0 : !!v;
}

/** Where the person picks up: the saved step (or the first), past steps already answered or skipped; 'results' when
 * nothing is left. all: "Change my answers" — every step, from the first, answered or not. */
export function resumeStep(steps, a, skipped = [], at = null, done = false, all = false) {
  if (all) return steps[0];
  if (done) return 'results';
  const from = Math.max(0, steps.indexOf(at));
  return steps.slice(from).find((s) => !answered(s, a) && !skipped.includes(s)) || 'results';
}

/** The step after `from` (answered and skipped ones are passed, except when going through all of them). */
export function nextStep(steps, a, skipped = [], from, all = false) {
  const rest = steps.slice(steps.indexOf(from) + 1);
  if (all) return rest[0] || 'results';
  return rest.find((s) => !answered(s, a) && !skipped.includes(s)) || 'results';
}

export const prevStep = (steps, from) => steps[steps.indexOf(from) - 1] || null;

/** Merges an answer into the answers: null or an empty list clears it. */
export function withAnswer(a, patch) {
  const out = { ...a };
  Object.entries(patch).forEach(([k, v]) => { if (v == null || (Array.isArray(v) && !v.length)) delete out[k]; else out[k] = v; });
  return out;
}

/** The levels next to each answer (Batch B): when nothing matches the person's own level, these are tried, never
 * the whole board (a 1-3 year person is not shown 8-12 year or Lead / Senior / Manager jobs). */
export const NEAR = {
  fresher: 'internship,fresher,0_1,1_3,not_stated', '0_1': 'fresher,0_1,1_3,not_stated', '1_3': '0_1,1_3,3_5,not_stated',
  '3_5': '1_3,3_5,5_8,not_stated', '5_8': '3_5,5_8,8_plus,not_stated', '8_plus': '5_8,8_plus,not_stated',
};

/** The job board filters for a job seeker's answers, from the closest match to the widest (each one only when it
 * differs from the one before): the first that finds jobs is shown. `level` (the person's experience) hides jobs far
 * above it on every try. */
export function jobQueries(a = {}) {
  const exp = a.experience === 'fresher' ? 'fresher,0_1' : a.experience || '';
  const near = NEAR[a.experience] || '';
  const level = a.experience || '';
  const places = a.cities?.length ? a.cities.slice(0, MAX_CITIES) : a.remote ? ['remote'] : [''];
  const tries = [
    { q: a.job || '', experience: exp, places, level },
    { q: a.job || '', experience: near, places, level },
    { q: a.job || '', experience: near, places: a.remote && a.cities?.length ? ['remote'] : [''], level },
    { q: '', experience: exp, places: [''], level },
  ];
  const seen = new Set();
  return tries.filter((t) => { const k = JSON.stringify(t); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- the API (preview builds keep it in this browser) ---------- */

const KEY = 'nm7-quick-start-v1';
const local = () => { try { return JSON.parse(localStorage.getItem(`${KEY}:${currentUser()?.id}`) || '{}'); } catch { return {}; } };
function localState(role, saved = local()[role] || {}) {
  const answers = saved.answers || {};
  const steps = stepsFor(role, answers, {});
  const skipped = saved.skipped || [];
  return { role, steps, answers, prefilled: [], skipped, step: resumeStep(steps, answers, skipped, saved.step, !!saved.doneAt), pending: steps.filter((s) => !answered(s, answers) && !skipped.includes(s)).length, done: !!saved.doneAt, startedAt: saved.startedAt || null, doneAt: saved.doneAt || null, switches: { trust: false, vetting: false } };
}

export function getSetup(role) {
  if (!LIVE) return Promise.resolve(localState(role));
  return http(`/api/me/setup/${role}`);
}

/** Every role of mine: { roles, active, setup: { role: state } }. */
export function getAllSetup() {
  if (!LIVE) {
    const roles = currentUser()?.roles?.length ? currentUser().roles : ['jobseeker'];
    return Promise.resolve({ roles, active: currentUser()?.activeRole, setup: Object.fromEntries(roles.map((r) => [r, localState(r)])) });
  }
  return http('/api/me/setup');
}

/** Saves one answer (or skip) at once. body: { answers?, skip?, step?, done? } */
export function putSetup(role, body) {
  if (!LIVE) {
    const all = local();
    const s = all[role] || {};
    const answers = withAnswer(s.answers || {}, body.answers || {});
    const skipped = [...new Set([...(s.skipped || []), ...(body.skip || [])])].filter((x) => !answered(x, answers));
    all[role] = { ...s, answers, skipped, step: body.step || s.step, startedAt: s.startedAt || Date.now(), doneAt: s.doneAt || (body.done ? Date.now() : null) };
    try { localStorage.setItem(`${KEY}:${currentUser()?.id}`, JSON.stringify(all)); } catch { /* ignore */ }
    return Promise.resolve(localState(role, all[role]));
  }
  return http(`/api/me/setup/${role}`, { method: 'PUT', body });
}

export const nearestCity = (lat, lng) => http('/api/me/setup/nearest-city', { method: 'POST', body: { lat, lng } });

export function suggest(kind, q) {
  if (!LIVE) return Promise.resolve({ items: [] });
  return http(`/api/me/setup/suggest?kind=${kind}&q=${encodeURIComponent(q || '')}`);
}

/** The first role of mine whose quick start isn't done yet (other than `but`), or null. */
export function nextRole(all, but) {
  return (all?.roles || []).find((r) => r !== but && QS_ROLES.includes(r) && all.setup?.[r] && !all.setup[r].done) || null;
}
