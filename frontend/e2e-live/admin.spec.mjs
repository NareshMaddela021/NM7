// Admin console and expert portal against the real API: real numbers and empty states, actions saved and logged.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, emailsTo, login, seed } from './helpers.mjs';

test('admin console shows real data (no samples), and every action is saved and logged', async ({ page, browser }) => {
  const owner = email('owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const cust = email('cust');
  seed('customer', cust, 'Kiran Rao', PASSWORD);
  const order = seed('paid-order', cust, 'expert').id;
  const ex = email('expert');
  const expertId = seed('expert', ex, 'Ravi Kumar', PASSWORD, 'review').id;

  await adminLogin(page, owner, secret);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(/sample data/i)).toHaveCount(0);
  await expect(page.getByText('₹70,026')).toHaveCount(0);
  await expect(page.getByText('Paid orders')).toBeVisible();
  // clear labels: verified customers (all time) vs sign-ups in the period
  await expect(page.getByText('Verified customers')).toBeVisible();
  await expect(page.getByText(/sign-up\(s\) in this period/)).toBeVisible();
  await expect(page.getByText(/paid order\(s\) without an expert/)).toBeVisible();

  // refunds: real empty state
  await page.getByRole('link', { name: 'Refunds & disputes' }).click();
  await expect(page.getByText('No refund requests waiting.')).toBeVisible();

  // approve the expert application
  await page.getByRole('link', { name: 'Experts' }).click();
  await page.getByRole('button', { name: 'Ravi Kumar' }).click();
  await page.getByRole('button', { name: 'Approve without test' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  expect(emailsTo(ex).some((m) => m.includes('approved'))).toBe(true);

  // offer the paid order to the expert
  await page.getByRole('link', { name: 'Orders' }).click();
  await page.getByRole('button', { name: order }).click();
  await page.getByLabel('Offer to an expert').selectOption(expertId);
  await page.getByRole('button', { name: 'Offer order' }).click();
  await expect(page.getByText('Offered to the expert')).toBeVisible();

  // change a price; the public price list follows
  await page.getByRole('link', { name: 'Settings & prices' }).click();
  await page.getByLabel('Expert rewrite price in rupees').fill('899');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved — new orders use these prices')).toBeVisible();
  const prices = await page.evaluate(async (api) => (await fetch(`${api}/api/public/prices`)).json(), API);
  expect(prices.plans.expert.price).toBe(899);

  // customer ticket → reply from the console → customer sees it
  const c = await browser.newContext();
  const cp = await c.newPage();
  await login(cp, cust);
  await cp.waitForURL('**/me');
  await cp.goto('/me/help');
  await cp.getByLabel('What happened?').fill('Where is my expert? I paid yesterday.');
  await cp.getByRole('button', { name: 'Send to support' }).click();
  await expect(cp.getByText(/Sent — our team replies/)).toBeVisible();
  await page.getByRole('link', { name: 'Customers & support' }).click();
  await page.getByRole('tab', { name: 'Support tickets' }).click();
  await page.getByLabel('Reply (emailed to the customer)').fill('Your expert Ravi has the order now.');
  await page.getByRole('button', { name: 'Send reply & resolve' }).click();
  await expect(page.getByText('Reply emailed — ticket resolved')).toBeVisible();
  expect(emailsTo(cust).some((m) => m.includes('Your expert Ravi has the order now.'))).toBe(true);
  await cp.reload();
  await expect(cp.getByText('Your expert Ravi has the order now.')).toBeVisible();
  await c.close();

  // audit log lists what we did
  await page.getByRole('link', { name: 'Team & audit log' }).click();
  for (const action of ['expert.approve', 'order.assigned', 'settings.changed', 'ticket.replied']) {
    await expect(page.getByRole('cell', { name: action, exact: true })).toBeVisible();
  }

  // the expert sees the offered order in their portal and accepts it
  const e = await browser.newContext();
  const ep = await e.newPage();
  await login(ep, ex);
  await ep.waitForURL('**/expert');
  await ep.goto('/expert/orders');
  await expect(ep.getByText(order).first()).toBeVisible();
  await e.close();
});

test('roles only see their sections; the setup page is closed once an admin exists', async ({ page }) => {
  const fin = email('fin');
  const { secret } = seed('admin', fin, 'finance', PASSWORD);
  await adminLogin(page, fin, secret);
  await expect(page.getByRole('link', { name: 'Payments & invoices' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings & prices' })).toHaveCount(0);
  await page.goto('/admin/settings');
  await expect(page.getByText('No access')).toBeVisible();
  await page.goto('/admin/setup');
  await expect(page.getByText('Admin setup is closed.')).toBeVisible();
  await expect(page.getByLabel('Setup token')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('footer').getByRole('link', { name: 'Admin' })).toHaveCount(0);
});
