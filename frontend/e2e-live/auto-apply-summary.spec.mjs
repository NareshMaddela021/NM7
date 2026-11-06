// The Auto Apply summary (Phase 3, A6) on a desktop and a 390 px phone, against the real API: after the morning run
// the dashboard card says "Applied 1 · 1 need your answer · 0 ready to apply" with buttons to each list; the Auto
// Apply page shows the week (real numbers, a tip from real data) and the summary-emails switch; the "Stop these
// emails" page for Auto Apply. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('dashboard card, week report and tips, the emails switch', async ({ page, request }) => {
      test.setTimeout(150_000);
      const tag = `${label}s${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag);
      await co.post(`Data Analyst ${tag}`, { skills: ['SQL', 'Power BI', 'Kafka'] });
      await co.post(`Report Analyst ${tag}`, { skills: ['SQL', 'Kafka'], questions: [{ text: 'Notice period in days?', kind: 'number' }] });
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'sum');
      expect((await call(page, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], minScore: 50, dailyLimit: 5, consent: true }))).status).toBe(200);
      seed('auto-apply-run', me, 'past');

      await page.goto('/me');
      const card = page.getByTestId('aa-summary');
      await expect(card.getByTestId('aa-sum-today')).toHaveText('Applied 1 · 1 need your answer · 0 ready to apply');
      expect(await noSideScroll(page)).toBe(true);
      await card.getByRole('link', { name: /Needs your answer/ }).click();
      await expect(page).toHaveURL(/\/me\/auto-apply#needs$/);
      await expect(page.getByTestId('aa-needs')).toContainText(`Report Analyst ${tag}`);
      const week = page.getByTestId('aa-week');
      await expect(week).toContainText('Applied 1 · viewed 0 · shortlisted 0 · interviews 0');
      await expect(week.getByTestId('aa-tip').first()).toContainText('Kafka was asked in 2 of the 2 jobs that matched you');
      // the summary emails switch
      await expect(page.getByTestId('aa-emails')).toBeChecked();
      await page.getByText('Email me a short summary on days something happens, and a weekly report').click();
      await expect(page.getByTestId('aa-emails')).not.toBeChecked();
      await page.reload();
      await expect(page.getByTestId('aa-emails')).not.toBeChecked();
      expect(await noSideScroll(page)).toBe(true);
      // the stop page knows Auto Apply emails
      await page.goto('/stop-alerts#t=bad.token.value.here&k=autoapply');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Auto Apply summary emails');
    });
  });
}
