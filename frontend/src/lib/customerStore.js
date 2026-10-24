// The customer's dashboard data: account, orders (customer side), resume library, applications, cover letters,
// ATS checks, share link, support issues and referrals.
// Preview: kept in this browser (localStorage). Live app: /api/me/* endpoints (one per block below).
import { useSyncExternalStore } from 'react';
import { INITIAL, completeResume, emptyResume } from '../pages/builder/schema';
import { isEmptyResume, stripSample } from './sampleData';
import { TEMPLATE_PRESETS } from '../pages/builder/design';
import { atsScore } from './atsScore';
import { findOrder, updateOrder as updateExpertOrder, addExpertOrder, reloadExpertOrders } from './expertStore';
import { requestRefund } from '../services/api';
import { PLANS, ADDONS, PROMISES } from './pricing';
import { IMPORTED_DRAFTS_KEY, currentUser, draftKey, draftKeyFor, SAMPLE_USER_ID, onSignOut, updateUser } from './auth';
import { LIVE, http, reportSaveError } from '../services/http';
import * as live from './meLive';
import { pendingDownload } from './downloads';
import { announceResume } from './resumeChannel';

// One store per signed-in customer. The sample customer (Sai Varsha) keeps the original key and sample data.
// Live app: no sample data and nothing personal in localStorage — the store is filled from the API.
const custId = () => (currentUser()?.role === 'customer' ? currentUser().id : LIVE ? null : SAMPLE_USER_ID);
const keyOf = (id) => (id === SAMPLE_USER_ID ? 'asuraa-me-v2' : `asuraa-me-v2:${id}`);
const H = 3600 * 1000; const D = 24 * H;
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A blank resume with the person's own details (new accounts don't start from the sample). */
export function blankResume(u = currentUser()) {
  const d = emptyResume(); // truly empty: only the account's name, email and phone
  d.personal = { ...d.personal, name: u?.name || '', email: u?.email || '', phone: u?.phone || '' };
  return d;
}
/** The starting resume for whoever is signed in (sample data only for guests and the sample customer). */
export const defaultResume = () => (currentUser()?.role === 'customer' && currentUser().id === SAMPLE_USER_ID && !LIVE ? structuredClone(INITIAL) : currentUser()?.role === 'customer' ? blankResume() : emptyResume()); // the sample only for the preview build's demo customer
/** "Name", or "Name (2)", "Name (3)"… so new resumes never share a name. */
export const uniqueName = (name, resumes) => {
  const taken = new Set((resumes || []).map((r) => r.name));
  const base = name.slice(0, 54);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
};
/** Live: the resume built in this browser before signing in (not the untouched sample, unless the person clicked
 * Download on it). It moves into the account once: the first resume of a new account, or a new resume next to
 * the ones they already have (never over them). */
function guestDraft() {
  try {
    const s = localStorage.getItem(draftKeyFor(null));
    const d = s && stripSample(completeResume(JSON.parse(s))); // never carry the sample person into an account
    return d && !isEmptyResume(d) ? d : null; // an empty draft, or one that only held the sample, is never imported
  } catch { return null; }
}
const forgetGuestDraft = () => { try { localStorage.removeItem(draftKeyFor(null)); } catch { /* ignore */ } };

/* A browser draft moves into an account at most once. Each import is noted in this browser (a fingerprint of the
 * resume's text, kept through sign-outs; nothing personal): the same draft is never imported again (another tab, a
 * reload, a second sign-in), a draft identical to a resume the account already has is not added, and after one
 * import any later draft found in this browser is only offered ("Is it yours?"), never added by itself, unless the
 * person clicked Download on it. */
