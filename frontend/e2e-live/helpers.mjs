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
    env: { ...process.env, MONGODB_DB: 'nm7_e2e', MONGODB_URI: process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0' },
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
