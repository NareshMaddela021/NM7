// Every checkbox and radio button has a name a screen reader can say (Batch E item 50): its own label text, an
// aria-label or aria-labelledby, never nothing (a screen reader then reads its value, "on"). Visits the job seeker
// dashboard pages, the builder, the company dashboard tabs, a college coordinator's portal and the admin console;
// desktop and a 390 px phone.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, asTestPerson, login, seed } from './helpers.mjs';
import { SIZES, call, college, json } from './college.mjs';

const ME = ['/me', '/me/profile', '/me/settings', '/me/jobs', '/me/auto-apply', '/me/learn', '/me/practice', '/me/roles', '/me/skill-checks', '/me/programs', '/me/hire', '/me/simple'];
const ADMIN = ['/admin', '/admin/orders', '/admin/customers', '/admin/jobs', '/admin/companies', '/admin/auto-apply', '/admin/settings', '/admin/team', '/admin/orgs', '/admin/shared-resumes'];
const CO_TABS = ['Jobs', 'Applicants', 'Hire now', 'Internships & projects', 'Talent pool', 'Team', 'Settings', 'Security'];

/** The checkboxes and radios on the page with no name (or the name "on"), as short descriptions. */
const unnamed = (page, where) => page.evaluate((w) => {
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height && getComputedStyle(el).position !== 'absolute') continue; // not shown
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(' ');
    const name = (el.getAttribute('aria-label') || '').trim() || by || [...(el.labels || [])].map(text).join(' ') || (el.getAttribute('title') || '').trim()
      || (el.tagName !== 'INPUT' ? text(el) : '');
    if (!name || name.toLowerCase() === 'on') out.push(`${w}: ${el.outerHTML.slice(0, 160)}`);
  }
  return out;
}, where);

const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };

for (const [size, opts] of SIZES) {
  test(`checkboxes and radios have names (${size})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const found = [];
    // a job seeker
    const mail = `cbn-${size}-${Date.now().toString(36)}@example.com`;
    seed('customer', mail, 'Asha Rao', PASSWORD);
    const me = await (await browser.newContext(opts)).newPage();
    await asTestPerson(me);
    await login(me, mail);
    await me.waitForURL(/\/(me|welcome)/).catch(() => {});
    for (const p of [...ME, '/builder']) { await me.goto(p); await settle(me); found.push(...await unnamed(me, p)); }
    // the admin console, then the demo company
    const owner = `cbn-admin-${size}-${Date.now().toString(36)}@nm7.si`;
    const { secret } = seed('admin', owner, 'owner', PASSWORD);
    const admin = await (await browser.newContext(opts)).newPage();
    await adminLogin(admin, owner, secret);
    let r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {}));
    for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {})); }
    expect(r.status).toBe(200);
    for (const p of ADMIN) { await admin.goto(p); await settle(admin); found.push(...await unnamed(admin, p)); }
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript((s) => { try { localStorage.setItem('nm7-recruiter-account', s); } catch { /* storage blocked */ } }, r.body.session);
    const co = await ctx.newPage();
    await co.goto('/company'); await settle(co);
    found.push(...await unnamed(co, '/company'));
    for (const tab of CO_TABS) {
      await co.getByRole('tab', { name: tab, exact: true }).click();
      await settle(co);
      found.push(...await unnamed(co, `/company ${tab}`));
    }
    // a college coordinator
    const c = await college(browser, opts, `cbn${size[0]}`, { students: 1, prefix: 'cb' });
    for (const p of ['', '/dashboard', '/drives', '/offers', '/team', '/placement']) { await c.coord.goto(`/org/${c.org.id}${p}`); await settle(c.coord); found.push(...await unnamed(c.coord, `/org${p}`)); }
    await c.close();
    expect(found).toEqual([]);
  });
}
