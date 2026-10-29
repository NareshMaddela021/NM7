// Admin daily summary on a desktop and a 390 px phone, against the real API: the Dashboard's "Today so far" card
// with a Share to WhatsApp link (wa.me with the numbers, no personal data); Admin > Settings turns the 8:00 email off.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Today card, Share to WhatsApp, settings toggle', async ({ page }) => {
      const owner = `owner-daily-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin');
      const card = page.getByTestId('today-card');
      await expect(card).toContainText('New users');
      await expect(card).toContainText('Server errors');
      const href = new URL(await card.getByTestId('today-wa').getAttribute('href'));
      expect(href.origin + href.pathname).toBe('https://wa.me/');
      const text = href.searchParams.get('text');
      expect(text).toMatch(/^Nm7 today so far/);
      expect(text).toContain('Revenue: Rs');
      expect(text).not.toContain('@');
      expect(await noSideScroll(page)).toBe(true);

      await page.goto('/admin/settings');
      const box = page.getByTestId('daily-settings');
      await box.getByTestId('daily-on').uncheck();
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.reload();
      await expect(page.getByTestId('daily-on')).not.toBeChecked();
      await page.getByTestId('daily-on').check();
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.reload();
      await expect(page.getByTestId('daily-on')).toBeChecked();
    });
  });
}
