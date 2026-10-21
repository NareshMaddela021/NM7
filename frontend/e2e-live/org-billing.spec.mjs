// Phase 4 (Nm7 for Organizations, billing) against the real API: an Owner starts free from /for-orgs, fills billing
// details, buys Drive, and the plan turns on only when Razorpay's signed webhook arrives — then kiosks unlock.
// The browser tests run without Razorpay keys (no secrets in CI), so the Razorpay order is seeded on the server and
// Razorpay's own window is replaced by a stand-in that "pays"; the webhook is a real signed request to the API.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, pdfText, seed } from './helpers.mjs';

const WEBHOOK_SECRET = 'e2e-webhook-secret'; // e2e-live/api.sh

async function webhook(request, razorpayOrderId, amount, paymentId) {
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

export async function buyDrive(page, request, owner, orgId) {
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
  const order = seed('org-order', orgId, 'drive', owner);
  await page.route('**/billing/checkout', (r) => r.fulfill({ status: 201, json: order }));
  await fakeRazorpay(page);
  await drive.getByRole('button', { name: 'Pay ₹4,999' }).click();
  await expect(page.getByText('waiting for Razorpay to confirm it')).toBeVisible();
  // the browser's "paid" does nothing on its own: still Free
  const before = await (await request.get(`${API}/api/public/org-plans`)).json();
  expect(before.plans.length).toBeGreaterThan(0);
  await expect(page.getByText('Free plan', { exact: true })).toBeVisible();
  // Razorpay's signed webhook turns the plan on; the page notices by itself
  expect((await webhook(request, order.razorpayOrderId, order.amount, 'pay_E2E')).ok()).toBe(true);
  await expect(page.getByText('Drive plan', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  return order;
}

test('an Owner starts free, buys Drive, and the plan turns on only from the verified webhook — kiosks unlock', async ({ page, request }) => {
  const owner = email('owner');
  const orgId = await startFreeOrg(page, owner);
  await expect(page.getByText(/Owner · Free plan/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kiosks' })).toHaveCount(0);
  await buyDrive(page, request, owner, orgId);
  await page.reload();
  await expect(page.getByText(/Owner · Drive plan/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kiosks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Branding' })).toBeVisible();
  // a forged webhook (wrong secret) is refused
  const forged = await request.post(`${API}/api/payments/webhook`, { data: '{}', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'bad' } });
  expect(forged.status()).toBe(400);
  // the invoice (GST off until a supplier GSTIN is set: a plain "Invoice") downloads as a PDF
  await page.getByRole('link', { name: 'Billing' }).click();
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await expect(invoices).toContainText(/NM7\/\d{2}-\d{2}\/\d{4}/);
  const [file] = await Promise.all([page.waitForEvent('download'), invoices.getByRole('button', { name: /^Download NM7/ }).click()]);
  expect(file.suggestedFilename()).toMatch(/^NM7-\d{2}-\d{2}-\d{4}\.pdf$/);
  const pdf = readFileSync(await file.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((await pdfText(pdf)).join(' ')).toContain('Rupees Four Thousand Nine Hundred Ninety Nine Only');
});

test('the Free plan pauses a second group with an upgrade message, and nothing is deleted', async ({ page }) => {
  const owner = email('owner');
  const orgId = await startFreeOrg(page, owner, 'Skill Hub Guntur');
  await page.goto(`/org/${orgId}`);
  const add = async (name, code) => {
    await page.getByRole('button', { name: 'New group' }).click();
    await page.getByLabel('Group name').fill(name);
    await page.getByLabel('Join code').fill(code);
    await page.getByRole('button', { name: 'Save group' }).click();
  };
  await add('Welders 2026', 'WELDGNT1');
  await expect(page.getByTestId('join-code')).toHaveText(['WELDGNT1']);
  await add('Fitters 2026', 'FITGNT1');
  await expect(page.getByText(/ask your Owner to upgrade/i)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('join-code')).toHaveText(['WELDGNT1']); // nothing deleted, nothing added
  await expect(page.getByText(/groups are all used/)).toBeVisible(); // the banner
});

test('admin: plans editor saves a new version, billing settings list what to fill before going live', async ({ page }) => {
  const admin = email('nm7admin');
  const { secret } = seed('admin', admin, 'owner', PASSWORD);
  await adminLogin(page, admin, secret);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/plans');
  await expect(page).toHaveTitle(/Organization plans/);
  const drive = page.getByRole('form', { name: 'Drive plan' });
  await expect(drive).toContainText('version 1');
  await drive.getByLabel('Price (₹, before GST)').fill('5499');
  await drive.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('form', { name: 'Drive plan' })).toContainText('version 2');
  await page.goto('/admin/billing-settings');
  await expect(page.getByText('Before going live, fill in')).toContainText('GSTIN');
  await expect(page.getByLabel('Legal name')).toHaveValue('AsuraaX AI Private Limited');
  await page.goto('/for-orgs');
  await expect(page.getByRole('table')).toContainText('₹5,499');
});
