// Before/after screenshots of Vetting V2 (skill checks), desktop 1280 px and phone 390 px: the candidate's skill
// checks page, the start dialog, a question, a result, the practical task and the badge; the demo company's Hire
// now with "Skill verified" people; Admin → Skill checks (banks, rubrics, review, integrity, stats). Only runs when
// SHOTS is set (the e2e workflow by hand with shots_ref); pictures go to SHOTS_DIR. Not a behaviour test: a screen
// that fails to open (the "before" app has no V2) is still photographed as it is.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { PASSWORD, adminLogin, login, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(900_000);
test.use({ actionTimeout: 8000, navigationTimeout: 30000 });  // a missing control fails fast, never hangs

const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(800); };
const snap = (page, name, size) => page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: true, type: 'jpeg', quality: 60 });
const quiet = (fn) => { try { return fn(); } catch (e) { console.log(e.message.split('\n')[0]); return null; } };

for (const [size, opts] of SIZES) {
  test(`vetting screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const tag = `${size}-${Date.now().toString(36)}`;
    const mail = `shots-vet-${tag}@example.com`;
    seed('customer', mail, 'Asha Rao', PASSWORD);
    seed('vetting-tester', mail); // the vetting engine is hidden by default (Admin → Skill checks → Launch)
    const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    let page = await ctx.newPage();
    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); } await settle(page); await snap(page, name, size); };
    await login(page, mail);
    await settle(page);
    await step('vet-catalog', () => page.goto('/me/skill-checks'));
    await step('vet-start', async () => {
      await page.getByTestId('sk-list').getByTestId('sk-start-SQL').first().click({ timeout: 8000 });
    });
    await step('vet-question', async () => {
      const label = page.getByText('I understand what is checked during the test');
      if (await label.count()) await label.last().click();
      await page.getByRole('button', { name: /^Start/ }).last().click({ timeout: 8000 });
      await page.getByText(/Question 1 of/i).first().waitFor({ timeout: 15000 });
    });
    // a passed paper through the API (the right answers from the test seed), then its result and the task, in a
    // fresh tab (the running SQL test above lives in the first tab's session storage)
    page = await ctx.newPage();
    await page.goto('/me'); await settle(page);  // calls need the site's origin (a blank tab can't fetch)
    let aid = null;
    await step('vet-result', async () => {
      await call(page, '/api/me/skill-checks/consent', json('POST', {}));
      const start = await call(page, '/api/me/skill-checks/start', json('POST', { skill: 'Excel', band: '1-3' }));
      aid = start.body.id;
      const right = quiet(() => seed('skill-answers', aid))?.answers || {};
      const times = Object.fromEntries(Object.keys(right).map((k) => [k, 20000]));
      await call(page, `/api/me/skill-checks/${aid}/submit`, json('POST', { answers: right, times }));
      await page.goto(`/me/skill-checks/${aid}`);
    });
    await step('vet-task', async () => {
      await page.getByRole('button', { name: /practical task/i }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1500);
    });
    quiet(() => seed('skill-verified', mail, 'SQL', '3-5', '84', '86'));
    await step('vet-badge', () => page.goto('/me/skill-checks'));
    await step('vet-home', () => page.goto('/me'));
    await ctx.close();

    // the demo company's Hire now, with three demo people "Skill verified"
    const owner = `shots-vet-admin-${tag}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', PASSWORD);
    const actx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
    const admin = await actx.newPage();
    await adminLogin(admin, owner, secret);
    await settle(admin);
    let r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {}));
    for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {})); }
    quiet(() => seed('skill-verified', '@demo', 'Customer support', '1-3', '86', '80'));
    const astep = async (name, fn) => { try { await fn(); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); } await settle(admin); await snap(admin, name, size); };
    for (const [name, tab] of [['vet-admin-banks', ''], ['vet-admin-rubrics', '?tab=rubrics'], ['vet-admin-review', '?tab=review'],
      ['vet-admin-integrity', '?tab=integrity'], ['vet-admin-stats', '?tab=stats']]) {
      await astep(name, () => admin.goto(`/admin/skill-tests${tab}`));
    }
    await actx.close();
    if (r.status === 200 && r.body.session) {
      const cctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      await cctx.addInitScript((s) => { try { localStorage.setItem('nm7-recruiter-account', s); } catch { /* */ } }, r.body.session);
      const co = await cctx.newPage();
      await co.goto('/company'); await settle(co);
      try {
        await co.getByRole('tab', { name: 'Hire now', exact: true }).click({ timeout: 8000 });
        const sel = co.getByTestId('co-hire-job');
        const v = await sel.locator('option').evaluateAll((os) => (os.find((o) => /support/i.test(o.textContent)) || os[0])?.value);
        await sel.selectOption(v);
      } catch (e) { console.log(`vet-hire: ${e.message.split('\n')[0]}`); }
      await settle(co); await snap(co, 'vet-hire', size);
      await cctx.close();
    }
  });
}
