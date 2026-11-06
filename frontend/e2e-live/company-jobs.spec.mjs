// Safe job posting (Phase 2, C3) on a desktop and a 390 px phone, against the real API: "Write the description for
// me" (no AI key here: the plain draft from the 3 lines), unfair wording caught by Check (Post disabled), a clean job
// goes live on the board, a scam-worded job waits for our team, a live job's edits left, close with the in-page
// confirm; Admin → Jobs → Waiting for review → reject with a reason typed on the page. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, lastCode, ownNetwork, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('write, check, post, review, edit, close; admin rejects the review job', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}p${Date.now().toString(36)}`;
      const site = `post${tag}.example`;
      const email = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Postco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email, name: 'Hira' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email, name: 'Hira', code: lastCode(email), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      await page.goto('/company');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await page.reload();
      await page.getByRole('tab', { name: 'Jobs' }).click();
      const jobs = page.getByTestId('co-jobs');
      await expect(jobs.getByTestId('co-jobs-room')).toHaveText('Live jobs: 0 of 3.');
      await jobs.getByRole('button', { name: 'Post a job' }).click();
      const form = page.getByTestId('co-job-form');
      // the writer
      await form.getByText('Write the description for me').click();
      await form.getByLabel('The role').fill(`QA Trainee ${tag}`);
      await form.getByLabel('Skills needed').fill('Manual testing, SQL');
      await form.getByLabel('City and salary (optional)').fill('Pune, ₹2.4–3 LPA');
      await form.getByRole('button', { name: 'Write it' }).click();
      await expect(form.getByTestId('co-writer-note')).toContainText('simple draft');
      await expect(form.getByLabel('Job description')).toHaveValue(/Manual testing, SQL/);
      await expect(form.getByLabel('Job title')).toHaveValue(`QA Trainee ${tag}`);
      await form.getByLabel('Cities (comma between)').fill('Pune');
      // unfair wording: Check shows it and Post is disabled
      const desc = await form.getByLabel('Job description').inputValue();
      await form.getByLabel('Job description').fill(`${desc}\n\nMale preferred.`);
      await form.getByRole('button', { name: 'Check' }).click();
      await expect(form.getByTestId('co-job-check')).toContainText('Please remove: male preferred');
      await expect(form.getByRole('button', { name: 'Post job' })).toBeDisabled();
      await form.getByLabel('Job description').fill(desc);
      await form.getByRole('button', { name: 'Check' }).click();
      await expect(form.getByTestId('co-job-check')).toContainText('Looks good');
      await wide();
      await form.getByRole('button', { name: 'Post job' }).click();
      const live = jobs.getByTestId('co-job').filter({ hasText: `QA Trainee ${tag}` });
      await expect(live.getByTestId('co-job-status')).toHaveText('Live');
      // a scam-worded job waits for our team
      await jobs.getByRole('button', { name: 'Post a job' }).click();
      await form.getByLabel('Job title').fill(`Typing Work ${tag}`);
      await form.getByLabel('Job description').fill('Simple typing work from home for freshers. Pay a registration fee of Rs 300 to get started today.');
      await form.getByLabel('Cities (comma between)').fill('Pune');
      await form.getByRole('button', { name: 'Check' }).click();
      await expect(form.getByTestId('co-job-check')).toContainText('scam warning sign');
      await form.getByRole('button', { name: 'Post job' }).click();
      const held = jobs.getByTestId('co-job').filter({ hasText: `Typing Work ${tag}` });
      await expect(held.getByTestId('co-job-status')).toHaveText('Waiting for our team');
      // edit the live job: edits left
      await live.getByRole('button', { name: /Edit/ }).click();
      await expect(form).toContainText('you can edit it 2 more times');
      await form.getByLabel('Job description').fill(`${desc}\n\nShift timings: 9 to 6.`);
      await form.getByRole('button', { name: 'Save' }).click();
      await expect(live.getByRole('button', { name: /Edit/ })).toContainText('1 edits left');
      // close (in-page confirm)
      await live.getByRole('button', { name: 'Close job' }).click();
      await live.getByRole('alert').getByRole('button', { name: 'Close job' }).click();
      await expect(live.getByTestId('co-job-status')).toHaveText('Closed');
      await wide();

      // Admin rejects the held job with a reason typed on the page
      const owner = `cj-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const admin = await ctx.newPage();
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/jobs');
      await admin.getByLabel('Search').fill(`Typing Work ${tag}`);
      await admin.getByLabel('Status').selectOption('review');
      await admin.getByRole('button', { name: 'Search' }).click();
      const box = admin.getByTestId('job-review');
      await expect(box).toContainText('registration fee');
      await box.getByRole('button', { name: 'Reject' }).click();
      await box.getByLabel('Why can’t it go live?').fill('Asks candidates to pay a fee.');
      await box.getByRole('button', { name: 'Reject' }).click();
      await expect(admin.getByText('Rejected: the company was emailed')).toBeVisible();
      await ctx.close();
    });
  });
}
