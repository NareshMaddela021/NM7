// Admin → Codes on a desktop and a 390 px phone, against the real API:
//   create a free code from the form, see it in the list (uses, status), pause / resume, search and filter,
//   bulk one-time codes with a prefix + CSV, a customer uses one → "Who used it" + CSV, delete only an unused code,
//   and a Finance admin gets no access (the page and the API).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: r.status, body };
}, [API, path, init]);

async function admin(browser, role, label) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const mail = `${role}-codes-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, role, PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Owner creates, pauses, bulk-makes codes, sees who used one, deletes only unused codes', async ({ browser }) => {
      const owner = await admin(browser, 'owner', label);
      const page = owner.page;
      const tag = `${label === 'desktop' ? 'D' : 'P'}${Date.now().toString(36).toUpperCase().slice(-5)}`;
      const code = `CAMPUS-${tag}`;
      await page.goto('/admin/codes');
      await expect(page.getByRole('heading', { name: 'Codes' })).toBeVisible();
      await page.getByTestId('code-new').click();
      const form = page.getByTestId('code-form');
      await form.getByTestId('code-code').fill(code.toLowerCase());
      await form.getByTestId('code-type').selectOption('free');
      await form.getByLabel('All').uncheck();
      await form.getByLabel('Resume download').check();
      await form.getByLabel('Unlimited uses').uncheck();
      await form.getByTestId('code-total').fill('100');
      await form.getByTestId('code-note').fill(`Campus drive ${tag}`);
      await form.getByTestId('code-save').click();
      await expect(page.getByText('Code created')).toBeVisible();
      const row = page.getByTestId(`code-row-${code}`);
      await expect(row).toContainText('Free');
      await expect(row).toContainText('Resume download');
      await expect(row).toContainText('0 / 100');
      await expect(row).toContainText('Active');
      // pause and resume
      await row.getByRole('button', { name: 'Pause' }).click();
      await expect(row).toContainText('Paused');
      await row.getByRole('button', { name: 'Resume' }).click();
      await expect(row).toContainText('Active');
      // search and filter
      await page.getByTestId('code-search').fill(tag.toLowerCase());
      await expect(page.getByRole('table', { name: 'Codes' }).locator('tbody tr')).toHaveCount(1);
      await page.getByTestId('code-filter-status').selectOption('paused');
      await expect(page.getByText('No codes match.')).toBeVisible();
      await page.getByTestId('code-filter-status').selectOption('');
      await page.getByTestId('code-search').fill('');

      // bulk one-time codes + CSV
      await page.getByTestId('code-bulk').click();
      const bulk = page.getByTestId('code-form');
      await bulk.getByTestId('code-prefix').fill(`B${tag}`);
      await bulk.getByTestId('code-count').fill('3');
      await bulk.getByTestId('code-type').selectOption('percent');
      await bulk.getByTestId('code-value').fill('20');
      await bulk.getByTestId('code-save').click();
      const done = page.getByTestId('bulk-done');
      await expect(done).toContainText('3 codes made');
      const [dl] = await Promise.all([page.waitForEvent('download'), done.getByTestId('bulk-csv').click()]);
      expect(dl.suggestedFilename()).toBe(`Nm7_codes_B${tag}.csv`);
      const csv = await (await dl.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8'));
      expect(csv.trim().split('\r\n')).toHaveLength(4);
      expect(csv).toMatch(new RegExp(`B${tag}-[A-Z0-9]{4}`));
      await done.getByRole('button', { name: 'Close' }).click();
      await page.getByTestId('code-search').fill(`b${tag}`);
      await expect(page.getByRole('table', { name: 'Codes' }).locator('tbody tr')).toHaveCount(3);
      await expect(page.getByRole('table', { name: 'Codes' })).toContainText('0 / 1');
      await page.getByTestId('code-search').fill('');

      // a customer uses the code
      const cctx = await browser.newContext();
      const cpage = await cctx.newPage();
      const mail = email(`codes-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(cpage, mail);
      await cpage.waitForURL('**/me');
      await call(cpage, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: 'r1', name: 'Main', data: { personal: { name: 'Asha' } } }) });
      const used = await call(cpage, '/api/me/codes/apply', { method: 'POST', body: JSON.stringify({ code: ` ${code.toLowerCase()} `, item: 'resume', resumeId: 'r1' }) });
      expect(used.status).toBe(200);
      expect(used.body.unlocked).toBe(true);
      await cctx.close();

      await page.reload();
      await expect(row).toContainText('1 / 100');
      await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0); // used: pause only
      await row.getByRole('button', { name: 'Who used it' }).click();
      const uses = page.getByTestId('code-uses');
      await expect(uses).toContainText('Asha Rao');
      await expect(uses).toContainText('Resume download');
      await expect(uses).toContainText('Rs 99');
      const [dl2] = await Promise.all([page.waitForEvent('download'), uses.getByRole('button', { name: 'Download CSV' }).click()]);
      expect(dl2.suggestedFilename()).toBe(`Nm7_code_${code.replace('-', '_')}_uses.csv`);
      await uses.getByRole('button', { name: 'Close' }).click();
      const del = await call(page, `/api/admin/coupons/${code}`, { method: 'DELETE' });
      expect(del.status).toBe(409);

      // an unused code can be deleted
      page.once('dialog', (d) => d.accept());
      await page.getByTestId('code-search').fill(`b${tag}`);
      const first = page.getByRole('table', { name: 'Codes' }).locator('tbody tr').first();
      await first.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('Deleted')).toBeVisible();
      await expect(page.getByRole('table', { name: 'Codes' }).locator('tbody tr')).toHaveCount(2);

      // the log has it
      const log = await call(page, '/api/admin/audit-log?action=coupon.created');
      expect(JSON.stringify(log.body)).toContain(code);
      await owner.ctx.close();
    });

    test('Finance admin: no Codes page, 403 from the API', async ({ browser }) => {
      const fin = await admin(browser, 'finance', label);
      await fin.page.goto('/admin/codes');
      await expect(fin.page.getByText('No access')).toBeVisible();
      expect((await call(fin.page, '/api/admin/coupons')).status).toBe(403);
      expect((await call(fin.page, '/api/admin/coupons', { method: 'POST', body: JSON.stringify({ type: 'free', items: ['all'] }) })).status).toBe(403);
      await fin.ctx.close();
    });
  });
}
