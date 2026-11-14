// Item 41 (fix round, 7 Nov): Telugu and Hindi are hidden until Admin → Settings → "Show Telugu and Hindi" is on.
// Off (the default): no language switch on the home page, sign-in or the job board, the easy dashboard opens in
// English without "Choose your language", and a saved Telugu choice falls back to English. On: the switches are back.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

test.afterAll(() => seed('site-langs', 'off'));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('hidden by default; Admin can show them again', async ({ page, browser }) => {
      test.setTimeout(120_000);
      seed('site-langs', 'off');
      for (const path of ['/', '/login', '/jobs', '/for-orgs']) {
        const flags = page.waitForResponse((r) => r.url().endsWith('/api/public/site-flags'));
        await page.goto(path);
        await flags;
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('.hx-lang')).toHaveCount(0);
      }
      // the easy dashboard: no question, English, a saved Telugu choice ignored
      await studentWith(page, label, STRONG, 'nolang');
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'te' }))).status).toBe(200);
      await page.goto('/me/simple');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hi Asha');
      await expect(page.getByTestId('sx-pick-te')).toHaveCount(0);
      await expect(page.getByTestId('sx-lang')).toHaveCount(0);
      await page.goto('/me/simple/language');
      await expect(page).toHaveURL(/\/me\/simple$/);
      // Admin turns them on: the switches come back
      const owner = `langs-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const admin = await ctx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/settings');
      await expect(admin.getByTestId('langs-on')).not.toBeChecked();
      await admin.getByTestId('langs-on').check();
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await expect(admin.getByTestId('langs-on')).toBeChecked();
      await ctx.close();
      await page.goto('/old-home');
      await expect(page.locator('.hx-lang').first()).toBeVisible();
      await page.goto('/me/simple');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('నమస్తే Asha');
      seed('site-langs', 'off');
    });
  });
}
