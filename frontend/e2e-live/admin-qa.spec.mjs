// Admin QA: every tab on every admin page, both directions, with no console errors; page titles; search
// failures; the audit log filter and details; settings validation; no "Expert view" link for admins.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, seed } from './helpers.mjs';

const PAGES = [
  ['Dashboard', '/admin'], ['Orders', '/admin/orders'], ['Experts', '/admin/experts'], ['Refunds & disputes', '/admin/refunds'],
  ['Payments & invoices', '/admin/payments'], ['Customers & support', '/admin/customers'], ['Quality', '/admin/quality'],
  ['Reports', '/admin/reports'], ['Settings & prices', '/admin/settings'], ['Automation', '/admin/automation'], ['Team & audit log', '/admin/team'],
];

async function signIn(page) {
  const owner = email('owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const cust = email('cust');
  seed('customer', cust, 'Kiran Rao', PASSWORD);
  seed('paid-order', cust, 'expert'); // a payment and an invoice to list
  await adminLogin(page, owner, secret);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); // signed in before going anywhere
}

test('every admin page and every tab, both directions: no crash, no console errors, own tab titles', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  await signIn(page);
  await expect(page.getByRole('link', { name: 'Expert view' })).toHaveCount(0); // an admin isn't an expert

  for (const [name, path] of PAGES) {
    await page.goto(path);
    const main = page.locator('main#main');
    await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page).toHaveTitle(`${name} · Admin · Nm7`);
    for (const list of await main.getByRole('tablist').all()) {
      const tabs = await list.getByRole('tab').all();
      const order = [...tabs.keys(), ...[...tabs.keys()].reverse()];
      for (const i of order) {
        await tabs[i].click();
        await expect(tabs[i]).toHaveAttribute('aria-selected', 'true');
        await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible(); // the console never blanks
        await expect(main.getByText('This part of the page couldn’t be shown.')).toHaveCount(0);
      }
    }
  }
  // Payments ⇄ Invoices quickly, the exact report
  await page.goto('/admin/payments?tab=invoices');
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('tab', { name: 'Payments' }).click();
    await page.getByRole('tab', { name: 'Invoices' }).click();
  }
  await expect(page.getByRole('tab', { name: 'Invoices' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/invoice\(s\)\. Prices include GST|No invoices yet/)).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('search failures, audit log filter and details, settings validation', async ({ page }) => {
  await signIn(page);

  // a search the hosting edge refuses (simulated: 503, no CORS) says so plainly
  await page.route(/\/api\/admin\/orders\?.*q=/, (r) => r.fulfill({ status: 503, body: 'blocked' }));
  await page.goto('/admin/orders');
  await page.getByLabel('Search orders').fill('OR 1=1');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Search couldn’t run — try different words.')).toBeVisible();
  await expect(page.getByText(/Check your internet/)).toHaveCount(0);
  await page.unroute(/\/api\/admin\/orders\?.*q=/);

  // settings: a bad value is explained under the field; the server still checks
  await page.goto('/admin/settings');
  const price = page.getByLabel('Expert rewrite price in rupees');
  await expect(price).toHaveAttribute('inputmode', 'numeric');
  await price.fill('');
  await expect(page.getByText('Enter a whole number of rupees')).toBeVisible();
  await price.fill('0');
  await expect(page.getByText('Price must be ₹1–₹1,00,000')).toBeVisible();
  await page.getByLabel('Delivery hours').fill('500');
  await expect(page.getByText('Delivery must be 24–168 hours')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await price.fill('899');
  await page.getByLabel('Delivery hours').fill('72');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved — new orders use these prices')).toBeVisible();
  const r = await page.evaluate(async () => {
    const base = 'http://localhost:8001';
    const res = await fetch(`${base}/api/admin/settings`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryHours: 500 }) });
    return res.status;
  });
  expect(r).toBe(422);

  // audit log: readable details, debounced filter, a clear "no match" with Clear
  await page.goto('/admin/team');
  await expect(page.getByRole('cell', { name: /via: authenticator app · trusted device: no/ }).first()).toBeVisible();
  expect(await page.locator('section[aria-label="Audit log"]').innerText()).not.toMatch(/\{"/);
  let calls = 0;
  page.on('request', (q) => { if (q.url().includes('/api/admin/audit-log?') && q.url().includes('action=')) calls += 1; });
  await page.getByLabel('Action').pressSequentially('no.such.action', { delay: 30 });
  await expect(page.getByText('No entries match “no.such.action”.')).toBeVisible();
  expect(calls).toBeLessThanOrEqual(2); // not one request per key
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Action')).toHaveValue('');
  await expect(page.getByRole('cell', { name: 'settings.changed', exact: true })).toBeVisible();
});
