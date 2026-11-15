// Apply on Nm7 into the company dashboard (Phase 2, C5) on a desktop and a 390 px phone, against the real API: a
// company job with screening questions; a student answers them and ticks the consent box on the job page (both
// needed); the company's Applicants tab ranks them with the match reasons and the "Not a fit" label, hides contact
// details until shortlisting, schedules an interview (in-page form) and adds them to the talent pool; the student sees
// the stages in My applications and withdraws; /grievance explains the data and complaints. No browser dialogs, no
// sideways scrolling.
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

    test('questions + consent on apply; ranked applicants, shortlist, interview, pool; student sees stages and withdraws', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}a${Date.now().toString(36)}`;
      const site = `apply${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Applyco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Uma' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Uma', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const title = `Data Analyst ${tag}`;
      const questions = [
        { text: 'Can you work from Hyderabad?', kind: 'yesno', want: 'yes' },
        { text: 'Which shift suits you?', kind: 'choice', options: ['Day', 'Night'], accept: ['Day'] },
      ];
      const job = { title, description: 'Build weekly dashboards in SQL and Power BI for our stores. Freshers welcome; training given.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'], questions };
      const posted = await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { data: { job }, headers: H })).json();
      expect(posted.status).toBe('active');
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      // the student: a resume, then the job page asks the questions and for consent
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.7.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
      await page.goto('/old-home');
      const smail = email(`asha-${label}`);
      expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: 'Asha Rao', email: smail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
      expect((await call(page, '/api/auth/verify-email', json('POST', { email: smail, code: lastCode(smail) }))).status).toBe(200);
      const rs = (await call(page, '/api/me/resumes')).body;
      if (rs.length) await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data: RESUME }));
      else expect((await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', data: RESUME, active: true }))).status).toBe(201);
      await page.goto(`/jobs/${posted.slug}`);
      await page.getByTestId('apply').click();
      const form = page.getByTestId('apply-form');
      await expect(form).toContainText('Can you work from Hyderabad?');
      await form.getByTestId('apply-send').click();
      await expect(form.getByRole('alert')).toHaveText('Answer every question first.');
      await form.getByRole('radio', { name: 'Yes' }).check();
      await form.getByRole('radio', { name: 'Night' }).check(); // breaks the shift rule: "Not a fit" for the company
      await form.getByTestId('apply-send').click();
      await expect(form.getByRole('alert')).toHaveText(`Tick the box to share your resume with Applyco ${tag} Pvt Ltd.`);
      await form.getByTestId('apply-consent').check();
      expect(await noSideScroll(page)).toBe(true);
      await form.getByTestId('apply-send').click();
      await expect(page.getByTestId('applied')).toBeVisible();

      // the company: Applicants tab
      const cctx = await browser.newContext(opts);
      const co = await cctx.newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.reload();
      await co.getByRole('tab', { name: 'Applicants' }).click();
      const card = co.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' });
      await expect(card.getByTestId('co-ap-score')).toContainText('%');
      await expect(card.getByTestId('co-ap-stage')).toHaveText('Viewed');
      await expect(card.getByTestId('co-ap-notfit')).toContainText('Which shift suits you? – answered Night');
      await expect(card).toContainText('Email and phone show once you shortlist this person.');
      expect(await noSideScroll(co)).toBe(true);
      await card.getByRole('button', { name: 'Shortlist' }).click();
      await expect(card.getByTestId('co-ap-contact')).toContainText(smail);
      // interview (in-page form)
      await card.getByRole('button', { name: 'Schedule an interview' }).click();
      const ivf = card.getByTestId('co-ap-ivform');
      const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      await ivf.getByLabel('Date').fill(day);
      await ivf.getByLabel('Time (IST)').fill('11:00');
      await ivf.getByLabel('Online link (https://…)').fill('https://meet.example.com/abc');
      await ivf.getByLabel('Round (optional)').fill('Technical round 1'); // fix round item 39
      await ivf.getByLabel('Interviewer’s name (optional)').fill('Ravi (HR)');
      await ivf.getByRole('button', { name: 'Send the invite' }).click();
      await expect(card.getByTestId('co-ap-stage')).toHaveText('Interview');
      await expect(card.getByTestId('co-ap-interview')).toContainText('Technical round 1 · Ravi (HR)');
      await card.getByRole('button', { name: 'Add to talent pool' }).click();
      await expect(card).toContainText('In your talent pool');
      await card.getByRole('button', { name: 'See the resume' }).click();
      await expect(card.getByTestId('co-ap-resume')).toBeVisible();
      await co.getByRole('tab', { name: 'Talent pool' }).click();
      await expect(co.getByTestId('co-pool')).toContainText('Asha Rao');

      // the student sees the stage and withdraws (in-page confirm)
      await page.goto('/me/jobs');
      const app = page.locator('article').filter({ hasText: `Applyco ${tag}` });
      await expect(page.getByRole('listitem', { name: /^Interview: / })).toContainText(`Applyco ${tag}`);
      await app.getByRole('button', { name: 'Withdraw application' }).click();
      await app.getByRole('button', { name: 'Withdraw', exact: true }).click();
      await expect(app.getByTestId('withdrawn')).toBeVisible();
      await co.getByRole('tab', { name: 'Applicants' }).click();
      await expect(co.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' })).toHaveCount(0);
      await cctx.close();

      // the grievance page
      await page.goto('/grievance');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your data when you apply, and complaints');
      await expect(page.getByTestId('grievance-contact')).toContainText('@');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
