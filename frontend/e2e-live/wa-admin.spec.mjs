// Pay via WhatsApp, admin side, on a desktop and a 390 px phone, against the real API:
//   Settings → Payments: the number is checked (+91), WhatsApp needs a number, the number never reaches the audit log
//   WhatsApp payments: a pending order shows up; Mark as paid needs a UTR, a reason when the amount differs; it unlocks
//                      for that customer only and emails a receipt (no GST invoice without business details);
//                      a UTR used before is refused; Cancel; Refund removes access; the report and the CSV
//   roles: only Owner and Finance see the page and can mark paid; Support can't
// Every test puts the payment mode back to Off (the other specs expect it).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, emailsTo, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: r.status, body };
}, [API, path, init]);
const post = (page, path, body) => call(page, path, { method: 'POST', body: JSON.stringify(body) });
const NUMBER = '+91 90000 12345';

async function admin(browser, role, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const mail = `${role}-wa-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, role, PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}
async function customer(browser, who, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return { ctx, page, mail };
}
const setMode = (page, mode) => call(page, '/api/admin/payment-settings', {
  method: 'PUT', body: JSON.stringify({ mode, whatsappNumber: NUMBER, replyHours: 'We reply 9 am - 9 pm', cancelAfterHours: 72 }),
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);
    let owner;
    test.afterEach(async () => {
      if (owner) { await setMode(owner.page, 'off'); await owner.ctx.close(); owner = null; }
    });

    test('Settings → Payments: number checked, WhatsApp needs a number, saved, number kept out of the audit log', async ({ browser }) => {
      owner = await admin(browser, 'owner', `set-${label}`);
      const page = owner.page;
      await page.goto('/admin/settings');
      const box = page.getByTestId('pay-settings');
      await expect(box.getByTestId('pay-active')).toHaveText('Off');
      await expect(box.getByTestId('pay-business')).toContainText('no GST invoice');
      await expect(box.getByRole('radio', { name: 'Razorpay' })).toBeDisabled(); // no keys on this server
      const number = box.getByLabel('WhatsApp number');
      await number.fill('');
      await box.getByRole('radio', { name: 'WhatsApp' }).click();
      await expect(box).toContainText('Add the WhatsApp number to use WhatsApp.');
      await expect(box.getByRole('button', { name: 'Save payments' })).toBeDisabled();
      await number.fill('12345');
      await expect(box).toContainText('Enter an Indian mobile number');
      await expect(box.getByRole('button', { name: 'Save payments' })).toBeDisabled();
      // the server checks it too
      const bad = await call(page, '/api/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ mode: 'whatsapp', whatsappNumber: '12345', replyHours: '', cancelAfterHours: 72 }) });
      expect(bad.status).toBe(400);
      await number.fill(NUMBER);
      await box.getByLabel('Reply hours').fill('We reply 9 am - 9 pm');
      await box.getByLabel('Cancel unpaid orders after').fill('48');
      await box.getByRole('button', { name: 'Save payments' }).click();
      await expect(page.getByText('Payment settings saved')).toBeVisible();
      await expect(box.getByTestId('pay-active')).toHaveText('WhatsApp');
      await expect(number).toHaveValue('+919000012345');
      const pub = await call(page, '/api/public/payment-mode');
      expect(pub.body).toEqual({ mode: 'whatsapp', replyHours: 'We reply 9 am - 9 pm' });
      const log = await call(page, '/api/admin/audit-log?action=settings.payments');
      expect(JSON.stringify(log.body[0])).not.toContain('9000012345');
      // back to Off in the page
      await box.getByRole('radio', { name: 'Off' }).click();
      await box.getByRole('button', { name: 'Save payments' }).click();
      await expect(box.getByTestId('pay-active')).toHaveText('Off');
      expect((await call(page, '/api/public/payment-mode')).body.mode).toBe('off');
    });

    test('WhatsApp payments: mark paid unlocks for that customer only, receipt emailed, duplicate UTR refused, cancel, refund, report', async ({ browser }) => {
      owner = await admin(browser, 'owner', `pay-${label}`);
      const page = owner.page;
      expect((await setMode(page, 'whatsapp')).status).toBe(200);
      const ravi = await customer(browser, `wa-ravi-${label}`, 'Ravi Kumar');
      const sita = await customer(browser, `wa-sita-${label}`, 'Sita Rao');
      const a = await post(ravi.page, '/api/orders/whatsapp', { planId: 'linkedin_pack' });
      const b = await post(sita.page, '/api/orders/whatsapp', { planId: 'linkedin_pack' });
      expect(a.status).toBe(201);
      const idA = a.body.orderId;
      const idB = b.body.orderId;
      expect((await call(ravi.page, '/api/me/linkedin/pack')).status).toBe(403); // nothing unlocks yet
      // a customer can't mark their own order paid
      const self = await post(ravi.page, `/api/admin/whatsapp/orders/${idA}/paid`, { method: 'upi', reference: 'UTR000111', amount: 14900, paidOn: new Date().toISOString().slice(0, 10) });
      expect([401, 403]).toContain(self.status);

      await page.goto('/admin/whatsapp-payments');
      const rowA = page.getByTestId('wa-row').filter({ hasText: idA });
      await expect(rowA).toContainText('Ravi Kumar');
      await expect(rowA).toContainText('LinkedIn pack');
      await expect(rowA).toContainText('₹149');
      await rowA.getByRole('button', { name: 'Mark as paid' }).click();
      const dlg = page.getByRole('dialog');
      const save = dlg.getByRole('button', { name: 'Save — mark paid' });
      await expect(save).toBeDisabled(); // a UTR is required
      const utr = `UTR${Date.now()}${label.length}`;
      await dlg.getByLabel('UTR or reference').fill(utr);
      await dlg.getByLabel('Amount received (₹)').fill('140');
      await expect(dlg).toContainText('The amount is different from the order total: say why.');
      await expect(save).toBeDisabled();
      // the server asks for the reason too
      const noReason = await post(page, `/api/admin/whatsapp/orders/${idA}/paid`, { method: 'upi', reference: utr, amount: 14000, paidOn: new Date().toISOString().slice(0, 10) });
      expect(noReason.body.error.code).toBe('reason_required');
      await dlg.getByLabel('Why is the amount different?').fill('Discount agreed in chat');
      await save.click();
      await expect(page.getByText(`${idA} marked paid — receipt emailed`)).toBeVisible();
      await expect(page.getByTestId('wa-row').filter({ hasText: idA })).toHaveCount(0); // left the waiting list

      // unlocked for Ravi only; the receipt is from Nm7, no GST invoice
      expect((await call(ravi.page, '/api/me/linkedin/pack')).status).toBe(200);
      expect((await call(sita.page, '/api/me/linkedin/pack')).status).toBe(403);
      const order = await call(ravi.page, `/api/orders/${idA}`);
      expect(order.body.status).not.toBe('awaiting_payment');
      expect(order.body.receiptNo).toMatch(/^NM7R\//);
      expect(order.body.invoiceNo ?? null).toBeNull();
      await expect.poll(() => emailsTo(ravi.mail).some((m) => m.includes(`Payment received for ${idA}`))).toBe(true);
      const mailText = emailsTo(ravi.mail).find((m) => m.includes(`Payment received for ${idA}`));
      expect(mailText).not.toMatch(/Private Limited|Pvt\.? Ltd|LLP/i);
      // paid twice: refused
      const twice = await post(page, `/api/admin/whatsapp/orders/${idA}/paid`, { method: 'upi', reference: `${utr}X`, amount: 14900, paidOn: new Date().toISOString().slice(0, 10) });
      expect(twice.body.error.code).toBe('already_paid');

      // the same UTR on Sita's order: refused
      const rowB = page.getByTestId('wa-row').filter({ hasText: idB });
      await rowB.getByRole('button', { name: 'Mark as paid' }).click();
      await dlg.getByLabel('UTR or reference').fill(utr.toLowerCase());
      await dlg.getByRole('button', { name: 'Save — mark paid' }).click();
      await expect(page.getByText(/already recorded on another payment/)).toBeVisible();
      await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();
      expect((await call(sita.page, '/api/me/linkedin/pack')).status).toBe(403);
      // cancel Sita's: a cancelled order can't be paid
      await rowB.getByRole('button', { name: 'Cancel' }).click();
      await dlg.getByRole('button', { name: 'Cancel order' }).click();
      await expect(page.getByText(`${idB} cancelled`)).toBeVisible();
      const late = await post(page, `/api/admin/whatsapp/orders/${idB}/paid`, { method: 'upi', reference: `${utr}Y`, amount: 14900, paidOn: new Date().toISOString().slice(0, 10) });
      expect(late.body.error.code).toBe('cancelled');
      await page.getByRole('tab', { name: 'Cancelled' }).click();
      await expect(page.getByTestId('wa-row').filter({ hasText: idB })).toContainText('Cancelled');

      // refund Ravi's: access removed
      await page.getByRole('tab', { name: 'Paid' }).click();
      const paidA = page.getByTestId('wa-row').filter({ hasText: idA });
      await expect(paidA).toContainText(utr);
      await paidA.getByRole('button', { name: 'Refund' }).click();
      await dlg.getByLabel('Refund UTR or reference').fill(`RF${utr}`);
      await dlg.getByRole('button', { name: 'Save refund' }).click();
      await expect(page.getByText(`${idA} refunded`)).toBeVisible();
      expect((await call(ravi.page, '/api/me/linkedin/pack')).status).toBe(403);

      // the audit log has each step
      for (const action of ['whatsapp.paid', 'whatsapp.cancelled', 'whatsapp.refunded']) {
        const log = await call(page, `/api/admin/audit-log?action=${action}`);
        expect(log.body.some((e) => [idA, idB].includes(e.data?.order_id ?? e.target))).toBe(true);
      }
      // report and CSV
      await page.goto('/admin/reports');
      const rep = page.getByTestId('wa-report');
      await expect(rep).toContainText('Money in · WhatsApp');
      await expect(rep).toContainText('cancelled');
      const csv = await call(page, '/api/admin/whatsapp/report.csv?days=30');
      expect(csv.status).toBe(200);
      expect(csv.body.split('\n')[0].toLowerCase()).toContain('utr');
      expect(csv.body).toContain(idA);
      expect(csv.body).toContain(utr);
      const dl = page.waitForEvent('download');
      await rep.getByRole('button', { name: 'Download payments CSV' }).click();
      expect((await dl).suggestedFilename()).toBe('nm7-payments-30d.csv');
      await ravi.ctx.close();
      await sita.ctx.close();
    });

    test('roles: Finance can mark paid; Support can’t see the page or mark paid', async ({ browser }) => {
      owner = await admin(browser, 'owner', `roles-${label}`);
      await setMode(owner.page, 'whatsapp');
      const c = await customer(browser, `wa-role-${label}`, 'Asha Devi');
      const { body } = await post(c.page, '/api/orders/whatsapp', { planId: 'linkedin_pack' });
      const support = await admin(browser, 'support', `roles-${label}`);
      await expect(support.page.getByRole('link', { name: /WhatsApp payments/ })).toHaveCount(0);
      const today = new Date().toISOString().slice(0, 10);
      const denied = await post(support.page, `/api/admin/whatsapp/orders/${body.orderId}/paid`, { method: 'upi', reference: `SUP${Date.now()}`, amount: 14900, paidOn: today });
      expect(denied.status).toBe(403);
      expect((await call(support.page, '/api/admin/whatsapp/orders')).status).toBe(403);
      await support.ctx.close();
      const finance = await admin(browser, 'finance', `roles-${label}`);
      await finance.page.goto('/admin/whatsapp-payments');
      const row = finance.page.getByTestId('wa-row').filter({ hasText: body.orderId });
      await row.getByRole('button', { name: 'Mark as paid' }).click();
      const dlg = finance.page.getByRole('dialog');
      await dlg.getByLabel('Method').selectOption('bank');
      await dlg.getByLabel('UTR or reference').fill(`FIN${Date.now()}${label.length}`);
      await dlg.getByRole('button', { name: 'Save — mark paid' }).click();
      await expect(finance.page.getByText(`${body.orderId} marked paid — receipt emailed`)).toBeVisible();
      expect((await call(c.page, '/api/me/linkedin/pack')).status).toBe(200);
      await finance.ctx.close();
      await c.ctx.close();
    });
  });
}
