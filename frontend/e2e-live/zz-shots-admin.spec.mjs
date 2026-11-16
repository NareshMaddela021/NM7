// Before/after screenshots of the admin console and the expert screens (Phase 5), desktop 1280 px and phone 390 px.
// Seeds some real data first (a paid order, the demo college, the demo company) so the sections are not empty.
// Only runs when SHOTS is set (the e2e workflow run by hand with shots_ref); pictures go to SHOTS_DIR (default
// shots/). Not a behaviour test: a screen that fails to open is still photographed as it is.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { PASSWORD, adminLogin, login, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
const ADMIN = ['', 'orders', 'experts', 'refunds', 'payments', 'customers', 'quality', 'reports', 'settings', 'automation', 'team', 'orgs',
  'shared-resumes', 'plans', 'billing-settings', 'org-invoices', 'partners', 'codes', 'courses', 'college-groups', 'stories',
  'jobs', 'companies', 'auto-apply', 'skill-tests', 'learn-paths', 'programs', 'joining-reports'];
const EXPERT = ['', 'orders', 'snippets', 'performance', 'earnings', 'profile', 'help'];

test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(900_000);

const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); };
const snap = (page, name, size) => page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });

for (const [size, opts] of SIZES) {
  test(`admin screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const tag = `${size}-${Date.now().toString(36)}`;
    const cust = `shots-cust-${tag}@example.com`;
    seed('customer', cust, 'Asha Rao', PASSWORD);
    seed('paid-order', cust, 'expert');
    const ex = `shots-expert-${tag}@example.com`;
    seed('expert', ex, 'Ravi Kumar', PASSWORD, 'approved');
    const owner = `shots-admin-${tag}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', PASSWORD);

    // the sign-in and 2-step screens, as they look before signing in
    const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); } await settle(page); await snap(page, name, size); };
    await step('admin-login', () => page.goto('/admin/login'));
    await step('admin-2step', async () => {
      await page.getByLabel('Work email').fill(owner);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Authenticator code').waitFor({ timeout: 10_000 });
    });
    await adminLogin(page, owner, secret);
    await settle(page);
    // real data for the sections: the demo college and the demo company
    await call(page, '/api/admin/demo-org', json('POST', {})).catch(() => {});
    await call(page, '/api/admin/demo-company/hire/open', json('POST', {})).catch(() => {});
    for (const sub of ADMIN) await step(`admin-${sub || 'dashboard'}`, () => page.goto(`/admin${sub ? `/${sub}` : ''}`));
    await ctx.close();

    // the expert screens, signed in as an approved expert
    const ectx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const ep = await ectx.newPage();
    await login(ep, ex);
    await settle(ep);
    for (const sub of EXPERT) {
      try { await ep.goto(`/expert${sub ? `/${sub}` : ''}`); } catch (e) { console.log(`expert ${sub}: ${e.message.split('\n')[0]}`); }
      await settle(ep);
      await snap(ep, `expert-${sub || 'home'}`, size);
    }
    await ectx.close();
  });
}
