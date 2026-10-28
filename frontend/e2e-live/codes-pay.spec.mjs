// "Have a code?" at the pay step, on a desktop and a 390 px phone, against the real API:
//   a ?code= link fills in the code (never used by itself); a free code on a resume download unlocks that resume at
//   once (no WhatsApp) and it stays unlocked (PDF and Word again later); a percent code shows the new price and the
//   WhatsApp order and message carry the code and the new price; wrong codes get a clear message; Off mode: a
//   discount is refused, a free pack code unlocks; an organization's Owner turns the Drive plan on with a free code.
// Every test puts the payment mode back to Off (the other specs expect it).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed, downloadThrough } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const NUMBER = '+91 90000 12345';
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body };
}, [API, path, init]);
const post = (page, path, body) => call(page, path, { method: 'POST', body: JSON.stringify(body) });
const setMode = (page, mode) => call(page, '/api/admin/payment-settings', {
  method: 'PUT', body: JSON.stringify({ mode, whatsappNumber: NUMBER, replyHours: 'We reply 9 am - 9 pm', cancelAfterHours: 72 }),
});
const fakeWhatsApp = (page) => page.context().route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>chat' }));
const tagOf = (label) => `${label === 'desktop' ? 'D' : 'P'}${Date.now().toString(36).toUpperCase().slice(-5)}`;

