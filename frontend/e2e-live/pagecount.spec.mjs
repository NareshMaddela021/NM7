// While a saved resume (and its fonts) load, the builder shows no page count and no page breaks — never a
// wrong "2 pages" for a 1-page resume. Also: the tab title of the "Expert accounts are separate" note.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : r.json();
}, [API, path, opts]);

// a resume that fills most of one page
const bullets = Array.from({ length: 7 }, (_, i) => `Built report ${i + 1} for the regional sales team, cutting weekly reporting time for 12 managers from five hours to thirty minutes`).join('\n');

test('page counter: never "2 pages" while a 1-page resume and its fonts load; no break markers meanwhile', async ({ page }) => {
  const mail = email('pages');
  seed('customer', mail, 'Isha Kapoor', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  const [r] = await api(page, '/api/me/resumes');
  await api(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Isha one page', data: {
    ...r.data, summary: 'Analyst who builds dashboards that sales managers use every week.',
    exp: [{ company: 'Northwind Retail', role: 'Data Analyst', from: '2023-01', current: true, description: bullets }],
    edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Computer Science', from: '2019-08', to: '2023-05' }],
    design: { preset: 'impact', font: 'open-sans', accent: '#9A4508', headingStyle: 'bar', bodySize: 9.5 },
  } }) });

  // record every value the counter shows, and whether a page break was ever drawn
  await page.addInitScript(() => {
    window.__counts = []; window.__breaks = 0;
    new MutationObserver(() => {
      const c = document.querySelector('[data-testid="page-count"]');
      if (c && c.textContent !== window.__counts[window.__counts.length - 1]) window.__counts.push(c.textContent);
      if (document.querySelector('.page-break')) window.__breaks += 1;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  // slow the saved resume and the template fonts down, so the in-between state lasts
  await page.route('**/api/me/state', async (route) => { await new Promise((res) => { setTimeout(res, 1200); }); await route.continue(); });
  await page.route('https://fonts.googleapis.com/**', async (route) => { await new Promise((res) => { setTimeout(res, 1500); }); await route.continue().catch(() => route.abort()); });

  await page.goto('/builder');
  await page.getByRole('region', { name: 'CONTINUE EDITING' }).getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('page-count')).toHaveText('1 page ✓', { timeout: 15_000 });
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Northwind Retail');
  await page.waitForTimeout(800);
  const counts = await page.evaluate(() => window.__counts);
  expect(counts.some((t) => /\d+ pages/.test(t)), `counter showed: ${counts.join(' → ')}`).toBe(false);
  expect(counts[counts.length - 1]).toBe('1 page ✓');
  expect(await page.evaluate(() => window.__breaks)).toBe(0);

  // a reload straight into the builder: same
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByTestId('page-count')).toHaveText('1 page ✓', { timeout: 15_000 });
  const again = await page.evaluate(() => window.__counts);
  expect(again[0]).toBe('Measuring…');
  expect(again.some((t) => /\d+ pages/.test(t)), `counter showed: ${again.join(' → ')}`).toBe(false);
});

test('"Become an expert" while signed in as a customer: the tab says so', async ({ page }) => {
  const mail = email('title');
  seed('customer', mail, 'Isha Kapoor', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/signup?as=expert');
  await expect(page.getByRole('heading', { name: 'Expert accounts are separate' })).toBeVisible();
  await expect(page).toHaveTitle('Expert accounts are separate · Nm7');
  await page.getByRole('button', { name: 'Sign out and create an expert account' }).click();
  await expect(page.getByLabel('Full name')).toBeVisible();
  await expect(page).toHaveTitle('Create your account · Nm7');
});
