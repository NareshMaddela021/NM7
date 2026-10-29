// Phase 4C against the real API: someone applies on /partners, Nm7 approves them with a code, an organization arrives
// through the partner link, pays (Razorpay's signed webhook), and the partner sees the organization (name and plan
// only) and a pending commission on their page.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { buyDrive, startFreeOrg } from './orgBilling.mjs';

test('partner link → organization pays → commission pending on the partner page', async ({ browser, request }) => {
  const partnerEmail = email('ravi');
  // 1. apply
  const visitor = await browser.newPage();
  await visitor.goto('/partners');
  await expect(visitor).toHaveTitle(/partner programme/);
  const form = visitor.getByRole('form', { name: 'Partner application' });
  await form.getByLabel('Your name').fill('Ravi Kumar');
  await form.getByLabel('Organisation (optional)').fill('Ravi Placements');
  await form.getByLabel('Email').fill(partnerEmail);
  await form.getByLabel('Phone').fill('+91 98765 43210');
  await form.getByRole('button', { name: 'Apply to be a partner' }).click();
  await expect(visitor.getByText('we’ve got your application')).toBeVisible();
  await visitor.close();

  // 2. Nm7 approves with the suggested code
  const nm7 = await browser.newPage();
  const admin = email('nm7admin');
  const { secret } = seed('admin', admin, 'owner', PASSWORD);
  await adminLogin(nm7, admin, secret);
  await expect(nm7.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await nm7.goto('/admin/partners');
  await expect(nm7).toHaveTitle(/Partners/);
  await nm7.getByRole('row', { name: new RegExp(partnerEmail) }).getByRole('button', { name: 'Review' }).click();
  const card = nm7.getByRole('region', { name: 'Partner Ravi Kumar' });
  const code = await card.getByLabel('Code').inputValue();
  expect(code).toMatch(/^ASX-RAVI\d*$/);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toContainText(`/for-orgs?ref=${code}`);

  // 3. an organization comes through the link, starts free and buys Drive
  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await owner.goto(`/for-orgs?ref=${code.toLowerCase()}`);
  await expect(owner.getByRole('status').filter({ hasText: 'Referred by partner code' })).toContainText(code);
  const ownerEmail = email('owner');
  const orgId = await startFreeOrg(owner, ownerEmail, 'Krishna Degree College');
  await buyDrive(owner, request, ownerEmail, orgId, code);
  await ctx.close();

  // 4. the partner signs in with the same email: their page shows the organization and the pending commission
  seed('customer', partnerEmail, 'Ravi Kumar', PASSWORD);
  const partner = await browser.newPage();
  await login(partner, partnerEmail);
  await partner.waitForURL(/\/me/);
  await partner.goto('/partner');
  await expect(partner).toHaveTitle(/partner page/i);
  await expect(partner.getByTestId('partner-code')).toHaveText(code);
  const orgs = partner.getByRole('region', { name: 'Referred organizations' });
  await expect(orgs).toContainText('Krishna Degree College');
  await expect(orgs).toContainText('Drive');
  const ledger = partner.getByRole('region', { name: 'Commission entries' });
  await expect(ledger).toContainText('₹999.80'); // 20% of ₹4,999 (GST off)
  await expect(ledger).toContainText('Pending');
  await expect(partner.getByRole('region', { name: 'Commission', exact: true })).toContainText('₹999.80');
  // never the organization's members or their data
  await expect(partner.locator('main')).not.toContainText(ownerEmail);
  expect((await partner.request.get(`http://localhost:8001/api/org/${orgId}/shared-resumes`)).status()).toBeGreaterThanOrEqual(403);
});
