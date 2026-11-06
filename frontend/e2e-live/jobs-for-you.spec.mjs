// "Jobs for you" on My dashboard (J6) on a desktop and a 390 px phone: without a resume it asks for one; with a resume
// it shows the top matches with their scores and plain reasons, one big button to all jobs by best match, and the
// Saved jobs and My applications shortcuts with real counts. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const DESC = 'Build reports and dashboards for our operations team. Freshers who know SQL are welcome.';
const RESUME = { personal: { name: 'Sai Varsha', email: 'sai@example.com', location: 'Vizag' }, skillGroups: [{ id: 'c', label: 'Core', value: 'SQL, Looker' }], edu: [{ institution: 'Lakeview Institute', degree: 'B.Tech' }] };
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('asks for a resume, then top matches, the big button and the shortcuts', async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${label}y${Date.now().toString(36)}`;
      // a perfect fit only this person's resume will rank first (Looker + Vizag are unusual)
      const best = seed('job', JSON.stringify({ title: `Looker Analyst ${tag}`, company: { name: `Wave ${tag}` }, locations: ['Vizag'], skills: ['SQL', 'Looker'], experience: 'fresher', description: DESC, applyMethod: 'link', applyUrl: `https://wave.example/${tag}` }));
      const me = email('jfy');
      seed('customer', me, 'Sai Varsha', PASSWORD);
      await login(page, me);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/me');
      const card = page.getByTestId('jobs-for-you');
      await expect(card).toContainText('Add your resume to see your match on every job.');

      expect((await call(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: 'r1', name: 'Main', data: RESUME, active: true }) })).status).toBe(201);
      await call(page, `/api/me/saved-jobs/${best.id}`, { method: 'PUT' });
      await page.reload();
      await expect(card.getByTestId('jfy-job').first()).toContainText(`Looker Analyst ${tag}`);
      await expect(card.getByTestId('jfy-job').first()).toContainText('100% match');
      await expect(card.getByTestId('jfy-job').first()).toContainText('Matches 2 of 2 skills · Fresher OK · In Vizag');
      expect(await card.getByTestId('jfy-job').count()).toBeLessThanOrEqual(3);
      await expect(card.getByTestId('jfy-saved')).toHaveText('Saved jobs (1)');
      await expect(card.getByTestId('jfy-apps')).toHaveText('My applications (0)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      await card.getByTestId('jfy-cta').click();
      await expect(page).toHaveURL(/\/jobs\?sort=match/);
      await expect(page.getByLabel('Sort')).toHaveValue('match');
      await page.goto('/me');
      await card.getByTestId('jfy-saved').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Saved jobs' })).toBeVisible();
    });
  });
}
