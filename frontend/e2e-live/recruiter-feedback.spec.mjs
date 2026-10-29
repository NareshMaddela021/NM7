// Recruiter feedback to the college (R4, Drive plan) on a desktop and a 390 px phone, against the real API: the
// recruiter sends the one-minute form from the portal (rating, gaps, visit again); the college's Recruiters page shows
// "What recruiters said" with the gap and a free course; the recruiter edits it later from My drives. No sideways
// scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('portal form → What recruiters said with free courses → edit from My drives', async ({ page, browser }) => {
      test.setTimeout(120_000);
      const owner = email(`fb-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Feedback College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'drive' }) })).status).toBe(200);
      const code = `FB${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = (await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, settings: { shareWithRecruiters: true } }) })).body;
      const recruiter = email(`fb-rec-${label}`);
      const inv = (await call(page, `/api/org/${org.id}/recruiter-invites`, { method: 'POST', body: JSON.stringify({ company: 'Acme Analytics', recruiterName: 'Ravi K', email: recruiter, groupIds: [g.id], expiresOn: inDays(30) }) })).body;

      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const r = await rctx.newPage();
      await r.goto(`/recruiter/${inv.url.split('/recruiter/')[1]}`);
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible();
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      await r.getByRole('button', { name: 'Feedback for the college' }).click();
      const form = r.getByRole('form', { name: 'Feedback for the college' });
      await form.getByRole('radio', { name: '4 out of 5' }).click();
      await form.getByRole('checkbox', { name: 'SQL', exact: true }).check();
      await form.getByLabel('Communication').check();
      await form.getByLabel('Basics of…').selectOption('Python');
      await form.getByRole('button', { name: 'Add' }).click();
      await form.getByLabel('What went well (optional)').fill('Well organised');
      await form.getByLabel('Yes').check();
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      await form.getByRole('button', { name: 'Send feedback' }).click();
      await expect(form).toHaveCount(0);

      // the college
      await page.goto(`/admin/orgs?org=${org.id}`);
      const said = page.getByTestId('recruiter-feedback');
      await expect(said.getByTestId('feedback-rating')).toContainText('4 / 5 · 1 drive · 1 would visit again');
      const sql = said.getByTestId('feedback-gap').filter({ hasText: 'SQL' });
      await expect(sql.getByRole('link').first()).toBeVisible(); // a free course
      await expect(said.getByTestId('feedback-gap').filter({ hasText: 'Basics of Python' })).toBeVisible();
      await expect(said.getByTestId('feedback-gap').filter({ hasText: 'Communication' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // later, from My drives: the form opens with the answer and can be changed
      await r.goto('/recruiter/drives');
      const drive = r.getByTestId('my-drive');
      await drive.getByRole('button', { name: 'Edit feedback' }).click();
      const again = r.getByRole('form', { name: 'Feedback for the college' });
      await expect(again.getByRole('radio', { name: '4 out of 5' })).toHaveAttribute('aria-checked', 'true');
      await again.getByRole('radio', { name: '5 out of 5' }).click();
      await again.getByRole('button', { name: 'Send feedback' }).click();
      await expect(again).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('feedback-rating')).toContainText('5 / 5');
      await rctx.close();
    });
  });
}
