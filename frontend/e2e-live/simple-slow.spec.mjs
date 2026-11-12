// Re-test 12 Nov N6, on a desktop and a 390 px phone, against the real API: the site starts waking the API the moment
// it opens (GET /health); an easy-dashboard screen keeps showing its last data while a slow server answers; and while
// a sleeping server wakes up, the simple screens say so in plain words instead of only "Loading…".
import { expect, test } from '@playwright/test';
import { SIZES } from './college.mjs';
import { studentWith } from './autoapply.mjs';

const RESUME = { personal: { name: 'Asha Rao' }, edu: [{ institution: 'JNTU', degree: 'B.Tech', field: 'CSE', from: '', to: '2025', grade: '' }], skillGroups: [{ id: 'core', label: 'Skills', value: 'Excel' }], proj: [{ title: 'Canteen dashboard', description: 'Built a dashboard', tech: 'Excel' }], exp: [] };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('wake on open, last data kept, waking note', async ({ page }) => {
      test.setTimeout(120_000);
      const woke = page.waitForRequest((r) => /\/health$/.test(r.url()));
      await studentWith(page, label, RESUME, 'slow');
      await woke; // the first page load already called the API's /health
      await page.goto('/me/simple/myresume');
      await expect(page.getByTestId('sx-mr-projects')).toContainText('Canteen dashboard');

      // the server is slow now (every API call waits 6 s): the screen shows the last resume at once, not "Loading…"
      await page.route('http://localhost:8001/api/**', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
      await page.reload();
      await expect(page.getByTestId('sx-mr-projects')).toContainText('Canteen dashboard', { timeout: 3000 });

      // back in this tab after the server fell asleep, on a screen with nothing kept yet: the simple screen itself says
      // the server is waking up, in plain words, and the note goes once it answers
      await page.route('http://localhost:8001/health', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
      await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('nm7-simple')).forEach((k) => sessionStorage.removeItem(k)));
      await page.goto('/me/simple/jobs');
      await expect(page.getByTestId('sx-waking')).toContainText('The server is waking up', { timeout: 5000 });
      await expect(page.getByTestId('sx-waking')).toBeHidden({ timeout: 30_000 });
      // a new tab (never signed in here): the site-wide notice covers the wait
      const tab = await page.context().newPage();
      await tab.route('http://localhost:8001/**', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
      await tab.goto('/me/simple/jobs');
      await expect(tab.getByTestId('server-waking')).toBeVisible({ timeout: 5000 });
      await tab.close();
    });
  });
}
