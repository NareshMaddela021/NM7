// The home page against the real API, on a desktop and a 390 px phone: every hero and "Start from" button lands on
// the right builder mode or page, the language switch changes the hero and survives a reload, the organization plans
// table comes from the API, nothing shifts while the page loads, and taps are counted (first-party, no cookies).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];

/** A link on the home page, then where it should land (a URL and one thing visible there). */
const DESTINATIONS = [
  ['Build my resume — free', /\/builder$/, (p) => p.getByRole('heading', { name: /Build a resume recruiters/ })],
  ['Snap my papers', /\/builder\?start=photos$/, (p) => p.getByRole('heading', { name: 'Snap photos of your papers' })],
  ['Import my resume', /\/builder\?start=resume$/, (p) => p.getByRole('heading', { name: 'Rebuild your old resume' })],
  ['See plans for organizations', /\/for-orgs$/, (p) => p.getByRole('heading', { level: 1, name: /Every student’s resume/ })],
  ['Start free', /\/for-orgs\?start=1#start$/, (p) => p.getByRole('link', { name: 'Create a free account' })],
  ['I have a resume', /\/builder\?start=resume$/, (p) => p.getByRole('heading', { name: 'Rebuild your old resume' })],
  ['I have papers', /\/builder\?start=photos$/, (p) => p.getByRole('heading', { name: 'Snap photos of your papers' })],
  ['I have nothing', /\/builder\?start=scratch$/, (p) => p.getByRole('heading', { name: 'Pick a starting look' })],
  ['I have a LinkedIn', /\/builder\?start=linkedin$/, (p) => p.getByRole('heading', { name: 'Import your LinkedIn profile' })],
  ['Try the summary writer', /\/builder\?start=summary$/, (p) => p.getByLabel('Your summary')],
];

for (const [label, size] of SIZES) {
  test.describe(`home · ${label}`, () => {
    test.use({ viewport: size });

    test('each hero, "Start from" and demo button lands on the right builder mode or page', async ({ page }) => {
      for (const [name, url, landed] of DESTINATIONS) {
        await page.goto('/');
        const link = page.getByRole('main').getByRole('link', { name: new RegExp(`^${name}`) }).first(); // cards add their description
        await link.scrollIntoViewIfNeeded();
        const box = await link.boundingBox();
        expect(box.height, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
        await link.click();
        await expect(page, name).toHaveURL(url);
        await expect(landed(page), name).toBeVisible();
      }
    });

    test('the language switch changes the hero and the header, and is remembered after a reload', async ({ page }) => {
      await page.goto('/');
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveText('Resumes for every job seeker. Resume drives for every campus.');
      await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'తెలుగు' }).click();
      await expect(h1).toContainText('ఉద్యోగం వెతికే ప్రతి ఒక్కరికీ రెజ్యూమ్');
      await expect(page.locator('section[aria-labelledby="hero-title"]')).toHaveAttribute('lang', 'te');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en'); // the rest of the page is still English
      await expect(page.getByRole('link', { name: 'నా రెజ్యూమ్ తయారు చేయండి — ఉచితం' }).first()).toBeVisible();
      await expect(page.locator('link[data-lang-font="te"]')).toHaveCount(1); // Noto Sans Telugu, only now
      await page.reload();
      await expect(h1).toContainText('ఉద్యోగం');
      await page.getByRole('group', { name: 'భాష' }).getByRole('button', { name: 'हिन्दी' }).click();
      await expect(h1).toContainText('हर नौकरी ढूँढने वाले के लिए रिज़्यूमे');
      await expect(page.getByRole('heading', { name: 'जहाँ हैं, वहीं से शुरू करें' })).toBeVisible();
      await page.reload();
      await expect(h1).toContainText('रिज़्यूमे');
      await page.getByRole('group', { name: 'भाषा' }).getByRole('button', { name: 'English' }).click();
      await expect(h1).toHaveText('Resumes for every job seeker. Resume drives for every campus.');
    });

    test('nothing shifts while the page loads; the hero image is preloaded and sized; no builder code on the page', async ({ page }) => {
      const scripts = [];
      page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
      await page.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
      await expect(page.locator('link[rel="preload"][as="image"]')).toHaveAttribute('href', '/home/hero-btech.webp');
      const img = page.locator('.hx-sample img');
      await expect(img).toHaveAttribute('width', '340');
      await expect(img).toHaveAttribute('height', '481');
      expect(scripts.filter((s) => /Builder|ResumePreview|resumePdf|pdf|Scan/.test(s))).toEqual([]);
      // the skip link works
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to content' });
      await expect(skip).toBeFocused();
    });
  });
}

test('the organization plans table on the home page comes from the API', async ({ page, request }) => {
  const api = await (await request.get(`${API}/api/public/org-plans`)).json();
  await page.goto('/#org-plans');
  const table = page.getByRole('region', { name: 'Start free. Upgrade for your drive.' }).getByRole('table');
  await expect(table).toBeVisible();
  for (const p of api.plans) await expect(table).toContainText(p.name);
  await expect(table).toContainText('₹4,999');
  await expect(page.getByText('Loading plans…')).toHaveCount(0);
});

test('taps are counted on our own server, without cookies, and show on the admin dashboard', async ({ page }) => {
  await page.goto('/');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/public/events') && r.method() === 'POST');
  await page.getByRole('main').getByRole('link', { name: /^I have papers/ }).click();
  const req = await sent;
  expect(req.postDataJSON()).toEqual({ name: 'start_papers' });
  expect(req.headers().cookie).toBeUndefined();

  const admin = email('nm7admin');
  const { secret } = seed('admin', admin, 'owner', PASSWORD);
  await adminLogin(page, admin, secret);
  const card = page.getByRole('region', { name: 'Home page taps' });
  await expect(card).toContainText('Start from · I have papers');
});
