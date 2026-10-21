// Data safety on a cold start and across deploys:
//  - the builder opened before the sign-in answer arrives must load the saved resume, never send a guest draft over it;
//  - a page whose file is from an older build shows "Nm7 was just updated" instead of a spinner or a blank page;
//  - a guest draft found on a shared phone is offered, not added to the account silently;
//  - the header's "Saved" note reflects the server, and a save that fails shows it.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : r.json();
}, [API, path, opts]);

const RESUME = {
  personal: { name: 'Meera Nair', headline: 'Data Analyst', email: 'meera@example.com', phone: '', location: 'Kochi', level: 'Junior (1–3 yrs)' },
  summary: 'Analyst who builds dashboards people use every week.',
  exp: [{ company: 'Acme Corp', role: 'Analyst', from: '2023-01', to: '', description: '• Built 12 dashboards' }],
  edu: [], proj: [], certs: [], ach: [], langs: [], skillGroups: [],
};

async function signInWithResume(page, who = 'Meera Nair') {
  const mail = email('safety');
  seed('customer', mail, who, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  const [r] = await api(page, '/api/me/resumes');
  await api(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME }) });
  return { mail, resumeId: r.id };
}

test('cold start: /builder opened while /api/auth/me is slow loads the saved resume and never overwrites it', async ({ page }) => {
  const { resumeId } = await signInWithResume(page);
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  // the API "wakes up": the next sign-in answer is held for 6 s (longer than the builder's own autosave delay)
  let held = 0;
  await page.route('**/api/auth/me', async (route) => {
    if (held === 0) { held += 1; await new Promise((r) => setTimeout(r, 6_000)); }
    return route.continue();
  });
  await page.reload();
  // meanwhile the page shows the sample, says it is loading and sends nothing
  await expect(page.getByTestId('save-status')).toHaveText(/Loading your resume|Saved in this browser/);
  await page.waitForTimeout(2_500);
  const before = await api(page, `/api/me/resumes/${resumeId}`);
  expect(before.data.summary).toBe(RESUME.summary);
  // the answer arrives: the saved resume replaces the sample
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Acme Corp', { timeout: 15_000 });
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  const after = await api(page, `/api/me/resumes/${resumeId}`);
  expect(after.data.summary).toBe(RESUME.summary);
  expect(after.data.personal.name).toBe('Meera Nair');
  // an edit now saves on top of the right copy
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await page.getByLabel('Your summary').fill('Edited after the cold start.');
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  await expect.poll(async () => (await api(page, `/api/me/resumes/${resumeId}`)).data.summary).toBe('Edited after the cold start.');
});

test('a 502 from /api/auth/me during a cold start does not sign the person out or bounce them to /login', async ({ page }) => {
  await signInWithResume(page);
  let n = 0;
  await page.route('**/api/auth/me', (route) => {
    n += 1;
    if (n === 1) return route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad Gateway' });
    return route.continue();
  });
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: /Hi|Welcome|resume/i }).first()).toBeVisible({ timeout: 20_000 });
  expect(page.url()).not.toMatch(/\/login/);
  expect(n).toBeGreaterThanOrEqual(2); // asked again instead of giving up
});

test('a page file from an older build shows "Nm7 was just updated" with a Reload button, never a blank page', async ({ page }) => {
  // the Builder chunk is gone after a deploy: Vercel answers the SPA shell (text/html) instead of JavaScript
  // (a built site serves it as /assets/Builder-<hash>.js; the dev server this suite runs on as /src/pages/Builder.jsx)
  await page.route(/(\/assets\/Builder-[\w-]+\.js|\/src\/pages\/Builder\.jsx)(\?.*)?$/, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><html><body>not here</body></html>' }));
  await page.addInitScript(() => { sessionStorage.setItem('nm7-chunk-reload', String(Date.now())); }); // a reload already happened: no loop
  await page.goto('/builder');
  await expect(page.getByRole('alert')).toContainText('Nm7 was just updated', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload now' })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});

test('a guest draft with another person’s name is offered to the account, not added silently', async ({ page }) => {
  // someone built a resume on this phone as a guest
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByTestId('tp-use-top').click();
  await page.getByLabel('Full name').fill('Ravi Kumar');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await page.getByLabel('Your summary').fill('Ravi’s draft from a shared phone.');
  await page.waitForTimeout(500);
  // now Meera signs in on the same phone
  const mail = email('shared');
  seed('customer', mail, 'Meera Nair', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/builder');
  const ask = page.getByTestId('guest-draft-ask');
  await expect(ask).toContainText('for “Ravi Kumar”', { timeout: 15_000 });
  const resumes = await api(page, '/api/me/resumes');
  expect(resumes).toHaveLength(1);
  expect(resumes[0].data.personal?.name || '').not.toBe('Ravi Kumar'); // nothing added yet
  await ask.getByRole('button', { name: 'No, forget it' }).click();
  await expect(ask).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k === 'asuraa-builder-draft-v6'))).toBe(false);
});

test('"Saving…" then "All changes saved" follows the real request; a failing save says so', async ({ page }) => {
  await signInWithResume(page);
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Acme Corp');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  // the API refuses saves: the note must not claim they are saved
  await page.route('**/api/me/resumes/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'down', message: 'down' } }) }) : route.continue()));
  await page.getByLabel('Your summary').fill('Will this be saved?');
  await expect(page.getByTestId('save-status')).toHaveText('Saving…');
  await expect(page.getByTestId('save-status')).toHaveText('Not saved yet — retrying', { timeout: 15_000 });
  await page.unroute('**/api/me/resumes/*');
  await page.getByLabel('Your summary').fill('Will this be saved? Yes.');
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
});
