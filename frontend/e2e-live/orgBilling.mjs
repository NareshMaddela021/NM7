// Shared steps for the organization billing browser tests (Phase 4): start free, buy Drive with Razorpay stood in,
// and Razorpay's signed webhook.
import { createHmac } from 'node:crypto';
import { expect } from '@playwright/test';
import { API, PASSWORD, login, seed } from './helpers.mjs';

const WEBHOOK_SECRET = 'e2e-webhook-secret'; // e2e-live/api.sh

export async function webhook(request, razorpayOrderId, amount, paymentId) {
  const body = JSON.stringify({ entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id: paymentId, entity: 'payment', order_id: razorpayOrderId, amount, currency: 'INR', method: 'upi', status: 'captured' } } } });
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return request.post(`${API}/api/payments/webhook`, { data: body, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': `evt_${paymentId}` } });
}

/** Razorpay's checkout window, stood in: "pays" at once and hands the ids to the page's handler. */
async function fakeRazorpay(page) {
  await page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Razorpay=function(o){this.open=function(){setTimeout(function(){o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:"pay_E2E",razorpay_signature:"sig"})},50)}}' }));
}

export async function startFreeOrg(page, owner, name = 'Sri Venkateswara College') {
  seed('customer', owner, 'Priya Owner', PASSWORD);
  await login(page, owner);
  await page.waitForURL(/\/me/);
  await page.goto('/for-orgs?start=1');
  await expect(page).toHaveTitle(/Nm7 for Organizations/);
  await expect(page.getByRole('table')).toContainText('Drive');
  await expect(page.getByRole('table')).toContainText('₹4,999');
  await page.getByLabel('Organization name').fill(name);
  await page.getByLabel('City').fill('Tirupati');
  await page.getByRole('button', { name: 'Create my organization' }).click();
  await page.waitForURL(/\/org\/[^/]+$/);
  return page.url().split('/org/')[1];
}

export async function buyDrive(page, request, owner, orgId, ref = null) {
  // Razorpay mode for this page (the test API has no Razorpay keys, so its payment mode is Off)
  await page.route(`${API}/api/org/${orgId}/billing`, async (r) => {
    const res = await r.fetch();
    await r.fulfill({ response: res, json: { ...(await res.json()), paymentMode: 'razorpay' } });
  });
  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
  await page.getByLabel('Legal name').fill('Sri Venkateswara College Trust');
  await page.getByLabel('Address (with PIN code)').fill('1 College Road, Tirupati 517502');
  await page.getByLabel('State').selectOption('37');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Billing details saved')).toBeVisible();

  const drive = page.getByRole('region', { name: 'Buy Drive' });
  await drive.getByRole('button', { name: 'Upgrade' }).click();
  await expect(drive).toContainText('Total');
  await expect(drive).toContainText('₹4,999');
  // the server's Razorpay order (seeded: no Razorpay keys in the test environment)
  if (ref) await expect(drive).toContainText(`Referred by partner ${ref}`); // the partner link's cookie, read by the server
  const order = seed('org-order', orgId, 'drive', owner, ...(ref ? [ref] : []));
  await page.route('**/billing/checkout', (r) => r.fulfill({ status: 201, json: order }));
  await fakeRazorpay(page);
  await drive.getByRole('button', { name: 'Pay ₹4,999' }).click();
  await expect(page.getByText('waiting for Razorpay to confirm it')).toBeVisible();
  // the browser's "paid" does nothing on its own: still Free
  const before = await (await request.get(`${API}/api/public/org-plans`)).json();
  expect(before.plans.length).toBeGreaterThan(0);
  await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
  // Razorpay's signed webhook turns the plan on; the page notices by itself
  expect((await webhook(request, order.razorpayOrderId, order.amount, `pay_E2E${order.orderId.replace('-', '')}`)).ok()).toBe(true);
  await expect(page.getByText('Drive plan', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  return order;
}

