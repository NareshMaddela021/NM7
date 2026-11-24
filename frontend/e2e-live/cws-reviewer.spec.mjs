// The Chrome Web Store review account, against the real API: the owner creates it in Admin -> Auto Apply (the
// password stays hidden until "Show password"), the reviewer signs in with email and password and finds 2 jobs ready
// with the Nm7 Apply helper panel; the account can't change its password; the practice form fills, and its Submit
// sends no request at all and only says "Practice form: nothing was sent". Not indexed. No sideways scrolling on a phone.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const REVIEWER = 'chrome-review@nm7.si';

test('owner makes the review account; the reviewer sees 2 jobs ready and can’t change the password', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = `cws-owner-${Date.now().toString(36)}@nm7.si`;
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  await adminLogin(page, owner, secret);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/admin/auto-apply');
  const card = page.getByTestId('aa-cws');
  await expect(card).toBeVisible();
  const create = card.getByTestId('aa-cws-create');
  if (await create.isVisible()) await create.click();
  else await card.getByTestId('aa-cws-reset').click(); // made by an earlier run on this database
  const shown = card.getByTestId('aa-cws-password');
  await expect(shown).toBeVisible();
  const password = (await shown.textContent()).trim(); // never printed
  expect(password.length).toBeGreaterThanOrEqual(20);
  await card.getByRole('button', { name: 'Hide' }).click();
  await expect(card.getByTestId('aa-cws-hidden')).toBeVisible();
  await expect(card.getByTestId('aa-cws-email')).toHaveText(REVIEWER);

  const ctx = await browser.newContext();
  const rp = await ctx.newPage();
  rp.on('dialog', () => { throw new Error('no browser dialogs'); });
  await login(rp, REVIEWER, password);
  await expect(rp).not.toHaveURL(/\/login/);
  await rp.goto('/me/auto-apply/v2?tab=ready');
  await expect(rp.getByTestId('aa2-onetap-head')).toContainText('2 jobs ready');
  await expect(rp.getByTestId('aa2-onetap')).toContainText('Customer Support Executive');
  await expect(rp.getByTestId('aa2-onetap')).toContainText('Junior Data Analyst');
  await rp.getByTestId('aa2-helper-make').click();
  await expect(rp.getByTestId('aa2-helper-code')).toBeVisible();
  const no = await call(rp, '/api/auth/password/change', json('POST', { currentPassword: password, password: 'Other-pass-1234', passwordConfirm: 'Other-pass-1234' }));
  expect(no.status).toBe(403);
  expect(no.body.error.code).toBe('review_account');
  expect((await call(rp, '/api/me/account/deletion/code', json('POST', {}))).status).toBe(403);
  await ctx.close();
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('the practice form fills and its Submit sends nothing', async ({ page }) => {
      await page.goto('/demo/apply/customer-support-executive');
      await expect(page.getByRole('heading', { name: 'Apply for Customer Support Executive' })).toBeVisible();
      await expect(page.getByTestId('practice-note')).toContainText('Nothing you type here is sent or saved');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await page.getByLabel('Full name').fill('Priya Sharma (demo)');
      await page.getByLabel('Email').fill(REVIEWER);
      await page.getByLabel('Phone number').fill('+91 90000 12345');
      await page.getByLabel('City').fill('Pune');
      await page.getByLabel('LinkedIn profile').fill('https://linkedin.com/in/priya-sharma-demo');
      await page.getByLabel('Notice period').fill('30 days');
      await page.getByLabel('Degree').fill('B.Com');
      await page.getByLabel('Resume (PDF)').setInputFiles({ name: 'Priya_Sharma_Resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 practice') });
      await page.getByLabel('Cover note').fill('I answer customer emails.');
      const requests = [];
      page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
      await page.getByRole('button', { name: 'Submit application' }).click();
      await expect(page.getByTestId('practice-sent')).toHaveText('Practice form: nothing was sent.');
      await page.waitForTimeout(500);
      expect(requests).toEqual([]);
      await expect(page).toHaveURL(/\/demo\/apply\/customer-support-executive$/);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
