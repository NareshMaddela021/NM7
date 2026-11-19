// Deep journeys of the LIVE admin, desktop + 390 px: every admin page (read only: no switch is pressed, the guard
// blocks every write), the Daily report, Settings (the switches, looked at only), and "Switch to" each view (job
// seeker, student, expert, company, college) with "Back to Admin". A view is one at a time per admin session, so the
// switching runs once (j-desktop) and does both window sizes one after the other.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { API, STATE } from './common.mjs';
import { guard, recorder, menuLinks } from './journeys-common.mjs';

const info = () => { try { return JSON.parse(readFileSync(join(STATE, 'info.json'), 'utf8')); } catch { return { demos: {} }; } };
const ready = () => { const i = info(); test.skip(!i.admin, i.adminError ? `admin sign-in failed: ${i.adminError}` : 'no live admin secrets'); };
const ADMIN = ['', 'daily-report', 'orders', 'experts', 'refunds', 'payments', 'customers', 'quality', 'reports', 'settings', 'automation', 'team', 'orgs', 'shared-resumes',
  'plans', 'billing-settings', 'org-invoices', 'partners', 'codes', 'courses', 'college-groups', 'stories', 'jobs', 'companies', 'auto-apply', 'skill-tests',
  'learn-paths', 'programs', 'joining-reports'].map((s) => `/admin${s ? `/${s}` : ''}`);
const VIEW_PAGES = {
  jobseeker: ['/me', '/me/simple', '/me/jobs', '/me/resumes', '/me/auto-apply', '/me/skill-checks', '/me/hire', '/me/upgrade', '/jobs'],
  student: ['/me/learn', '/me/simple', '/me/progress', '/me/skill-checks', '/me/practice'],
  expert: ['/expert', '/expert/orders', '/expert/snippets', '/expert/performance', '/expert/help', '/expert/earnings', '/expert/profile', '/expert/test', '/expert/reviewer'],
  company: ['/company'],
  college: [],
};
const SIZES = { desktop: { viewport: { width: 1280, height: 900 } }, 'phone 390': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } };

test.describe('journey admin', () => {
  test.use({ storageState: join(STATE, 'admin.json') });

  test('journey admin › every admin page and menu link (read only)', async ({ page }, ti) => {
    test.setTimeout(1_200_000);
    ready();
    const r = recorder(ti, { role: 'admin', signedIn: true });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    const seen = new Set(); const links = new Set();
    for (const p of ADMIN) { await r.visit(page, p); seen.add(p); (await menuLinks(page).catch(() => [])).forEach((l) => links.add(l)); }
    for (const l of links) if (!seen.has(l) && l.startsWith('/admin') && l !== '/admin/login' && l !== '/admin/setup') { await r.visit(page, l, `menu link ${l}`); seen.add(l); }
    r.note(`pages checked: ${seen.size}; writes blocked: ${writes.filter((w) => !w.allowed).map((w) => `${w.method} ${w.path}`).join(', ') || 'none'}`);
    r.finish(writes);
  });

  test('journey admin › Daily report and Settings switches (looked at only)', async ({ page }, ti) => {
    test.setTimeout(300_000);
    ready();
    const r = recorder(ti, { role: 'admin', signedIn: true });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/admin/daily-report');
    await r.step(page, 'Daily report has numbers', async () => {
      await expect(page.locator('main')).toContainText(/\d/, { timeout: 30_000 });
      const tiles = await page.locator('.dr-tile').count();
      r.note(`Daily report tiles: ${tiles}`);
    });
    await r.visit(page, '/admin/settings');
    await r.step(page, 'Settings switches listed', async () => {
      const sw = await page.locator('input[type=checkbox], [role=switch]').evaluateAll((els) => els.map((e) => {
        const l = e.closest('label')?.innerText || e.getAttribute('aria-label') || e.id;
        return `${(l || '').trim().replace(/\s+/g, ' ').slice(0, 60)}=${e.checked ?? e.getAttribute('aria-checked')}`;
      }));
      r.note(`Settings switches (not changed): ${sw.join(' | ')}`);
    });
    r.finish(writes);
  });

  test('journey admin › Switch to each view and Back to Admin (desktop and 390 px)', async ({ browser }, ti) => {
    test.skip(!ti.project.name.includes('desktop'), 'one view at a time per admin session: runs once, both sizes inside');
    test.setTimeout(1_800_000);
    ready();
    const r = recorder(ti, { role: 'admin views', signedIn: true, allow404: ['/api/me/offer', '/api/me/drive'] });
    const allWrites = [];
    for (const [size, use] of Object.entries(SIZES)) {
      for (const role of Object.keys(VIEW_PAGES)) {
        const ctx = await browser.newContext({ ...use, storageState: join(STATE, 'admin.json') });
        const page = await ctx.newPage();
        r.watch(page);
        const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/admin\/views\/(switch|stop)$/, /^POST \/api\/(track|events)\b/] });
        const L = `${size} ${role}`;
        await r.visit(page, '/admin', `${L}: /admin before`);
        const opened = await r.step(page, `${L}: Switch to`, async () => {
          await page.getByRole('button', { name: /^Account menu/ }).first().click();
          const item = page.getByTestId(`switch-${role}`);
          await expect(item).toBeVisible({ timeout: 15_000 });
          await item.click();
          await expect(page.getByTestId('view-banner')).toBeVisible({ timeout: 45_000 });
          return true;
        });
        if (opened) {
          const landed = page.url().replace(/^https?:\/\/[^/]+/, '');
          r.note(`${L}: landed on ${landed}; banner "${(await page.getByTestId('view-banner').innerText()).replace(/\s+/g, ' ')}"`);
          await r.check(page, `${L}: view home ${landed}`);
          const pages = role === 'college' ? ['/dashboard', '/drives', '/resumes'].map((p) => `${landed.match(/^\/org\/[^/]+/)?.[0] || '/org'}${p}`) : VIEW_PAGES[role];
          for (const p of pages) {
            await r.visit(page, p, `${L}: ${p}`);
            if (!(await page.getByTestId('view-banner').count())) await r.fail(page, `${L}: ${p} banner`, 'the "viewing as" banner is gone on this page');
          }
          if (role === 'jobseeker' || role === 'student' || role === 'expert') {
            await page.goto(role === 'expert' ? '/expert' : role === 'student' ? '/me/learn' : '/me');
            await page.waitForLoadState('networkidle').catch(() => {});
            const sc = await page.getByTestId('sc-card').or(page.getByTestId('sc-complete')).count();
            r.note(`${L}: setup card ${sc ? 'shown' : 'NOT shown'}`);
            if (!sc) await r.fail(page, `${L}: setup card`, 'no setup card (or "Profile complete") on this role\'s home');
          }
          await r.step(page, `${L}: Back to Admin`, async () => {
            await page.getByTestId('back-to-admin').click();
            await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 30_000 });
            await expect(page.getByTestId('view-banner')).toHaveCount(0, { timeout: 15_000 });
            await r.check(page, `${L}: back on /admin`);
          });
        }
        allWrites.push(...writes);
        // never leave a view open
        await page.evaluate(async (api) => { await fetch(`${api}/api/admin/views/stop`, { method: 'POST', credentials: 'include' }).catch(() => {}); }, API).catch(() => {});
        await ctx.close();
      }
    }
    r.finish(allWrites);
  });
});
