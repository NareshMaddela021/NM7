// Pay via WhatsApp, customer side, on a desktop and a 390 px phone, against the real API:
//   Off:       no buy button (Coming soon) on checkout and the LinkedIn pack; the server refuses a WhatsApp order
//   WhatsApp:  "Buy on WhatsApp" makes a pending order and opens wa.me with only the item, the price and the order
//              number (no name, email or phone); the order number and a tappable link are shown; nothing unlocks;
//              My orders and the order page say it is waiting; once Nm7 marks it paid it unlocks for that customer
//              with a receipt from "Nm7" (no GST invoice, no company name)
//   Fallback:  WhatsApp didn't open (pop-up blocked): the order number and the link are still there
// Razorpay mode is unchanged: linkedin-pack.spec, downloads.spec and org-billing.spec still pay through it.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const NUMBER = '+91 90000 12345';
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function ownerPage(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const mail = `owner-wac-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}
const setMode = (page, mode) => call(page, '/api/admin/payment-settings', {
  method: 'PUT', body: JSON.stringify({ mode, whatsappNumber: NUMBER, replyHours: 'We reply 9 am - 9 pm', cancelAfterHours: 72 }),
});
async function signIn(page, who, name) {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
/** wa.me, stood in: a tiny page, so the test can read the URL the site opened. */
const fakeWhatsApp = (page) => page.context().route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>chat' }));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);
    let owner;
    test.afterEach(async () => {
      if (owner) { await setMode(owner.page, 'off'); await owner.ctx.close(); owner = null; }
    });

    test('Off: Coming soon on checkout and the pack, no buy button; the server refuses a WhatsApp order', async ({ page }) => {
      await signIn(page, `wac-off-${label}`, 'Ravi Kumar');
      await page.goto('/checkout');
      const form = page.getByRole('form', { name: 'Payment' });
      await expect(form.getByTestId('checkout-soon')).toContainText('Coming soon');
      await expect(form.getByRole('button', { name: 'Coming soon' })).toBeDisabled();
      await expect(form.getByRole('button', { name: /Pay ₹|Buy on WhatsApp/ })).toHaveCount(0);
      await page.goto('/linkedin?path=fix');
      await expect(page.getByTestId('li-pack-soon')).toBeVisible();
      await expect(page.getByTestId('li-pack-buy')).toHaveCount(0);
      const r = await call(page, '/api/orders/whatsapp', { method: 'POST', body: JSON.stringify({ planId: 'linkedin_pack' }) });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('not_whatsapp');
    });

    test('WhatsApp: pending order, wa.me link with no personal data, nothing unlocks, waiting texts; mark paid unlocks with a receipt', async ({ page, browser }) => {
      owner = await ownerPage(browser, `buy-${label}`);
      expect((await setMode(owner.page, 'whatsapp')).status).toBe(200);
      const mail = await signIn(page, `wac-buy-${label}`, 'Ravi Kumar');
      await fakeWhatsApp(page);
      // home pricing says how to pay
      await page.goto('/');
      await expect(page.getByTestId('home-wa-pay')).toHaveText('Pay by UPI through WhatsApp. Your order starts as soon as we confirm payment.');

      await page.goto('/linkedin?path=fix');
      const buy = page.getByTestId('li-pack-buy');
      await expect(buy).toHaveText('Buy on WhatsApp');
      await expect(page.getByTestId('li-locked')).toContainText('Pay by UPI through WhatsApp.');
      const popup = page.waitForEvent('popup');
      await buy.click();
      const chat = await popup;
      await chat.waitForURL(/^https:\/\/wa\.me\//);
      const url = new URL(chat.url());
      expect(url.pathname).toBe('/919000012345');
      const placed = page.getByTestId('wa-placed');
      const orderNo = (await placed.getByTestId('wa-order-no').innerText()).trim();
      expect(orderNo).toMatch(/^NM7-\d{5}$/);
      expect(url.searchParams.get('text')).toBe(`Hi Nm7, I want to buy LinkedIn pack (Rs 149). Order ${orderNo}.`);
      expect(chat.url()).not.toMatch(/ravi|Kumar|example\.com|%40/i);
      await expect(placed.getByTestId('wa-open-chat')).toHaveAttribute('href', chat.url());
      await expect(placed).toContainText('Pay only to the UPI ID we send in the Nm7 WhatsApp chat. We never ask for your OTP, PIN or card number.');
      await expect(placed).toContainText('Delivery time starts after payment is confirmed.');
      await chat.close();
      // nothing unlocks
      expect((await call(page, '/api/me/linkedin/pack')).status).toBe(403);

      // the order page and My orders
      await placed.getByRole('link', { name: 'See my order' }).click();
      await expect(page).toHaveURL(new RegExp(`/me/orders/${orderNo}$`));
      const waiting = page.getByTestId('wa-waiting');
      await expect(waiting).toContainText('Waiting for payment confirmation');
      await expect(waiting).toContainText('Pay only to the UPI ID we send in the Nm7 WhatsApp chat. We never ask for your OTP, PIN or card number.');
      await expect(waiting).toContainText('Delivery time starts after payment is confirmed.');
      await page.goto('/me/orders');
      await expect(page.getByRole('link', { name: new RegExp(orderNo) })).toContainText('Waiting for payment confirmation');

      // Nm7 confirms the payment: unlocked for this customer, a receipt from "Nm7" (no GST invoice)
      const paid = await call(owner.page, `/api/admin/whatsapp/orders/${orderNo}/paid`, { method: 'POST', body: JSON.stringify({ method: 'upi', reference: `UTRC${Date.now()}${label.length}`, amount: 14900, paidOn: today() }) });
      expect(paid.status).toBe(200);
      expect((await call(page, '/api/me/linkedin/pack')).status).toBe(200);
      await page.goto(`/me/orders/${orderNo}`);
      await expect(page.getByTestId('wa-waiting')).toHaveCount(0);
      const receipts = page.getByRole('region', { name: 'Receipts' });
      await expect(receipts).toContainText(/NM7R\//);
      await expect(receipts).toContainText('A payment receipt from Nm7.');
      await expect(page.getByRole('region', { name: 'Invoices' })).toHaveCount(0);
      const dl = page.waitForEvent('download');
      await receipts.getByRole('button', { name: 'PDF' }).click();
      expect((await dl).suggestedFilename()).toMatch(/^Receipt_NM7R-/);
      await page.goto('/linkedin?path=fix');
      await expect(page.getByTestId('li-locked')).toHaveCount(0);
      expect(mail).toBeTruthy();
    });

    test('WhatsApp checkout: Career Launch order, and the fallback when WhatsApp didn’t open', async ({ page, browser }) => {
      owner = await ownerPage(browser, `co-${label}`);
      await setMode(owner.page, 'whatsapp');
      await signIn(page, `wac-co-${label}`, 'Sita Rao');
      await page.addInitScript(() => { window.open = () => null; }); // a pop-up blocker
      await page.goto('/checkout');
      await page.getByRole('checkbox', { name: /Upgrade to Career Launch/ }).check();
      const form = page.getByRole('form', { name: 'Payment' });
      await expect(form.getByTestId('checkout-wa')).toContainText('Pay by UPI through WhatsApp. Your order starts as soon as we confirm payment.');
      await expect(page.getByText(/counted from when we confirm your payment/)).toBeVisible();
      await form.getByRole('button', { name: /^Buy on WhatsApp · ₹/ }).click();
      const placed = page.getByTestId('wa-placed');
      const orderNo = (await placed.getByTestId('wa-order-no').innerText()).trim();
      await expect(placed).toContainText('Tap below to open WhatsApp');
      const href = await placed.getByTestId('wa-open-chat').getAttribute('href');
      const u = new URL(href);
      expect(u.host).toBe('wa.me');
      expect(u.searchParams.get('text')).toMatch(new RegExp(`^Hi Nm7, I want to buy Career Launch \\(Rs [\\d,]+\\)\\. Order ${orderNo}\\.$`));
      expect(href).not.toMatch(/sita|rao|example|%40/i);
      // an expert order waits: no expert work starts
      const o = await call(page, `/api/orders/${orderNo}`);
      expect(o.body.status).toBe('awaiting_payment');
      expect(o.body.paidAt).toBeNull();
      // Nm7 cancels it: the order page says so and it can't be paid any more
      await call(owner.page, `/api/admin/whatsapp/orders/${orderNo}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '' }) });
      await page.goto(`/me/orders/${orderNo}`);
      await expect(page.getByTestId('wa-cancelled')).toContainText('Nothing was charged');
    });
  });
}
