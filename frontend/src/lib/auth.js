// Accounts and sign-in: customers, experts and admins.
// Live (VITE_API_BASE set): the FastAPI backend — hashed passwords, httpOnly session cookies, email codes, admin TOTP.
// Preview (no VITE_API_BASE): accounts live in this browser, passwords are plain text and every code is 246810.
import { useSyncExternalStore } from 'react';
import { http, LIVE } from '../services/http';

export { LIVE };
const USERS_KEY = 'asuraa-users-v3';
const SESSION_KEY = 'asuraa-session-v1';
export const DEMO_CODE = '246810'; // preview only: every email / authenticator code
export const SAMPLE_PASSWORD = 'Nm7@2026';
export const SAMPLE_USER_ID = 'u-sai';

const SEED = [
  { id: 'u-sai', role: 'customer', name: 'Sai Varsha', email: 'saivarsha@example.com', phone: '+91 98765 43210', password: SAMPLE_PASSWORD, verified: true, createdAt: Date.now() - 82 * 864e5 },
  { id: 'u-naresh', role: 'expert', name: 'Naresh Maddela', email: 'naresh@example.com', phone: '+91 90000 11111', password: SAMPLE_PASSWORD, verified: true, expertStatus: 'approved', createdAt: Date.now() - 120 * 864e5 },
  { id: 'u-ravi', role: 'expert', name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+91 90000 33333', password: SAMPLE_PASSWORD, verified: true, expertStatus: 'test', createdAt: Date.now() - 3 * 864e5 },
  { id: 'u-admin', role: 'admin', name: 'Naresh (owner)', email: 'admin@nm7.si', phone: '+91 90000 22222', password: SAMPLE_PASSWORD, verified: true, twoStep: true, createdAt: Date.now() - 200 * 864e5 },
];

const read = (k, fb) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fb; } catch { return fb; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const subs = new Set();
let snap = null;
const notify = () => { snap = null; subs.forEach((f) => f()); };

/* ---------- live state: the signed-in user from the API ---------- */
let live = { user: null, ready: false };
const fromApi = (u) => ({
  id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone || '', verified: u.verified,
  expertStatus: u.expertStatus || undefined, adminRole: u.adminRole || undefined, createdAt: Date.parse(u.createdAt),
});
const setLive = (user) => { live = { user: user ? fromApi(user) : null, ready: true }; notify(); return live.user; };
if (LIVE) http('/api/auth/me').then(setLive, () => setLive(null)); // restore the session on page load

/* ---------- preview state: accounts in this browser ---------- */
let users = null; let session;
const getUsers = () => { if (!users) users = read(USERS_KEY, SEED); return users; };
const getSession = () => { if (session === undefined) session = read(SESSION_KEY, null); return session; };
const emit = () => { write(USERS_KEY, users); write(SESSION_KEY, session); notify(); };

const snapshot = () => {
  if (!snap) {
    if (LIVE) {
      // Admin sessions from the server always passed two-step login.
      const u = live.user;
      snap = { user: u, session: u ? { userId: u.id, twoStep: u.role === 'admin' } : null, ready: live.ready };
    } else {
      const s = getSession(); const u = s ? getUsers().find((x) => x.id === s.userId) : null;
      snap = { user: u || null, session: u ? s : null, ready: true };
    }
  }
  return snap;
};
/** { user, session, ready } — `ready` is false while the live app is still asking the server who is signed in. */
export const useAuth = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, snapshot);
export const currentUser = () => snapshot().user;

