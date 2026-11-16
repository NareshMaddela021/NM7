// Before/after screenshots of every dashboard page with the demo students (Kavya: Auto Apply, Ravi: Easy dashboard,
// Meera: learning, Arjun: first 90 days), desktop 1280 px and phone 390 px. Only runs when SHOTS is set (the
// "shots" workflow); pictures go to SHOTS_DIR (default shots/). Not a test of behaviour: a page that fails to load
// is still photographed so a broken page shows up in the pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
const PEOPLE = [
  ['kavya', '/api/admin/auto-apply/demo', undefined, [
    ['home', '/me'], ['resumes', '/me/resumes'], ['profile', '/me/profile'], ['ats', '/me/ats'], ['covers', '/me/covers'],
    ['share', '/me/share'], ['jobs', '/me/jobs'], ['auto-apply', '/me/auto-apply'], ['hire', '/me/hire'],
    ['orders', '/me/orders'], ['payments', '/me/payments'], ['upgrade', '/me/upgrade'], ['settings', '/me/settings'],
    ['help', '/me/help'], ['messages', '/me/messages'], ['groups', '/me/groups'], ['builder', '/builder'],
  ]],
  ['meera', '/api/admin/seek/demo', { who: 'meera' }, [
    ['roles', '/me/roles'], ['learn', '/me/learn'], ['practice', '/me/practice'], ['skill-checks', '/me/skill-checks'],
    ['programs', '/me/programs'], ['launch', '/me/launch'], ['guidance', '/me/guidance'], ['offer-check', '/me/offer-check'],
    ['feedback', '/me/feedback'], ['certificates', '/me/certificates'],
    // screens behind a click: the Compare offers tab, and a skill check being taken (last: it starts a timed test)
    ['offer-compare', '/me/offer-check', (pg) => pg.getByTestId('oc-tab-compare').click()],
    ['skill-test', '/me/skill-checks', async (pg) => {
      const consent = pg.getByTestId('vt-consent');
      if (await consent.isVisible()) { await consent.getByTestId('vt-consent-tick').check(); await consent.getByTestId('vt-consent-go').click(); }
      await pg.getByTestId('sk-list').locator('[data-testid^="sk-start-"]').first().click();
      await pg.getByTestId('vt-go').click();
      await pg.getByTestId('vt-q').waitFor();
    }],
  ]],
  ['arjun', '/api/admin/seek/demo', { who: 'arjun' }, [['progress', '/me/progress']]],
  ['ravi', '/api/admin/simple/demo', undefined, [['simple', '/me/simple']]],
];

test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(600_000);

for (const [size, opts] of SIZES) {
  test(`dashboard screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const owner = `shots-${size}-${Date.now().toString(36)}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', 'Strong-pass-123');
    const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await adminLogin(admin, owner, secret);
    await admin.waitForLoadState('networkidle').catch(() => {});
    for (const [who, url, body, pages] of PEOPLE) {
      let r = await call(admin, url, json('POST', body || {}));
      for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, url, json('POST', body || {})); } // the admin session can take a moment
      if (r.status !== 200) { console.log(`demo ${who}: ${r.status} ${JSON.stringify(r.body)}`); continue; }
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(r.body.path);
      await page.waitForLoadState('networkidle').catch(() => {});
      for (const [name, path, act] of pages) {
        await page.goto(path);
        await page.waitForLoadState('networkidle').catch(() => {});
        if (act) { await act(page).catch((e) => console.log(`${name}: ${e.message}`)); await page.waitForLoadState('networkidle').catch(() => {}); }
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });
      }
      await ctx.close();
    }
  });
}
