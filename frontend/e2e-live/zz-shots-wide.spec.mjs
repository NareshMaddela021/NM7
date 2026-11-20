// Before/after screenshots for the full-width layout (every area except the home page) at 1920, 1440 and 390 px.
// Only runs when SHOTS is set (the e2e workflow run by hand with shots_ref); pictures go to SHOTS_DIR. Not a behaviour
// test: a screen that fails to open is still photographed as it is. Areas: Admin, company (demo company), college
// (demo coordinator), candidate /me and the Easy dashboard, expert, public /jobs, blog and a legal page.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { call, json } from './college.mjs';

const OUT = process.env.SHOTS_DIR || 'shots';
const SIZES = [['1920', { viewport: { width: 1920, height: 1080 } }], ['1440', { viewport: { width: 1440, height: 900 } }],
  ['390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];

test.skip(!process.env.SHOTS, 'screenshots only in the shots workflow');
test.setTimeout(900_000);

const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); };
const snap = (page, name, size) => page.screenshot({ path: join(OUT, `${name}-${size}.jpg`), fullPage: false, type: 'jpeg', quality: 60 });
const shoot = async (page, name, size, path) => {
  try { await page.goto(path); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); }
  await settle(page); await snap(page, name, size);
};
async function adminPage(browser, tag) {
  const owner = `shots-wide-${tag}-${Date.now().toString(36)}@nm7.si`;
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await adminLogin(page, owner, secret);
  await settle(page);
  return page;
}
async function demo(admin, path) {
  let r = await call(admin, path, json('POST', {}));
  for (let i = 0; i < 5 && (r.status === 401 || r.status === 429); i += 1) { await admin.waitForTimeout(3000); r = await call(admin, path, json('POST', {})); }
  if (r.status !== 200) throw new Error(`${path}: ${r.status}`);
  return r.body;
}

for (const [size, opts] of SIZES) {
  test(`full-width screenshots (${size})`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const ctxOpts = { ...opts, reducedMotion: 'reduce' };

    // public pages, signed out
    const pub = await (await browser.newContext(ctxOpts)).newPage();
    await shoot(pub, 'public-jobs', size, '/jobs');
    await shoot(pub, 'public-blog', size, '/blog');
    await shoot(pub, 'public-terms', size, '/terms');
    await shoot(pub, 'public-salaries', size, '/salaries');
    await pub.context().close();

    // Admin (signed in as an owner at this size)
    const owner = `shots-wa-${size}-${Date.now().toString(36)}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', PASSWORD);
    const ad = await (await browser.newContext(ctxOpts)).newPage();
    await adminLogin(ad, owner, secret);
    await settle(ad);
    for (const [name, path] of [['admin-home', '/admin'], ['admin-jobs', '/admin/jobs'], ['admin-orders', '/admin/orders'],
      ['admin-customers', '/admin/customers'], ['admin-companies', '/admin/companies'], ['admin-payments', '/admin/payments']]) {
      await shoot(ad, name, size, path);
    }
    await ad.context().close();

    // company (the demo company) and college (the demo coordinator)
    const admin = await adminPage(browser, size);
    try {
      const co = await demo(admin, '/api/admin/demo-company/hire/open');
      const cctx = await browser.newContext(ctxOpts);
      await cctx.addInitScript((v) => { try { localStorage.setItem('nm7-recruiter-account', v); } catch { /* */ } }, co.session);
      const cp = await cctx.newPage();
      await shoot(cp, 'company-overview', size, '/company');
      for (const [name, label] of [['company-applicants', 'Applicants'], ['company-hire', 'Hire now']]) {
        try { await cp.getByRole('tab', { name: label, exact: true }).click({ timeout: 10_000 }); } catch (e) { console.log(`${name}: ${e.message.split('\n')[0]}`); }
        await settle(cp); await snap(cp, name, size);
      }
      await cctx.close();
    } catch (e) { console.log(`company: ${e.message}`); }
    try {
      const org = await demo(admin, '/api/admin/demo-org/coordinator');
      const op = await (await browser.newContext(ctxOpts)).newPage();
      await op.goto(org.path);
      await op.waitForURL(/\/org\/[^/]+/, { timeout: 30_000 }).catch(() => {});
      await settle(op); await snap(op, 'college-dashboard', size);
      await op.context().close();
    } catch (e) { console.log(`college: ${e.message}`); }

    // candidate /me and the Easy dashboard
    const mail = email(`shots-wide-${size}`);
    seed('customer', mail, 'Asha Rao', PASSWORD);
    const me = await (await browser.newContext(ctxOpts)).newPage();
    try { await login(me, mail); } catch (e) { console.log(`login: ${e.message.split('\n')[0]}`); }
    await shoot(me, 'me-home', size, '/me');
    await shoot(me, 'me-jobs', size, '/me/jobs');
    await shoot(me, 'me-easy', size, '/me/simple');
    await me.context().close();

    // expert
    const ex = email(`shots-wide-ex-${size}`);
    seed('expert', ex, 'Ravi Kumar', PASSWORD, 'approved');
    const ep = await (await browser.newContext(ctxOpts)).newPage();
    try { await login(ep, ex); } catch (e) { console.log(`expert login: ${e.message.split('\n')[0]}`); }
    await shoot(ep, 'expert-home', size, '/expert');
    await ep.context().close();
  });
}
