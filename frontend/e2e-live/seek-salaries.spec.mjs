// Phase 6 S4 salary guide, on a desktop and a 390 px phone, against the real API: /salaries lists every role with
// starting, 1–3 years and 3+ years pay, saying "Not enough data yet" where Nm7 has too few real jobs (it never
// guesses); a city can be picked; Ready to join shows the hint (job-page lookup: tests/test_seek_salary.py).
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
      await page.goto('/salaries');
      const rows = page.getByTestId('sal-role');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(20);
      await expect(rows.filter({ hasText: 'Data analyst' })).toContainText('Not enough data yet');
      await expect(page.getByTestId('salaries')).toContainText('Nothing is guessed');
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
