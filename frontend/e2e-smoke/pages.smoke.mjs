// Every page of the live site, by area, desktop + 390 px (the projects in playwright.smoke.config.mjs). One test per
// page, so the report counts pages. Signed-in areas reuse the browser state saved by setup.smoke.mjs and are skipped
// when there are no live admin secrets. The test names start with the area: public, seeker, student, company,
// college, admin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { STATE, checkPage } from './common.mjs';

const PUBLIC = ['/', '/jobs', '/salaries', '/templates', '/builder', '/linkedin', '/for-companies', '/for-orgs', '/pricing', '/grievance', '/login', '/signup',
  '/forgot-password', '/admin/login', '/terms', '/privacy', '/refund-policy', '/delivery-policy', '/expert-terms', '/contact', '/blog', '/status',
  '/accessibility', '/partners', '/partner', '/recruiter', '/new-home', '/old-home'];
// a detail page of each kind, found from its list page: [list, link pattern]
const DETAILS = [['/jobs', /^\/jobs\/[^/?#]+$/], ['/salaries', /^\/salaries\/[^/?#]+$/], ['/blog', /^\/blog\/(?!category\/)[^/?#]+\/?$/], ['/jobs', /^\/companies\/[^/?#]+$/]];
const ME = ['', 'orders', 'messages', 'profile', 'certificates', 'resumes', 'ats', 'covers', 'jobs', 'auto-apply', 'hire', 'skill-checks', 'roles', 'learn',
  'practice', 'offer-check', 'feedback', 'programs', 'guidance', 'progress', 'share', 'groups', 'launch', 'payments', 'upgrade', 'settings', 'help', 'drive', 'alumni'];
const STUDENT = ['/me', '/me/auto-apply', '/me/progress', '/me/jobs', '/me/groups', '/me/resumes'];
const COMPANY_TABS = ['Overview', 'Jobs', 'Applicants', 'Hire now', 'Internships & projects', 'Talent pool', 'Team', 'Company page', 'Settings', 'Security', 'Activity'];
const COLLEGE = ['', '/dashboard', '/resumes', '/drives', '/offers', '/kiosks', '/recruiters', '/branding', '/billing', '/team', '/alumni', '/reviewers', '/activity'];
const ADMIN = ['', 'orders', 'experts', 'refunds', 'payments', 'customers', 'quality', 'reports', 'settings', 'automation', 'team', 'orgs', 'shared-resumes',
  'plans', 'billing-settings', 'org-invoices', 'partners', 'whatsapp-payments', 'codes', 'courses', 'college-groups', 'stories', 'jobs', 'companies',
  'auto-apply', 'skill-tests', 'learn-paths', 'programs', 'joining-reports'];

const info = () => { try { return JSON.parse(readFileSync(join(STATE, 'info.json'), 'utf8')); } catch { return { demos: {} }; } };
const state = (name) => join(STATE, `${name}.json`);
/** A signed-in area: skipped (with the reason) when its demo couldn't be opened. */
function area(name, who, list, toPath = (p) => p, extra = {}) {
  test.describe(name, () => {
    test.use({ storageState: state(who) }); // setup.smoke.mjs always writes this file (empty when the demo didn't open)
    for (const p of list) {
      test(`${name} › ${typeof p === 'string' ? p || '(home)' : p.title}`, async ({ page }) => {
        const i = info();
        const d = who === 'admin' ? { ok: i.admin } : i.demos[who];
        test.skip(!d?.ok, i.adminError ? `admin sign-in failed: ${i.adminError}` : d?.error ? `demo not opened: ${d.error}` : 'no live admin secrets');
        if (typeof p === 'string') await checkPage(page, toPath(p, d), { signedIn: true, ...extra });
        else await p.run(page, d);
      });
    }
  });
}

test.describe('public', () => {
  for (const p of PUBLIC) test(`public › ${p}`, async ({ page }) => { await checkPage(page, p); });
  for (const [list, re] of DETAILS) {
    test(`public › a ${re.source.split('\\/')[1]} detail page`, async ({ page }) => {
      await page.goto(list); await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      const href = await page.evaluate((src) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h)), re.source);
      test.skip(!href, `no link on ${list} matched (nothing published yet)`);
      await checkPage(page, href);
    });
  }
  test('public › every link in the header and footer menus', async ({ page }) => {
    const links = new Set(await checkPage(page, '/'));
    for (const p of ['/jobs', '/for-companies', '/for-orgs']) (await checkPage(page, p)).forEach((l) => links.add(l));
    const todo = [...links].map((l) => l.split('#')[0]).filter((l) => l && !PUBLIC.includes(l) && !/^\/(api|me|admin(?!\/login)|company|org\/|expert)/.test(l));
    const bad = [];
    for (const l of [...new Set(todo)]) { try { await checkPage(page, l); } catch (e) { bad.push(`${l}: ${e.message.split('\n').find((x) => x.includes('"')) || 'failed'}`); } }
    if (bad.length) throw new Error(`menu links that fail:\n${bad.join('\n')}`);
  });
});

area('seeker', 'seeker', ME.map((s) => `/me${s ? `/${s}` : ''}`).concat(['/builder']), (p) => p, { allow: ['/api/me/offer', '/api/me/drive'] });
area('student', 'student', STUDENT);
area('student', 'easy', ['/me/simple']);
area('company', 'company', ['/company', ...COMPANY_TABS.map((t) => ({
  title: `/company tab ${t}`,
  run: async (page) => {
    await checkPage(page, '/company', { signedIn: true });
    const { expect } = await import('@playwright/test');
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`API ${r.status()} ${r.url()}`); });
    await page.getByRole('tab', { name: t, exact: true }).click({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    expect(errs, `tab ${t}`).toEqual([]);
    expect((await page.locator('main').innerText()).trim().length, `tab ${t} is not blank`).toBeGreaterThan(40);
  },
}))]);
area('college', 'college', COLLEGE, (p, d) => `${d?.base || '/org'}${p}`);
area('admin', 'admin', ADMIN.map((s) => `/admin${s ? `/${s}` : ''}`));
