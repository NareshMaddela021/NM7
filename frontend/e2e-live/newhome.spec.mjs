// The new home page on test (/new-home), against the real API, on a desktop and a 390 px phone: the four tabs change
// the headline, the main button and the address bar (also with the arrow keys); the job seekers' widget shows the
// real numbers from the jobs API and the newest real job; without WebGL, or with "reduce motion", the still picture
// shows instead of the 3D dots; the page is not indexed, carries its structured data, and has no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

const TABS = [
  ['company', 'I’m a company', 'Hire any role in 30 minutes', 'Post a job free', '/for-companies'],
  ['college', 'I’m a college', 'Place every student, track every step', 'Partner with Nm7', '/for-orgs'],
  ['seeker', 'I’m a job seeker', 'Get hired fast, at any experience level', 'Find a job', '/jobs'],
  ['student', 'I’m a student', 'From classroom to your first job', 'Start free', '/signup'],
];

/** Turns WebGL off in the page, the way a browser without it behaves. */
const noWebgl = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(kind, ...rest) {
    return /webgl/i.test(kind) ? null : orig.call(this, kind, ...rest);
  };
};

for (const [label, opts] of SIZES) {
  test.describe(`new home · ${label}`, () => {
    test.use(opts);

    test('the four tabs change the headline, the button and the address bar', async ({ page }) => {
      await page.goto('/new-home');
      await expect(page.getByRole('heading', { level: 1, name: 'Blinkit for hiring.' })).toBeVisible();
      const tabs = page.getByRole('tablist', { name: 'Who are you?' }).getByRole('tab');
      await expect(tabs).toHaveText(TABS.map((t) => t[1]));
      // job seeker by default
      await expect(page.getByRole('tab', { name: 'I’m a job seeker' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('nh-headline')).toHaveText('Get hired fast, at any experience level');
      for (const [key, tab, headline, button, to] of TABS) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page).toHaveURL(new RegExp(`[?&]for=${key}$`));
        await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('nh-headline')).toHaveText(headline);
        const cta = page.getByTestId('nh-cta');
        await expect(cta).toHaveText(button);
        await expect(cta).toHaveAttribute('href', to);
        await expect(page.getByTestId('nh-widget')).toHaveAttribute('data-audience', key);
        const box = await page.getByRole('tab', { name: tab }).boundingBox();
        expect(box.height, `${tab} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
      }
      // the keyboard: arrows move between the tabs and pick them
      await page.getByRole('tab', { name: 'I’m a student' }).focus();
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByRole('tab', { name: 'I’m a job seeker' })).toBeFocused();
      await expect(page).toHaveURL(/for=seeker$/);
      await page.keyboard.press('Home');
      await expect(page).toHaveURL(/for=company$/);
      // the choice survives a reload (it is in the address)
      await page.reload();
      await expect(page.getByTestId('nh-headline')).toHaveText('Hire any role in 30 minutes');
      // the main button goes where it says
      await page.goto('/new-home?for=seeker');
      await page.getByTestId('nh-cta').click();
      await expect(page).toHaveURL(/\/jobs$/);
    });

    test('the widget and the live jobs show real numbers from the API; the search box goes to /jobs', async ({ page, request }) => {
      const tag = `nh${label}${Date.now().toString(36)}`;
      seed('job', JSON.stringify({ title: `Field Engineer ${tag}`, description: 'Install and service machines across the city.', company: { name: `Volt ${tag}`, website: 'https://volt.example' },
        applyMethod: 'link', applyUrl: `https://volt.example/jobs/${tag}`, locations: ['Hyderabad'], experience: 'fresher', skills: ['Wiring'] }));
      const all = await (await request.get(`${API}/api/jobs`)).json();
      const today = await (await request.get(`${API}/api/jobs?posted=24h`)).json();
      expect(all.total).toBeGreaterThan(0);

      await page.goto('/new-home');
      const text = page.getByTestId('nh-widget-text');
      await expect(text).toContainText(`${all.total.toLocaleString('en-IN')} job`);
      await expect(text).toContainText(`${today.total.toLocaleString('en-IN')} new today`);
      await expect(text).toContainText(`top city ${all.cities[0]}`);
      await expect(page.getByTestId('nh-widget-big')).toHaveText(all.total.toLocaleString('en-IN'));

      // the newest real job is first in "Live jobs", and its details show on hover (desktop)
      const row = page.getByTestId('nh-live-row').first();
      await row.scrollIntoViewIfNeeded();
      await expect(row).toContainText(`Field Engineer ${tag}`);
      await expect(row).toContainText(`Volt ${tag}`);
      if (label === 'desktop') {
        await row.hover();
        await expect(page.getByTestId('nh-live-detail')).toContainText(`Field Engineer ${tag}`);
        await expect(page.getByTestId('nh-live-detail')).toContainText('Fresher');
      }
      // a chip filters the live list
      await page.getByRole('button', { name: 'Fresher', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Fresher', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('nh-live-row').first()).toContainText(`Field Engineer ${tag}`);

      // the search box under the tabs
      await page.getByTestId('nh-q').fill(`Field Engineer ${tag}`);
      await page.getByTestId('nh-city').fill('Hyderabad');
      await page.getByRole('button', { name: 'Search jobs' }).click();
      await expect(page).toHaveURL(new RegExp(`/jobs\\?q=Field\\+Engineer\\+${tag}&city=Hyderabad`));
      await expect(page.getByTestId('job-card')).toHaveCount(1);
    });

    test('without WebGL the still picture shows, and the page still works', async ({ page }) => {
      await page.addInitScript(noWebgl);
      await page.goto('/new-home?for=company');
      const stage = page.getByTestId('nh-stage');
      await expect(stage).toHaveAttribute('data-off', /no-webgl|low-power/);
      await expect(stage).toHaveAttribute('data-mode', 'still');
      await expect(stage.locator('svg.nh-still')).toHaveAttribute('data-shape', 'stopwatch');
      await expect(page.locator('canvas')).toHaveCount(0);
      await page.getByRole('tab', { name: 'I’m a student' }).click();
      await expect(stage.locator('svg.nh-still')).toHaveAttribute('data-shape', 'cap');
      await expect(page.getByTestId('nh-headline')).toHaveText('From classroom to your first job');
    });

    test('“reduce motion”: the still picture, the widget stays still, cards are shown', async ({ browser }) => {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto('/new-home?for=company');
      await expect(page.getByTestId('nh-stage')).toHaveAttribute('data-off', 'reduced-motion');
      await expect(page.getByTestId('nh-widget')).toHaveAttribute('data-phase', 'view');
      await page.waitForTimeout(5500); // longer than one widget look
      await expect(page.getByTestId('nh-widget')).toHaveAttribute('data-phase', 'view');
      await expect(page.getByRole('heading', { name: 'The 30-minute flow' })).toBeVisible();
      await ctx.close();
    });

    test('not indexed, structured data, phone layout without sideways scrolling', async ({ page }) => {
      await page.goto('/new-home');
      await expect(page).toHaveTitle(/Blinkit for hiring/);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      const types = await page.locator('script[type="application/ld+json"][id^="nh-ld-"]').evaluateAll((els) => els.map((e) => JSON.parse(e.textContent)['@type']));
      expect(types).toEqual(['Organization', 'WebSite', 'FAQPage']);
      // FAQ: a group per audience; footer keeps the legal links and job removal
      for (const g of ['Companies', 'Colleges', 'Job seekers', 'Students']) await expect(page.locator('.nh-faq-group h3', { hasText: g })).toHaveCount(1);
      const footer = page.getByRole('contentinfo');
      for (const name of ['Terms', 'Privacy', 'Contact', 'Request job removal']) await expect(footer.getByRole('link', { name, exact: true })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Request job removal' })).toHaveAttribute('href', '/contact?topic=job-removal');
      // scroll the whole page so every card slides in; nothing may be wider than the screen
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      if (label === 'phone') {
        const [a, b, c] = await Promise.all(['company', 'college', 'seeker'].map((k) => page.getByTestId(`nh-tab-${k}`).boundingBox()));
        expect(Math.abs(a.y - b.y), 'tabs: two in a row').toBeLessThan(2);
        expect(c.y, 'tabs: 2 × 2').toBeGreaterThan(a.y + 20);
      }
      // the live home page is unchanged
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Blinkit for hiring.' })).toHaveCount(0);
    });
  });
}
