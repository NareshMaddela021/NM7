// The signed-in customer's Job Profile. Live: GET/PUT /api/me/job-profile, autosaved (debounced) with a version
// number so two windows never silently overwrite each other. Preview: this browser (cleared on sign-out).
// If the API doesn't have the Job Profile yet (an older server), `available` is false and the pages say so.
import { useSyncExternalStore } from 'react';
import { LIVE, http, reportSaveError } from '../services/http';
import { currentUser, onSignOut } from './auth';
import { normalizeProfile } from './jobProfile';

const SAVE_MS = 800;
const blank = { for: null, loading: false, available: true, data: null, privacy: { experts: false, salary: false, personal: false }, version: 0, saving: false, error: null };
let state = blank;
let timer = null;
let pending = null; // { data, privacy } waiting to be saved
const subs = new Set();
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
const previewKey = (id) => `asuraa-profile-v1:${id}`;

async function load(id) {
  if (state.for !== id || !state.loading) set({ for: id, loading: true, error: null });
  if (!LIVE) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(previewKey(id)) || 'null'); } catch { /* ignore */ }
    set({ loading: false, available: true, data: normalizeProfile(raw?.data, currentUser()), privacy: raw?.privacy || blank.privacy, version: raw?.version || 0 });
    return;
  }
  try {
    const r = await http('/api/me/job-profile');
    if (state.for !== id) return;
    set({ loading: false, available: true, data: normalizeProfile(r.data, currentUser()), privacy: r.privacy, version: r.version });
  } catch (e) {
    if (state.for !== id) return;
    if (e.status === 404 || e.status === 405) set({ loading: false, available: false, data: null });
    else set({ loading: false, error: e.message || 'We couldn’t load your Job Profile.' });
  }
}

const me = () => (currentUser()?.role === 'customer' ? currentUser().id : null);
function snapshot() {
  const id = me();
  // a new account: start loading after this render (snapshots must not change while React reads them)
  if (id !== state.for) { state = { ...blank, for: id, loading: !!id }; if (id) queueMicrotask(() => load(id)); }
  return state;
}
export const useJobProfile = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, snapshot, snapshot);
export const getJobProfile = () => snapshot();
export const reloadJobProfile = () => { const id = me(); if (id) load(id); };

// one save at a time, so each PUT carries the version the previous one returned
let inflight = Promise.resolve();
function save() { timer = null; inflight = inflight.then(doSave, doSave); return inflight; }
async function doSave() {
  const job = pending; pending = null;
  if (!job || !state.for) return;
  if (!LIVE) {
    const version = state.version + 1;
    try { localStorage.setItem(previewKey(state.for), JSON.stringify({ data: job.data, privacy: job.privacy, version })); } catch { /* ignore */ }
    set({ version, saving: false });
    return;
  }
  try {
    const r = await http('/api/me/job-profile', { method: 'PUT', body: { data: job.data, privacy: job.privacy, version: state.version } });
    set({ version: r.version, saving: !!pending });
  } catch (e) {
    set({ saving: false });
    if (e.status === 404 || e.status === 405) { set({ available: false }); return; }
    reportSaveError(e);
    if (e.code === 'profile_changed') reloadJobProfile(); // another window saved first: show its copy
  }
}
function schedule() {
  set({ saving: true });
  clearTimeout(timer);
  timer = setTimeout(save, SAVE_MS);
}
/** Change the profile: setJobProfile((p) => ({ ...p, hobbies: 'Chess' })). Autosaved. */
export function setJobProfile(fn) {
  if (!state.data) return;
  const data = typeof fn === 'function' ? fn(state.data) : fn;
  set({ data });
  pending = { data, privacy: state.privacy };
  schedule();
}
export function setPrivacy(patch) {
  const privacy = { ...state.privacy, ...patch };
  set({ privacy });
  pending = { data: state.data, privacy };
  schedule();
}
/** Saves what's waiting now (before leaving the page / signing out). */
export async function flushJobProfile() { if (timer) { clearTimeout(timer); await save(); } }
onSignOut(async () => { await flushJobProfile(); state = blank; subs.forEach((f) => f()); });
