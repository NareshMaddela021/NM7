// The annual student pass (P1) on a desktop and a 390 px phone, against the real API (payments Off: no Razorpay keys;
// "on" is mocked for the page): "Best value" on the home pricing; the pass paid with Razorpay (stood in, confirmed by
// the signed webhook) shows "Pass active until <date>" on the dashboard and unlocks downloads, the Tailor and
// Interview packs and the LinkedIn pack; a free "Annual pass" code unlocks it from the dashboard; Off hides the offer.
// No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { webhook } from './orgBilling.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);
const post = (page, path, body) => call(page, path, { method: 'POST', body: JSON.stringify(body) });
/** The pass on sale for this page (Razorpay mode), whatever the test API says. */
const passOnSale = (page) => page.route(`${API}/api/me/pass`, async (r) => {
  const res = await r.fetch();
  await r.fulfill({ response: res, json: { ...(await res.json()), onSale: true, mode: 'razorpay' } });
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);
    let owner;
    test.afterEach(async () => { if (owner) { await owner.ctx.close(); owner = null; } });

    test('pass paid with Razorpay → active until, everything unlocked; a free pass code; Off hides it', async ({ page, browser, request }) => {
      test.setTimeout(150_000);
      const ctx = await browser.newContext();
      owner = { ctx, page: await ctx.newPage() };
      const mail = `owner-pass-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      await adminLogin(owner.page, mail, secret);
      await expect(owner.page).not.toHaveURL(/\/login/);

      // the home pricing shows the pass as best value
      await page.goto('/pricing'); // round P: its own page
      const card = page.getByTestId('home-pass');
      await expect(card).toContainText('Annual student pass');
      await expect(card).toContainText('Best value');

      // a student: the offer on the dashboard, paid with Razorpay (stood in); the signed webhook confirms it
      const student = email(`pass-${label}`);
      seed('customer', student, 'Priya S', PASSWORD);
      await login(page, student);
      await page.waitForURL('**/me');
      await passOnSale(page);
      const order = seed('customer-order', student, 'annual_pass');
      await page.route('**/api/orders', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 201, json: order }) : r.fallback()));
      await page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Razorpay=function(o){this.open=function(){setTimeout(function(){o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:"pay_E2E",razorpay_signature:"sig"})},50)}}' }));
      await page.route('**/api/payments/verify', async (r) => {
        expect((await webhook(request, order.razorpayOrderId, order.amount, `pay_P${order.orderId.replace('-', '')}`)).ok()).toBe(true);
        return r.fulfill({ status: 200, json: { id: order.orderId, status: 'done', invoiceNo: 'NM7/test', paymentMethod: 'upi', paymentId: 'pay_P' } });
      });
      await page.goto('/me?pass=1');
      const offer = page.getByTestId('pass-offer');
      await expect(offer).toContainText('Best value');
      await expect(offer).not.toContainText('WhatsApp');
      await expect(offer.getByTestId('pass-buy')).toHaveText(/^Get the pass ₹|^Get the pass Rs/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      await offer.getByTestId('pass-buy').click();
      await expect(page.getByTestId('pass-active')).toContainText('Pass active until', { timeout: 15_000 });
      await page.goto('/me');
      await expect(page.getByTestId('pass-active')).toContainText('Pass active until');
      const ent = (await call(page, '/api/me/entitlements')).body; // with payments Off downloads are free for everyone
      expect(ent.canDownload).toBe(true);
      expect(['pass', 'payments_off']).toContain(ent.reason);
      const jobs = (await call(page, '/api/me/jobs/access')).body;
      expect([jobs.tailor, jobs.interview, jobs.tailorSource]).toEqual([true, true, 'pass']);
      expect((await call(page, '/api/me/linkedin/pack/status')).body.owned).toBe(true);
      await page.goto('/linkedin');
      await expect(page.getByTestId('li-locked')).toHaveCount(0);

      // another student: a free "Annual pass" code from the dashboard
      const code = `PASS-${label === 'desktop' ? 'D' : 'P'}${Date.now().toString(36).toUpperCase().slice(-5)}`;
      expect((await post(owner.page, '/api/admin/coupons', { code, type: 'free', items: ['annual_pass'], totalLimit: 5 })).status).toBe(201);
      const s2 = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const p2 = await s2.newPage();
      const mail2 = email(`pass2-${label}`);
      seed('customer', mail2, 'Ravi T', PASSWORD);
      await login(p2, mail2);
      await p2.waitForURL('**/me');
      await passOnSale(p2);
      await p2.goto('/me?pass=1');
      await p2.getByTestId('pass-offer').getByTestId('code-open').click();
      await p2.getByTestId('code-input').fill(code);
      await p2.getByTestId('code-apply').click();
      await expect(p2.getByTestId('pass-active')).toContainText('Pass active until');
      await expect(p2.getByTestId('pass-offer')).toHaveCount(0);

      // Off (the test API: no Razorpay keys): no offer for someone without a pass
      const s3 = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const p3 = await s3.newPage();
      const mail3 = email(`pass3-${label}`);
      seed('customer', mail3, 'Anu K', PASSWORD);
      await login(p3, mail3);
      await p3.waitForURL('**/me');
      await p3.goto('/me?pass=1');
      await expect(p3.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(p3.getByTestId('pass-offer')).toHaveCount(0);
      await s2.close(); await s3.close();
    });
  });
}
