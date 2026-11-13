// Phase 5 H9 + demo, on a desktop and a 390 px phone, against the real API: Admin opens the supply map, then "Reset and
// open as company (Hire in 30 minutes)": the company lands on Hire now with the bulk post (50 openings), demo
// candidates with skill check results and reliability ("New - no history yet" for some), three interview times and
// one offer waiting; the hiring speed card appears once a candidate was shown. No browser dialogs, no sideways
// scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Hire in 30 minutes demo walk-through', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const owner = `hd-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('supply-map').locator('summary').click();
      await expect(page.getByTestId('supply-total')).toContainText('people ready to join now');
      expect(await noSideScroll(page)).toBe(true); // the long demo button wraps at 390 px
      await page.getByTestId('demo-hire').click();
      await expect(page).toHaveURL(/\/company/);
      const hire = page.getByTestId('co-hire');
      await expect(hire).toBeVisible();
      await page.getByTestId('co-hire-job').selectOption({ label: 'Customer Support Executive' });
      await expect(page.getByTestId('co-bulk')).toContainText('Bulk hiring: 50 openings');
      await expect(page.getByTestId('co-hire-row').first()).toBeVisible();
      expect(await page.getByTestId('co-hire-row').count()).toBeGreaterThanOrEqual(9);
      // 13 Nov live test: the top 10 first with "Show more", ranked by score, and never "In undefined"
      expect(await page.getByTestId('co-hire-row').count()).toBeLessThanOrEqual(10);
      await expect(hire).not.toContainText('undefined');
      const scores = (await page.getByTestId('co-hire-score').allInnerTexts()).map((x) => parseInt(x.replace(/\D/g, ''), 10));
      expect(scores).toEqual([...scores].sort((x, y) => y - x));
      if (await page.getByTestId('co-hire-more').count()) {
        await page.getByTestId('co-hire-more').click();
        expect(await page.getByTestId('co-hire-row').count()).toBeGreaterThan(10);
      }
      await expect(hire).toContainText('Skill check');
      await expect(hire).toContainText('New - no history yet');
      await expect(page.getByTestId('co-slot')).toHaveCount(3);
      await expect(page.getByTestId('co-offer-state')).toHaveText('Waiting for an answer');
      expect(await noSideScroll(page)).toBe(true);
      await page.reload();
      await page.getByRole('tab', { name: 'Hire now' }).click();
      await expect(page.getByTestId('co-speed')).toBeVisible();
    });
  });
}
