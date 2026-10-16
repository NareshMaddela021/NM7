// Helpers for the live tests: seed data through the backend, read emailed codes from the API log, TOTP codes.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..', '..', 'backend');
export const API = 'http://localhost:8001';
export const PASSWORD = 'Strong-pass-123';

export function seed(...args) {
  const out = execFileSync('uv', ['run', 'python', '-m', 'tests.e2e_seed', ...args], {
    cwd: backend,
    env: { ...process.env, MONGODB_DB: 'nm7_e2e', SECRET_KEY: 'e2e-only-secret', ENCRYPTION_KEY: '', APP_ENV: 'dev', MONGODB_URI: process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0' },
  }).toString();
  return JSON.parse(out.trim().split('\n').pop());
}

let n = 0;
/** A unique email per test run. */
export const email = (who) => `${who}-${Date.now().toString(36)}-${(n += 1)}@example.com`;

/** The last 6-digit code emailed to `to` (dev mode prints emails into the API log). */
export function lastCode(to) {
  const log = readFileSync(join(here, '.api.log'), 'utf8');
  const parts = log.split('EMAIL to ').filter((p) => p.startsWith(to));
  const m = parts.length && parts[parts.length - 1].match(/\b(\d{6})\b/);
  if (!m) throw new Error(`no code for ${to}`);
  return m[1];
}
/** Every email sent to `to`, as text. */
export const emailsTo = (to) => readFileSync(join(here, '.api.log'), 'utf8').split('EMAIL to ').filter((p) => p.startsWith(to));

/** RFC 6238 code for a base32 secret (what an authenticator app shows). */
export function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/** Signs in through the page. */
export async function login(page, mail, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Admin two-step sign in. */
export async function adminLogin(page, mail, secret, password = PASSWORD) {
  await page.goto('/admin/login');
  await page.getByLabel('Work email').fill(mail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify & open admin' }).click();
  await page.waitForURL(/\/admin/);
}

/** A member made through the API: a verified account, one resume ("r1"), joined to the group with `code`. */
export async function apiMember(playwright, mail, name, code, fields = {}, data = null, joinExtra = {}) {
  seed('customer', mail, name, PASSWORD);
  const api = await playwright.request.newContext({ baseURL: API, extraHTTPHeaders: { Origin: 'http://localhost:5182' } });
  const ok = async (r) => { if (!r.ok()) throw new Error(`${r.url()} ${r.status()} ${await r.text()}`); return r.json(); };
  await ok(await api.post('/api/auth/login', { data: { email: mail, password: PASSWORD } }));
  const resume = data || { // the shape the builder saves (every section present)
    personal: { name, email: mail, phone: '+91 98765 43210', headline: 'ITI Electrician', location: 'Guntur', level: 'Fresher (0–1 yr)' },
    summary: '', edu: [{ institution: 'Govt ITI Guntur', degree: 'ITI Electrician', field: '', from: '', to: '', current: false, grade: '' }],
    skillGroups: [{ id: 'core', label: 'Skills', value: 'Wiring, Panel fitting' }],
    exp: [{ company: 'Shown Co', role: 'Apprentice', links: [] }, { company: 'Hidden Co', role: 'Helper', off: true, links: [] }],
    proj: [], certs: [], ach: [], custom: [], langs: [{ name: 'Telugu', level: 'Native' }], hobbies: '', strengths: '',
    pinfo: {}, links: {}, hidden: {}, titles: {}, showPhoto: false,
  };
  await ok(await api.post('/api/me/resumes', { data: { id: 'r1', name: 'Main', data: resume, active: true } }));
  const m = await ok(await api.post('/api/me/groups/join', { data: { code, consent: true, fields, resumeId: 'r1', ...joinExtra } }));
  return { api, membership: m };
}

/** All the text in a PDF (pdf.js), page by page. */
export async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const doc = await (pdfjs.default || pdfjs).getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join(' '));
  return pages;
}
