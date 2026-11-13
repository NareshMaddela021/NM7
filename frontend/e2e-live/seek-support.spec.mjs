// Phase 6 S9 special filters and guidance, on a desktop and a 390 px phone, against the real API: a Verified company
// declares an inclusive policy on its page; /jobs "Support: inclusive employer" shows its job and the job page shows
// the policy as the company's own words; a candidate marks "returning after a break" and lists an employer to hide
// from; /me/guidance lists private roles for exams, suggests honest gap wording, and flags wording that hides a gap.
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('inclusive filter + policy text; Ready to join extras; honest guidance', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}s${Date.now().toString(36)}`;
      const site = `sp${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Inclusivo ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Uma' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Uma', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const title = `Support Analyst ${tag}`;
      const job = { title, description: 'Answer customer questions by chat and email, and keep tickets up to date. Freshers welcome; training given.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Customer service'] };
      const posted = await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { data: { job }, headers: H })).json();
      const co = await (await browser.newContext(opts)).newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.reload();
      await co.getByRole('tab', { name: 'Company page' }).click();
      await co.getByTestId('cp-pol-inclusive').fill('Equal pay review every year; a creche at the office.');
      await co.getByRole('button', { name: 'Save' }).click();
      await expect(co.getByRole('status').or(co.getByText('Saved'))).toBeVisible();
      expect(await noSideScroll(co)).toBe(true);

      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/jobs?support=inclusive');
      await expect(page.locator('#f-support')).toHaveValue('inclusive');
      await expect(page.getByText(title)).toBeVisible();
      await page.goto(`/jobs/${posted.slug}`);
      await expect(page.getByTestId('job-policies')).toContainText('Equal pay review every year');
      await expect(page.getByTestId('job-policies')).toContainText("company's own words");
      expect(await noSideScroll(page)).toBe(true);

      // the candidate: Ready to join extras, then guidance
      const smail = email(`sp-${label}`);
      seed('customer', smail, 'Lata Devi', PASSWORD);
      await login(page, smail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/hire');
      await page.getByTestId('hj-returner').check();
      await page.getByTestId('hj-hide').fill('Old Employer Pvt Ltd, oldemployer.in');
      expect(await noSideScroll(page)).toBe(true);
      await page.goto('/me/guidance');
      await expect(page.getByTestId('gd-exam')).toHaveCount(4);
      await expect(page.getByTestId('gd-exams')).toContainText('Railways');
      await page.getByTestId('gd-from').fill('2023-06');
      await page.getByTestId('gd-to').fill('2024-05');
      await page.getByTestId('gd-reason').selectOption('exam_prep');
      await page.getByTestId('gd-suggest').click();
      await expect(page.getByTestId('gd-suggestions')).toContainText('Career break (Jun 2023 – May 2024): preparing for competitive exams.');
      await page.getByTestId('gd-mine').fill('Worked continuously from 2021 to 2024.');
      await page.getByTestId('gd-check').click();
      await expect(page.getByTestId('gd-check-bad')).toContainText('no gap');
      await page.getByTestId('gd-mine').fill('Career break (Jun 2023 – May 2024) preparing for exams.');
      await page.getByTestId('gd-check').click();
      await expect(page.getByTestId('gd-check-ok')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
