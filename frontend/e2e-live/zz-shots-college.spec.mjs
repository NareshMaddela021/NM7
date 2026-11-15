// Before/after screenshots of the college pages (Phase 4) with the demo college (Admin → Organizations → Demo →
// "Reset and open as coordinator"), desktop 1280 px and phone 390 px. Only runs when SHOTS is set (the e2e workflow
// run by hand with shots_ref); pictures go to SHOTS_DIR (default shots/). Not a behaviour test: a screen that fails
// to open is still photographed as it is.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
const PAGES = [['org-groups', ''], ['org-dashboard', '/dashboard'], ['org-resumes', '/resumes'], ['org-drives', '/drives'], ['org-offers', '/offers'],
  ['org-kiosks', '/kiosks'], ['org-recruiters', '/recruiters'], ['org-branding', '/branding'], ['org-billing', '/billing'], ['org-team', '/team'],
  ['org-alumni', '/alumni'], ['org-reviewers', '/reviewers'], ['org-activity', '/activity']];

test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(600_000);

const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(700); };
const snap = (page, name, size) => page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });

for (const [size, opts] of SIZES) {
  test(`college screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const owner = `shots-org-${size}-${Date.now().toString(36)}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', 'Strong-pass-123');
    const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(admin, owner, secret);
    await settle(admin);
    let r = await call(admin, '/api/admin/demo-org/coordinator', json('POST', {}));
    for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, '/api/admin/demo-org/coordinator', json('POST', {})); }
    if (r.status !== 200) throw new Error(`demo college: ${r.status} ${JSON.stringify(r.body)}`);

    // the public sign-up / onboarding page, signed out
    const out = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const pub = await out.newPage();
    await pub.goto('/for-orgs'); await settle(pub); await snap(pub, 'org-signup', size);
    await out.close();

    const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); } await settle(page); await snap(page, name, size); };
    await page.goto(r.body.path);
    await page.waitForURL(/\/org\/[^/]+/, { timeout: 30_000 }).catch(() => {});
    await settle(page);
    const base = new URL(page.url()).pathname.match(/^\/org\/[^/]+/)?.[0] || '/org';
    await step('org-home', () => page.goto('/org'));
    for (const [name, sub] of PAGES) {
      await step(name, () => page.goto(`${base}${sub}`));
      if (name === 'org-groups') {
        const href = await page.locator(`a[href*="${base}/groups/"]`).first().getAttribute('href', { timeout: 3000 }).catch(() => null);
        if (href) await step('org-group', () => page.goto(href));
      }
      if (name === 'org-kiosks') {
        const href = await page.locator('a[href^="/kiosk/"]').first().getAttribute('href', { timeout: 3000 }).catch(() => null);
        if (href) await step('org-kiosk-screen', () => page.goto(href));
      }
    }
    await ctx.close();
  });
}
