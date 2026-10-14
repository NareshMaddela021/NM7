// Expert profile: fields, auto-fill from an asuraa.ai profile or an uploaded document, strength and checks.
import { isUpi } from './format';
import { currentUser, updateUser } from './auth';

export const DOMAINS = ['Data & analytics', 'Software engineering', 'Product', 'Design', 'Finance', 'Marketing & HR', 'Sales', 'Operations & supply chain', 'Management', 'Healthcare', 'Education', 'Govt / PSU', 'Core engineering'];
export const LEVELS = [['fresher', 'Freshers / students'], ['early', '0–3 years'], ['mid', '3+ years']];
export const LANGS = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Odia', 'Urdu'];
export const STATUS = {
  draft: ['Draft', 'b-neutral', 'Fill in your profile and submit it for review.'],
  review: ['Under review', 'b-warning', 'We’re checking your profile. This usually takes 1–2 working days.'],
  changes: ['Needs changes', 'b-danger', 'Please update the points below and submit again.'],
  test: ['Test task', 'b-warning', 'Your profile looks good. Last step: a short test task — rewrite a sample resume within 48 hours.'],
  testReview: ['Test submitted', 'b-warning', 'Thanks! We’re reviewing your test task. This usually takes 1–2 working days.'],
  approved: ['Approved · Verified expert', 'b-success', 'You can now receive orders.'],
  rejected: ['Not approved', 'b-danger', 'We can’t approve your profile right now. See the note below.'],
};
const BASE = 'asuraa-expert-profile-v1';
/** One profile per expert account (the sample expert and signed-out preview use the original key). */
export const keyFor = (userId) => (!userId || userId === 'u-naresh' ? BASE : `${BASE}:${userId}`);
export const KEY = BASE;
const myKey = () => keyFor(currentUser()?.role === 'expert' ? currentUser().id : null);
/** Every expert profile saved in this browser (preview stand-in for GET /api/admin/expert-applications). */
export function allProfiles() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k === BASE || k.startsWith(`${BASE}:`)) out.push({ key: k, p: { ...BLANK, ...JSON.parse(localStorage.getItem(k)) } }); } } catch { /* ignore */ }
  return out;
}
/** Admin decision / test result written back to that expert's profile and account. */
export function patchProfile(key, patch) {
  try {
    const p = { ...BLANK, ...JSON.parse(localStorage.getItem(key) || '{}'), ...patch };
    localStorage.setItem(key, JSON.stringify(p));
    if (p.userId && patch.status) updateUser(p.userId, { expertStatus: patch.status });
    return p;
  } catch { return null; }
}

export const BLANK = {
  source: null,
  ai: null, // { username, url, verified, showBadge, rating, reviews, syncedAt }
  photo: null, // adjusted photo (data URL)
  about: { name: '', headline: '', bio: '', city: '', languages: [] },
  expertise: { domains: [], roles: '', levels: [] },
  proof: { experience: [], certs: [], linkedin: '', recruiterYears: '', resumesWritten: '' },
  samples: [], // { name, size, anonymised }
  services: { plans: ['expert'], perWeek: 5, rush: false, paused: false },
  payout: { method: 'upi', upi: '', bankName: '', account: '', ifsc: '', pan: '', reuseAi: false },
  agree: false,
  status: 'draft',
  note: '',
};

export const loadExpert = () => { try { const s = localStorage.getItem(myKey()); return s ? { ...BLANK, ...JSON.parse(s) } : null; } catch { return null; } };
export const saveExpert = (p) => {
  const u = currentUser();
  const next = u?.role === 'expert' ? { ...p, userId: u.id } : p;
  try { localStorage.setItem(myKey(), JSON.stringify(next)); } catch { /* ignore */ }
  if (u?.role === 'expert' && u.expertStatus !== next.status && !(u.expertStatus === 'approved' && next.status === 'draft')) updateUser(u.id, { expertStatus: next.status });
};
export const clearExpert = () => { try { localStorage.removeItem(myKey()); } catch { /* ignore */ } };

/* ---------- domain suggestions from experience / headline ---------- */
const DOMAIN_WORDS = [
  [/data|analyst|analytics|machine learning|\bml\b|\bai\b|power bi|sql/i, 'Data & analytics'],
  [/software|developer|frontend|backend|full.?stack|sde|programmer/i, 'Software engineering'],
  [/product manager|product owner/i, 'Product'],
  [/\b(design|designer|ui|ux)\b/i, 'Design'],
  [/financ|bank|account|audit|\bca\b/i, 'Finance'],
  [/marketing|\bhr\b|recruit|talent|hiring/i, 'Marketing & HR'],
  [/sales|business development/i, 'Sales'],
  [/supply chain|logistic|warehouse|inventory|operations|glovis/i, 'Operations & supply chain'],
  [/founder|ceo|director|head of|manager/i, 'Management'],
  [/nurse|doctor|pharma|health|hospital/i, 'Healthcare'],
  [/\b(teacher|professor|lecturer|tutor)\b/i, 'Education'],
];
export function suggestDomains(p) {
  const text = [p.about.headline, p.about.bio, ...p.proof.experience.map((e) => `${e.role} ${e.company}`)].join(' ');
  return DOMAINS.filter((dm) => DOMAIN_WORDS.some(([re, d]) => d === dm && re.test(text)));
}

