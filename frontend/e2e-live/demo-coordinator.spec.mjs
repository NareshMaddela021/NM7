// Admin → Organizations → Demo → "Reset and open as coordinator", on a desktop and a 390 px phone, against the real
// API: no email code; the demo college's portal opens with the Demo banner; every college tab works (drives,
// offers, alumni, reviewers, dashboard) and the college group roll-up; the session can't open a real organization,
// resumes or orders; "Sign out of the demo" ends it.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('open the demo college as its coordinator', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `owner-democo-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const real = (await call(page, '/api/admin/orgs', json('POST', { name: `Real College ${label}`, type: 'college' }))).body;
      await page.goto('/admin/orgs');
      page.once('dialog', (d) => d.accept());
      await page.getByTestId('demo-as-coordinator').click();
      await page.waitForURL('**/org/demo-engineering-college');
      await expect(page.getByTestId('demo-banner')).toContainText('Demo');
      expect(page.url()).not.toContain('#t='); // the token doesn't stay in the address bar
      for (const [tab, text] of [['drives', 'Drive day'], ['offers', 'Offers'], ['alumni', 'alumni'], ['reviewers', 'Reviewer'], ['dashboard', 'Joined']]) {
        await page.goto(`/org/demo-engineering-college/${tab}`);
        await expect(page.getByRole('main')).toContainText(new RegExp(text, 'i'));
        expect(await noSideScroll(page)).toBe(true);
      }
      const groups = (await call(page, '/api/me/college-groups')).body;
      await page.goto(`/college-group/${groups[0].id}`);
      await expect(page.getByRole('main')).toContainText('Demo Engineering College');
      // nothing else
      expect((await call(page, `/api/org/${real.id}`)).status).toBe(403);
      expect((await call(page, '/api/me/resumes')).status).toBe(403);
      expect((await call(page, '/api/admin/orgs')).status).toBe(403);
      // sign out
      await page.goto('/org/demo-engineering-college');
      await page.getByTestId('demo-signout').click();
      await page.waitForURL('**/login**');
      expect((await call(page, '/api/auth/me')).status).toBe(401);
    });
  });
}
