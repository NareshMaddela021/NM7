// Re-test 12 Nov N5, on a desktop and a 390 px phone, against the real API (Telugu and Hindi hidden, the default):
// the demo button says English; one waiting question reads "Answer 1 question"; a verified company's status says
// "Verified" once.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('plain words: English demo, singular, Verified once', async ({ browser }) => {
      test.setTimeout(120_000);
      const owner = `wording-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      // a verified company: "Verified", not "Verified · Verified"
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      await page.goto('/admin/companies');
      await page.getByRole('tab', { name: /^Verified/ }).click();
      await page.getByLabel('Search companies').fill('Demo Tech');
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByTestId('admin-company').filter({ hasText: 'Demo Tech Solutions (demo)' }).getByRole('button', { name: 'Review' }).click();
      await expect(page.getByTestId('co-status')).toHaveText('Verified');
      // the demo button follows "Show Telugu and Hindi" (off): English
      await page.goto('/admin/auto-apply');
      await expect(page.getByTestId('aa-demo-simple')).toHaveText('Reset and open as student (Easy dashboard, English)');
      expect(await noSideScroll(page)).toBe(true); // the long label wraps on a 390 px phone
      const box = await page.getByTestId('aa-demo-simple').boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(opts.viewport.width);
      await page.getByTestId('aa-demo-simple').click();
      await expect(page).toHaveURL(/\/me\/simple$/);
      // Ravi has one question waiting: singular
      await page.goto('/me/simple/jobs');
      await expect(page.getByTestId('sx-to-answers')).toHaveText(/Answer 1 question from companies$/);
      expect(await noSideScroll(page)).toBe(true);
      await ctx.close();
    });
  });
}
