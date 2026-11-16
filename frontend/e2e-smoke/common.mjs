// Shared bits of the live smoke check.
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export const API = process.env.SMOKE_API || 'https://nm7-api.onrender.com';
export const STATE = join(process.cwd(), 'e2e-smoke', '.state');
export const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL, password: process.env.SMOKE_ADMIN_PASSWORD, secret: process.env.SMOKE_ADMIN_TOTP };
export const hasAdmin = !!(ADMIN.email && ADMIN.password && ADMIN.secret);

/** RFC 6238 code for a base32 secret (what an authenticator app shows). */
export function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/[\s=]+/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// noise that is not the site's fault (browser extensions don't exist here; these come from third parties)
const IGNORE = [/favicon/i, /google-analytics|googletagmanager|gtag/i, /Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/i];

/**
 * Opens `path` and checks it: the document loads, the page isn't blank or "Page not found", and there were no page
 * errors, console errors or failed API calls (5xx, network failures, or 4xx other than the expected 401/403 of a
 * signed-out check and 404 of an optional lookup marked `allow404`). Returns the internal links in its menus.
 */
export async function checkPage(page, path, { signedIn = false, allow = [] } = {}) {
  const problems = [];
  const onConsole = (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) problems.push(`console: ${m.text().slice(0, 200)}`); };
  const onError = (e) => problems.push(`page error: ${e.message.split('\n')[0].slice(0, 200)}`);
  const onFail = (r) => { const u = r.url(); if (u.includes('/api/') && !/aborted/i.test(r.failure()?.errorText || '')) problems.push(`API failed: ${r.method()} ${u.replace(API, '')} ${r.failure()?.errorText}`); };
  const onResp = (r) => {
    const u = r.url(); const s = r.status();
    if (!u.includes('/api/') || s < 400) return;
    const p = u.replace(API, '').split('?')[0];
    if (!signedIn && (s === 401 || s === 403)) return; // signed out: "who am I" says no
    if (allow.some((a) => p.startsWith(a))) return;
    problems.push(`API ${s}: ${r.request().method()} ${p}`);
  };
  page.on('console', onConsole); page.on('pageerror', onError); page.on('requestfailed', onFail); page.on('response', onResp);
  try {
    const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (res && res.status() >= 400) problems.push(`document ${res.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const text = (await page.locator('body').innerText().catch(() => '')).trim();
    if (text.length < 60) problems.push(`blank page (${text.length} characters of text)`);
    if (/Page not found/i.test(await page.title())) problems.push('shows "Page not found"');
    if (await page.getByRole('alert').filter({ hasText: /Something went wrong|crashed|couldn.t load this page/i }).count()) problems.push('shows an error box');
  } finally {
    page.off('console', onConsole); page.off('pageerror', onError); page.off('requestfailed', onFail); page.off('response', onResp);
  }
  expect(problems, `${path}`).toEqual([]);
  return page.evaluate(() => [...document.querySelectorAll('header a[href], nav a[href], footer a[href], aside a[href]')]
    .map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/') && !h.startsWith('//')));
}