/* ---------- validation (same rules as the server) ---------- */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
export const normPhone = (p) => { const d = (p || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p; };
export function passwordIssue(p) {
  if ((p || '').length < 8) return 'At least 8 characters';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and at least one number';
  return '';
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byEmail = (e) => getUsers().find((u) => u.email.toLowerCase() === (e || '').trim().toLowerCase());
const byPhone = (p) => getUsers().find((u) => normPhone(u.phone) === normPhone(p));
const start = (u, extra = {}) => { session = { userId: u.id, at: Date.now(), ...extra }; emit(); return u; };
const fail = (message, code) => Object.assign(new Error(message), { code });
const WRONG_CODE = 'That code is wrong or expired.';

/* ---------- sign in / up ---------- */
/** Throws an error with code 'email_not_verified' when the account still needs its email code. */
export async function signIn(email, password) {
  if (LIVE) return setLive(await http('/api/auth/login', { method: 'POST', body: { email: email.trim(), password } }));
  await wait(500);
  const u = byEmail(email);
  if (!u || u.password !== password) throw fail('Email or password is wrong.', 'invalid_credentials');
  if (u.role === 'admin') throw fail('Admins sign in at /admin/login (with two-step login).', 'use_admin_login');
  if (!u.verified) throw fail('Please confirm your email first — we’ve sent you a code.', 'email_not_verified');
  return start(u);
}
/** Creates the account and emails a 6-digit code. Returns { email }. */
export async function signUp({ role, name, email, phone, password, confirm, agree }) {
  if (LIVE) {
    return http('/api/auth/signup', { method: 'POST', body: { role, name: name.trim(), email: email.trim(), phone: phone?.trim() || null, password, passwordConfirm: confirm, termsAccepted: !!agree } });
  }
  await wait(500);
  if (password !== confirm) throw fail('The two passwords don’t match.', 'password_mismatch');
  const existing = byEmail(email);
  if (existing?.verified) throw fail('An account with this email already exists — sign in instead.', 'email_taken');
  if (phone && byPhone(phone) && byPhone(phone) !== existing) throw fail('This mobile number is already used by another account.', 'phone_taken');
  const u = { id: existing?.id || `u-${Date.now().toString(36)}`, role, name: name.trim(), email: email.trim(), phone: normPhone(phone), password, verified: false, createdAt: Date.now(), ...(role === 'expert' ? { expertStatus: 'draft' } : {}) };
  users = [...getUsers().filter((x) => x !== existing), u]; emit();
  return { email: u.email, codeSent: true };
}
/** Confirms the email with the code and signs in. */
export async function verifyEmail(email, code) {
  if (LIVE) return setLive(await http('/api/auth/verify-email', { method: 'POST', body: { email: email.trim(), code } }));
  await wait(400);
  const u = byEmail(email);
  if (!u || code !== DEMO_CODE) throw fail(WRONG_CODE, 'invalid_code');
  users = getUsers().map((x) => (x.id === u.id ? { ...x, verified: true } : x));
  return start(users.find((x) => x.id === u.id));
}
export async function resendCode(email) {
  if (LIVE) return http('/api/auth/verify-email/resend', { method: 'POST', body: { email: email.trim() } });
  await wait(400);
  return { ok: true };
}
export async function sendReset(email) {
  if (LIVE) return http('/api/auth/password/forgot', { method: 'POST', body: { email: email.trim() } });
  await wait(500);
  return { known: !!byEmail(email), demo: DEMO_CODE };
}
export async function resetPassword(email, code, password, confirm) {
  if (LIVE) return http('/api/auth/password/reset', { method: 'POST', body: { email: email.trim(), code, password, passwordConfirm: confirm } });
  await wait(400);
  if (code !== DEMO_CODE) throw fail(WRONG_CODE, 'invalid_code');
  const u = byEmail(email); if (!u) throw fail(WRONG_CODE, 'invalid_code');
  users = getUsers().map((x) => (x.id === u.id ? { ...x, password, verified: true } : x)); emit();
}
export async function signOut() {
  if (LIVE) {
    setLive(null);
    await http('/api/auth/logout', { method: 'POST' }).catch(() => {});
    return;
  }
  session = null; emit();
}
/** Local change to the signed-in user (e.g. expert status after submitting a profile). */
export function updateUser(id, patch) {
  if (LIVE) { if (live.user?.id === id) { live = { ...live, user: { ...live.user, ...patch } }; notify(); } return; }
  users = getUsers().map((u) => (u.id === id ? { ...u, ...patch } : u)); emit();
}

/* ---------- admin: password, then authenticator code ---------- */
/** Step 1. Returns { signedIn: true } when this device is trusted (no code needed), else { signedIn: false, userId }. */
export async function adminPassword(email, password) {
  if (LIVE) {
    const r = await http('/api/auth/admin/login', { method: 'POST', body: { email: email.trim(), password } });
    if (r.status === 'signed_in') { setLive(r.user); return { signedIn: true }; }
    return { signedIn: false };
  }
  await wait(500);
  const u = byEmail(email);
  if (!u || u.role !== 'admin' || u.password !== password) throw fail('Email or password is wrong.', 'invalid_credentials');
  return { signedIn: false, userId: u.id };
}
/** Step 2: 6-digit authenticator code, or a recovery code (XXXX-XXXX). */
export async function adminVerify(userId, code, trust) {
  if (LIVE) {
    const r = await http('/api/auth/admin/verify', { method: 'POST', body: { code, trust: !!trust } });
    return setLive(r.user);
  }
  await wait(400);
  if (code !== DEMO_CODE) throw fail('That code is wrong. Use the 6-digit code from your authenticator app.', 'invalid_code');
  const u = getUsers().find((x) => x.id === userId);
  return start(u, { twoStep: true, trustUntil: trust ? Date.now() + 30 * 864e5 : null });
}

/** Where someone lands after signing in. */
export const homeFor = (u) => (!u ? '/login' : u.role === 'admin' ? '/admin' : u.role === 'expert' ? (u.expertStatus === 'approved' ? '/expert' : '/expert/profile') : '/me');

/** Each signed-in customer has their own builder draft; guests and the sample customer share the original one. */
export function draftKeyFor(userId) { return !userId || userId === SAMPLE_USER_ID ? 'asuraa-builder-draft-v6' : `asuraa-builder-draft-v6:${userId}`; }
export const draftKey = () => draftKeyFor(currentUser()?.role === 'customer' ? currentUser().id : null);

/** Preview only: switch accounts from the yellow preview bar without typing passwords. */
export function previewSignIn(userId) {
  if (import.meta.env.VITE_PREVIEW !== '1' || LIVE) return;
  if (!userId) { signOut(); return; }
  const u = getUsers().find((x) => x.id === userId);
  if (u) start(u, u.role === 'admin' ? { twoStep: true } : {});
}
export const previewUsers = () => (LIVE ? [] : getUsers());

/* ---------- one-time owner setup (live only; the server closes it once an admin exists) ---------- */
/** Step 1: returns { otpauthUri, secret, recoveryCodes, expiresInMinutes }. Nothing is saved yet. */
export async function adminSetupStart({ token, email, name, password, confirm }) {
  if (!LIVE) throw fail('Admin setup only works on the live site.', 'not_live');
  return http('/api/admin/setup', { method: 'POST', body: { token: token.trim(), email: email.trim(), name: name.trim(), password, passwordConfirm: confirm } });
}
/** Step 2: the 6-digit code from the authenticator app creates the owner account. */
export async function adminSetupVerify(code) {
  if (!LIVE) throw fail('Admin setup only works on the live site.', 'not_live');
  return http('/api/admin/setup/verify', { method: 'POST', body: { code } });
}
