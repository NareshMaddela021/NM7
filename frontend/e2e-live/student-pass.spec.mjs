// The annual student pass (P1) on a desktop and a 390 px phone, against the real API (WhatsApp mode, put back to Off
// afterwards like the other specs): "Best value" on the download pop-up and the home pricing; a WhatsApp order for the
// pass, marked paid by the admin, shows "Pass active until <date>" on the dashboard and unlocks downloads, the Tailor
// and Interview packs and the LinkedIn pack; a free "Annual pass" code unlocks it from the dashboard; Off mode hides
// the offer. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const NUMBER = '+91 90000 12345';
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);
const post = (page, path, body) => call(page, path, { method: 'POST', body: JSON.stringify(body) });
const setMode = (page, mode) => call(page, '/api/admin/payment-settings', {
  method: 'PUT', body: JSON.stringify({ mode, whatsappNumber: NUMBER, replyHours: 'We reply 9 am - 9 pm', cancelAfterHours: 72 }),
});
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);
    let owner;
    test.afterEach(async () => { if (owner) { await setMode(owner.page, 'off'); await owner.ctx.close(); owner = null; } });

    test('WhatsApp pass marked paid → active until, everything unlocked; a free pass code; Off hides it', async ({ page, browser }) => {
      test.setTimeout(150_000);
      const ctx = await browser.newContext();
      owner = { ctx, page: await ctx.newPage() };
      const mail = `owner-pass-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      await adminLogin(owner.page, mail, secret);
      await expect(owner.page).not.toHaveURL(/\/login/);
      expect((await setMode(owner.page, 'whatsapp')).status).toBe(200);

      // the home pricing shows the pass as best value
      await page.goto('/#pricing');
      const card = page.getByTestId('home-pass');
      await expect(card).toContainText('Annual student pass');
      await expect(card).toContainText('Best value');

      // a student: the offer on the dashboard, then a WhatsApp order the admin marks paid
      const student = email(`pass-${label}`);
      seed('customer', student, 'Priya S', PASSWORD);
      await login(page, student);
      await page.waitForURL('**/me');
      await page.goto('/me?pass=1');
      const offer = page.getByTestId('pass-offer');
      await expect(offer).toContainText('Best value');
      await expect(offer.getByTestId('pass-buy')).toHaveText('Get the pass on WhatsApp');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      const o = await post(page, '/api/orders/whatsapp', { planId: 'annual_pass' });
      expect(o.status).toBe(201);
      const markPaid = await post(owner.page, `/api/admin/whatsapp/orders/${o.body.orderId}/paid`, { method: 'upi', reference: `UTR${Date.now()}`, amount: o.body.amount ?? 19900, paidOn: today() });
      expect(markPaid.status, JSON.stringify(markPaid.body)).toBe(200);
      await page.goto('/me');
      await expect(page.getByTestId('pass-active')).toContainText('Pass active until');
      expect((await call(page, '/api/me/entitlements')).body.reason).toBe('pass');
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
      await p2.goto('/me?pass=1');
      await p2.getByTestId('pass-offer').getByTestId('code-open').click();
      await p2.getByTestId('code-input').fill(code);
      await p2.getByTestId('code-apply').click();
      await expect(p2.getByTestId('pass-active')).toContainText('Pass active until');
      await expect(p2.getByTestId('pass-offer')).toHaveCount(0);

      // Off: no offer for someone without a pass
      expect((await setMode(owner.page, 'off')).status).toBe(200);
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