async function ownerPage(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const mail = `owner-codepay-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}
async function signIn(page, who, name) {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
const newCode = async (owner, body) => {
  const r = await post(owner.page, '/api/admin/coupons', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);
    let owner;
    test.afterEach(async () => {
      if (owner) { await setMode(owner.page, 'off'); await owner.ctx.close(); owner = null; }
    });

    test('a free resume code from a link unlocks that resume at once (no WhatsApp) and it stays unlocked', async ({ page, browser }) => {
      owner = await ownerPage(browser, `free-${label}`);
      expect((await setMode(owner.page, 'whatsapp')).status).toBe(200);
      const code = `CAMPUS-${tagOf(label)}`;
      await newCode(owner, { code, type: 'free', items: ['resume'], totalLimit: 100, note: 'e2e' });
      await signIn(page, `codepay-free-${label}`, 'Asha Rao');
      const made = await post(page, '/api/me/resumes', { id: 'r1', name: 'Main', data: { personal: { name: 'Asha Rao' } } });
      expect(made.status).toBeLessThan(300);
      let popups = 0;
      page.on('popup', () => { popups += 1; });

      await page.goto(`/builder?code=${code.toLowerCase()}`); // the link: kept for the pay step, not used
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('nm7.code'))).toBe(code); // once the page has loaded
      await page.goto('/me/resumes');
      expect((await call(page, `/api/admin/coupons`)).status).toBe(403); // a customer never lists codes
      await page.getByRole('button', { name: 'PDF' }).first().click();
      const gate = page.getByRole('dialog', { name: /Unlock downloads/ });
      await expect(gate).toBeVisible();
      await expect(gate.getByTestId('code-input')).toHaveValue(code); // filled in from the link
      const [pdf] = await downloadThrough(page, () => gate.getByTestId('code-apply').click());
      expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
      await expect(page.getByText('Code applied - unlocked')).toBeVisible();
      await expect(gate).toHaveCount(0);
      expect(popups).toBe(0); // no WhatsApp step

      // later: Word and PDF again, no gate
      await page.reload();
      const [docx] = await downloadThrough(page, () => page.getByRole('button', { name: 'Word' }).first().click());
      expect(docx.suggestedFilename()).toMatch(/\.docx$/);
      const [pdf2] = await downloadThrough(page, () => page.getByRole('button', { name: 'PDF' }).first().click());
      expect(pdf2.suggestedFilename()).toMatch(/\.pdf$/);
      await expect(page.getByRole('dialog', { name: /Unlock downloads/ })).toHaveCount(0);
      const orders = await call(page, '/api/orders');
      const o = orders.body.find((x) => x.coupon?.code === code);
      expect(o.amount).toBe(0);
      expect(o.coupon).toMatchObject({ original: 9900, discount: 9900, final: 0 });
      expect(o.resumeId).toBe('r1');
    });

    test('a percent code lowers the WhatsApp order; wrong codes get clear messages', async ({ page, browser }) => {
      owner = await ownerPage(browser, `pct-${label}`);
      expect((await setMode(owner.page, 'whatsapp')).status).toBe(200);
      const tag = tagOf(label);
      const code = `SAVE50-${tag}`;
      await newCode(owner, { code, type: 'percent', value: 50, items: ['linkedin_pack'] });
      await newCode(owner, { code: `PACKONLY-${tag}`, type: 'free', items: ['tailor_pack'] });
      await newCode(owner, { code: `OLD-${tag}`, type: 'free', items: ['all'], validUntil: '2020-01-01' });
      await signIn(page, `codepay-pct-${label}`, 'Ravi Kumar');
      await fakeWhatsApp(page);
      await page.goto('/linkedin?path=fix');
      const box = page.getByTestId('li-locked');
      await box.getByTestId('code-open').click();
      const input = box.getByTestId('code-input');
      for (const [bad, text] of [['NOPE-ZZZ', 'We couldn’t find that code'], [`PACKONLY-${tag}`, 'isn’t valid for the LinkedIn pack'], [`OLD-${tag}`, 'This code has expired']]) {
        await input.fill(bad);
        await box.getByTestId('code-apply').click();
        await expect(box.getByTestId('code-error')).toContainText(text);
      }
      await input.fill(` ${code.toLowerCase()} `);
      await box.getByTestId('code-apply').click();
      await expect(box.getByTestId('code-applied')).toHaveText(new RegExp(`Rs 149 -> Rs 74.50 with ${code}`));
      const popup = page.waitForEvent('popup');
      await box.getByTestId('li-pack-buy').click();
      const chat = await popup;
      await chat.waitForURL(/^https:\/\/wa\.me\//);
      const text = new URL(chat.url()).searchParams.get('text');
      expect(text).toContain(`Rs 149 -> Rs 74.50 with code ${code}`);
      await chat.close();
      const orderNo = (await page.getByTestId('wa-placed').getByTestId('wa-order-no').innerText()).trim();
      const mine = await call(page, '/api/orders');
      const o = mine.body.find((x) => x.id === orderNo);
      expect(o.amount).toBe(7450);
      expect(o.coupon).toMatchObject({ code, original: 14900, discount: 7450, final: 7450 });
      // the admin's list shows it
      const rows = await call(owner.page, '/api/admin/whatsapp/orders?status=awaiting');
      expect(JSON.stringify(rows.body)).toContain(code);
    });

    test('Off mode: a discount is refused, a free pack code unlocks', async ({ page, browser }) => {
      owner = await ownerPage(browser, `off-${label}`);
      expect((await setMode(owner.page, 'off')).status).toBe(200);
      const tag = tagOf(label);
      await newCode(owner, { code: `HALF-${tag}`, type: 'percent', value: 50, items: ['all'] });
      await newCode(owner, { code: `GIFT-${tag}`, type: 'free', items: ['linkedin_pack'] });
      await signIn(page, `codepay-off-${label}`, 'Meena Iyer');
      await page.goto('/linkedin?path=fix');
      const box = page.getByTestId('li-locked');
      await expect(box.getByTestId('li-pack-soon')).toBeVisible();
      await box.getByTestId('code-open').click();
      await box.getByTestId('code-input').fill(`HALF-${tag}`);
      await box.getByTestId('code-apply').click();
      await expect(box.getByTestId('code-error')).toContainText('only codes that make it free work');
      await box.getByTestId('code-input').fill(`GIFT-${tag}`);
      await box.getByTestId('code-apply').click();
      await expect(page.getByText('LinkedIn pack unlocked')).toBeVisible();
      await expect(page.getByTestId('li-locked')).toHaveCount(0);
      expect((await call(page, '/api/me/linkedin/pack/status')).body.owned).toBe(true);
    });

    test('an organization’s Owner turns the Drive plan on with a free code from a /for-orgs link', async ({ page, browser }) => {
      owner = await ownerPage(browser, `org-${label}`);
      const code = `DRIVE-${tagOf(label)}`;
      await newCode(owner, { code, type: 'free', items: ['drive'], perLimit: 1 });
      const mail = email(`codepay-org-${label}`);
      seed('customer', mail, 'Priya Owner', PASSWORD);
      await login(page, mail);
      await page.waitForURL(/\/me/);
      await page.goto(`/for-orgs?start=1&code=${code}`);
      await page.getByLabel('Organization name').fill(`Code College ${label}`);
      await page.getByLabel('City').fill('Tirupati');
      await page.getByRole('button', { name: 'Create my organization' }).click();
      await page.waitForURL(/\/org\/[^/]+$/);
      await page.getByRole('link', { name: 'Billing' }).click();
      await page.getByLabel('Legal name').fill('Code College Trust');
      await page.getByLabel('Address (with PIN code)').fill('1 College Road, Tirupati 517502');
      await page.getByLabel('State').selectOption('37');
      await page.getByRole('button', { name: 'Save details' }).click();
      await expect(page.getByText('Billing details saved')).toBeVisible();
      const drive = page.getByRole('region', { name: 'Buy Drive' });
      await drive.getByRole('button', { name: 'Upgrade' }).click();
      await expect(drive.getByTestId('code-input')).toHaveValue(code);
      await drive.getByTestId('code-apply').click();
      await expect(page.getByText('Drive plan', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Active', { exact: true })).toBeVisible();
      const uses = await call(owner.page, `/api/admin/coupons/${code}/uses`);
      expect(uses.body.uses).toHaveLength(1);
      expect(uses.body.uses[0]).toMatchObject({ who: 'org', name: `Code College ${label}`, final: 0 });
    });
  });
}
