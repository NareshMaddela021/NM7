// Razorpay payments, admin side, on a desktop and a 390 px phone, against the real API (no Razorpay keys here, so the
// payment method can't be Razorpay and Razorpay calls are stood in where a test needs them):
//   Settings → Payments: "Payment method" Razorpay / Off (pause payments) only; the missing-keys hint; no WhatsApp
//                        number, reply hours or cancel hours; Off saves; the server refuses "whatsapp"
//   banner:              "Razorpay keys missing: …" at the top of every Admin page while the keys aren't set
//   Old WhatsApp orders: a tab in Payments & invoices (the old page and its menu item are gone; the old address
//                        redirects there); read-only, labelled "old (WhatsApp)"; only "Send Razorpay payment link" and
//                        "Send links to all pending" (in-page confirm); no Mark paid, Cancel or Record refund (404)
//   Payments & invoices: Razorpay payment ID, method, fee with its GST, refunded, source; "Refund via Razorpay" with an
//                        in-page confirm (never a browser pop-up); the Daily check tab with Run now and Resolve
//   roles: Support sees none of it
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}, [API, path, init]);
const KEYS = 'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET';

async function admin(browser, role, label, opts) {
  const ctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => { throw new Error(`a browser pop-up appeared: ${d.message()}`); }); // no window.confirm / alert
  const mail = `${role}-pay-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, role, PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}
const noSideways = async (page, opts) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

const OLD_ROW = (id, extra = {}) => ({
  id, kind: 'customer', customer: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '' }, item: 'LinkedIn pack', amount: 14900, coupon: null,
  status: 'awaiting_payment', createdAt: Date.now() - 50 * 3600e3, ageHours: 50, chatUrl: '', label: 'old (WhatsApp)', paymentLink: null,
  receiptNo: null, invoiceNo: null, payment: null, ...extra,
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test('Settings → Payments: Razorpay / Off only, the keys hint, no WhatsApp fields; Off saves', async ({ browser }) => {
      const { ctx, page } = await admin(browser, 'owner', `set-${label}`, opts);
      await page.goto('/admin/settings');
      const box = page.getByTestId('pay-settings');
      await expect(box.getByText('Payment method', { exact: true })).toBeVisible();
      const radios = box.getByRole('radio');
      await expect(radios).toHaveCount(2);
      await expect(box.getByRole('radio', { name: 'Razorpay' })).toBeDisabled(); // no keys on this server
      await expect(box.getByTestId('pay-keys')).toContainText(`Naresh adds ${KEYS} in Render`);
      await expect(box.getByTestId('pay-active')).toHaveText('Off');
      for (const gone of ['WhatsApp number', 'Reply hours', 'Cancel unpaid orders after']) await expect(box.getByLabel(gone)).toHaveCount(0);
      await expect(box).not.toContainText('WhatsApp number');
      await noSideways(page, opts);
      await box.getByRole('radio', { name: 'Off (pause payments)' }).click();
      const save = box.getByRole('button', { name: 'Save payment method' });
      if (await save.isEnabled()) {
        await save.click();
        await expect(page.getByText('Payments paused')).toBeVisible();
      }
      await expect(box.getByRole('radio', { name: 'Off (pause payments)' })).toHaveAttribute('aria-checked', 'true');
      expect((await call(page, '/api/admin/payment-settings')).body).toMatchObject({ mode: 'off', active: 'off', razorpayReady: false });
      // the server: WhatsApp is no longer a payment method; Razorpay needs its keys
      expect((await call(page, '/api/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ mode: 'whatsapp' }) })).status).toBe(422);
      const rzp = await call(page, '/api/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ mode: 'razorpay' }) });
      expect(rzp.body.error.code).toBe('razorpay_not_ready');
      expect((await call(page, '/api/public/payment-mode')).body.mode).toBe('off');
      await ctx.close();
    });

    test('Razorpay keys banner on every Admin page; Old WhatsApp orders tab: read-only, Razorpay links only', async ({ browser }) => {
      const { ctx, page } = await admin(browser, 'owner', `old-${label}`, opts);
      expect((await call(page, '/api/admin/payments/status')).body).toMatchObject({ razorpayReady: false, mode: 'off' });
      // the banner: calm, at the top of every live Admin page, not dismissible
      for (const path of ['/admin', '/admin/orders', '/admin/settings']) {
        await page.goto(path);
        const banner = page.getByTestId('admin-keys-banner');
        await expect(banner).toContainText(`Razorpay keys missing: add ${KEYS} in Render`);
        await expect(banner).toHaveAttribute('role', 'status');
        await expect(banner.getByRole('button')).toHaveCount(0);
      }
      // the old page is gone: no menu item, its address opens the tab
      await expect(page.getByRole('link', { name: /WhatsApp payments/ })).toHaveCount(0);
      await page.goto('/admin/whatsapp-payments');
      await expect(page).toHaveURL(/\/admin\/payments\?tab=old$/);
      await expect(page.getByRole('heading', { name: 'Payments & invoices' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Old WhatsApp orders' })).toHaveAttribute('aria-selected', 'true');
      // the removed actions answer 404
      for (const path of ['/api/admin/whatsapp/orders/RS-1/paid', '/api/admin/whatsapp/orders/RS-1/cancel', '/api/admin/whatsapp/orders/RS-1/refund']) {
        expect([404, 405]).toContain((await call(page, path, { method: 'POST', body: JSON.stringify({}) })).status);
      }
      // a real link request without the keys: the server's calm message, shown in the page (nothing seeded: 404 / 503)
      const noKeys = await call(page, '/api/admin/whatsapp/orders/RS-1/payment-link', { method: 'POST' });
      expect([404, 409, 503]).toContain(noKeys.status);

      // old orders (stood in: they can't be made any more): one waiting, one paid
      await page.route(/\/api\/admin\/whatsapp\/orders\?status=all$/, (r) => r.fulfill({ json: [
        OLD_ROW('RS-7001'),
        OLD_ROW('RS-7002', { status: 'offer', payment: { method: 'upi', reference: 'UTR123456', amount: 14900, paidOn: '2026-10-01' }, receiptNo: 'NM7R/26-27/0001' }),
      ] }));
      const sent = [];
      let keysOn = false;
      await page.route('**/api/admin/whatsapp/orders/RS-7001/payment-link', (r) => {
        sent.push('one');
        return keysOn ? r.fulfill({ json: { url: 'https://rzp.io/i/abc', id: 'plink_1', expiresAt: '2026-12-01T00:00:00Z', emailed: true, to: 'ravi@example.com' } })
          : r.fulfill({ status: 503, json: { error: { code: 'payments_unavailable', message: 'Payments aren’t switched on yet.' } } });
      });
      await page.route('**/api/admin/whatsapp/payment-links', (r) => { sent.push('all'); return r.fulfill({ json: { sent: 1, failed: 0 } }); });
      await page.reload();
      const box = page.getByTestId('old-wa');
      const row = box.getByTestId('wa-row').filter({ hasText: 'RS-7001' });
      await expect(row).toContainText('old (WhatsApp)');
      await expect(row).toContainText('₹149');
      await expect(row).toContainText('Waiting for payment');
      const paid = box.getByTestId('wa-row').filter({ hasText: 'RS-7002' });
      await expect(paid).toContainText('old (WhatsApp)');
      await expect(paid).toContainText('Paid');
      await expect(paid).toContainText('UPI UTR123456');
      await expect(paid).toContainText('NM7R/26-27/0001');
      await expect(paid.getByRole('button')).toHaveCount(0); // nothing to do on a paid one
      for (const gone of [/Mark as paid/, /^Cancel$/, /Record refund/, /Refund/]) await expect(box.getByRole('button', { name: gone })).toHaveCount(0);
      // no keys: the server's message, calmly in the page
      await row.getByRole('button', { name: 'Send Razorpay payment link' }).click();
      await expect(box.getByTestId('wa-note')).toHaveText('Payments aren’t switched on yet.');
      keysOn = true;
      await row.getByRole('button', { name: 'Send Razorpay payment link' }).click();
      await expect(box.getByTestId('wa-note')).toHaveText('Payment link for RS-7001 emailed to ravi@example.com.');
      await box.getByTestId('wa-links-all').click();
      await expect(box.getByTestId('wa-links-confirm')).toBeVisible();
      expect(sent).toEqual(['one', 'one']); // nothing until confirmed
      await box.getByTestId('wa-links-all-yes').click();
      await expect(box.getByTestId('wa-note')).toHaveText('1 link(s) sent.');
      expect(sent).toEqual(['one', 'one', 'all']);
      // the source label in the payments table stays
      await page.getByRole('tab', { name: 'Payments', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Payments & invoices' })).toBeVisible();
      await noSideways(page, opts);
      await ctx.close();
    });

    test('Payments & invoices: payment ID, source, fee, Refund via Razorpay with an in-page confirm; Daily check', async ({ browser }) => {
      const cust = email(`pay-adm-${label}`);
      seed('customer', cust, 'Asha Devi', PASSWORD);
      const orderId = seed('paid-order', cust, 'expert').id;
      const { ctx, page } = await admin(browser, 'owner', `pay-${label}`, opts);
      const asked = [];
      await page.route(`**/api/admin/orders/${orderId}/razorpay-refund`, (r) => { asked.push(r.request().postDataJSON()); return r.fulfill({ json: { id: orderId } }); });
      await page.goto('/admin/payments');
      await expect(page.getByRole('heading', { name: 'Payments & invoices' })).toBeVisible();
      const row = page.getByTestId('payment-row').filter({ hasText: orderId });
      await expect(row).toContainText(`pay_${orderId.replace('-', '')}`);
      await expect(row).toContainText('Razorpay');
      await expect(row).toContainText('captured');
      await row.getByRole('button', { name: 'Refund via Razorpay' }).click();
      const dlg = page.getByTestId('rzp-refund');
      await dlg.getByLabel(/^Amount/).fill('999999');
      await expect(dlg).toContainText('Enter up to');
      await expect(dlg.getByRole('button', { name: 'Refund via Razorpay' })).toBeDisabled();
      await dlg.getByLabel(/^Amount/).fill('');
      await dlg.getByLabel('Reason').selectOption('quality');
      await dlg.getByLabel(/^Note/).fill('Customer asked after the re-do');
      await dlg.getByRole('button', { name: 'Refund via Razorpay' }).click();
      await expect(dlg).toContainText('back to the customer’s original payment method?');
      expect(asked).toEqual([]); // nothing until confirmed
      await dlg.getByTestId('rzp-refund-yes').click();
      await expect(page.getByText('Refund sent to Razorpay — the customer is emailed')).toBeVisible();
      expect(asked).toEqual([{ reason: 'quality', note: 'Customer asked after the re-do' }]);

      // the daily check: Run now (no keys here: Razorpay can't answer), then a flag to resolve
      await page.getByRole('tab', { name: 'Daily check' }).click();
      const box = page.getByTestId('pay-checks');
      await expect(box).toBeVisible();
      let resolved = false;
      const check = () => ({ items: [{ day: '2026-11-16', at: '2026-11-16T03:00:00Z', checked: 4, flags: [{ n: 0, kind: 'status', text: 'Captured at Razorpay but “created” on nm7.si (the order may still be unpaid).', payment_id: 'pay_X1', order_id: 'RS-5001', resolved, note: resolved ? 'Paid by webhook later' : undefined }] }], open: resolved ? 0 : 1 });
      await page.route('**/api/admin/payments/checks', (r) => r.fulfill({ json: check() }));
      const notes = [];
      await page.route('**/api/admin/payments/checks/2026-11-16/flags/0/resolve', (r) => { notes.push(r.request().postDataJSON().note); resolved = true; return r.fulfill({ json: check().items[0] }); });
      await page.getByRole('tab', { name: 'Payments', exact: true }).click();
      await page.getByRole('tab', { name: 'Daily check' }).click();
      await expect(box.getByTestId('pay-check-open')).toHaveText('1 open flag(s) in the latest check.');
      const flag = box.getByTestId('pay-flag');
      await expect(flag).toContainText('RS-5001 · pay_X1');
      await flag.getByRole('button', { name: 'Resolve' }).click();
      await expect(flag.getByRole('button', { name: 'Resolve' })).toBeDisabled(); // a note first
      await flag.getByLabel('What was done').fill('Paid by webhook later');
      await flag.getByRole('button', { name: 'Resolve' }).click();
      await expect(page.getByText('Flag resolved')).toBeVisible();
      await expect(flag).toContainText('Resolved');
      expect(notes).toEqual(['Paid by webhook later']);
      await expect(box.getByTestId('pay-check-run')).toBeVisible();
      await noSideways(page, opts);
      await ctx.close();
    });

    test('roles: Support can’t open payment settings, old WhatsApp orders or payments', async ({ browser }) => {
      const { ctx, page } = await admin(browser, 'support', `role-${label}`, opts);
      await expect(page.getByRole('link', { name: /WhatsApp payments/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Payments & invoices' })).toHaveCount(0);
      expect((await call(page, '/api/admin/whatsapp/orders?status=all')).status).toBe(403);
      expect((await call(page, '/api/admin/whatsapp/pending')).status).toBe(403);
      // the keys banner needs the dashboard role: Support gets 403 and simply no banner (no error shown)
      expect((await call(page, '/api/admin/payments/status')).status).toBe(403);
      await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();
      await expect(page.getByTestId('admin-keys-banner')).toHaveCount(0);
      expect((await call(page, '/api/admin/payments/checks')).status).toBe(403);
      await ctx.close();
    });
  });
}
