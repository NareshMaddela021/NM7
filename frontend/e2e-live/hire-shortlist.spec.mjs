// Phase 5 H2 instant shortlist, on a desktop and a 390 px phone, against the real API: a Verified company's "Hire now"
// tab shows a candidate who is ready to join (match score, when they join, salary fit), with no email or phone; the
// company invites everyone; the candidate accepts on /me/hire; the company then sees the email and the person in
// Applicants. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const RESUME = {
  personal: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 11111', location: 'Hyderabad' },
  summary: 'Fresher data analyst with SQL and Power BI projects.',
  skillGroups: [{ id: 'core', label: 'Core', value: 'SQL, Power BI, Excel' }],
  proj: [{ title: 'Sales dashboard', tagline: 'Power BI dashboard for a college fest', description: '', tech: 'Power BI, SQL' }],
  edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Computer Science', from: '2021-08', to: '2025-05' }],
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Hire now: shortlist, invite all, candidate accepts, contact shows', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}h${Date.now().toString(36)}`;
      const site = `hire${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Hireco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Uma' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Uma', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const title = `Data Analyst ${tag}`;
      const first = `Asha${tag.slice(-5)}`; // its own name: other runs' candidates may also suit
      const job = { title, description: 'Build weekly dashboards in SQL and Power BI for our stores. Freshers welcome; training given.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'], salary: { min: 240000, max: 360000, period: 'yearly' } };
      const posted = await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { data: { job }, headers: H })).json();
      expect(posted.status).toBe('active');
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      // the candidate: a resume and Ready to join
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.8.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
      await page.goto('/old-home');
      const smail = email(`hire-asha-${label}`);
      expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: `${first} Rao`, email: smail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
      expect((await call(page, '/api/auth/verify-email', json('POST', { email: smail, code: lastCode(smail) }))).status).toBe(200);
      const rs = (await call(page, '/api/me/resumes')).body;
      if (rs.length) await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data: RESUME }));
      else expect((await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', data: RESUME, active: true }))).status).toBe(201);
      expect((await call(page, '/api/me/hire', json('PUT', { on: true, consent: true, joinDate: '2026-12-01', cities: ['Hyderabad'], salary: { amount: 25000, unit: 'month' }, noticeDays: 15, jobTypes: ['full_time'] }))).status).toBe(200);

      // the company: Hire now
      const co = await (await browser.newContext(opts)).newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.goto('/company');
      await co.getByRole('tab', { name: 'Hire now' }).click();
      await co.getByTestId('co-hire-job').selectOption({ label: title });
      const row = co.getByTestId('co-hire-row').filter({ hasText: `${first} R.` });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('co-hire-score')).toContainText('% match');
      await expect(row.getByTestId('co-hire-when')).toContainText("15 days' notice");
      await expect(row.getByTestId('co-hire-salary')).toContainText('within your range');
      await expect(row.getByTestId('co-hire-trust')).toContainText('New - no history yet'); // H4
      await expect(co.getByTestId('co-hire')).not.toContainText(smail);
      expect(await noSideScroll(co)).toBe(true);
      await co.getByTestId('co-hire-note').fill('Can you come on Monday?');
      await co.getByTestId('co-hire-all').click();
      await expect(co.getByTestId('co-hire-msg')).toContainText(/invites? sent/);
      await expect(row.getByTestId('co-hire-state')).toHaveText('Invited: waiting');

      // the candidate accepts
      await page.goto('/me/hire');
      const inv = page.getByTestId('hire-invite').filter({ hasText: title });
      await expect(inv).toContainText('Can you come on Monday?');
      expect(await noSideScroll(page)).toBe(true);
      await inv.getByTestId('hire-accept').click();
      await expect(inv.getByTestId('hire-invite-state')).toContainText('Accepted');
      expect(await noSideScroll(page)).toBe(true); // the long badge wraps on a phone

      // the company sees the contact, and the person in Applicants
      await co.reload();
      await co.getByRole('tab', { name: 'Hire now' }).click();
      await co.getByTestId('co-hire-job').selectOption({ label: title });
      await expect(co.getByTestId('co-hire-inv').filter({ hasText: `${first} Rao` }).getByTestId('co-hire-contact')).toContainText(smail);
      await co.getByRole('tab', { name: 'Applicants' }).click();
      await expect(co.getByText(`${first} Rao`).first()).toBeVisible();
    });
  });
}
