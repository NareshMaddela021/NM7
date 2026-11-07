// The Easy dashboard demo (Phase 4) on a desktop and a 390 px phone, against the real API: Admin → Auto Apply →
// "Reset and open as student (Easy dashboard, Telugu)" (no browser dialog) opens Ravi Kumar (demo) on /me/simple in
// Telugu: the next step is a project, about 60% ready, the demo company's jobs (looking only), one question waiting.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed, teluguHindi } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

teluguHindi(test); // these tests are about Telugu / Hindi: shown for this file (item 41)

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Ravi in Telugu from the demo shortcut', async ({ browser }) => {
      test.setTimeout(150_000);
      const owner = `sx-demo-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/auto-apply');
      await page.getByTestId('aa-demo-simple').click();
      await expect(page).toHaveURL(/\/me\/simple$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('నమస్తే Ravi');
      await expect(page.getByTestId('sx-next')).toHaveAttribute('data-key', 'projects');
      await expect(page.getByTestId('sx-ready-link')).toHaveText(/మీరు (5[5-9]|6[0-5])% సిద్ధంగా ఉన్నారు/);
      expect(await noSideScroll(page)).toBe(true);
      const v = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact));
      expect(v.map((x) => x.id)).toEqual([]);
      // keyboard: the next step's button works with Enter
      await page.getByTestId('sx-next-go').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/me\/simple\/resume\?step=projects$/);
      await expect(page.getByTestId('sx-guided')).toHaveAttribute('data-step', 'projects');
      await page.goto('/me/simple');
      await page.getByTestId('sx-tile-jobs').click();
      await expect(page.getByTestId('sx-job')).toHaveCount(3);
      await expect(page.getByTestId('sx-to-answers')).toBeVisible();
      await page.getByTestId('sx-job').first().getByTestId('sx-job-apply').click();
      await expect(page.getByTestId('sx-send')).toBeDisabled(); // demo jobs: look, not apply
      await expect(page.getByText('ఇది డెమో ఉద్యోగం: చూడవచ్చు, అప్లై చేయలేరు.')).toBeVisible();
      await page.goto('/me/simple/answers');
      await expect(page.getByTestId('sx-answer-item')).toBeVisible();
      await ctx.close();
    });
  });
}
