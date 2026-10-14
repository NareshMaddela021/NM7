// Accounts and sign-in: customers, experts and admins.
// Preview: accounts live in this browser and passwords are plain text — the live app hashes them on the server
// (FastAPI: POST /api/auth/signup, /login, /otp/send, /otp/verify, /password/reset, /admin/2fa) and uses httpOnly cookies.
import { useSyncExternalStore } from 'react';

const USERS_KEY = 'asuraa-users-v3';
const SESSION_KEY = 'asuraa-session-v1';
export const DEMO_CODE = '246810'; // preview only: every OTP / authenticator code
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

let users = null; let session; const subs = new Set();
const getUsers = () => { if (!users) users = read(USERS_KEY, SEED); return users; };
const getSession = () => { if (session === undefined) session = read(SESSION_KEY, null); return session; };
const emit = () => { write(USERS_KEY, users); write(SESSION_KEY, session); snap = null; subs.forEach((f) => f()); };
let snap = null;
const snapshot = () => {
  if (!snap) { const s = getSession(); const u = s ? getUsers().find((x) => x.id === s.userId) : null; snap = { user: u || null, session: u ? s : null }; }
  return snap;
};
export const useAuth = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, snapshot);
export const currentUser = () => snapshot().user;

/* ---------- validation ---------- */
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

/* ---------- sign in / up ---------- */
export async function signIn(email, password) {
  await wait(500);
  const u = byEmail(email);
  if (!u || u.password !== password) throw new Error('Email or password is wrong.');
  if (u.role === 'admin') throw new Error('Admins sign in at /admin/login (with two-step login).');
  return start(u);
}
export async function sendOtp(phone) {
  await wait(500);
  if (!PHONE_RE.test((phone || '').trim())) throw new Error('Enter a 10-digit Indian mobile number.');
  return { sentTo: normPhone(phone), demo: DEMO_CODE };
}
export async function signInOtp(phone, code) {
  await wait(400);
  if (code !== DEMO_CODE) throw new Error('That code is wrong or expired.');
  const u = byPhone(phone);
  if (!u) throw new Error('No account with this number yet — sign up first.');
  if (u.role === 'admin') throw new Error('Admins sign in at /admin/login.');
  return start(u);
}
export async function signUp({ role, name, email, phone, password }) {
  await wait(500);
  if (byEmail(email)) throw new Error('An account with this email already exists — sign in instead.');
  if (byPhone(phone)) throw new Error('This mobile number is already used by another account.');
  const u = { id: `u-${Date.now().toString(36)}`, role, name: name.trim(), email: email.trim(), phone: normPhone(phone), password, verified: false, createdAt: Date.now(), ...(role === 'expert' ? { expertStatus: 'draft' } : {}) };
  users = [...getUsers(), u]; emit();
  return u;
}
export async function verifyPhone(userId, code) {
  await wait(400);
  if (code !== DEMO_CODE) throw new Error('That code is wrong or expired.');
  users = getUsers().map((u) => (u.id === userId ? { ...u, verified: true } : u));
  return start(users.find((u) => u.id === userId));
}
export async function sendReset(email) { await wait(500); return { known: !!byEmail(email), demo: DEMO_CODE }; }
export async function resetPassword(email, code, password) {
  await wait(400);
  if (code !== DEMO_CODE) throw new Error('That code is wrong or expired.');
  const u = byEmail(email); if (!u) throw new Error('No account with this email.');
  users = getUsers().map((x) => (x.id === u.id ? { ...x, password } : x)); emit();
}
export function signOut() { session = null; emit(); }
export function updateUser(id, patch) { users = getUsers().map((u) => (u.id === id ? { ...u, ...patch } : u)); emit(); }

/* ---------- admin: password + two-step code ---------- */
export async function adminPassword(email, password) {
  await wait(500);
  const u = byEmail(email);
  if (!u || u.role !== 'admin' || u.password !== password) throw new Error('Email or password is wrong.');
  return { userId: u.id };
}
export async function adminVerify(userId, code, trust) {
  await wait(400);
  if (!/^\d{6}$/.test(code) || code !== DEMO_CODE) throw new Error('That code is wrong. Use the 6-digit code from your authenticator app.');
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
  if (import.meta.env.VITE_PREVIEW !== '1') return;
  if (!userId) { signOut(); return; }
  const u = getUsers().find((x) => x.id === userId);
  if (u) start(u, u.role === 'admin' ? { twoStep: true } : {});
}
export const previewUsers = () => getUsers();
