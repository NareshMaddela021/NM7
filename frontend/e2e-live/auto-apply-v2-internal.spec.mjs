// Auto Apply 2.0, phase A2 (jobs posted on Nm7) on a desktop and a 390 px phone, against the real API. A tester has
// 2.0 on (full auto); a verified company with a tester on its team posts a job and the application arrives without
// the post waiting for it: "Sent by Auto Apply" on the applicant card with the match score, 3 reasons, notice period,
// expected salary and the cover note. The company shortlists; the candidate's tracker shows the update (channel On Nm7)
// and "Got it" clears it. A second job posted with auto applications off gets nothing until the company turns them on
// in the job's Auto Apply settings. The posting form shows the controls at their defaults. The demo company shows its
// labelled auto applications and the controls. Every test uses its own company, candidate and jobs (desktop and phone
// share one database), so nothing needs putting back. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

const tracker = async (page) => (await call(page, '/api/me/auto-apply/v2/tracker')).body;

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('company posts, the auto application arrives labelled; shortlist reaches the tracker; per-job controls', async ({ page, request, browser }) => {
      test.setTimeout(200_000);
      const tag = `a2${label[0]}${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag);
      seed('aa2-tester', `hr-${tag}@example.com`); // a tester on the team: a test company while the switch is OFF
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'aa2i');
      seed('aa2-tester', me);
      const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'full_auto', noticePeriod: '30_days', minSalary: 300000 };
      expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
      expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);

      // the company posts: the application arrives right after (the post never waits for it)
      const job = await co.post(`Data Analyst ${tag}`);
      expect(job.status).toBe('active');
      expect(job.autoApply).toEqual({ accept: true, max: 50, minLevel: 0, received: 0 });
      await expect.poll(async () => (await tracker(page)).items.filter((x) => x.job.id === job.id).map((x) => x.stage), { timeout: 30_000 }).toEqual(['applied']);

      // the company's applicant card
      const cctx = await browser.newContext(opts);
      const cp = await cctx.newPage();
      cp.on('dialog', () => { throw new Error('no browser dialogs'); });
      await cp.goto('/company');
      await cp.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
      await cp.reload();
      await cp.getByRole('tab', { name: 'Applicants' }).click();
      const card = cp.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' });
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('co-ap-auto2')).toHaveText('Sent by Auto Apply');
      const block = card.getByTestId('co-ap-auto');
      await block.locator('summary').click();
      await expect(block).toContainText(/match \d+\/100/);
      await expect(block.getByTestId('co-ap-auto-reasons').locator('li')).toHaveCount(3);
      await expect(block.getByTestId('co-ap-auto-reasons')).toContainText('Matches 2 of 2 skills');
      await expect(block.getByTestId('co-ap-auto-notice')).toHaveText('30 days');
      await expect(block.getByTestId('co-ap-auto-salary')).toHaveText('₹3 lakh a year or more');
      await expect(block.getByTestId('co-ap-auto-cover')).toContainText(`I am applying for the Data Analyst ${tag} role`);
      expect(await noSideScroll(cp)).toBe(true);
      // shortlist
      const moved = cp.waitForResponse((r) => r.url().includes('/status') && r.request().method() === 'POST');
      await card.getByRole('button', { name: 'Shortlist' }).click();
      expect((await moved).ok()).toBe(true);
      await expect(card.getByTestId('co-ap-stage')).toHaveText('Shortlisted');

      // the candidate's tracker: the update, the channel, and "Got it"
      await page.goto('/me/auto-apply/v2');
      const upd = page.getByTestId('aa2-updates');
      await expect(upd).toContainText(`shortlisted you for Data Analyst ${tag}`);
      const row = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row).toContainText('On Nm7');
      await expect(row).toContainText('Shortlisted');
      expect(await noSideScroll(page)).toBe(true);
      const seen = page.waitForResponse((r) => r.url().includes('/tracker/seen'));
      await page.getByTestId('aa2-updates-seen').click();
      expect((await seen).ok()).toBe(true);
      await expect(page.getByTestId('aa2-updates')).toHaveCount(0);

      // a job posted with auto applications off gets none until the company turns them on (not an edit)
      const off = await co.post(`Reporting Analyst ${tag}`, { autoApply: { accept: false } });
      expect(off.autoApply.accept).toBe(false);
      await cp.getByRole('tab', { name: 'Jobs' }).click();
      const jr = cp.getByTestId('co-job').filter({ hasText: `Reporting Analyst ${tag}` });
      await expect(jr.getByTestId('aa-co-summary')).toHaveText('⚡ Auto Apply: off');
      await expect(cp.getByTestId('co-job').filter({ hasText: `Data Analyst ${tag}` }).getByTestId('aa-co-summary')).toContainText('on · 1 of 50 received');
      expect((await tracker(page)).items.some((x) => x.job.id === off.id)).toBe(false);
      await jr.getByTestId('aa-co-edit').click();
      await jr.getByTestId('aa-co-accept').check();
      await jr.getByTestId('aa-co-max').fill('5');
      expect(await noSideScroll(cp)).toBe(true);
      const saved = cp.waitForResponse((r) => r.url().includes(`/jobs/${off.id}/auto-apply`) && r.request().method() === 'PUT');
      await jr.getByTestId('aa-co-save').click();
      expect((await saved).ok()).toBe(true);
      await expect(jr.getByTestId('aa-co-summary')).toContainText('on · ');
      await expect(jr.getByTestId('aa-co-summary')).toContainText('of 5 received');
      await expect(jr).toContainText('Edit (2 edits left)'); // the controls don't use an edit
      await expect.poll(async () => (await tracker(page)).items.filter((x) => x.job.id === off.id).map((x) => x.stage), { timeout: 30_000 }).toEqual(['applied']);
      // the posting form shows the controls at their defaults (nothing posted here)
      await cp.getByRole('button', { name: 'Post a job' }).click();
      const auto = cp.getByTestId('aa-co-new');
      await expect(auto).toBeVisible();
      await expect(auto.getByTestId('aa-co-accept')).toBeChecked();
      await expect(auto.getByTestId('aa-co-max')).toHaveValue('50');
      expect(await noSideScroll(cp)).toBe(true);
      await cctx.close();
    });

    test('demo company: labelled auto applications with score and reasons, and the controls', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `aa2-demo-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      await page.getByRole('tab', { name: 'Applicants' }).click();
      const auto = page.getByTestId('co-applicant').filter({ has: page.getByTestId('co-ap-auto2') });
      const first = auto.first();
      await expect(first).toBeVisible();
      await first.getByTestId('co-ap-auto').locator('summary').click();
      await expect(first.getByTestId('co-ap-auto')).toContainText(/match \d+\/100/);
      await expect(first.getByTestId('co-ap-auto-cover')).toBeVisible();
      expect(await first.getByTestId('co-ap-auto-reasons').locator('li').count()).toBeGreaterThanOrEqual(2);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByRole('tab', { name: 'Jobs' }).click();
      await expect(page.getByTestId('aa-co-summary').first()).toContainText('Auto Apply: on');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
