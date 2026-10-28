// Runs only against a production build served with the vercel.json headers (CSP_CHECK=1): no CSP violations.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, readQrPng, seed, downloadThrough } from './helpers.mjs';

test.skip(!process.env.CSP_CHECK, 'needs the production build with headers (npm run test:e2e:csp)');

test('pages work under the Content-Security-Policy', async ({ page }) => {
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  expect((await page.request.get('/nope')).status()).toBe(404); // unknown paths: real 404 (still shows the app)
  expect((await page.request.get('/robots.txt')).status()).toBe(200);
  expect((await page.request.get('/me/orders')).status()).toBe(200);
  // home: the language switch loads Noto Sans Telugu / Devanagari from Google Fonts; tap counters post to the API
  await page.goto('/');
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'తెలుగు' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('రెజ్యూమ్');
  await page.getByRole('group', { name: 'భాష' }).getByRole('button', { name: 'English' }).click();
  await page.waitForLoadState('networkidle');
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
  const [dl] = await downloadThrough(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click());
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

test('a group\'s "Download QR code (PNG)" works under the CSP (it once fetched a data: URL and did nothing)', async ({ page }) => {
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Failed to fetch|Content Security Policy/.test(m.text())) errors.push(m.text()); });
  const owner = email('csp-qr');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `CQ${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('AsuraaX');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Job Drive 2026');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: 'Save group' }).click();
  const card = page.getByRole('region', { name: 'Group Job Drive 2026' });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), card.getByRole('button', { name: 'Download QR code (PNG)' }).click()]);
  expect(dl.suggestedFilename()).toBe('AsuraaX_Job_Drive_2026_QR.png');
  const qr = await readQrPng((await import('node:fs')).readFileSync(await dl.path()));
  expect(qr.text).toMatch(new RegExp(`/join/${code}$`));
  const [poster] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), card.getByRole('button', { name: 'Download QR poster (PDF)' }).click()]);
  expect(poster.suggestedFilename()).toBe('AsuraaX_Job_Drive_2026_QR_poster.pdf');
  expect((await page.evaluate(() => window.__csp)).filter((x) => !x.includes('eval'))).toEqual([]);
  expect(errors).toEqual([]);
});
