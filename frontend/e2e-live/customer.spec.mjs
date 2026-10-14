// Customer dashboard against the real API: own data only, saved on the server, cleared from the browser on sign-out.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, emailsTo, lastCode, login, seed } from './helpers.mjs';

const personalKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => (k.startsWith('asuraa-') || k.startsWith('nm7-')) && k !== 'asuraa-theme'));

test('sign up once (double click), confirm with a code, resend countdown', async ({ page }) => {
  const mail = email('new');
  const signups = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/auth/signup') && r.method() === 'POST') signups.push(r); });
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Asha Rao');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Mobile (WhatsApp)').fill('98765 43210');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Re-type password').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  expect(signups).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Send the code again in \d+ s/ })).toBeDisabled();
  await page.getByLabel('6-digit code').fill(lastCode(mail));
  await page.getByRole('button', { name: 'Confirm & continue' }).click();
  await page.waitForURL('**/me');
  await expect(page.getByText('Signed in as')).toContainText('Asha Rao');
  await expect(page.getByText('Sai Varsha')).toHaveCount(0); // no sample person
});

test('login: email checked on the page; autofilled values are read on submit', async ({ page }) => {
  const mail = email('auto');
  seed('customer', mail, 'Auto Fill', PASSWORD);
  await page.goto('/login');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter a valid email address, like name@example.com')).toBeVisible();
  // Chrome autofill sets values without React change events
  await page.evaluate(([m, p]) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(document.getElementById('li-e'), m); set.call(document.getElementById('li-p'), p);
  }, [mail, PASSWORD]);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/me');
});

test('dashboard data is saved on the server and only shown to its owner', async ({ page }) => {
  const a = email('a'); const b = email('b');
  seed('customer', a, 'Asha Rao', PASSWORD);
  seed('customer', b, 'Bala K', PASSWORD);
  const order = seed('paid-order', a, 'expert').id;

  await login(page, a);
  await page.waitForURL('**/me');
  // orders come from /api/orders
  await page.goto('/me/orders');
  await expect(page.getByText(`${order} · Expert rewrite`)).toBeVisible();
  // a job application, saved and still there after a reload
  await page.goto('/me/jobs');
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Company').fill('Zoho');
  await page.getByLabel('Role', { exact: false }).first().fill('Data Analyst');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Zoho').first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByText('Zoho').first()).toBeVisible();
  const apps = await page.evaluate(async (api) => (await fetch(`${api}/api/me/state`, { credentials: 'include' })).json(), API);
  expect(apps.apps.map((x) => x.company)).toEqual(['Zoho']);
  expect(await personalKeys(page)).toEqual(['asuraa-last-user']); // nothing personal in localStorage

  // profile: saved via the API, email can't be edited here
  await page.goto('/me/settings');
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Target role').fill('Data Analyst');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Target role')).toHaveValue('Data Analyst');

  // Raise an issue → stored on the server and emailed to info@nm7.si
  await page.goto('/me/help');
  await page.getByLabel('What happened?').fill('I was charged twice for my order.');
  await page.getByRole('button', { name: 'Send to support' }).click();
  await expect(page.getByText(/Sent — our team replies/)).toBeVisible();
  await expect(page.getByText('I was charged twice for my order.')).toBeVisible();
  expect(emailsTo('info@nm7.si').some((m) => m.includes('I was charged twice'))).toBe(true);

  // sign out: everything personal is gone from the browser
  await page.goto('/me');
  await page.getByRole('button', { name: 'Asha' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/me'));
  expect(await personalKeys(page)).toEqual([]);

  // the other customer, in the same browser, sees none of it
  await login(page, b);
  await page.waitForURL('**/me');
  await page.goto('/me/orders');
  await expect(page.getByText('No orders yet')).toBeVisible();
  await page.goto('/me/jobs');
  await expect(page.getByText('Zoho')).toHaveCount(0);
  await page.goto('/me/help');
  await expect(page.getByText('I was charged twice')).toHaveCount(0);
  const cross = await page.evaluate(async ([api, id]) => (await fetch(`${api}/api/orders/${id}`, { credentials: 'include' })).status, [API, order]);
  expect(cross).toBe(404);
});

test('share link: public page from the server, phone hidden, views counted', async ({ page, browser }) => {
  const a = email('share');
  seed('customer', a, 'Meena Iyer', PASSWORD);
  await login(page, a);
  await page.waitForURL('**/me');
  // the first visit makes the first resume on the server
  await expect.poll(() => page.evaluate(async (api) => (await (await fetch(`${api}/api/me/resumes`, { credentials: 'include' })).json()).length, API)).toBe(1);
  // put a phone number on the resume (through the API, as the builder would)
  await page.evaluate(async (api) => {
    const s = await (await fetch(`${api}/api/me/state`, { credentials: 'include' })).json();
    const r = s.resumes[0];
    await fetch(`${api}/api/me/resumes/${r.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { ...r.data, personal: { ...r.data.personal, name: 'Meena Iyer', phone: '+91 99999 88888' } } }) });
  }, API);
  await page.goto('/me/share');
  await page.getByRole('switch').check();
  await expect(page.getByText('Link turned on')).toBeVisible();
  await page.getByLabel('Hide my phone number on the link').check();
  const slug = (await page.getByLabel('Link name').inputValue());
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/r/${slug}`);
  await expect(v.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await expect(v.getByRole('heading', { name: 'Meena Iyer' })).toBeVisible();
  await expect(v.getByText('99999 88888')).toHaveCount(0);
  await visitor.close();
  await page.reload();
  await expect(page.getByText(/1 in total/)).toBeVisible();
  await page.getByRole('switch').uncheck();
  await expect(page.getByText('Link turned off')).toBeVisible();
  const again = await browser.newContext();
  const w = await again.newPage();
  await w.goto(`/r/${slug}`);
  await expect(w.getByText('This resume link is turned off')).toBeVisible();
  await again.close();
});

test('change password signs out other browsers', async ({ page, browser }) => {
  const a = email('pw');
  seed('customer', a, 'Ravi P', PASSWORD);
  const other = await browser.newContext();
  const o = await other.newPage();
  await login(o, a);
  await o.waitForURL('**/me');
  await login(page, a);
  await page.waitForURL('**/me');
  await page.goto('/me/settings');
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('Another-pass-456');
  await page.getByLabel('Re-type new password').fill('Another-pass-456');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed — other devices are signed out')).toBeVisible();
  const status = await o.evaluate(async (api) => (await fetch(`${api}/api/auth/me`, { credentials: 'include' })).status, API);
  expect(status).toBe(401);
  await other.close();
});
