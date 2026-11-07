// The job readiness score (Phase 4, E5) on a desktop and a 390 px phone, against the real API: "You are 55% ready"
// on the simple home, the big ring with up to 3 things left (each one button to the exact place), the small card on
// the full dashboard, recomputed after a change; Admin's weights must add up to 100.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('readiness: score, things left, full dashboard card, admin weights', async ({ page, browser }) => {
      test.setTimeout(200_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await studentWith(page, label, STRONG, 'ready');
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'en', mode: 'simple' }))).status).toBe(200);
      await page.goto('/me/simple');
      // a complete resume with a LinkedIn link: 20 + 25 + 10; no jobs chosen, no practice, no certificate yet
      await expect(page.getByTestId('sx-ready-link')).toHaveText(/You are 55% ready/);
      await page.getByTestId('sx-ready-link').click();
      await expect(page.getByTestId('sx-ready-score')).toHaveText('You are 55% ready');
      await expect(page.getByTestId('sx-ready').getByRole('listitem')).toHaveCount(3);
      await expect(page.getByTestId('sx-left-roles')).toHaveText(/Choose the jobs you want · \+20 points/);
      // item 13 (fix round): "Things left" stay inside the easy dashboard
      await expect(page.getByTestId('sx-left-roles')).toHaveAttribute('href', '/me/simple/auto');
      await expect(page.getByTestId('sx-left-interview')).toHaveAttribute('href', '/me/simple/practice');
      await expect(page.getByTestId('sx-left-certs')).toHaveAttribute('href', '/me/simple/resume?step=certs');
      expect(await noSideScroll(page)).toBe(true);
      const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
      expect(v.map((x) => x.id)).toEqual([]);
      // a certificate on the resume: recomputed
      const rs = (await call(page, '/api/me/resumes')).body;
      await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data: { ...STRONG, certs: [{ name: 'Excel basics', issuer: 'NPTEL', issueDate: '2025-01' }] } }));
      await page.goto('/me/simple');
      await expect(page.getByTestId('sx-ready-link')).toHaveText(/You are 65% ready/);
      // the full dashboard: a small card with the next thing
      await page.getByTestId('sx-to-full').click();
      await expect(page.getByTestId('readiness-card')).toContainText('Job readiness: 65%');
      await expect(page.getByTestId('readiness-next')).toHaveText(/Next: Choose the jobs you want/);
      // Admin → Settings: the points must add up to 100
      const owner = `ready-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/settings');
      await admin.getByTestId('ready-w-linkedin').fill('30');
      await expect(admin.getByText('The readiness points must add up to 100')).toBeVisible();
      await expect(admin.getByRole('button', { name: 'Save settings' })).toBeDisabled();
      await admin.getByTestId('ready-w-linkedin').fill('10');
      await expect(admin.getByRole('button', { name: 'Save settings' })).toBeEnabled();
      await actx.close();
    });
  });
}
