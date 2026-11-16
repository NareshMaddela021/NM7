// Razorpay payments, customer side, on a desktop and a 390 px phone, against the real API (the test API has no
// Razorpay keys, so payments are Off; "on" is mocked for the page and Razorpay's window is stood in):
//   Off:       Coming soon on checkout and the LinkedIn pack, no Pay button, no WhatsApp anywhere; the old WhatsApp
//              order endpoints answer 410
//   Checkout:  the optional "Need a GST invoice for your company?" section checks the GSTIN in the page and shows the
//              server's message inline; a closed Razorpay window says "Payment not completed — no money was taken."
//              with Try again, which reuses the same order; paying opens the order (the signed webhook confirms it)
//   My orders: an unpaid order shows Pay now; /me/orders?pay=<id> (the reminder email's link) starts it once;
//              once paid, the invoice downloads
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';
import { webhook } from './orgBilling.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}, [API, path, init]);
const NOT_PAID = 'Payment not completed — no money was taken.';

async function signIn(page, who, name) {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
/** Payments on for this page (Razorpay mode), whatever the test API says. */
const paymentsOn = (page) => page.route(`${API}/api/public/payment-mode`, (r) => r.fulfill({ json: { mode: 'razorpay', replyHours: '' } }));
/** Razorpay's window, stood in: counts how often it opened; the person closes it. */
async function closingRazorpay(page) {
  await page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__opened=0;window.Razorpay=function(o){this.open=function(){window.__opened+=1;setTimeout(function(){o.modal.ondismiss()},50)}}' }));
}
/** From now on the stand-in "pays"; the server learns it from Razorpay's signed webhook. */
async function payingRazorpay(page, request, order) {
  await page.evaluate(() => { window.Razorpay = function (o) { this.open = () => { window.__opened += 1; setTimeout(() => o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_E2E', razorpay_signature: 'sig' }), 50); }; }; });
  await page.route('**/api/payments/verify', async (r) => {
    expect((await webhook(request, order.razorpayOrderId, order.amount, `pay_C${order.orderId.replace('-', '')}`)).ok()).toBe(true);
    return r.fulfill({ status: 200, json: { id: order.orderId, status: 'offer', invoiceNo: null, paymentMethod: 'upi', paymentId: 'pay_C' } });
  });
}
/** A GSTIN with the right check character (the GSTN mod-36 rule). */
function gstin(first14) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let total = 0;
  for (let i = 0; i < 14; i += 1) { const v = chars.indexOf(first14[i]) * (i % 2 ? 2 : 1); total += Math.floor(v / 36) + (v % 36); }
  return first14 + chars[(36 - (total % 36)) % 36];
}
const noSideways = async (page, opts) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Off: Coming soon, no Pay button, no WhatsApp; the old WhatsApp order endpoints are gone', async ({ page }) => {
      await signIn(page, `pay-off-${label}`, 'Ravi Kumar');
      await page.goto('/checkout');
      const form = page.getByRole('form', { name: 'Payment' });
      await expect(form.getByTestId('checkout-soon')).toContainText('Coming soon');
      await expect(form.getByRole('button', { name: 'Coming soon' })).toBeDisabled();
      await expect(form.getByRole('button', { name: /Pay ₹/ })).toHaveCount(0);
      await expect(form.getByTestId('checkout-gst')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('WhatsApp');
      await noSideways(page, opts);
      await page.goto('/linkedin?path=fix');
      await expect(page.getByTestId('li-pack-soon')).toBeVisible();
      await expect(page.getByTestId('li-pack-buy')).toHaveCount(0);
      for (const path of ['/api/orders/whatsapp']) {
        const r = await call(page, path, { method: 'POST', body: JSON.stringify({ planId: 'linkedin_pack' }) });
        expect(r.status).toBe(410);
        expect(r.body.error.code).toBe('whatsapp_payments_retired');
      }
      expect((await call(page, '/api/public/payment-mode')).body.mode).toBe('off');
      // the refund policy: Razorpay only
      await page.goto('/refund-policy');
      await expect(page.locator('main')).toContainText('original payment method');
      await expect(page.locator('main')).not.toContainText('WhatsApp');
    });

    test('Checkout: GST details checked, a closed window takes no money, Try again reuses the order, paying opens it', async ({ page, request }) => {
      const mail = await signIn(page, `pay-co-${label}`, 'Sita Rao');
      await paymentsOn(page);
      await closingRazorpay(page);
      const order = seed('customer-order', mail, 'expert');
      const sent = [];
      let created = 0;
      await page.route('**/api/orders', (r) => {
        if (r.request().method() !== 'POST') return r.fallback();
        const body = r.request().postDataJSON();
        sent.push(body);
        if (body.billing) return r.fulfill({ status: 400, json: { error: { code: 'bad_gstin', message: 'This GSTIN is registered in Telangana, but the state chosen is Karnataka.' } } });
        created += 1;
        return r.fulfill({ status: 201, json: order });
      });
      await page.goto('/checkout');
      const form = page.getByRole('form', { name: 'Payment' });
      const pay = form.getByRole('button', { name: /^Pay ₹/ });
      await expect(pay).toBeEnabled();
      await expect(form).not.toContainText('WhatsApp');

      // the GST section: collapsed, checked in the page, then the server's message inline
      const gst = form.getByTestId('checkout-gst');
      await gst.getByText('Need a GST invoice for your company?').click();
      await gst.getByLabel('Company name').fill('Rao Traders');
      await gst.getByLabel('GSTIN').fill('12345');
      await expect(gst.getByRole('alert')).toContainText('A GSTIN has 15 characters');
      await pay.click();
      expect(sent).toHaveLength(0); // nothing sent with a GSTIN that can't be right
      await gst.getByLabel('GSTIN').fill(gstin('36AABCR1234Q1Z'));
      await expect(gst.getByLabel('State')).toHaveValue('36'); // from the GSTIN
      await expect(gst.getByRole('alert')).toHaveCount(0);
      await pay.click();
      await expect(gst.getByRole('alert')).toContainText('This GSTIN is registered in Telangana');
      expect(sent[0].billing).toMatchObject({ companyName: 'Rao Traders', stateCode: '36' });
      await expect(form.getByTestId('pay-retry')).toHaveCount(0);
      await noSideways(page, opts);

      // no GST invoice after all: Razorpay opens; the person closes it
      await gst.getByLabel('Company name').fill('');
      await gst.getByLabel('GSTIN').fill('');
      await pay.click();
      const retry = form.getByTestId('pay-retry');
      await expect(retry).toContainText(NOT_PAID);
      await expect(pay).toBeEnabled();
      expect(created).toBe(1);
      await retry.getByRole('button', { name: 'Try again' }).click();
      await expect(retry).toContainText(NOT_PAID);
      expect(created).toBe(1); // the same order again, not a second one
      expect(await page.evaluate(() => window.__opened)).toBe(2);

      // it goes through: the order page
      await payingRazorpay(page, request, order);
      await retry.getByRole('button', { name: 'Try again' }).click();
      await page.waitForURL(new RegExp(`/me/orders/${order.orderId}$`));
      expect(created).toBe(1);
      await expect(page.getByText('Payment received. You’re in good hands.')).toBeVisible({ timeout: 15_000 });
      const o = (await call(page, `/api/orders/${order.orderId}`)).body;
      expect(o.paidAt).not.toBeNull();
    });

    test('My orders: Pay now on an unpaid order; ?pay= starts it once; the invoice downloads once paid', async ({ page, request }) => {
      const mail = await signIn(page, `pay-mine-${label}`, 'Kiran Rao');
      await paymentsOn(page);
      await closingRazorpay(page);
      const order = seed('customer-order', mail, 'linkedin_pack');
      let asked = 0;
      await page.route(`**/api/orders/${order.orderId}/pay`, (r) => { asked += 1; return r.fulfill({ status: 200, json: order }); });

      // the reminder email's link: the payment starts once, and the link is tidied away
      await page.goto(`/me/orders?pay=${order.orderId}`);
      await expect(page.getByTestId('pay-retry')).toContainText(NOT_PAID);
      expect(asked).toBe(1);
      await expect(page).not.toHaveURL(/pay=/);
      const row = page.getByRole('listitem').filter({ hasText: order.orderId });
      await expect(row).toContainText('Waiting for payment');
      await expect(row.getByTestId('pay-now')).toHaveText(/Pay now · ₹149/);
      await noSideways(page, opts);
      await page.reload();
      await expect(row.getByTestId('pay-now')).toBeVisible();
      expect(asked).toBe(1); // not again without the link

      // the order page has Pay now too; paying confirms it
      await row.getByRole('link').first().click();
      await expect(page.getByTestId('order-unpaid')).toContainText('Nothing has been charged yet');
      await payingRazorpay(page, request, order);
      await page.getByTestId('order-unpaid').getByTestId('pay-now').click();
      await expect(page.getByRole('region', { name: 'Invoices' })).toBeVisible({ timeout: 15_000 });
      expect(asked).toBe(2);
      const dl = page.waitForEvent('download');
      await page.getByRole('region', { name: 'Invoices' }).getByRole('button', { name: /^Download invoice/ }).click();
      expect((await dl).suggestedFilename()).toMatch(/^Invoice_.*\.pdf$/);
      await page.goto('/me/orders');
      await expect(page.getByRole('listitem').filter({ hasText: order.orderId }).getByTestId('pay-now')).toHaveCount(0);
    });
  });
}
