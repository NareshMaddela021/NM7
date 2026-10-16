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

test('blog: pre-rendered static pages are served (not the app shell), real 404s, sitemap, and no CSP violations', async ({ page }) => {
  // the build pre-rendered the test posts (e2e-live/build-with-blog.mjs)
  const r = await page.request.get('/blog/ats-friendly-resume');
  expect(r.status()).toBe(200);
  const html = await r.text();
  expect(html).toContain('<title>How to make an ATS-friendly resume · Nm7</title>');
  expect(html).toContain('<link rel="canonical" href="https://nm7.si/blog/ats-friendly-resume" />');
  expect(html).toContain('ATS software reads your resume before a person does.');
  expect(html).toContain('"@type":"BlogPosting"');
  expect(r.headers()['content-security-policy']).toContain('https://*.graphassets.com');
  for (const p of ['/blog', '/blog/category/ats']) expect((await page.request.get(p)).status()).toBe(200);
  expect((await page.request.get('/blog/no-such-post')).status()).toBe(404);
  expect((await page.request.get('/blog/category/no-such-category')).status()).toBe(404);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('<loc>https://nm7.si/blog/ats-friendly-resume</loc><lastmod>2026-10-12T08:30:00.000Z</lastmod>');

  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await page.goto('/blog');
  await expect(page.locator('main .blog-card')).toHaveCount(3);
  await page.getByRole('link', { name: /How to make an ATS-friendly resume/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'How to make an ATS-friendly resume' })).toBeVisible();
  await page.goto('/blog/ats-keywords'); // straight in: the app takes over the static page
  await expect(page.getByRole('complementary', { name: 'Free resume scan' })).toBeVisible();
  await page.goto('/blog/no-such-post');
  await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect((await page.evaluate(() => window.__csp)).filter((x) => !x.includes('eval'))).toEqual([]);
});
