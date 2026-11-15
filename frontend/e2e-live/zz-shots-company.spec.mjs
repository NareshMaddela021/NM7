// Before/after screenshots of the company and recruiter pages (Phase 3) with the demo company (Admin → Companies →
// "Reset and open as company (Hire in 60 minutes)"), desktop 1280 px and phone 390 px. Only runs when SHOTS is set
// (the e2e workflow run by hand with shots_ref); pictures go to SHOTS_DIR (default shots/). Not a behaviour test: a
// screen that fails to open is still photographed as it is.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
const TABS = [['overview', 'Overview'], ['jobs', 'Jobs'], ['applicants', 'Applicants'], ['hire', 'Hire now'], ['programs', 'Internships & projects'],
  ['pool', 'Talent pool'], ['team', 'Team'], ['page', 'Company page'], ['settings', 'Settings'], ['security', 'Security'], ['activity', 'Activity']];

test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(600_000);

const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); };
const snap = (page, name, size) => page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });
const tab = (page, label) => page.getByRole('tab', { name: label, exact: true }).click();

for (const [size, opts] of SIZES) {
  test(`company screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const owner = `shots-co-${size}-${Date.now().toString(36)}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', 'Strong-pass-123');
    const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(admin, owner, secret);
    await settle(admin);
    let r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {}));
    for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {})); }
    if (r.status !== 200) throw new Error(`demo company: ${r.status} ${JSON.stringify(r.body)}`);

    // the public sign-up page first, signed out
    const out = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const pub = await out.newPage();
    await pub.goto('/for-companies'); await settle(pub); await snap(pub, 'co-signup', size);
    await out.close();

    const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('nm7-recruiter-account', s); } catch { /* */ } }, r.body.session);
    const page = await ctx.newPage();
    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); } await settle(page); await snap(page, name, size); };
    await page.goto('/company'); await settle(page);
    for (const [k, label] of TABS) {
      await step(`co-${k}`, () => tab(page, label));
      if (k === 'jobs') {
        await step('co-job-form', () => page.getByRole('button', { name: 'Post a job' }).first().click({ timeout: 5000 }));
        await page.goto('/company'); await settle(page); await tab(page, 'Jobs').catch(() => {});
      }
      if (k === 'hire') {
        await step('co-hire-bulk', async () => {
          const sel = page.getByTestId('co-hire-job');
          const v = await sel.locator('option').evaluateAll((os) => (os.find((o) => /support/i.test(o.textContent)) || os[0])?.value);
          await sel.selectOption(v);
        });
      }
      if (k === 'page') {
        const href = await page.getByTestId('co-public-link').getAttribute('href', { timeout: 3000 }).catch(() => null);
        if (href) { await step('co-public', () => page.goto(href)); await page.goto('/company'); await settle(page); }
      }
    }
    await step('recruiter', () => page.goto('/recruiter'));
    await ctx.close();
  });
}
