// QA small fixes, desktop + 390 px phone: the "No experience yet? Skip this" tip shows only while Experience is empty;
// every template card's "Use" button has a name ("Use <template>").
import { expect, test } from '@playwright/test';
import { asTestPerson } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
async function openExperience(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Experience/ }).click();
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('the skip tip is hidden once there is an experience entry', async ({ page }) => {
      await asTestPerson(page); // a fresher with an internship
      await openExperience(page);
      await expect(page.getByRole('heading', { name: /Experience/ }).first()).toBeVisible();
      await expect(page.getByTestId('fresher-tip')).toHaveCount(0);
    });

    test('the skip tip shows for a fresher with no experience', async ({ page }) => {
      await asTestPerson(page, { exp: [] });
      await openExperience(page);
      await expect(page.getByTestId('fresher-tip')).toHaveText('No experience yet? Skip this — projects carry your resume.');
    });

    test('every "Use template" button on the cards has a name', async ({ page }) => {
      await page.goto('/builder');
      await page.getByRole('button', { name: /Start from scratch/ }).click();
      const uses = page.locator('button.tp-use');
      await expect(uses).toHaveCount(19);
      const names = await uses.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      expect(names.every((n) => /^Use \S/.test(n || ''))).toBe(true);
      expect(new Set(names).size).toBe(19);
    });
  });
}
