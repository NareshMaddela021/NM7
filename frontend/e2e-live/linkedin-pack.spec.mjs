// The LinkedIn pack (Rs 149), on a desktop and a 390 px phone, against the real API (payments off, no AI key).
//   payments off: "Coming soon" everywhere (page, dashboard, Upgrade & add-ons), no Buy button, no checkout, and the
//                 server refuses the pack to an account that doesn't own it
//   admin grant:  Admin > Customers > Grant LinkedIn pack unlocks it for that customer only; all items, copy,
//                 where to paste, the banner PNG (1584 × 396), one regenerate per section, edits kept
//   payments on (mocked): Buy → Razorpay → the signed webhook marks the order paid → unlocked; a closed window or a
//                 failed payment never unlocks; Career Launch includes the pack
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { webhook } from './orgBilling.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const PRIVATE = /98765|ravi@example\.com/;

async function signIn(page, who, name = 'Ravi Kumar') {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
async function pasteProfile(page) {
  await page.getByLabel(/Your LinkedIn link/).fill('linkedin.com/in/ravi-kumar-4b2a91a3');
  await page.getByLabel('The job you want').fill('Data Analyst');
  await page.getByRole('button', { name: 'Paste sections' }).click();
  await page.getByLabel('Headline').fill('Student at JNTU Hyderabad');
  await page.getByLabel('About').fill('I am a final year student. Call 98765 43210 or mail ravi@example.com.');
  await page.getByLabel('Experience').fill('Data Intern at Acme Analytics\nMade weekly sales reports in Excel.');
  await page.getByLabel('Skills').fill('Excel, Communication, SQL, Python, Power BI');
}
function noCheckout(page) {
  const asked = [];
  page.on('request', (r) => { if ((r.method() === 'POST' && /\/api\/(orders|payments)/.test(r.url())) || /razorpay/i.test(r.url())) asked.push(r.url()); });
  return asked;
}
/** Payments switched on for this page only: the status the page reads says the pack is on sale. */
async function paymentsOn(page) {
  await page.route('**/api/me/linkedin/pack/status', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, paymentsOn: true, onSale: true } });
  });
}
/** Razorpay's checkout window, stood in: the person closes it. */
const fakeRazorpay = (page) => page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({
  contentType: 'text/javascript',
  body: 'window.Razorpay=function(o){this.open=function(){setTimeout(function(){o.modal.ondismiss()},50)}}',
}));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('payments off: Coming soon on the page, dashboard and Upgrade; no Buy; the server refuses the pack', async ({ page }) => {
      await signIn(page, `pk-off-${label}`);
      const asked = noCheckout(page);
      const card = page.getByTestId('me-linkedin');
      await expect(card.getByTestId('me-li-pack-soon')).toHaveText('Coming soon');
      await page.goto('/linkedin?path=fix');
      const offer = page.getByTestId('li-locked');
      await expect(offer).toContainText('LinkedIn pack');
      await expect(page.getByTestId('li-pack-price')).toHaveText('₹149');
      await expect(offer.locator('li')).toHaveCount(9);
      await expect(page.getByTestId('li-pack-buy')).toHaveCount(0);
      await page.getByTestId('li-pack-soon').click({ force: true });
      await expect(page).toHaveURL(/\/linkedin/);
      for (const [path, method] of [['/api/me/linkedin/pack', 'GET'], ['/api/me/linkedin/pack/generate', 'POST']]) {
        const r = await call(page, path, { method, ...(method === 'POST' ? { body: JSON.stringify({ path: 'create', targetRole: 'Data Analyst', details: { skills: 'SQL' } }) } : {}) });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('pack_locked');
      }
      await page.goto('/me/upgrade');
      await expect(page.getByTestId('up-li-pack')).toContainText('Coming soon');
      await expect(page.getByTestId('up-li-pack').getByRole('button')).toHaveCount(0);
      await page.goto('/');
      await expect(page.getByTestId('home-linkedin-pack')).toContainText('LinkedIn pack · ₹149');
      expect(asked).toEqual([]);
    });

    test('admin grant unlocks it for that customer only: all items, limits, copy, banner PNG, regenerate once, edits kept', async ({ page, browser }) => {
      const mail = await signIn(page, `pk-grant-${label}`);
      // the admin grants it in Admin > Customers
      const adminCtx = await browser.newContext();
      const admin = await adminCtx.newPage();
      const adminMail = `owner-pk-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', adminMail, 'owner', PASSWORD);
      await adminLogin(admin, adminMail, secret);
      await expect(admin).not.toHaveURL(/\/login/); // signed in (two-step done)
      const list = await call(admin, `/api/admin/customers?q=${encodeURIComponent(mail)}`);
      const uid = list.body.items[0].id;
      await admin.goto(`/admin/customers?id=${uid}`);
      const box = admin.getByTestId('admin-li-pack');
      await expect(box).toContainText('Not unlocked');
      await box.getByRole('button', { name: 'Grant LinkedIn pack' }).click();
      await expect(box).toContainText('Granted by an admin');
      const log = await call(admin, '/api/admin/audit-log?action=linkedin_pack.granted');
      expect(log.body[0].target).toBe(uid);
      await adminCtx.close();

      // the customer makes the pack from the profile they pasted
      await page.goto('/linkedin?path=fix');
      await pasteProfile(page);
      await page.getByTestId('li-pack-generate').click();
      const pack = page.getByTestId('li-pack');
      await expect(pack).toBeVisible({ timeout: 30_000 });
      // 1. headline: 5 options, before shown
      const opts = pack.getByTestId('li-pack-option');
      await expect(opts).toHaveCount(5);
      for (const t of await opts.allInnerTexts()) { expect(t.length).toBeLessThanOrEqual(220); expect(t).not.toMatch(PRIVATE); }
      await expect(page.getByTestId('li-pack-headline')).toContainText('Before: Student at JNTU Hyderabad');
      // 2. About in 3 styles
      for (const style of ['Simple', 'Professional', 'Story']) {
        await page.getByTestId('li-pack-about').getByRole('button', { name: style }).click();
        const text = await page.getByTestId('li-pack-about-text').innerText();
        expect(text.length).toBeGreaterThan(20);
        expect(text.length).toBeLessThanOrEqual(2600);
        expect(text).not.toMatch(PRIVATE);
      }
      // 3-8
      await expect(page.getByTestId('li-pack-exp')).toHaveCount(1);
      await expect(page.getByTestId('li-pack-exp')).toContainText('Before: Made weekly sales reports in Excel.');
      await expect(page.getByTestId('li-pack-education')).toBeVisible();
      await expect(page.getByTestId('li-pack-skill').first()).toHaveText('SQL');
      await expect(page.getByTestId('li-pack-featured')).toContainText('Your Nm7 resume link');
      await expect(page.getByTestId('li-pack-url')).toHaveCount(3);
      await expect(page.getByTestId('li-pack-url').first()).toHaveText('linkedin.com/in/ravi-data-analyst');
      // 9. copy buttons and where to paste (English, Telugu, Hindi)
      await expect(page.getByTestId('li-where-headline')).toContainText('Where to paste: Profile');
      await pack.getByRole('button', { name: 'తెలుగు' }).click();
      await expect(page.getByTestId('li-where-headline')).toContainText('NEED NATIVE REVIEW');
      await pack.getByRole('button', { name: 'English' }).click();
      await expect(page.getByTestId('li-copy-about')).toBeVisible();
      // the banner: a 1584 × 396 PNG with a sensible name, drawn on the page (no data: URL is fetched)
      const dataFetch = [];
      page.on('request', (r) => { if (r.url().startsWith('data:')) dataFetch.push(r.url()); });
      const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('li-banner-download').click()]);
      expect(file.suggestedFilename()).toBe('Ravi_Kumar_LinkedIn_Banner.png');
      const png = readFileSync(await file.path());
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1584, 396]);
      expect(dataFetch).toEqual([]);
      // one regenerate per section
      const regen = page.getByTestId('li-regen-headline');
      await regen.click();
      await expect(regen).toHaveText('Regenerated');
      await expect(regen).toBeDisabled();
      // the person's edits are kept; regenerating that section asks first
      await page.getByTestId('li-edit-about').click();
      await page.getByTestId('li-pack-about').getByRole('button', { name: 'Simple' }).click();
      await page.getByTestId('li-pack-editor').fill('My own words about working with data.');
      await page.getByTestId('li-pack-about').getByRole('button', { name: 'Save' }).click();
      await expect(page.getByTestId('li-pack-about-text')).toHaveText('My own words about working with data.');
      await page.getByTestId('li-regen-about').click();
      const dlg = page.getByRole('dialog', { name: 'Replace your changes?' });
      await dlg.getByRole('button', { name: 'Keep my changes' }).click();
      await expect(page.getByTestId('li-pack-about-text')).toHaveText('My own words about working with data.');
      // saved: shown again after a reload
      await page.reload();
      await expect(page.getByTestId('li-pack-about-text')).toHaveText('My own words about working with data.', { timeout: 15_000 });
      expect(JSON.stringify((await call(page, '/api/me/linkedin/pack')).body.pack)).not.toMatch(PRIVATE);
      // the dashboard opens it
      await page.goto('/me');
      await page.getByTestId('me-li-pack').getByRole('link', { name: 'Open my LinkedIn pack' }).click();
      await expect(page.getByTestId('li-pack')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // another account stays locked
      const otherCtx = await browser.newContext(opts);
      const other = await otherCtx.newPage();
      await signIn(other, `pk-other-${label}`, 'Kiran Rao');
      await other.goto('/linkedin?path=fix');
      await expect(other.getByTestId('li-locked')).toBeVisible();
      expect((await call(other, '/api/me/linkedin/pack')).status).toBe(403);
      await otherCtx.close();
    });

    test('payments on (mocked): a closed window or a failed payment never unlocks; Razorpay\'s webhook does', async ({ page, request }) => {
      const mail = await signIn(page, `pk-pay-${label}`);
      await paymentsOn(page);
      const order = seed('customer-order', mail, 'linkedin_pack');
      expect(order.amount).toBe(14900);
      await page.route('**/api/orders', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 201, json: order }) : r.fallback()));
      // 1. the person closes Razorpay's window: nothing unlocks
      await fakeRazorpay(page);
      await page.goto('/linkedin?path=fix');
      await page.getByTestId('li-pack-buy').click();
      await expect(page.getByRole('alert')).toContainText('You closed the payment window. Nothing was charged.');
      await expect(page.getByTestId('li-pack-buy')).toBeVisible();
      // 2. a failed payment: still locked
      const fail = JSON.stringify({ entity: 'event', event: 'payment.failed', payload: { payment: { entity: { id: `pay_F${label}`, order_id: order.razorpayOrderId, amount: order.amount, currency: 'INR', status: 'failed' } } } });
      const failed = await request.post(`${API}/api/payments/webhook`, { data: fail, headers: await signed(fail, `evt_f_${label}_${Date.now()}`) });
      expect(failed.ok()).toBe(true);
      expect((await call(page, '/api/me/linkedin/pack/status')).body.owned).toBe(false);
      // 3. it goes through: the server confirms it from Razorpay's signed webhook, then the pack is unlocked
      // (Razorpay's script is already loaded in the page: the stand-in now "pays")
      await page.evaluate(() => { window.Razorpay = function (o) { this.open = () => setTimeout(() => o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_E2E', razorpay_signature: 'sig' }), 50); }; });
      await page.route('**/api/payments/verify', async (r) => {
        expect((await webhook(request, order.razorpayOrderId, order.amount, `pay_OK${order.orderId.replace('-', '')}`)).ok()).toBe(true);
        return r.fulfill({ status: 200, json: { id: order.orderId, status: 'done', invoiceNo: 'NM7/test', paymentMethod: 'upi', paymentId: 'pay_OK' } });
      });
      await page.getByTestId('li-pack-buy').click();
      await expect(page.getByTestId('li-pack-make')).toBeVisible({ timeout: 15_000 });
      const st = (await call(page, '/api/me/linkedin/pack/status')).body;
      expect(st).toMatchObject({ owned: true, source: 'order', orderId: order.orderId });
      const orders = (await call(page, '/api/orders')).body;
      expect(orders[0]).toMatchObject({ id: order.orderId, status: 'done' });
      expect(orders[0].invoiceNo).toMatch(/^NM7\//);
    });

    test('Career Launch includes the LinkedIn pack', async ({ page }) => {
      const mail = await signIn(page, `pk-launch-${label}`);
      seed('paid-order', mail, 'launch');
      await page.goto('/linkedin?path=create');
      await expect(page.getByTestId('li-pack-make')).toBeVisible();
      expect((await call(page, '/api/me/linkedin/pack/status')).body).toMatchObject({ owned: true, source: 'launch' });
    });
  });
}

async function signed(body, id) {
  const { createHmac } = await import('node:crypto');
  return { 'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', 'e2e-webhook-secret').update(body).digest('hex'), 'X-Razorpay-Event-Id': id };
}
