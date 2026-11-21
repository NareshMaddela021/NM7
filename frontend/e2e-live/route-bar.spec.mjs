// Batch C item 26: while the next page's file loads, a thin bar shows at the top (the old page stays meanwhile).
import { expect, test } from '@playwright/test';

test('a thin loading bar shows while the next page loads, then goes', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // the pricing page's file arrives slowly
  await page.route(/\/src\/pages\/PricingPage\.jsx/, async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.continue(); });
  // an in-app page change (the router follows the history), on desktop and phone alike
  await page.evaluate(() => { window.history.pushState({}, '', '/pricing'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByTestId('route-bar')).toBeVisible();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId('route-bar')).toHaveCount(0, { timeout: 15_000 });
});
