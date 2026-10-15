// Download gating against the real API (which runs with payments off, like the live site today):
// guests are asked to create a free account, their draft moves into the account and the download starts by itself;
// signed-in accounts download free while payments are off; with payments on (mocked) unpaid accounts see the
// "Unlock downloads" pop-up and no file is made, and paying unlocks the download they clicked.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, login, seed } from './helpers.mjs';

const api = (page, path) => page.evaluate(async ([base, p]) => (await fetch(`${base}${p}`, { credentials: 'include' })).json(), [API, path]);
const preview = (page) => page.getByRole('article', { name: 'Resume preview' });

async function openEditor(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(preview(page)).toBeVisible();
}
/** Counts files the browser saves. */
function downloads(page) {
  const files = [];
  page.on('download', (d) => files.push(d));
  return files;
}
async function expectFile(page, click, ext) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click()]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
  const head = (await import('node:fs')).readFileSync(await file.path()).subarray(0, 4).toString('latin1');
  expect(head).toBe(ext === '.pdf' ? '%PDF' : 'PK\u0003\u0004');
  return file;
}
const guestModal = (page) => page.getByRole('dialog', { name: 'Create a free account to download your resume' });

test('guest: every download button opens "Create a free account" and no file is made; building stays open', async ({ page }) => {
  const files = downloads(page);
  await page.goto('/builder');
  await expect(page.getByText('Free to build. Account needed to download.')).toBeVisible();
  await openEditor(page);
  const exports = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/me/exports')) exports.push(r); });
  for (const name of ['Download PDF', 'Word']) {
    await page.getByRole('button', { name, exact: true }).first().click();
    const dlg = guestModal(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Your resume is saved — nothing is lost.');
    await expect(dlg.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'I already have an account - Sign in' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dlg).toHaveCount(0);
  }
  // cover letter downloads too
  await page.getByRole('tab', { name: 'Cover letter' }).click();
  await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
  await expect(guestModal(page)).toBeVisible();
  await page.keyboard.press('Escape');
  expect(exports.length).toBe(3); // each one asked the server, which said "sign in" (401)
  expect(files).toHaveLength(0);
  // the free scan and the templates stay open to guests
  await page.goto('/');
  await expect(page.getByText('Try it now · no sign-up')).toBeVisible();
});

test('guest → Create account (email code) → the draft becomes their resume and the PDF downloads by itself', async ({ page }) => {
  await openEditor(page);
  await page.getByLabel('Full name').first().fill('Guna Shekar');
  await expect(preview(page)).toContainText('Guna Shekar');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
  await guestModal(page).getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/signup?next=%2Fbuilder');
  const mail = email('gate-new');
  await page.getByLabel('Full name').fill('Guna Shekar');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Mobile (WhatsApp)').fill('98765 43210');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Re-type password').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(lastCode(mail));
  const file = await expectFile(page, () => page.getByRole('button', { name: 'Confirm & continue' }).click(), '.pdf');
  expect(file.suggestedFilename()).toBe('Guna_Shekar_Resume.pdf');
  await expect(page).toHaveURL(/\/builder$/);
  await expect(preview(page)).toContainText('Guna Shekar');
  const rs = await api(page, '/api/me/resumes');
  expect(rs).toHaveLength(1);
  expect(rs[0].data.personal.name).toBe('Guna Shekar');
  expect(await page.evaluate(() => localStorage.getItem('asuraa-builder-draft-v6'))).toBeNull(); // moved, once
});

