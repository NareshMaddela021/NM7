// Phase 4 (Nm7 for Organizations, billing) against the real API: an Owner starts free from /for-orgs, fills billing
// details, buys Drive, and the plan turns on only when Razorpay's signed webhook arrives — then kiosks unlock.
// The browser tests run without Razorpay keys (no secrets in CI), so the Razorpay order is seeded on the server and
// Razorpay's own window is replaced by a stand-in that "pays"; the webhook is a real signed request to the API.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, pdfText, seed } from './helpers.mjs';
import { buyDrive, startFreeOrg } from './orgBilling.mjs';

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
  // back to the default, so the other tests in this run see Drive at ₹4,999
  await page.goto('/admin/plans');
  await page.getByRole('form', { name: 'Drive plan' }).getByLabel('Price (₹, before GST)').fill('4999');
  await page.getByRole('form', { name: 'Drive plan' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('form', { name: 'Drive plan' })).toContainText('version 3');
});