const CONTENT_KEYS = ['personal', 'summary', 'exp', 'edu', 'proj', 'certs', 'ach', 'langs', 'custom', 'skillGroups', 'hobbies', 'strengths', 'pinfo', 'links'];
export function draftFingerprint(d) {
  const c = completeResume(d || {});
  const s = JSON.stringify(CONTENT_KEYS.map((k) => c[k] ?? null));
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${s.length.toString(36)}`;
}
const importedDrafts = () => { try { return JSON.parse(localStorage.getItem(IMPORTED_DRAFTS_KEY) || '[]'); } catch { return []; } };
const noteImported = (fp, add = true) => {
  try {
    const list = importedDrafts().filter((x) => x !== fp);
    localStorage.setItem(IMPORTED_DRAFTS_KEY, JSON.stringify(add ? [...list, fp].slice(-20) : list));
  } catch { /* storage blocked */ }
};
/** 'new' | 'seen' (imported from this browser before) | 'exists' (the account already has a resume with this text). */
function draftStatus(d, resumes) {
  const fp = draftFingerprint(d);
  if (importedDrafts().includes(fp)) return 'seen';
  if ((resumes || []).some((r) => r.data && draftFingerprint(r.data) === fp)) return 'exists';
  return 'new';
}
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** A guest draft is taken as this person's when it has no name, or their own name or email. */
export function draftLooksMine(draft, account) {
  const n = norm(draft?.personal?.name); const e = norm(draft?.personal?.email);
  return (!n && !e) || (!!n && n === norm(account?.name)) || (!!e && e === norm(account?.email));
}
/** The draft found in this browser that may belong to someone else: add it to the account, or forget it. */
export async function acceptGuestDraft() {
  const s = get(); const d = s.pendingGuestDraft;
  if (!d || !LIVE) return null;
  const fp = draftFingerprint(d);
  const same = (s.resumes || []).find((r) => r.data && draftFingerprint(r.data) === fp);
  if (same || importedDrafts().includes(fp)) { // already in the account: open it instead of adding a copy
    forgetGuestDraft(); noteImported(fp);
    state = { ...get(), pendingGuestDraft: null };
    notify();
    return same?.id || activeResume(state)?.id || null;
  }
  const name = uniqueName(`${d.personal?.name?.trim() || 'My resume'} · from this browser · ${dayLabel()}`, s.resumes);
  noteImported(fp); // claimed before the request, so another tab or a second load never adds it too
  try {
    const saved = await live.createResume({ id: uid('r'), name, active: true, data: d, jd: '', versions: [] });
    forgetGuestDraft();
    state = { ...get(), resumes: [...get().resumes.map((r) => ({ ...r, active: false })), saved], pendingGuestDraft: null };
    notify();
    return saved.id;
  } catch (e) { noteImported(fp, false); reportSaveError(e); return null; }
}
export function discardGuestDraft() {
  forgetGuestDraft();
  state = { ...get(), pendingGuestDraft: null };
  notify();
}
const dayLabel = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const builderDraft = () => {
  if (LIVE && currentUser()?.role === 'customer') { const a = state && !state.loading ? activeResume(state) : null; return a ? a.data : blankResume(); }
  try { const s = localStorage.getItem(draftKey()); if (s) return stripSample(completeResume(JSON.parse(s))); } catch { /* ignore */ }
  return completeResume(defaultResume());
};
function blankSeed(u) {
  const t = Date.now();
  return {
    account: { name: u.name, email: u.email, phone: u.phone, targetRole: '', cities: '', level: 'Fresher (0–1 yr)', joined: u.createdAt || t, referralCode: `${u.name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'ASUR'}${String(t).slice(-2)}`,
      notify: { whatsapp: { order: true, draft: true, jobs: true, tips: false }, email: { order: true, draft: true, jobs: true, tips: false }, sms: { order: true, draft: false, jobs: false, tips: false } } },
    orders: [], resumes: [{ id: 'r1', name: 'My resume', active: true, created: t, updated: t, data: builderDraft(), jd: '', versions: [] }],
    checks: [], covers: [], apps: [], share: { on: false, slug: (u.name || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'me', resumeId: 'r1', views: [] },
    issues: [], referrals: [], calls: { picked: null, notes: '' },
  };
}

function seed() {
  const t = Date.now();
  const main = builderDraft();
  const general = { ...structuredClone(main), design: { ...TEMPLATE_PRESETS.classic.design, preset: 'classic' }, personal: { ...main.personal, headline: 'B.Tech CSE · Fresher' } };
  // earlier states of the same resume, so versions and the score trend show real change
  const older = { ...structuredClone(main), summary: '', certs: [], links: { ...main.links, linkedin: '' }, personal: { ...main.personal, headline: '' },
    skillGroups: main.skillGroups.map((g) => ({ ...g, value: g.id === 'core' ? 'Python, SQL' : '' })), exp: main.exp.map((e) => ({ ...e, description: 'made dashboards in power bi for sales team' })) };
  const mid = { ...structuredClone(main), summary: '', certs: [], skillGroups: main.skillGroups.map((g) => ({ ...g, value: g.id === 'frameworks' ? '' : g.value })) };
  return {
    account: {
      name: main.personal.name || 'Sai Varsha', email: main.personal.email || 'saivarsha@example.com', phone: main.personal.phone || '',
      targetRole: 'Data Analyst', cities: 'Bengaluru, Chennai, Hyderabad', level: main.personal.level || 'Fresher (0–1 yr)',
      notify: { whatsapp: { order: true, draft: true, jobs: true, tips: false }, email: { order: true, draft: true, jobs: true, tips: true }, sms: { order: true, draft: false, jobs: false, tips: false } },
      joined: t - 82 * D, referralCode: 'SAIV25',
    },
    orders: [
      { id: 'RS-1117', plan: 'expert', price: 999, paidAt: t - 18 * H, method: 'UPI', payId: 'pay_Q7hX2k9LmT', invoice: 'NM7/26-27/0417', addons: [], linked: true, resumeId: 'r1' },
      { id: 'RS-1043', plan: 'diy', price: 99, paidAt: t - 41 * D, method: 'Card', payId: 'pay_P2aS8d0KfQ', invoice: 'NM7/26-27/0143', addons: [], status: 'done' },
      { id: 'RS-0987', plan: 'expert', price: 999, paidAt: t - 76 * D, method: 'UPI', payId: 'pay_N9cE4r1WbZ', invoice: 'NM7/25-26/0987', addons: [], status: 'refunded', refund: { amount: 999, reason: 'Late delivery — automatic refund', at: t - 74 * D, done: t - 71 * D, ref: 'rfnd_N9d2Lw0' } },
    ],
    resumes: [
      { id: 'r1', name: 'Data Analyst – main', active: true, created: t - 41 * D, updated: t - 2 * H, data: main, jd: '',
        versions: [{ at: t - 40 * D, label: 'First version', data: older }, { at: t - 9 * D, label: 'Auto-saved', data: mid }] },
      { id: 'r2', name: 'Fresher – general', created: t - 30 * D, updated: t - 12 * D, data: general, jd: '', versions: [] },
    ],
    checks: [
      { at: t - 40 * D, score: 0, resumeId: 'r1', label: 'First upload', data: older },
      { at: t - 25 * D, score: 0, resumeId: 'r1', label: 'After DIY fixes', data: mid },
      { at: t - 9 * D, score: 0, resumeId: 'r1', label: 'Added certificate', data: main },
    ],
    covers: [
      { id: 'c1', company: 'Razorpay', role: 'Data Analyst', resumeId: 'r1', at: t - 6 * D, jd: '', body: '' },
    ],
    apps: [
      { id: 'a1', company: 'Razorpay', role: 'Data Analyst', status: 'interview', date: t - 12 * D, resumeId: 'r1', url: 'razorpay.com/jobs', notes: 'HR round done. Case study on Friday.', next: t + 2 * D },
      { id: 'a2', company: 'Swiggy', role: 'Business Analyst – Fresher', status: 'applied', date: t - 8 * D, resumeId: 'r1', url: '', notes: 'Referred by a senior.' },
      { id: 'a3', company: 'Zoho', role: 'Data Analyst Trainee', status: 'applied', date: t - 3 * D, resumeId: 'r2', url: '', notes: '' },
      { id: 'a4', company: 'PhonePe', role: 'Analyst', status: 'saved', date: t - 1 * D, resumeId: 'r1', url: '', notes: 'Apply after the final resume.' },
      { id: 'a5', company: 'Freshworks', role: 'Product Analyst', status: 'rejected', date: t - 20 * D, resumeId: 'r2', url: '', notes: 'Needed 1+ year experience.' },
      { id: 'a6', company: 'Tiger Analytics', role: 'Junior Analyst', status: 'applied', date: t - 16 * D, resumeId: 'r1', url: '', notes: '' },
    ],
    share: { on: true, slug: 'sai-varsha', resumeId: 'r1', views: [1, 1, 2, 3, 3, 4, 5, 5, 6, 6, 6, 9, 13].map((dd) => t - dd * D + 3 * H) },
    issues: [{ id: 'T-204', topic: 'Payment', text: 'Charged twice for the DIY plan?', at: t - 39 * D, status: 'resolved', reply: 'Only one charge went through — the second was a bank hold that dropped in 2 days.' }],
    referrals: [{ name: 'Kiran', at: t - 15 * D, status: 'joined' }, { name: 'Meena', at: t - 4 * D, status: 'bought' }],
    calls: { picked: null, notes: '' },
  };
}

/* ---------- tiny store ---------- */
let state = null; let stateFor = null;
const subs = new Set();
const load = (id) => {
  try { const s = localStorage.getItem(keyOf(id)); if (s) return JSON.parse(s); } catch { /* ignore */ }
  if (id !== SAMPLE_USER_ID) return blankSeed(currentUser());
  const s = seed();
  s.checks = s.checks.map((c) => ({ ...c, score: atsScore(c.data).score, data: undefined }));
  return s;
};
const notify = () => subs.forEach((f) => f());

/* live: load from the API for this customer; ignore answers that arrive after they signed out or switched */
async function loadLive(id) {
  try {
    const s = await live.fetchState();
    if (stateFor !== id) return;
    const downloading = !!pendingDownload(); // they clicked Download on this draft and signed in to get it
    let carried = guestDraft();
    const status = carried ? draftStatus(carried, s.resumes) : 'new';
    if (status !== 'new') { forgetGuestDraft(); carried = null; } // already imported, or already in the account
    const firstImport = !importedDrafts().length; // after one import in this browser, later drafts are only offered
    const fp = carried && draftFingerprint(carried);
    // The draft built in this browser before signing in moves into the account only when it is clearly this
    // person's: the one they just asked to download, or a draft without a name or with their own name. On a shared
    // phone the draft may be someone else's, so otherwise it is offered (see pendingGuestDraft) and never added
    // silently — and never over a resume they already have.
    const mine = carried && (downloading || (firstImport && draftLooksMine(carried, s.account)));
    if (mine) noteImported(fp); // claimed first: a second tab or a reload that reads the same draft skips it
    let imported = false;
    if (!s.resumes.length) {
      // first visit: start from the resume they built before signing in (if it is theirs), else a blank one
      const r = { id: uid('r'), name: 'My resume', active: true, data: mine ? carried : blankResume(), jd: '', versions: [] };
      let saved;
      try { saved = await live.createResume(r); } catch (e) { if (mine) noteImported(fp, false); throw e; }
      if (stateFor !== id) return;
      s.resumes = [saved];
      if (mine) { forgetGuestDraft(); imported = true; }
    } else if (mine) {
      // an account that already has resumes: the draft becomes a new one next to them (opened in the builder)
      const name = uniqueName(`${carried.personal?.name?.trim() || 'My resume'} · from this browser · ${dayLabel()}`, s.resumes);
      try {
        const saved = await live.createResume({ id: uid('r'), name, active: true, data: carried, jd: '', versions: [] });
        if (stateFor !== id) return;
        s.resumes = [...s.resumes.map((r) => ({ ...r, active: false })), saved];
        forgetGuestDraft(); imported = true;
      } catch { noteImported(fp, false); /* e.g. the resume limit: the draft stays in this browser and is offered below */ }
    }
    if (carried && !imported) s.pendingGuestDraft = carried; // ask first
    state = s;
  } catch (e) {
    if (stateFor !== id) return;
    state = { ...state, error: e.message || 'We couldn’t load your dashboard.' };
  }
  notify();
}
live.setErrorHandler((e) => {
  if (!stateFor) return;
  reportSaveError(e);
  // only when the server holds something newer or the resume is gone: a network blip must not replace what the
  // person is typing with an older copy (the save itself is retried in meLive)
  if (e?.status === 404) loadLive(stateFor);
  if (e?.status === 409) { // saved in another tab or device: reload the latest copy, then let the builder ask
    const id = stateFor;
    loadLive(id).then(() => {
      if (stateFor !== id) return;
      live.clearSaveError();
      state = { ...state, conflict: (state.conflict || 0) + 1 };
      notify();
    });
  }
});
// the tab is closed or hidden with saves still waiting: send them with keepalive
try {
  if (LIVE) window.addEventListener('pagehide', () => { if (stateFor) live.flushKeepalive(); });
  if (LIVE) document.addEventListener('visibilitychange', () => { if (stateFor && document.visibilityState === 'hidden') live.flushKeepalive(); });
} catch { /* no window */ }

const get = () => {
  const id = custId();
  if (!state || stateFor !== id) {
    stateFor = id;
    if (LIVE) {
      state = live.emptyState(currentUser());
      if (id) loadLive(id); else state = { ...state, loading: false };
    } else state = load(id);
  }
  return state;
};
const emit = () => { if (!LIVE) { try { localStorage.setItem(keyOf(stateFor), JSON.stringify(state)); } catch { /* ignore */ } } notify(); };
/** Every change goes through here: saved in this browser (preview) or sent to the API (live). */
function commit(next) {
  const prev = get();
  state = next;
  emit();
  if (LIVE && stateFor && !prev.loading) live.persist(prev, next);
}
export const useMe = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, get);
export const getMe = get;
export function setMe(fn) { const cur = get(); commit({ ...cur, ...fn(cur) }); }
export function resetMe() { const id = custId(); state = null; try { localStorage.removeItem(keyOf(id)); localStorage.removeItem(draftKey()); } catch { /* ignore */ } get(); emit(); }
/** Live: reload everything from the server (after a payment or refund). */
export function reloadMe() { if (LIVE && stateFor) { if (state?.loading) { state = { ...state, error: null }; notify(); } loadLive(stateFor); } }
/** Sign-out / account switch: forget everything in memory and send any unsaved resume edits first. */
export async function forgetMe() {
  if (LIVE) await live.flush();
  state = null; stateFor = null;
  notify();
}
onSignOut(forgetMe);
/** Profile & settings → Save. Live: saved on the server first (the email can't be changed here). */
export async function saveProfile(account) {
  if (!LIVE) { setMe(() => ({ account })); return; }
  const p = await http('/api/me/profile', { method: 'PATCH', body: { name: account.name, phone: account.phone || null, targetRole: account.targetRole || '', cities: account.cities || '', level: account.level || '' } });
  state = { ...get(), account: { ...get().account, name: p.name, phone: p.phone || '', targetRole: p.targetRole, cities: p.cities, level: p.level } };
  notify();
  updateUser(currentUser().id, { name: p.name, phone: p.phone || '' });
}
/** Share link settings. Live: saved on the server first (a link name can be taken by someone else). */
export async function saveShare(patch) {
  const next = { ...get().share, ...patch };
  if (!next.resumeId) next.resumeId = activeResume()?.id || null;
  if (!LIVE) { setMe(() => ({ share: next })); return; }
  const before = get().share;
  state = { ...get(), share: next }; notify(); // shown at once; put back if the server says no
  let r;
  try { r = await http('/api/me/share', { method: 'PUT', body: { on: !!next.on, slug: next.slug, resumeId: next.resumeId, hidePhone: !!next.hidePhone } }); } catch (e) { state = { ...get(), share: before }; notify(); throw e; }
  state = { ...get(), share: { on: r.on, slug: r.slug, resumeId: r.resumeId, hidePhone: r.hidePhone, views: r.views, viewCount: r.viewCount } };
  notify();
}
/** Live: a support ticket (saved and emailed by the server); preview: kept in this browser. */
export async function raiseIssue({ topic, order, text }) {
  if (!LIVE) { const t = { id: `T-${String(Date.now()).slice(-3)}`, topic, order, text, at: Date.now(), status: 'open' }; setMe((s) => ({ issues: [t, ...s.issues] })); return t; }
  const t = await live.sendTicket({ topic, order, text });
  state = { ...get(), issues: [t, ...get().issues] }; notify();
  return t;
}

/* ---------- resumes ---------- */
export const activeResume = (s = get()) => s.resumes.find((r) => r.active) || s.resumes[0];

/** The builder keeps editing the active resume. Called by the builder on every save and when the dashboard opens. */
/** Version snapshots leave the photo out (it is kept on the resume itself): 20 copies of it would not fit. */
export const withoutPhoto = (data) => { if (!data?.photo) return data; const { photo: _photo, ...rest } = data; return rest; };
export function syncFromBuilder(data) {
  const s = get(); const a = activeResume(s);
  if (!a || s.loading) return;
  const d = data || builderDraft();
  if (JSON.stringify(d) === JSON.stringify(a.data)) return;
  const last = a.versions[a.versions.length - 1];
  // keep an automatic snapshot at most every 30 minutes (up to 20)
  const versions = !last || Date.now() - last.at > 30 * 60 * 1000 ? [...a.versions, { at: Date.now(), label: 'Auto-saved', data: withoutPhoto(a.data) }].slice(-20) : a.versions;
  commit({ ...s, resumes: s.resumes.map((r) => (r.id === a.id ? { ...r, data: d, updated: Date.now(), versions } : r)) });
  announceResume(a.id, d); // an open Templates tab shows the edit
}

/** The builder's measured page count for the active resume (live accounts: shown to organizations it's shared with). */
export function setResumePages(n) {
  const s = get(); const a = activeResume(s);
  if (!LIVE || !a || s.loading || !n || a.pages === n) return;
  commit({ ...s, resumes: s.resumes.map((r) => (r.id === a.id ? { ...r, pages: n } : r)) });
}

/** Make a resume the one the builder edits. */
export function openInBuilder(id) {
  syncFromBuilder();
  const s = get(); const r = s.resumes.find((x) => x.id === id);
  if (!r) return;
  if (!LIVE) { try { localStorage.setItem(draftKey(), JSON.stringify(r.data)); } catch { /* ignore */ } }
  commit({ ...s, resumes: s.resumes.map((x) => ({ ...x, active: x.id === id })) });
}

export function addResume(name, data, extra = {}) {
  const id = uid('r');
  setMe((s) => ({ resumes: [...s.resumes, { id, name, created: Date.now(), updated: Date.now(), data: structuredClone(data), jd: '', versions: [], ...extra }] }));
  return id;
}
export function updateResume(id, patch) { setMe((s) => ({ resumes: s.resumes.map((r) => (r.id === id ? { ...r, ...patch, updated: Date.now() } : r)) })); }
export function deleteResume(id) {
  const s = get();
  if (s.resumes.length <= 1) return false;
  const wasActive = s.resumes.find((r) => r.id === id)?.active;
  setMe((x) => ({ resumes: x.resumes.filter((r) => r.id !== id) }));
  if (wasActive) openInBuilder(get().resumes[0].id);
  return true;
}
/** Replace a resume's content (and the builder's copy if it's the one being edited). */
export function setResumeData(id, data) {
  syncFromBuilder();
  const r = get().resumes.find((x) => x.id === id);
  if (!r) return;
  updateResume(id, { data });
  if (r.active && !LIVE) { try { localStorage.setItem(draftKey(), JSON.stringify(data)); } catch { /* ignore */ } }
}
export function restoreVersion(id, data) {
  syncFromBuilder();
  const r = get().resumes.find((x) => x.id === id);
  if (!r) return;
  const photo = r.data?.photo ? { photo: r.data.photo } : {}; // snapshots have no photo: keep the current one
  updateResume(id, { data: { ...structuredClone(data), ...photo }, versions: [...r.versions, { at: Date.now(), label: 'Before restore', data: withoutPhoto(r.data) }].slice(-20) });
  if (r.active && !LIVE) { try { localStorage.setItem(draftKey(), JSON.stringify(data)); } catch { /* ignore */ } }
}

/** Expert drafts that belong to a resume (from the linked expert order). */
export function expertDrafts(resumeId, s = get()) {
  return s.orders.filter((o) => o.linked && o.resumeId === resumeId).flatMap((o) => (findOrder(o.id)?.versions || []).filter((v) => v.data && v.sent).map((v) => ({ at: v.at, label: `${v.label} · expert (${o.id})`, data: v.data, expert: true })));
}

/** Days left before files from an expert order are deleted. */
export const retentionLeft = (deliveredAt) => (deliveredAt ? Math.ceil((deliveredAt + PROMISES.retentionDays * D - Date.now()) / D) : null);

/* ---------- orders (customer view) ---------- */
const STAGES = ['Paid', 'Expert assigned', 'Intake done', 'Draft 1', 'Changes', 'Final', 'Approved'];
/** Merges the customer's order record with the live expert order (status, drafts, deadline, chat). */
export function orderView(o) {
  if (o.awaiting) return { ...o, x: null, label: 'Waiting for payment confirmation', tone: 'warning', steps: [], live: false };
  if (o.waCancelled) return { ...o, x: null, label: 'Cancelled', tone: 'neutral', steps: [], live: false };
  const x = o.linked ? findOrder(o.id) : null;
  if (o.refund && x) return { ...o, x, sent: [], label: 'Refunded', tone: 'neutral', steps: [], live: false };
  if (!x) {
    const label = o.status === 'refunded' ? 'Refunded' : o.plan === 'diy' || o.plan === 'linkedin_pack' ? 'Unlocked' : 'Done';
    return { ...o, x: null, label, tone: o.status === 'refunded' ? 'neutral' : 'success', steps: [], live: false };
  }
  const sent = (x.versions || []).filter((v) => v.data && v.sent);
  const final = sent.some((v) => v.label === 'Final') || ['delivered', 'approved'].includes(x.status);
  const done = [true, !!x.accepted || x.status !== 'offer', !!x.intake?.target, sent.length > 0, sent.length > 1 || x.status === 'revision' || final, final, x.status === 'approved'];
  const now = done.indexOf(false);
  const steps = STAGES.map((l, i) => ({ label: l, state: done[i] ? 'done' : i === now ? 'now' : 'next' }));
  const live = !final;
  const late = live && x.deadline < Date.now();
  const action = !x.intake?.target ? { text: 'Tell your expert about your goals', to: `/orders/${o.id}/intake`, cta: 'Fill intake · 3 min' }
    : x.status === 'waiting' ? { text: `${sent[sent.length - 1]?.label || 'A draft'} is ready to review`, to: `/orders/${o.id}/review`, cta: 'Review draft' }
    : x.status === 'delivered' ? { text: 'Your final resume is ready', to: `/orders/${o.id}/review`, cta: 'Download & approve' }
    : x.status === 'revision' ? { text: 'Your expert is making your changes', to: `/me/orders/${o.id}`, cta: 'See order' }
    : x.status === 'approved' ? null
    : { text: `Your expert is writing ${sent.length ? `draft ${sent.length + 1}` : 'draft 1'}`, to: `/me/orders/${o.id}`, cta: 'See order' };
  const label = { offer: 'Finding your expert', progress: 'Expert writing', waiting: 'Draft ready', revision: 'Changes in progress', delivered: 'Final ready', approved: 'Approved' }[x.status] || x.status;
  if (o.refundRequest?.status === 'review') return { ...o, plan: x.plan || o.plan, x, sent, steps, label: 'Refund under review', tone: 'warning', live, late, action: null, deadline: x.deadline, deliveredAt: x.deliveredAt };
  const tone = late ? 'danger' : x.status === 'waiting' || x.status === 'delivered' ? 'warning' : x.status === 'approved' ? 'success' : 'neutral';
  return { ...o, plan: x.plan || o.plan, x, sent, steps, label, tone, live, late, action, deadline: x.deadline, deliveredAt: x.deliveredAt };
}

export function buyAddon(orderId, addonId) {
  const a = ADDONS[addonId];
  setMe((s) => ({ orders: s.orders.map((o) => (o.id === orderId ? { ...o, addons: [...o.addons, { id: addonId, price: a.price, at: Date.now(), payId: uid('pay_') }] } : o)) }));
  const x = findOrder(orderId);
  if (x) {
    const patch = { addons: [...(x.addons || []), addonId], messages: [...(x.messages || []), { from: 'system', text: `Customer added: ${a.name}.`, at: Date.now() }] };
    if (addonId === 'express') patch.deadline = Math.min(x.deadline, Date.now() + 24 * H);
    if (addonId === 'revision') patch.extraRevisions = (x.extraRevisions || 0) + 1;
    updateExpertOrder(orderId, () => patch);
  }
}
export function upgradeOrder(orderId, to) {
  const o = get().orders.find((x) => x.id === orderId);
  const diff = PLANS[to].price - PLANS[o.plan].price;
  setMe((s) => ({ orders: s.orders.map((x) => (x.id === orderId ? { ...x, plan: to, price: PLANS[to].price, upgrades: [...(x.upgrades || []), { from: o.plan, to, price: diff, at: Date.now(), payId: uid('pay_') }] } : x)) }));
  if (findOrder(orderId)) updateExpertOrder(orderId, (x) => ({ plan: to, price: PLANS[to].price, messages: [...(x.messages || []), { from: 'system', text: `Customer upgraded to ${PLANS[to].name}.`, at: Date.now() }] }));
}

/** Every payment and refund, newest first. */
export function payments(s = get()) {
  const rows = [];
  s.orders.forEach((o) => {
    if (!o.paidAt) return; // a WhatsApp order still waiting for payment
    const basePrice = o.price - (o.upgrades || []).reduce((t, u) => t + u.price, 0);
    rows.push({ at: o.paidAt, what: `${PLANS[(o.upgrades?.[0]?.from) || o.plan].name} · ${o.id}`, amount: basePrice, method: o.method, payId: o.payId, invoice: o.invoice || o.receipt, receipt: !o.invoice && !!o.receipt, orderId: o.id, kind: 'payment' });
    (o.upgrades || []).forEach((u) => rows.push({ at: u.at, what: `Upgrade to ${PLANS[u.to].name} · ${o.id}`, amount: u.price, method: o.method, payId: u.payId, invoice: `${o.invoice}-U`, orderId: o.id, kind: 'payment' }));
    (o.addons || []).forEach((a, i) => rows.push({ at: a.at, what: `${ADDONS[a.id].name} · ${o.id}`, amount: a.price, method: o.method, payId: a.payId, invoice: `${o.invoice}-A${i + 1}`, orderId: o.id, kind: 'payment' }));
    if (o.refund) rows.push({ at: o.refund.at, what: `Refund · ${o.id} · ${o.refund.reason}`, amount: -o.refund.amount, method: o.method, payId: o.refund.ref, orderId: o.id, kind: 'refund', done: o.refund.done });
  });
  return rows.sort((a, b) => b.at - a.at);
}

/* ---------- small helpers ---------- */
export const newId = uid;
export const APP_STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']];
export const unreadCount = (s = get()) => s.orders.filter((o) => o.linked).reduce((n, o) => {
  const x = findOrder(o.id); if (!x) return n;
  const seen = s.seen?.[o.id] || 0;
  return n + (x.messages || []).filter((m) => m.from === 'expert' && m.at > seen).length;
}, 0);
export function markSeen(orderId) { setMe((s) => ({ seen: { ...(s.seen || {}), [orderId]: Date.now() } })); }

/* ---------- placing an order and asking for a refund ---------- */
let nextNo = 1130;
/** Called after a successful payment at checkout. Creates the customer's order and the offer experts see. */
/** Live app: pass the server's order id, invoice number and Razorpay payment id. */
export function placeOrder({ plan, role, method, id: serverId, invoice: serverInvoice, payId: serverPayId }) {
  if (LIVE) { reloadMe(); reloadExpertOrders(); return serverId; } // the server already has it
  const s = get(); const u = currentUser();
  const used = new Set(s.orders.map((o) => o.id));
  let id = serverId;
  if (!id) do { id = `RS-${nextNo++}`; } while (used.has(id) || findOrder(id));
  const a = activeResume(s);
  const t = Date.now();
  const yy = new Date().getFullYear() % 100; const fy = new Date().getMonth() >= 3 ? `${yy}-${yy + 1}` : `${yy - 1}-${yy}`;
  const invoice = serverInvoice || `NM7/${fy}/${id.slice(3)}`;
  setMe((x) => ({ orders: [{ id, plan, price: PLANS[plan].price, paidAt: t, method, payId: serverPayId || uid('pay_'), invoice, addons: [], linked: true, resumeId: a.id }, ...x.orders.filter((o) => o.id !== id)] }));
  addExpertOrder({ id, customer: u?.name || s.account.name, customerId: u?.id || SAMPLE_USER_ID, plan, price: PLANS[plan].price, role: role || s.account.targetRole || 'Not set', domain: '', level: s.account.level || 'Fresher', createdAt: t, deadline: t + PROMISES.deliveryHours * H, status: 'offer', offerExpires: t + 30 * 60 * 1000, intake: {}, jd: '', original: a.data, versions: [], comments: [], messages: [], linkedin: null, call: null, rating: null });
  return id;
}
/** Late → refunded at once; otherwise our team reviews it within 24 hours (it shows in the admin support inbox). */
/** `decided` (live app) is the server's answer { ref, autoApproved, amount }; without it the browser decides. */
export function askRefund(orderId, { reason, details }, decided = null) {
  if (LIVE) { reloadMe(); reloadExpertOrders(); return decided; } // the server decided and saved it
  const o = get().orders.find((x) => x.id === orderId);
  if (!o) return null;
  const x = findOrder(orderId);
  const late = decided ? decided.autoApproved : !!x && x.deadline < Date.now() && !(x.versions || []).some((v) => v.sent);
  const ref = decided?.ref || `RF-${String(Date.now()).slice(-5)}`;
  const total = decided?.amount ?? o.price + o.addons.reduce((t, a) => t + a.price, 0);
  if (late) {
    setMe((s) => ({ orders: s.orders.map((y) => (y.id === orderId ? { ...y, status: 'refunded', refund: { amount: total, reason: 'Late delivery — automatic refund', at: Date.now(), done: null, ref } } : y)) }));
    if (x) updateExpertOrder(orderId, (y) => ({ status: 'cancelled', messages: [...(y.messages || []), { from: 'system', text: 'Order refunded — delivery was late.', at: Date.now() }] }));
    return { ref, autoApproved: true, amount: total };
  }
  setMe((s) => ({
    orders: s.orders.map((y) => (y.id === orderId ? { ...y, refundRequest: { status: 'review', reason, details, at: Date.now(), ref } } : y)),
    issues: [{ id: ref, topic: 'Refund', order: orderId, text: `${reason === 'quality' ? 'Quality' : 'Other'}: ${details}`, at: Date.now(), status: 'open' }, ...s.issues],
  }));
  return { ref, autoApproved: false, amount: total };
}

/* ---------- admin view across customers (preview: every customer store in this browser) ---------- */
export function allCustomerStores() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === 'asuraa-me-v2' || k.startsWith('asuraa-me-v2:')) out.push({ key: k, s: JSON.parse(localStorage.getItem(k)) });
    }
  } catch { /* ignore */ }
  if (!out.some((x) => x.key === 'asuraa-me-v2')) out.push({ key: 'asuraa-me-v2', s: get() && stateFor === SAMPLE_USER_ID ? state : load(SAMPLE_USER_ID) });
  return out;
}
/** Change another customer's store (admin actions). Keeps the in-memory copy in step if it's the open one. */
export function patchCustomer(key, fn) {
  const cur = allCustomerStores().find((x) => x.key === key);
  if (!cur) return;
  const next = { ...cur.s, ...fn(cur.s) };
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  if (state && keyOf(stateFor) === key) state = next;
  subs.forEach((f) => f());
}
export function decideRefund(key, orderId, approve, reply) {
  patchCustomer(key, (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    const total = o ? o.price + o.addons.reduce((t, a) => t + a.price, 0) : 0;
    return {
      orders: s.orders.map((x) => (x.id !== orderId ? x : approve
        ? { ...x, status: 'refunded', refundRequest: { ...x.refundRequest, status: 'approved' }, refund: { amount: total, reason: 'Refund approved after review', at: Date.now(), done: null, ref: x.refundRequest?.ref } }
        : { ...x, refundRequest: { ...x.refundRequest, status: 'declined', reply } })),
      issues: s.issues.map((i) => (i.order === orderId && i.topic === 'Refund' && i.status !== 'resolved' ? { ...i, status: 'resolved', reply } : i)),
    };
  });
  if (approve && findOrder(orderId)) updateExpertOrder(orderId, (y) => ({ status: 'cancelled', messages: [...(y.messages || []), { from: 'system', text: 'Order refunded after review.', at: Date.now() }] }));
}

/** Cancel before an expert accepts → full refund at once. */
export function cancelOrder(orderId) {
  if (LIVE) return requestRefund(orderId, { reason: 'cancel', details: '' }).then(() => { reloadMe(); reloadExpertOrders(); return true; });
  const o = get().orders.find((x) => x.id === orderId); const x = findOrder(orderId);
  if (!o || !x || x.status !== 'offer') return false;
  const total = o.price + o.addons.reduce((t, a) => t + a.price, 0);
  setMe((s) => ({ orders: s.orders.map((y) => (y.id === orderId ? { ...y, status: 'refunded', refund: { amount: total, reason: 'Cancelled before an expert started', at: Date.now(), done: null, ref: `RF-${String(Date.now()).slice(-5)}` } } : y)) }));
  updateExpertOrder(orderId, () => ({ status: 'cancelled' }));
  return true;
}
