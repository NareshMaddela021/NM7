// Runs only against a production build served with the vercel.json headers (CSP_CHECK=1): no CSP violations.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';

test.skip(!process.env.CSP_CHECK, 'needs the production build with headers (npm run test:e2e:csp)');

test('pages work under the Content-Security-Policy', async ({ page }) => {
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  expect((await page.request.get('/nope')).status()).toBe(404); // unknown paths: real 404 (still shows the app)
  expect((await page.request.get('/robots.txt')).status()).toBe(200);
  expect((await page.request.get('/me/orders')).status()).toBe(200);
  for (const path of ['/', '/privacy', '/contact', '/login', '/nope']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible();
  const mail = email('csp');
  seed('customer', mail, 'Csp Check', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.waitForLoadState('networkidle');
  await page.goto('/builder'); // downloads need an account
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  const v = await page.evaluate(() => window.__csp);
  expect(v.filter((x) => !x.includes('eval'))).toEqual([]);
});
