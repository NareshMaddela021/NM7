// Admin → Auto Apply and the demo (Phase 3, A7) on a desktop and a 390 px phone, against the real API: the numbers
// per day, the off switch with its in-page confirm (and back on), a default saved, a student paused and resumed; the
// company marks an auto application "Not relevant"; "Reset and open as student (Auto Apply)" opens the demo student
// with one applied, one sent by email, one needing an answer and one ready to apply. No browser dialogs, no sideways
// scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('admin numbers, off switch, defaults, pause; company mark; demo student', async ({ page, request, browser }) => {
      test.setTimeout(200_000);
      const tag = `${label}d${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag);
      await co.post(`Data Analyst ${tag}`);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'adm');
      expect((await call(page, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], minScore: 50, dailyLimit: 5, consent: true }))).status).toBe(200);
      seed('auto-apply-run', me, 'past');

      // the company marks it "Not relevant"
      const cctx = await browser.newContext(opts);
      const cp = await cctx.newPage();
      await cp.goto('/company');
      await cp.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
      await cp.reload();
      await cp.getByRole('tab', { name: 'Applicants' }).click();
      const row = cp.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' });
      await expect(row.getByTestId('co-ap-origin')).toHaveText('Auto');
      await row.getByTestId('co-ap-irrelevant').click();
      await expect(row.getByTestId('co-ap-marked')).toBeVisible();
      await cctx.close();

      // Admin → Auto Apply
      const owner = `aa-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/auto-apply');
      await expect(admin.getByTestId('aa-days')).toContainText('Nm7');
      await expect(admin.getByTestId('aa-days')).not.toContainText('—'); // one number per cell (item 36)
      await expect(admin.getByTestId('aa-runs')).toContainText('students');
      expect(await noSideScroll(admin)).toBe(true);
      // the off switch, with an in-page confirm, then back on
      await admin.getByRole('button', { name: 'Turn off for everyone' }).click();
      await admin.getByTestId('aa-off-confirm').click();
      await expect(admin.getByTestId('aa-switch-state')).toHaveText('Auto Apply is OFF: nothing is applied or sent');
      await admin.getByRole('button', { name: 'Turn on' }).click();
      await expect(admin.getByTestId('aa-switch-state')).toHaveText('Auto Apply is on for everyone');
      // a default
      await admin.getByTestId('aa-emailDailyCap').fill('75');
      await admin.getByRole('button', { name: 'Save defaults' }).click();
      await expect(admin.getByTestId('aa-emailDailyCap')).toHaveValue('75');
      // pause and resume the student
      await admin.getByLabel('Find a student').fill(me);
      await admin.getByTestId('aa-students').locator('..').getByRole('button', { name: 'Search' }).click();
      const st = admin.getByTestId('aa-students').locator('li').filter({ hasText: me });
      await st.getByRole('button', { name: 'Pause' }).click();
      await st.getByLabel('Why').fill('Testing the pause');
      await st.getByRole('button', { name: 'Pause' }).click();
      await expect(st).toContainText('paused by Admin: Testing the pause');
      await st.getByRole('button', { name: 'Resume' }).click();
      await expect(st).toContainText(' · on · ');
      await expect(admin.getByTestId('aa-companies')).toContainText('1 marked “Not relevant”');
      await admin.getByTestId('aa-emailDailyCap').fill('80');
      await admin.getByRole('button', { name: 'Save defaults' }).click();
      // the demo student
      await admin.getByTestId('aa-demo-open').click();
      await expect(admin).toHaveURL(/\/me\/auto-apply$/);
      await expect(admin.getByTestId('aa-applied')).toContainText('Junior Data Analyst');
      await expect(admin.getByTestId('aa-sent')).toContainText('Sent by email to hr@demotech.demo.nm7.invalid');
      await expect(admin.getByTestId('aa-need')).toHaveCount(1);
      await expect(admin.getByTestId('aa-ready-item')).toContainText('Data Engineer Intern');
      expect(await noSideScroll(admin)).toBe(true);
      await actx.close();
    });
  });
}
