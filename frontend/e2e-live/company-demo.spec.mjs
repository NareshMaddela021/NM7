// The Phase 2 demo on a desktop and a 390 px phone, against the real API: Admin → Companies shows the demo box;
// "Reset and open as company" (no browser dialogs) opens /company as the demo main admin with 5 jobs (2 live, within the
// limit of 3: fix round item 11) and ranked applicants from the demo college; ticking Compare shows the side-by-side
// bar right away (item 23); the trust queue lists the 3 sample sign-ups with their flags, the clean one can be
// approved, each email shows its real state (item 10) and the burst one warns that its emails aren't on its website
// (item 22). No sideways scrolling.
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
      await expect(page.getByTestId('co-jobs-room')).toHaveText('Live jobs: 2 of 3.'); // room to post one (item 11)
      await page.getByRole('tab', { name: 'Applicants' }).click();
      await expect(page.getByTestId('co-applicant').first()).toBeVisible();
      await expect(page.getByTestId('co-ap-notfit').first()).toContainText('Not a fit');
      expect(await noSideScroll(page)).toBe(true);
      // item 23: the compare bar shows up at once, in view, near the ticks
      const ticks = page.getByRole('checkbox', { name: /^Compare: / });
      await ticks.nth(0).check();
      const bar = page.getByTestId('co-ap-bar');
      await expect(bar).toContainText('1 of 3 picked to compare. Tick one more to see them side by side.');
      await expect(bar).toBeInViewport();
      await ticks.nth(1).check();
      await expect(bar.getByTestId('co-ap-compare')).toBeVisible();
      await expect(bar).toBeInViewport();
      await expect(bar.getByTestId('co-ap-compare')).not.toContainText(/\b0\.\d\b/); // no "0.2" years
      expect(await noSideScroll(page)).toBe(true);
      // the 3 sample sign-ups (the admin console is still signed in)
      await page.goto('/admin/companies');
      await page.getByLabel('Search companies').fill('(demo)');
      await page.getByRole('button', { name: 'Search' }).click();
      const rows = page.getByTestId('admin-company');
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: 'Duplicate GSTIN Sample (demo)' }).getByTestId('company-flags')).toContainText('same registration number');
      await expect(rows.filter({ hasText: 'Same Address Burst Sample (demo)' }).getByTestId('company-flags')).toContainText('3 sign-ups from the same address');
      await expect(rows.filter({ hasText: 'Same Address Burst Sample (demo)' }).getByTestId('company-flags')).toContainText('doesn’t match the website (burst-careers.invalid)');
      // item 10: the duplicate sample waits for its company email, and says so; the clean one can be approved
      await rows.filter({ hasText: 'Duplicate GSTIN Sample (demo)' }).getByRole('button', { name: 'Review' }).click();
      const review = page.getByTestId('company-review');
      await expect(review.getByTestId('co-emails')).toContainText('company email not added');
      await expect(review.getByRole('button', { name: 'Approve' })).toBeDisabled();
      await expect(review.getByTestId('co-approve-why')).toHaveText('Approve needs the company email confirmed first.');
      await page.getByRole('button', { name: /Close/ }).first().click();
      await rows.filter({ hasText: 'Clean Sample Software Pvt Ltd (demo)' }).getByRole('button', { name: 'Review' }).click();
      await expect(review.getByTestId('co-emails')).toHaveText('founder@clean.demo.nm7.invalid (confirmed) · hr@clean.demo.nm7.invalid (confirmed)');
      await expect(review).toContainText('Startup · Private limited · 51–200 people'); // item 33: plain words
      await review.getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByText('Verified: the main admin was emailed')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
