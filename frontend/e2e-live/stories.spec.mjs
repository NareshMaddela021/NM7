// Student stories on a desktop and a 390 px phone, against the real API: a student sends a story with the consent
// tick (Help & referral); it isn't public until Nm7 approves it (typo fix only); it shows on the home page and
// /for-orgs; the student withdraws it and it disappears.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('consent, review, public, withdraw', async ({ page, browser }) => {
      test.setTimeout(120_000);
      const tag = `${label}${Date.now().toString(36)}`;
      const text = `Story ${tag}: the ATS check showed what was missing and I was shortlisted by two companies in a week.`;
      const mail = email(`story-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/me/help');
      const box = page.getByTestId('my-stories');
      await box.getByTestId('story-text').fill(text);
      await expect(box.getByTestId('story-send')).toBeDisabled(); // no consent yet
      await box.getByTestId('story-consent').focus(); // keyboard: Space ticks it (the phone run's tap kept re-scrolling)
      await page.keyboard.press('Space');
      await expect(box.getByTestId('story-consent')).toBeChecked();
      await box.getByTestId('story-send').click();
      await expect(box.getByTestId('my-story')).toContainText('Waiting for review');
      expect(await noSideScroll(page)).toBe(true);
      expect(JSON.stringify((await call(page, '/api/public/stories?limit=12')).body)).not.toContain(tag);

      // Nm7's admin fixes a typo and approves
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      const owner = `owner-story-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/stories');
      const card = admin.getByTestId('admin-story').filter({ hasText: tag });
      await card.getByTestId('admin-story-text').fill(text.replace('in a week.', 'in one week.'));
      await card.getByTestId('admin-story-approve').click();
      await expect(admin.getByTestId('admin-story').filter({ hasText: tag })).toHaveCount(0); // left the "Waiting" list
      expect(await noSideScroll(admin)).toBe(true);
      await actx.close();

      // public on the home page and /for-orgs
      const anon = await (await browser.newContext(opts)).newPage();
      await anon.goto('/');
      await expect(anon.getByTestId('story').filter({ hasText: tag })).toContainText('in one week.');
      await anon.goto('/for-orgs');
      await expect(anon.getByTestId('stories')).toBeVisible();
      // withdrawn: gone
      await page.reload();
      await page.getByTestId('my-story').filter({ hasText: tag }).getByTestId('story-withdraw').click();
      await expect(page.getByTestId('my-story')).toHaveCount(0);
      await anon.goto('/');
      await expect(anon.getByTestId('story').filter({ hasText: tag })).toHaveCount(0);
      await anon.context().close();
    });
  });
}
