// /status on a desktop and a 390 px phone, against the real API: website, API and email states, no internal
// details; the footer links to it; /health answers GET and HEAD for uptime monitors.
import { expect, test } from '@playwright/test';
import { API } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('status page: three rows, states only', async ({ page, request }) => {
      await page.goto('/status');
      await expect(page.getByRole('heading', { name: 'Nm7 status' })).toBeVisible();
      const rows = page.getByTestId('status-row');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText('Working');
      await expect(rows.nth(1)).toContainText('Working');
      await expect(page.getByTestId('status-summary')).not.toHaveText('Checking…');
      const text = await page.locator('main').innerText();
      for (const leak of ['mongodb', 'onrender', 'localhost', 'Traceback']) expect(text.toLowerCase()).not.toContain(leak);
      expect(await noSideScroll(page)).toBe(true);
      expect((await request.get(`${API}/health`)).status()).toBe(200);
      expect((await request.head(`${API}/health`)).status()).toBe(200);
      await page.goto('/');
      await expect(page.getByRole('navigation', { name: 'Site links' }).getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status');
    });
  });
}