test('guest → Sign in to an account with resumes → a new resume (never overwritten) and the Word file downloads', async ({ page }) => {
  const mail = email('gate-old');
  seed('customer', mail, 'Old Timer', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  const [first] = await api(page, '/api/me/resumes');
  await page.getByRole('button', { name: 'Old' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/me'));

  await openEditor(page);
  await page.getByLabel('Full name').first().fill('Tara Guest');
  await expect(preview(page)).toContainText('Tara Guest');
  await page.getByRole('button', { name: 'Word', exact: true }).first().click();
  await guestModal(page).getByRole('button', { name: 'I already have an account - Sign in' }).click();
  await page.waitForURL('**/login?next=%2Fbuilder');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  const file = await expectFile(page, () => page.getByRole('button', { name: 'Sign in' }).click(), '.docx');
  expect(file.suggestedFilename()).toBe('Tara_Guest_Resume.docx');
  await expect(preview(page)).toContainText('Tara Guest');
  const rs = await api(page, '/api/me/resumes');
  expect(rs).toHaveLength(2);
  const old = rs.find((r) => r.id === first.id);
  expect(old.name).toBe(first.name);
  expect(old.data).toEqual(first.data); // untouched
  const added = rs.find((r) => r.id !== first.id);
  expect(added.name).toMatch(/^Tara Guest · from this browser · /);
  expect(added.active).toBe(true);
});

test('payments off: signed-in accounts download free from the builder and every dashboard button', async ({ page }) => {
  const mail = email('gate-free');
  seed('customer', mail, 'Free Load', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  expect(await api(page, '/api/me/entitlements')).toMatchObject({ canDownload: true, reason: 'payments_off', paymentsOn: false });
  await expect(page.getByText(/Unlock downloads|Rs 99/)).toHaveCount(0);
  await expectFile(page, () => page.getByRole('button', { name: 'PDF', exact: true }).first().click(), '.pdf'); // /me
  await page.goto('/me/resumes');
  await expectFile(page, () => page.getByRole('button', { name: 'Word', exact: true }).first().click(), '.docx');
  await openEditor(page);
  await expectFile(page, () => page.getByRole('button', { name: 'Download PDF', exact: true }).first().click(), '.pdf');
  await expect(page.getByText(/Unlock downloads/)).toHaveCount(0);
});

test('payments on (mocked): unpaid sees "Unlock downloads - Rs 99", no file; paying unlocks and the download starts', async ({ page }) => {
  const mail = email('gate-pay');
  seed('customer', mail, 'Pay Once', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  let paid = false;
  const orders = [];
  await page.route('**/api/me/entitlements', (r) => r.fulfill({ json: { canDownload: paid, reason: paid ? 'paid' : 'unpaid', paymentsOn: true, planId: 'diy', price: 99 } }));
  await page.route('**/api/me/exports', (r) => (paid
    ? r.fulfill({ json: { canDownload: true, reason: 'paid', paymentsOn: true, planId: 'diy', price: 99 } })
    : r.fulfill({ status: 402, json: { error: { code: 'payment_required', message: 'Unlock downloads - Rs 99 one-time.', planId: 'diy', price: 99 } } })));
  await page.route('**/api/orders', (r) => { if (r.request().method() !== 'POST') return r.fallback(); orders.push(r.request().postDataJSON()); return r.fulfill({ status: 201, json: { orderId: 'RS-9001', razorpayOrderId: 'order_X', amount: 9900, currency: 'INR', keyId: 'rzp_test', description: 'Fix it yourself', prefill: {} } }); });
  await page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Razorpay=function(o){this.open=function(){setTimeout(function(){o.handler({razorpay_order_id:"order_X",razorpay_payment_id:"pay_X",razorpay_signature:"sig"})},50)}}' }));
  await page.route('**/api/payments/verify', (r) => { paid = true; return r.fulfill({ json: { id: 'RS-9001', paymentMethod: 'upi', invoiceNo: 'NM7/26-27/0001', paymentId: 'pay_X' } }); });

  const files = downloads(page);
  // dashboard buttons follow the same rule
  await page.goto('/me/resumes');
  await page.getByRole('button', { name: 'PDF', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Unlock downloads - Rs 99 one-time' });
  await expect(dlg).toBeVisible();
  for (const t of ['PDF & Word downloads', 'All templates', 'AI line fixes']) await expect(dlg).toContainText(t);
  await dlg.getByRole('button', { name: 'Not now' }).click();

  await openEditor(page);
  await page.getByRole('button', { name: 'Word', exact: true }).first().click();
  await expect(dlg).toBeVisible();
  expect(files).toHaveLength(0);
  const file = await expectFile(page, () => dlg.getByRole('button', { name: 'Pay Rs 99' }).click(), '.docx');
  expect(file.suggestedFilename()).toBe('Pay_Once_Resume.docx');
  expect(orders).toEqual([{ planId: 'diy', role: null, addons: [] }]);
  await expect(page.getByText('Downloads unlocked for your account')).toBeVisible();
  // unlocked for good: the next download needs nothing
  await expectFile(page, () => page.getByRole('button', { name: 'Download PDF', exact: true }).first().click(), '.pdf');
});
