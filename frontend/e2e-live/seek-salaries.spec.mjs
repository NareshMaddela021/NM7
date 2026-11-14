// Phase 6 S4 salary guide, on a desktop and a 390 px phone, against the real API: /salaries lists every role with
// starting, 1–3 years and 3+ years pay, saying "Not enough data yet" where Nm7 has too few real jobs (it never
// guesses); a city can be picked; one role's page; hidden from search and the footer until there is enough data
// (round D1); Ready to join shows the hint (job-page lookup: tests/test_seek_salary.py).
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('salary guide: never guesses; city; Ready to join hint', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      // round D1: with too little data the page is hidden from search ("noindex, follow") and from the footer,
      // but still works when opened directly; each role has its own page
      await page.goto('/old-home');
      await expect(page.locator('footer')).toBeVisible();
      await expect(page.getByTestId('footer-salaries')).toHaveCount(0);
      await page.goto('/salaries');
      const rows = page.getByTestId('sal-role');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(20);
      await expect(rows.filter({ hasText: 'Data analyst' })).toContainText('Not enough data yet');
      await expect(page.getByTestId('salaries')).toContainText('Nothing is guessed');
      await rows.filter({ hasText: 'Data analyst' }).getByRole('link', { name: 'Data analyst' }).click();
      await expect(page).toHaveURL(/\/salaries\/data-analyst$/);
      await expect(page.getByTestId('sal-role')).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
      await page.getByTestId('sal-all-roles').click();
      await page.getByTestId('sal-city').fill('Hyderabad');
      await page.getByTestId('sal-go').click();
      await expect(rows.first()).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      // Ready to join: the hint for the person's role
      const mail = email(`sal-${label}`);
      seed('customer', mail, 'Sita Reddy', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.evaluate(async () => fetch('http://localhost:8001/api/me/roles', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studies: 'graduate', style: 'numbers', secondStyle: 'computers', likes: ['maths'], languages: ['English'], laptop: true, hoursWeek: 8 }) }));
      await page.goto('/me/hire');
      await page.getByLabel('Cities you can work in (comma between)').fill('Hyderabad');
      await expect(page.getByTestId('hj-pay')).toContainText('not enough data yet');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