/* ---------- auto-fill ---------- */
/** asuraa.ai public profile → expert profile (only the parts the expert ticked). */
export function fromAsuraaAi(base, ai, picks) {
  const p = structuredClone(base);
  if (picks.name) p.about.name = ai.name;
  if (picks.headline) p.about.headline = ai.headline;
  if (picks.bio) p.about.bio = ai.bio;
  if (picks.city) p.about.city = ai.location;
  if (picks.languages) p.about.languages = [...new Set([...p.about.languages, ...ai.languages])];
  if (picks.experience) p.proof.experience = ai.experience.map((e) => ({ ...e }));
  if (picks.links && ai.links.linkedin) p.proof.linkedin = ai.links.linkedin;
  p.ai = { username: ai.username, url: ai.url, verified: true, showBadge: true, rating: ai.rating, reviews: ai.reviews, syncedAt: new Date().toISOString() };
  p.source = 'asuraa.ai';
  return p;
}

const years = (from, to) => { if (!from) return ''; const a = +from.slice(0, 4); const b = to ? +to.slice(0, 4) : new Date().getFullYear(); return b >= a ? `${from.slice(0, 4)}–${to ? to.slice(0, 4) : 'now'}` : ''; };
/** Result of the resume / LinkedIn reader (lib/import) → expert profile. */
export function fromDocument(base, R) {
  const d = R.data;
  const p = structuredClone(base);
  p.about.name = p.about.name || d.personal.name;
  p.about.headline = p.about.headline || d.personal.headline;
  p.about.city = p.about.city || d.personal.location;
  if (!p.about.bio && d.summary) p.about.bio = d.summary.length > 600 ? `${d.summary.slice(0, 597).replace(/\s+\S*$/, '')}…` : d.summary;
  p.about.languages = [...new Set([...p.about.languages, ...d.langs.map((l) => l.name).filter((n) => LANGS.includes(n))])];
  if (!p.proof.experience.length) p.proof.experience = d.exp.map((e) => ({ role: e.role, company: e.company, period: years(e.from, e.current ? '' : e.to), current: !!e.current }));
  if (!p.proof.certs.length) p.proof.certs = d.certs.map((c) => ({ name: c.name, issuer: c.issuer || '' }));
  p.proof.linkedin = p.proof.linkedin || d.links.linkedin || '';
  p.source = p.source || 'document';
  return p;
}

/* ---------- checks ---------- */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function payoutError(po) {
  if (po.method === 'upi' && po.upi && !isUpi(po.upi)) return 'That doesn’t look like a UPI ID (name@bank).';
  if (po.method === 'bank' && po.ifsc && !IFSC_RE.test(po.ifsc.toUpperCase())) return 'IFSC should look like HDFC0001234.';
  if (po.method === 'bank' && po.account && !/^\d{9,18}$/.test(po.account)) return 'Account number should be 9–18 digits.';
  return '';
}

/** Problems that block "Submit for review". [{ sec, msg }] */
export function expertIssues(p) {
  const out = [];
  if (!p.about.name.trim()) out.push({ sec: 'about', msg: 'Add your full name.' });
  if (!p.about.headline.trim()) out.push({ sec: 'about', msg: 'Add a headline, e.g. “Senior Data Analyst · 6 yrs”.' });
  if (p.about.bio.trim().length < 150) out.push({ sec: 'about', msg: `Bio needs ${150 - p.about.bio.trim().length} more characters (150 minimum).` });
  if (!p.about.languages.length) out.push({ sec: 'about', msg: 'Pick at least one language you can work in.' });
  if (!p.expertise.domains.length) out.push({ sec: 'expertise', msg: 'Pick at least one domain.' });
  if (!p.expertise.levels.length) out.push({ sec: 'expertise', msg: 'Pick which experience levels you serve.' });
  if (!p.proof.experience.some((e) => e.role || e.company)) out.push({ sec: 'proof', msg: 'Add at least one job or role.' });
  if (!p.services.plans.length) out.push({ sec: 'services', msg: 'Pick at least one service you’ll take.' });
  const po = p.payout;
  if (!po.reuseAi) {
    if (po.method === 'upi' && !po.upi) out.push({ sec: 'payout', msg: 'Add your UPI ID for payouts.' });
    if (po.method === 'bank' && (!po.account || !po.ifsc || !po.bankName)) out.push({ sec: 'payout', msg: 'Add bank name, account number and IFSC.' });
    const e = payoutError(po); if (e) out.push({ sec: 'payout', msg: e });
  }
  if (!PAN_RE.test((po.pan || '').toUpperCase())) out.push({ sec: 'payout', msg: 'Add a valid PAN (e.g. ABCDE1234F) — needed for tax on payouts.' });
  if (p.samples.some((s) => !s.anonymised)) out.push({ sec: 'samples', msg: 'Confirm each sample has personal details removed.' });
  if (!p.agree) out.push({ sec: 'agree', msg: 'Accept the expert agreement.' });
  return out;
}

/** 0–100 profile strength. */
export function expertStrength(p) {
  let s = 0;
  if (p.about.name) s += 8; if (p.about.headline) s += 8; if (p.about.bio.length >= 150) s += 12; if (p.photo) s += 8; if (p.about.languages.length) s += 4;
  if (p.expertise.domains.length) s += 10; if (p.expertise.levels.length) s += 4; if (p.expertise.roles) s += 4;
  if (p.proof.experience.length) s += 10; if (p.proof.linkedin) s += 6; if (p.proof.certs.length) s += 4; if (p.proof.recruiterYears) s += 2;
  if (p.samples.length) s += 10; if (p.services.plans.length) s += 4;
  if (PAN_RE.test((p.payout.pan || '').toUpperCase()) && (p.payout.reuseAi || p.payout.upi || p.payout.account)) s += 6;
  return Math.min(100, s);
}
