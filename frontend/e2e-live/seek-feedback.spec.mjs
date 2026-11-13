// Phase 6 S6 interview feedback, on a desktop and a 390 px phone, against the real API: a Verified company marks an
// applicant Not selected and picks kind reasons (skills gap: SQL, communication); the student sees kind words with free
// practice and courses on /me/feedback (no interviewer, no company account), adds a private self-review and gets tips.
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Not selected → kind reasons → the student sees help; self-review tips', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}f${Date.now().toString(36)}`;
      const site = `fb${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Feedco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Uma' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Uma', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const job = { title: `Data Analyst ${tag}`, description: 'Build weekly dashboards in SQL and Power BI for our stores. Freshers welcome; training given.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'] };
      const posted = await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { data: { job }, headers: H })).json();
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      // the student applies
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.8.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
      await page.goto('/');
      const smail = email(`fb-${label}`);
      expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: 'Asha Rao', email: smail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
      expect((await call(page, '/api/auth/verify-email', json('POST', { email: smail, code: lastCode(smail) }))).status).toBe(200);
      await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', active: true, data: { personal: { name: 'Asha Rao', location: 'Hyderabad' }, skillGroups: [{ id: 'c', label: 'Core', value: 'Excel' }] } }));
      expect((await call(page, `/api/jobs/${posted.id}/apply`, json('POST', { consent: true, answers: {} }))).status).toBe(201);

      // the company: Not selected, then reasons
      const co = await (await browser.newContext(opts)).newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.reload();
      await co.getByRole('tab', { name: 'Applicants' }).click();
      const card = co.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' });
      await card.getByRole('button', { name: 'Not selected' }).click();
      const fb = card.getByTestId('co-fb');
      await fb.getByTestId('co-fb-send').click();
      await expect(fb.getByRole('alert')).toContainText('Pick at least one reason');
      await fb.getByTestId('co-fb-skills').check();
      await fb.getByTestId('co-fb-skill').fill('SQL');
      await fb.getByTestId('co-fb-communication').check();
      expect(await noSideScroll(co)).toBe(true);
      await fb.getByTestId('co-fb-send').click();
      await expect(card.getByTestId('co-fb-done')).toContainText('Skills gap, Communication');

      // the student sees kind words and help
      await page.goto('/me/feedback');
      const item = page.getByTestId('fb-item');
      await expect(item).toContainText('looking for more SQL');
      await expect(item).toContainText('could be clearer');
      await expect(item.getByRole('link', { name: 'Free practice test' }).first()).toBeVisible();
      await expect(item).not.toContainText('Uma');
      expect(await noSideScroll(page)).toBe(true); // long free-course titles wrap at 390 px
      // a private self-review with tips
      await page.getByTestId('fb-asked').fill('Tell me about yourself, then two SQL queries.');
      await page.getByTestId('fb-went-badly').check();
      await page.getByTestId('fb-self-save').click();
      await expect(page.getByTestId('fb-tips')).toContainText('Tell me about yourself');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
