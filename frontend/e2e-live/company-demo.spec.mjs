// The Phase 2 demo on a desktop and a 390 px phone, against the real API: Admin → Companies shows the demo box;
// "Reset and open as company" (no browser dialogs) opens /company as the demo main admin with 5 live jobs and ranked
// applicants from the demo college; the trust queue lists the 3 sample sign-ups with their flags. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('reset and open the demo company; sample sign-ups in the queue', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `demo-co-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      const box = page.getByTestId('demo-company');
      await expect(box).toContainText('Demo Tech Solutions (demo)');
      expect(await noSideScroll(page)).toBe(true);
      await box.getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      await expect(page.getByTestId('co-card')).toContainText('Demo Tech Solutions (demo)');
      await page.getByRole('tab', { name: 'Jobs' }).click();
      await expect(page.getByTestId('co-job')).toHaveCount(5);
      await page.getByRole('tab', { name: 'Applicants' }).click();
      await expect(page.getByTestId('co-applicant').first()).toBeVisible();
      await expect(page.getByTestId('co-ap-notfit').first()).toContainText('Not a fit');
      expect(await noSideScroll(page)).toBe(true);
      // the 3 sample sign-ups (the admin console is still signed in)
      await page.goto('/admin/companies');
      await page.getByLabel('Search companies').fill('(demo)');
      await page.getByRole('button', { name: 'Search' }).click();
      const rows = page.getByTestId('admin-company');
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: 'Duplicate GSTIN Sample (demo)' }).getByTestId('company-flags')).toContainText('same registration number');
      await expect(rows.filter({ hasText: 'Same Address Burst Sample (demo)' }).getByTestId('company-flags')).toContainText('3 sign-ups from the same address');
    });
  });
}
