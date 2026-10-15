// QA round 3, against the real API: builder start screen, thumbnails, job links, form errors, titles, footer,
// contact links, upgrade buttons, copy, the home demo and the sample data.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : { status: r.status, body: await r.json() };
}, [API, path, opts]);

async function signIn(page, who = 'Tara Menon') {
  const mail = email('qa3');
  seed('customer', mail, who, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}

test('builder start: continue the latest resume; new resumes are new and never share a name', async ({ page }) => {
  await signIn(page);
  await expect.poll(async () => (await api(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await api(page, '/api/me/resumes')).body;
  await api(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Tara main', data: { ...r.data, summary: 'Analyst with two years of retail dashboards.', exp: [{ company: 'Northwind', role: 'Analyst' }] } }) });
  await api(page, '/api/me/job-profile', { method: 'PUT', body: JSON.stringify({ data: { personal: { name: 'Tara Menon', headline: 'QA Data Analyst', email: '', phone: '', location: '' } }, version: 0 }) });

  await page.goto('/builder');
  const card = page.getByRole('region', { name: 'CONTINUE EDITING' });
  await expect(card).toContainText('Tara main');
  await expect(card).toContainText(/Edited \d+ (min|h|d) ago/);
  await expect(card.getByRole('link', { name: 'See all resumes' })).toHaveAttribute('href', '/me/resumes');
  await expect(page.getByRole('heading', { name: 'Or start a new resume' })).toBeVisible();
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#sum')).toHaveCount(0); // opens on the first section
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Northwind');

  // two resumes from the Job Profile on the same day get different names; the first resume is kept
  for (let i = 0; i < 2; i += 1) {
    await page.goto('/builder');
    await page.getByRole('button', { name: /Start from my Job Profile/ }).click();
    await expect(page.getByRole('button', { name: /^Use / })).toBeVisible();
  }
  await expect.poll(async () => (await api(page, '/api/me/resumes')).body.length).toBe(3);
  const names = (await api(page, '/api/me/resumes')).body.map((x) => x.name);
  expect(new Set(names).size).toBe(3);
  expect(names[0]).toBe('Tara main');
  expect(names[2]).toMatch(/QA Data Analyst · from Job Profile · .+ \(2\)$/);

  // Start from scratch makes a new resume too, instead of wiping the current one
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await expect.poll(async () => (await api(page, '/api/me/resumes')).body.length).toBe(4);
  expect((await api(page, '/api/me/resumes')).body[0].data.summary).toBe('Analyst with two years of retail dashboards.');
});

test('thumbnails: one label, no page-break text; job links are web links only; form errors are shown', async ({ page }) => {
  await signIn(page);
  await expect.poll(async () => (await api(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await api(page, '/api/me/resumes')).body;
  const long = Array.from({ length: 30 }, (_, i) => `Built dashboard number ${i} for the regional sales team, cutting the weekly reporting time for 12 managers from five hours to thirty minutes`).join('\n');
  await api(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...r.data, exp: [{ company: 'Northwind', role: 'Analyst', description: long }] } }) });

  for (const path of ['/me', '/me/resumes']) {
    await page.goto(path);
    const thumb = page.getByRole('img', { name: `Preview of ${r.name} resume` }).first();
    await expect(thumb).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/Page \d+ starts/);
    expect(await page.locator('main').textContent()).not.toMatch(/Page \d+ starts/);
    await expect(thumb.locator('a')).toHaveCount(0); // a picture: no links to tab into
  }
  // the builder still shows where pages break, as decoration only
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('dashboard number 29');
  await expect(page.locator('.page-break').first()).toBeAttached();
  expect(await page.locator('body').textContent()).not.toMatch(/Page \d+ starts/);

  // job links
  await page.goto('/me/jobs');
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Company *').fill('Zoho');
  await page.getByLabel('Role *').fill('Analyst');
  await page.getByLabel('Job link · optional').fill('javascript:alert(document.cookie)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Enter a web link like https://company.com/jobs/123')).toBeVisible();
  await page.getByLabel('Job link · optional').fill('careers.zoho.com/jobs/42');
  await page.getByRole('button', { name: 'Save' }).click();
  const link = page.getByRole('link', { name: /Job post/ });
  await expect(link).toHaveAttribute('href', 'https://careers.zoho.com/jobs/42');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const bad = await api(page, '/api/me/applications', { method: 'POST', body: JSON.stringify({ id: 'x9', company: 'Evil', url: 'javascript:alert(1)' }) });
  expect(bad.status).toBe(422);

  // settings: an empty name says so; the email field looks read-only
  await page.goto('/me/settings');
  await page.getByLabel('Full name').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter your name')).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCSS('cursor', 'not-allowed');

  // titles
  for (const [path, title] of [['/me/messages', 'Messages · Nm7'], ['/me/launch', 'Career Launch · Nm7'], ['/me/upgrade', 'Upgrade & add-ons · Nm7']]) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
  // upgrade: real buttons when there's no order
  await expect(page.getByRole('link', { name: 'Open the builder' })).toBeVisible();
  await page.getByRole('button', { name: /^Get Expert rewrite/ }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  // footer: signed in → My dashboard; "Become an expert" explains separate accounts
  await page.goto('/contact');
  const footer = page.locator('footer.site-footer');
  await expect(footer.getByRole('link', { name: 'My dashboard' })).toHaveAttribute('href', '/me');
  await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  for (const a of await page.getByRole('link', { name: 'info@nm7.si' }).all()) await expect(a).toHaveAttribute('href', 'mailto:info@nm7.si');
  expect(await page.getByRole('link', { name: 'info@nm7.si' }).count()).toBeGreaterThanOrEqual(3);
  await footer.getByRole('link', { name: 'Become an expert' }).click();
  await expect(page.getByRole('heading', { name: 'Expert accounts are separate' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out and create an expert account' }).click();
  await expect(page.getByRole('radio', { name: 'Work as an expert' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Full name')).toBeVisible();

  // forgot password: a bad email is explained, not just a dead button
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
});

test('home: improve demo only says IMPROVED when the score rises; samples have no placeholders or live links', async ({ page }) => {
  await page.goto('/');
  const box = page.locator('textarea#try');
  await box.fill('Built 6 Power BI dashboards for a 12-person sales team, cutting reporting from 5 hours to 30 minutes');
  await page.getByRole('button', { name: 'Improve this line' }).click();
  await expect(page.getByText(/Already strong — add the result/)).toBeVisible();
  await expect(page.getByText(/^IMPROVED/)).toHaveCount(0);
  await box.fill('made dashboards in power bi for sales team');
  await page.getByRole('button', { name: 'Improve this line' }).click();
  await expect(page.getByText(/^IMPROVED · \d+ → \d+\/100/)).toBeVisible();

  const text = await page.locator('main').textContent();
  expect(text).not.toMatch(/\[(Company|College)\]/);
  expect(await page.locator('main a[href*="github.com"]').count()).toBe(0);
  expect(await page.locator('main').innerHTML()).not.toMatch(/octocat/);
});
