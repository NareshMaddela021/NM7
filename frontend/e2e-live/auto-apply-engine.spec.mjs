// The Auto Apply engine and "Needs your answer" (Phase 3, A2 + A3) on a desktop and a 390 px phone, against the
// real API: a verified company posts two jobs on Nm7 (one asks a question); the morning run applies to the plain one
// (labelled Auto for the company, Auto in My applications) and puts the other in "Needs your answer"; one answer
// applies at once. A second student in their preview days sees both jobs waiting and approves them all. No browser
// dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('run applies to the plain job, the question job waits, one answer applies; preview approve all', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}e${Date.now().toString(36)}`;
      const site = `auto${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const NET = ownNetwork();
      const company = { details: { legalName: `Autoco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Ira' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Ira', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      const post = async (title, extra = {}) => (await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { headers: H, data: { job: { title, description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...extra } } })).json());
      const plain = await post(`Data Analyst ${tag}`);
      const asks = await post(`Reporting Analyst ${tag}`, { questions: [{ text: 'What is your notice period in days?', kind: 'number' }] });
      expect([plain.status, asks.status]).toEqual(['active', 'active']);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      // a student with Auto Apply on (past the preview days)
      const me = await studentWith(page, label, STRONG, 'eng');
      expect((await call(page, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], remote: true, minScore: 60, dailyLimit: 5, consent: true }))).status).toBe(200);
      seed('auto-apply-run', me, 'past');
      await page.goto('/me/auto-apply');
      await expect(page.getByTestId('aa-applied')).toContainText(`Data Analyst ${tag}`);
      const need = page.getByTestId('aa-need').filter({ hasText: `Reporting Analyst ${tag}` });
      await expect(need).toContainText('What is your notice period in days?');
      expect(await noSideScroll(page)).toBe(true);
      await need.getByLabel('What is your notice period in days?').fill('30');
      await need.getByRole('button', { name: 'Answer and apply' }).click();
      await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('aa-applied')).toContainText(`Reporting Analyst ${tag}`);
      await expect(page.getByTestId('aa-need').filter({ hasText: `Reporting Analyst ${tag}` })).toHaveCount(0);
      // My applications: labelled Auto
      await page.goto('/me/jobs');
      await expect(page.locator('article').filter({ hasText: `Autoco ${tag}` }).first().getByTestId('app-auto')).toHaveText('Auto');

      // the company sees both, labelled Auto
      const cctx = await browser.newContext(opts);
      const co = await cctx.newPage();
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.reload();
      await co.getByRole('tab', { name: 'Applicants' }).click();
      const rows = co.getByTestId('co-applicant').filter({ hasText: 'Asha Rao' });
      await expect(rows).toHaveCount(2);
      await expect(rows.first().getByTestId('co-ap-origin')).toHaveText('Auto');
      expect(await noSideScroll(co)).toBe(true);
      await cctx.close();

      // a second student in the preview days: both wait for Approve; Approve all sends them
      const sctx = await browser.newContext(opts);
      const p2 = await sctx.newPage();
      p2.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me2 = await studentWith(p2, `${label}2`, STRONG, 'prev');
      expect((await call(p2, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], minScore: 60, dailyLimit: 5, consent: true }))).status).toBe(200);
      await call(p2, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], minScore: 60, dailyLimit: 5 }));
      seed('auto-apply-run', me2);
      await p2.goto('/me/auto-apply');
      await expect(p2.getByTestId('aa-preview')).toBeVisible();
      await expect(p2.getByTestId('aa-wait')).toHaveCount(1); // the question job needs an answer first
      await expect(p2.getByTestId('aa-wait')).toContainText(`Data Analyst ${tag}`);
      await p2.getByTestId('aa-approve-all').click();
      await expect(p2.getByTestId('aa-waiting')).toHaveCount(0);
      await expect(p2.getByTestId('aa-applied')).toContainText(`Data Analyst ${tag}`);
      expect(await noSideScroll(p2)).toBe(true);
      await sctx.close();
    });
  });
}
