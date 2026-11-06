// Company trust and student protection (Phase 2, C4) on a desktop and a 390 px phone, against the real API: a
// Verified company's job shows its badge and trust score on the board and the job page, "Why this score" lists the
// parts in plain words, the company page shows the same; a signed-in student reports the job from the page (reason
// needed; no browser dialogs), two more students report it and it pauses; Admin → Jobs → Reports dismisses the
// reports and the job is live again. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

async function student(browser, opts, label, i) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const ip = `10.${label === 'phone' ? 4 : 3}.${i}.${Date.now() % 200}`; // each student from their own network
  await page.route(`${API}/**`, (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': ip } }));
  await page.goto('/');
  const mail = email(`reporter${i}-${label}`);
  const body = { role: 'customer', name: `Student ${i}`, email: mail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true };
  expect((await call(page, '/api/auth/signup', json('POST', body))).status).toBe(201);
  expect((await call(page, '/api/auth/verify-email', json('POST', { email: mail, code: lastCode(mail) }))).status).toBe(200);
  return { ctx, page };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('trust badge and why, report from the page, 3 reports pause, admin dismisses', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}t${Date.now().toString(36)}`;
      const site = `trust${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Trustco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: H });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      // a profile save works the score out again (the seed changes the database directly)
      await request.put(`${API}/api/company/${r.company.id}/page`, { data: { about: 'We build tools for small shops.' }, headers: H });
      const title = `Support Trainee ${tag}`;
      const job = { title, description: 'Answer customer questions by chat and email. Training given. Freshers welcome; good written English needed.', locations: ['Pune'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Communication'] };
      const posted = await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { data: { job }, headers: H })).json();
      expect(posted.status).toBe('active');
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      // the board card and the job page show the badge and score; "Why this score" lists the parts
      await page.goto(`/jobs?q=${encodeURIComponent(title)}`);
      const card = page.getByTestId('job-card').filter({ hasText: title });
      await expect(card.getByTestId('trust-line')).toContainText('Verified company');
      await expect(card.getByTestId('trust-score')).toHaveText(/^Trust \d+\/100$/);
      await card.getByRole('link', { name: title }).click();
      const trust = page.getByTestId('job-trust');
      await expect(trust.getByTestId('trust-line')).toContainText('Verified company');
      await trust.getByText('Why this score').click();
      await expect(trust.getByTestId('trust-why')).toContainText('Verified by Nm7 (registration checked by hand)');
      await expect(trust.getByTestId('trust-why')).toContainText('Companies can’t pay for it.');
      await expect(page.getByTestId('reply-badge')).toHaveCount(0); // no answers yet: no reply badge
      await expect(page.getByTestId('report-signin')).toBeVisible(); // signed out: sign in to report
      expect(await noSideScroll(page)).toBe(true);
      // the company page
      await trust.getByRole('link', { name: `See Trustco ${tag} Pvt Ltd on Nm7` }).click();
      await expect(page.getByTestId('company-public')).toContainText('Verified');
      await expect(page.getByTestId('company-public').getByTestId('trust-score')).toHaveText(/^Trust \d+\/100$/);

      // a signed-in student reports the job from the page
      const s1 = await student(browser, opts, label, 1);
      await s1.page.goto(`/jobs/${posted.slug}`);
      await s1.page.getByTestId('report-open').click();
      const form = s1.page.getByTestId('report-form');
      await form.getByRole('button', { name: 'Send report' }).click();
      await expect(form.getByRole('alert')).toHaveText('Choose a reason first.');
      await form.getByLabel('Reason').selectOption('scam');
      await form.getByLabel('Anything else we should know? (optional)').fill(`They asked me to pay for training ${tag}`);
      expect(await noSideScroll(s1.page)).toBe(true);
      await form.getByRole('button', { name: 'Send report' }).click();
      await expect(s1.page.getByTestId('report-done')).toHaveText('Thanks. Our team will check this job.');
      // two more students: the job pauses
      for (const i of [2, 3]) {
        const s = await student(browser, opts, label, i);
        const res = await call(s.page, `/api/jobs/${posted.id}/report`, json('POST', { reason: 'fake' }));
        expect(res.status).toBe(201);
        expect(res.body.paused).toBe(i === 3);
        await s.ctx.close();
      }
      await s1.page.reload();
      await expect(s1.page.getByTestId('job-status')).toHaveText('Closed');
      await s1.ctx.close();

      // Admin → Jobs → Reports: dismiss; the job is live again
      const owner = `ct-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const admin = await ctx.newPage();
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/jobs');
      await admin.getByRole('tab', { name: 'Reports' }).click();
      const row = admin.getByTestId('job-report').filter({ hasText: title });
      await expect(row).toContainText('3 reports');
      await expect(row).toContainText('Paused by reports');
      await expect(row).toContainText(`They asked me to pay for training ${tag}`);
      expect(await noSideScroll(admin)).toBe(true);
      await row.getByRole('button', { name: 'Dismiss and make live again' }).click();
      await expect(admin.getByText('Reports dismissed')).toBeVisible();
      await expect(row).toHaveCount(0);
      await ctx.close();
      await page.goto(`/jobs/${posted.slug}`);
      await expect(page.getByTestId('job-status')).toHaveText('Hiring');
    });
  });
}
