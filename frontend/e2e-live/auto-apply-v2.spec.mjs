// Auto Apply 2.0 (A1 "Engine") on a desktop and a 390 px phone, against the real API: hidden from a real user while
// Admin's switch is OFF (404, nothing new on the page); a tester saves the rules, opts in, the morning run puts a 70+
// job on the approval list (with its tailored cover note) and a 55–69 job in "Suggested for you"; Approve all sends it
// and the tracker shows it Applied with the channel and "What was sent"; Pause / Resume. Admin → Auto Apply 2.0: the
// hidden state, a threshold saved; the demo student Kavya shows every tracker state, waiting questions and
// suggestions. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('candidate: hidden for real users; rules, opt-in, approve all, tracker, what was sent, suggested', async ({ page, request }) => {
      test.setTimeout(200_000);
      const tag = `v2${label[0]}${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag);
      await co.post(`Data Analyst ${tag}`);
      await co.post(`Kafka Analyst ${tag}`, { skills: ['SQL', 'Kafka', 'Spring', 'Java'] });
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'aa2');
      // a real user while the switch is OFF: nothing
      expect((await call(page, '/api/me/auto-apply/v2')).status).toBe(404);
      await page.goto('/me/auto-apply');
      await expect(page.getByTestId('auto-apply')).toBeVisible();
      await expect(page.getByTestId('aa-v2-link')).toHaveCount(0);
      await page.goto('/me/auto-apply/v2');
      await expect(page.getByTestId('aa2-missing')).toBeVisible();
      // a tester
      seed('aa2-tester', me);
      await page.goto('/me/auto-apply');
      await page.getByTestId('aa-v2-link').getByRole('link', { name: 'Open Auto Apply 2.0' }).click();
      await expect(page).toHaveURL(/\/me\/auto-apply\/v2/);
      await expect(page.getByTestId('aa2-consent')).toBeVisible();
      await expect(page.getByTestId('aa2-turn-on')).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);
      // rules
      await page.getByTestId('aa2-tab-rules').click();
      const form = page.getByTestId('aa2-rules');
      await form.getByLabel('Roles or skills (comma between)').fill(tag);
      await form.getByLabel('Cities (comma between; empty = anywhere)').fill('Hyderabad');
      await form.getByLabel('Notice period').selectOption('30_days');
      await expect(form.getByTestId('aa2-modes').getByRole('radio', { name: /Approve each/ })).toBeChecked(); // the default
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('aa2-save').click();
      await expect(page.getByText('Rules saved')).toBeVisible();
      // explicit opt-in
      await page.getByTestId('aa2-agree').check();
      await page.getByTestId('aa2-turn-on').click();
      await expect(page.getByTestId('aa2-state')).toHaveText('Auto Apply 2.0 is on');
      // the morning run
      seed('auto-apply-run', me);
      await page.reload();
      await page.getByTestId('aa2-tab-approve').click();
      const item = page.getByTestId('aa2-approval');
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(`Data Analyst ${tag}`);
      await item.getByRole('button', { name: 'See what will be sent' }).click();
      await expect(item.getByTestId('aa2-cover')).toContainText(`I am applying for the Data Analyst ${tag} role`);
      await expect(item.getByTestId('aa2-cover')).toContainText('My notice period is 30 days');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('aa2-approve-all').click();
      await expect(page.getByText('Sent 1')).toBeVisible();
      // the tracker
      await page.getByTestId('aa2-tab-tracker').click();
      await expect(page.getByTestId('aa2-stage-applied')).toContainText('1');
      const row = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row).toContainText('On Nm7');
      await row.getByTestId('aa2-what').click();
      await expect(row.getByTestId('aa2-sent')).toContainText('This went out to the company');
      expect(await noSideScroll(page)).toBe(true);
      // Suggested for you
      await page.getByTestId('aa2-tab-suggested').click();
      const sug = page.getByTestId('aa2-suggestion');
      await expect(sug).toContainText(`Kafka Analyst ${tag}`);
      await sug.getByTestId('aa2-sug-apply').click();
      await expect(page.getByText('Sent', { exact: true })).toBeVisible();
      // pause / resume
      await page.getByTestId('aa2-pause').click();
      await expect(page.getByTestId('aa2-state')).toHaveText('Auto Apply 2.0 is paused');
      await page.getByTestId('aa2-pause').click();
      await expect(page.getByTestId('aa2-state')).toHaveText('Auto Apply 2.0 is on');
      const r = (await call(page, '/api/me/auto-apply/v2/tracker')).body;
      expect(r.items.filter((x) => x.stage === 'applied')).toHaveLength(2);
    });

    test('admin: switch, thresholds; demo Kavya in every state', async ({ browser }) => {
      test.setTimeout(150_000);
      const tag = `v2a${label[0]}${Date.now().toString(36)}`;
      const owner = `aa2-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const admin = await ctx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/auto-apply');
      const panel = admin.getByTestId('aa2-admin');
      await expect(panel.getByTestId('aa2-admin-state')).toContainText('Hidden: only admins, demo accounts and the testers below');
      await expect(panel.getByTestId('aa2-autoMin')).toHaveValue('70');
      await expect(panel.getByTestId('aa2-suggestMin')).toHaveValue('55');
      await expect(panel.getByTestId('aa2-maxDailyLimit')).toHaveValue('25');
      expect(await noSideScroll(admin)).toBe(true);
      await panel.getByTestId('aa2-autoMin').fill('72');
      const first = admin.waitForResponse((r) => r.url().includes('/api/admin/auto-apply/v2/settings') && r.request().method() === 'PUT');
      await panel.getByTestId('aa2-admin-save').click();
      expect((await first).ok()).toBe(true);
      await expect(admin.getByTestId('aa2-admin').getByTestId('aa2-autoMin')).toHaveValue('72');
      // put 70 back (the desktop and phone runs share one database): save, wait for the server, reload and check
      await admin.getByTestId('aa2-admin').getByTestId('aa2-autoMin').fill('70');
      const saved = admin.waitForResponse((r) => r.url().includes('/api/admin/auto-apply/v2/settings') && r.request().method() === 'PUT');
      await admin.getByTestId('aa2-admin').getByTestId('aa2-admin-save').click();
      expect((await saved).ok()).toBe(true);
      await admin.reload();
      await expect(admin.getByTestId('aa2-admin').getByTestId('aa2-autoMin')).toHaveValue('70');
      // the demo student
      await admin.getByTestId('aa-demo-open').click();
      await expect(admin).toHaveURL(/\/me\/auto-apply$/);
      await admin.getByTestId('aa-v2-link').getByRole('link', { name: 'Open Auto Apply 2.0' }).click();
      await expect(admin.getByTestId('aa2-state')).toHaveText('Auto Apply 2.0 is on');
      for (const k of ['ready', 'waiting', 'applied', 'viewed', 'replied', 'closed']) {
        await expect(admin.getByTestId(`aa2-stage-${k}`)).not.toContainText(/^0/);
      }
      await expect(admin.getByTestId('aa2-row').filter({ hasText: /^.Reporting Analyst/ })).toContainText('By email');
      expect(await noSideScroll(admin)).toBe(true);
      await admin.getByTestId('aa2-tab-waiting').click();
      await expect(admin.getByTestId('aa2-waiting-item').first()).toBeVisible();
      await admin.getByTestId('aa2-tab-suggested').click();
      await expect(admin.getByTestId('aa2-suggestion')).toHaveCount(2);
      await admin.getByTestId('aa2-tab-approve').click();
      await expect(admin.getByTestId('aa2-approval')).toHaveCount(2);
      expect(await noSideScroll(admin)).toBe(true);
      await ctx.close();
    });
  });
}
