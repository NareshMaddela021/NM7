// Auto Apply 2.0, phase A7 on a desktop and a 390 px phone, against the real API. A tester has 2.0 on; the seed gives
// them this week's applications on every channel with replies: a company's email inviting them to an interview, Nm7
// "viewed" and "interview" moves and a hiring system's "shortlisted", plus a waiting question. The candidate sees the
// Replies tab (unread badge, newest first, the interview invites marked, filters, read the reply, "See it in the
// tracker" opening that row, mark as read) and This week (sent by channel, viewed, replies, interviews, waiting). An
// owner sees the "Auto Apply" section of Admin → Daily report (5 channels, 8 success measures with Met / Not met / No
// data yet) and, on Admin → Auto Apply, the same numbers and the pricing settings (off by default, payments coming
// soon), switched on and put back (both sizes share one database). No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('candidate: Replies inbox with an interview invite, and This week', async ({ page }) => {
      test.setTimeout(150_000);
      const tag = `a7${label[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'aa7r');
      seed('aa2-tester', me);
      const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'approve' };
      expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
      expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);
      const { items } = seed('aa7-replies', me, tag);

      await page.goto('/me/auto-apply/v2');
      const tab = page.getByTestId('aa2-tab-replies');
      await expect(tab.locator('.aa2-badge')).toHaveText('4');
      await tab.click();
      await expect(page).toHaveURL(/tab=replies/);
      const rows = page.getByTestId('aa2-inbox-row');
      await expect(rows).toHaveCount(4);
      await expect(page.getByTestId('aa2-inbox-count')).toContainText('4 unread · 2 interview invites');
      const first = rows.first();
      await expect(first).toContainText(`Mailer ${tag} Ltd`);
      await expect(first).toHaveAttribute('data-interview', '1');
      await expect(first.getByTestId('aa2-inbox-tag')).toContainText('Interview invite');
      await expect(rows.nth(1)).toContainText(`Inviter ${tag} Ltd invited you to an interview`);
      await expect(rows.nth(2)).toContainText('Hiring system · Darwinbox');
      await expect(rows.nth(3)).toContainText('opened your application');
      expect(await noSideScroll(page)).toBe(true);
      // read the email reply: it opens and is no longer unread
      await first.getByTestId('aa2-inbox-open').click();
      await expect(first.getByTestId('aa2-inbox-text')).toContainText('We would like to invite you to an interview on Thursday');
      await expect(page.getByTestId('aa2-inbox-row').first()).toHaveAttribute('data-unread', '0');
      await expect(page.getByTestId('aa2-inbox-count')).toContainText('3 unread');
      // only the interview invites
      await page.getByTestId('aa2-inbox-f-interview').click();
      await expect(rows).toHaveCount(2);
      await page.getByTestId('aa2-inbox-f-all').click();
      // linked to the tracker row
      await rows.nth(1).getByTestId('aa2-inbox-tracker').click();
      await expect(page).toHaveURL(new RegExp(`tab=tracker&item=${items.inviter}`));
      await expect(page.getByTestId('aa2-row')).toHaveCount(1);
      await expect(page.getByTestId('aa2-row')).toContainText(`BI Analyst ${tag}`);
      await expect(page.getByTestId('aa2-row')).toContainText('Interview');
      await page.getByTestId('aa2-tracker-all').click();
      await expect(page.getByTestId('aa2-row')).not.toHaveCount(1);
      // mark all as read
      await page.getByTestId('aa2-tab-replies').click();
      await expect(page.getByTestId('aa2-inbox-count')).toContainText('2 unread');
      await page.getByTestId('aa2-inbox-allread').click();
      await expect(page.getByTestId('aa2-inbox-count')).toContainText('0 unread');
      await expect(page.getByTestId('aa2-tab-replies').locator('.aa2-badge')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);

      // This week
      await page.getByTestId('aa2-tab-week').click();
      await expect(page.getByTestId('aa2-week-sent')).toContainText('4');
      await expect(page.getByTestId('aa2-week-viewed')).toContainText('3');
      await expect(page.getByTestId('aa2-week-replies')).toContainText('3');
      await expect(page.getByTestId('aa2-week-interviews')).toContainText('2');
      await expect(page.getByTestId('aa2-week-waiting')).toContainText('1');
      const ch = page.getByTestId('aa2-week-channels');
      await expect(ch.locator('[data-channel="internal"]')).toContainText('2');
      await expect(ch.locator('[data-channel="email"]')).toContainText('1');
      await expect(ch.locator('[data-channel="partner"]')).toContainText('1');
      await expect(page.getByTestId('aa2-week-rule')).toContainText('One routine Auto Apply email a day at most');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('admin: Daily report Auto Apply section, the numbers and pricing on Admin → Auto Apply', async ({ browser }) => {
      test.setTimeout(150_000);
      const tag = `a7a${label[0]}${Date.now().toString(36)}`;
      const owner = `aa7-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const admin = await ctx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);

      await admin.goto('/admin/daily-report');
      await admin.getByTestId('dr-refresh').click();
      await expect(admin.getByText('Report refreshed')).toBeVisible({ timeout: 30_000 });
      await expect(admin.getByRole('heading', { name: 'Auto Apply', level: 2 })).toBeVisible();
      const sec = admin.getByTestId('dr-aa');
      await expect(sec.getByTestId('dr-aa-ch')).toHaveCount(5);
      for (const c of ['Nm7', 'Email', 'Partner', 'Company form', 'One tap']) await expect(sec.getByTestId('dr-aa-channels')).toContainText(c);
      const measures = sec.getByTestId('dr-aa-measure');
      await expect(measures).toHaveCount(8);
      for (let i = 0; i < 8; i += 1) await expect(measures.nth(i)).toContainText(/Met|Not met|No data yet/);
      await expect(sec.locator('[data-key="bounce"]')).toContainText('target below 2%');
      await expect(sec.locator('[data-key="perSeeker"]')).toContainText('target 10–25 a week');
      await expect(admin.getByTestId('dr-aa-switch')).toContainText('testers only');
      expect(await noSideScroll(admin)).toBe(true);

      await admin.goto('/admin/auto-apply');
      const stats = admin.getByTestId('aa2-admin-stats');
      await expect(stats.getByTestId('dr-aa-ch')).toHaveCount(5);
      await expect(stats.getByTestId('dr-aa-measure')).toHaveCount(8);
      const panel = admin.getByTestId('aa2-admin');
      const pricing = panel.getByTestId('aa2-pricing');
      await expect(pricing.getByTestId('aa2-pricingOn')).not.toBeChecked();
      await expect(pricing.getByTestId('aa2-paymentsOn')).toBeDisabled();
      await expect(pricing).toContainText('Payments: coming soon');
      await expect(pricing).not.toContainText('WhatsApp');
      await expect(pricing.getByTestId('aa2-pricing-state')).toContainText('Pricing is off: no weekly limit.');
      expect(await noSideScroll(admin)).toBe(true);
      const before = (await call(admin, '/api/admin/auto-apply/v2')).body.settings;
      try {
        await pricing.getByTestId('aa2-pricingOn').check();
        await pricing.getByTestId('aa2-freePerWeek').fill('7');
        await pricing.getByTestId('aa2-paidLimit').fill('40');
        const saved = admin.waitForResponse((r) => r.url().includes('/api/admin/auto-apply/v2/settings') && r.request().method() === 'PUT');
        await panel.getByTestId('aa2-admin-save').click();
        expect((await saved).ok()).toBe(true);
        await expect(admin.getByTestId('aa2-pricing-state')).toContainText('Pricing is on: 7 free applications a week, 40 a week on the paid plan.');
        // put it back (the desktop and phone runs share one database): uncheck, save, reload and check
        await admin.getByTestId('aa2-pricingOn').uncheck();
        await admin.getByTestId('aa2-freePerWeek').fill(String(before.freePerWeek));
        await admin.getByTestId('aa2-paidLimit').fill(String(before.paidLimit));
        const back = admin.waitForResponse((r) => r.url().includes('/api/admin/auto-apply/v2/settings') && r.request().method() === 'PUT');
        await admin.getByTestId('aa2-admin-save').click();
        expect((await back).ok()).toBe(true);
        await admin.reload();
        await expect(admin.getByTestId('aa2-pricing-state')).toContainText('Pricing is off');
      } finally {
        await call(admin, '/api/admin/auto-apply/v2/settings', json('PUT', before));
      }
      await ctx.close();
    });
  });
}
