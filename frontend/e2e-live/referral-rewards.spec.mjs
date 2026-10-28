// Referral rewards on a desktop and a 390 px phone, against the real API: Help & referral shows the invite link
// and "0 of 3"; friends who sign up with it from other networks, confirm their email and build a named resume count
// ("2 of 3", then "Downloads unlocked"); a sign-up from the inviter's own browser doesn't; Admin > Settings lists
// the reward and revokes it.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

async function friend(browser, opts, code, i, label) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  // another network: the address our proxy would pass on (added outside the page, so no CORS preflight)
  const ip = `10.${label === 'phone' ? 2 : 1}.${i}.${Date.now() % 200}`;
  await page.route(`${API}/**`, (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': ip } }));
  await page.goto('/');
  const mail = email(`friend${i}-${label}`);
  const body = { role: 'customer', name: `Friend ${i}`, email: mail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true, ref: code };
  expect((await call(page, '/api/auth/signup', json('POST', body))).status).toBe(201);
  expect((await call(page, '/api/auth/verify-email', json('POST', { email: mail, code: lastCode(mail) }))).status).toBe(200);
  const rs = (await call(page, '/api/me/resumes')).body;
  const data = { personal: { name: `Friend ${i}` } };
  if (rs.length) await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data }));
  else expect((await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', data }))).status).toBe(201);
  await ctx.close();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('invite link, 2 of 3, own browser does not count, unlocked, admin revokes', async ({ page, browser }) => {
      test.setTimeout(150_000);
      const mail = email(`inviter-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/me/help');
      const reward = page.getByTestId('ref-reward');
      await expect(reward).toContainText('0 of 3');
      const link = await page.getByTestId('ref-link').textContent();
      const code = link.split('ref=')[1];
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(await noSideScroll(page)).toBe(true);

      // a sign-up from the inviter's own browser (their session goes along) doesn't count
      const alt = email(`alt-${label}`);
      await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: 'Alt Me', email: alt, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true, ref: code }));
      await friend(browser, opts, code, 1, label);
      await friend(browser, opts, code, 2, label);
      await page.reload();
      await expect(reward).toContainText('2 of 3');
      await expect(page.getByTestId('ref-friend').filter({ hasText: 'Alt' })).toContainText('doesn’t count');
      await friend(browser, opts, code, 3, label);
      await page.reload();
      await expect(reward).toContainText('Downloads unlocked');

      // admin: listed, revoke
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      const owner = `owner-ref-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/settings');
      await expect(admin.getByTestId('ref-needed')).toHaveValue('3');
      const row = admin.getByTestId('ref-row').filter({ hasText: mail });
      await expect(row).toContainText('3');
      admin.once('dialog', (d) => d.accept('Test revoke'));
      await row.getByTestId('ref-revoke').click();
      await expect(row).toContainText('Revoked');
      expect(await noSideScroll(admin)).toBe(true);
      await page.reload();
      await expect(reward).toContainText('was removed');
      await actx.close();
    });
  });
}
