// Phase 5 H8 all domains, on a desktop and a 390 px phone, against the real API: a Verified company starts a job from
// the "Electrician (ITI)" template: the title, skills, description and lowest qualification fill in, the salary stays
// blank; it posts, and the job keeps ITI as the lowest qualification. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('post a non-IT job from a template', async ({ page, request }) => {
      test.setTimeout(120_000);
      const tag = `${label}t${Date.now().toString(36)}`;
      const site = `tpl${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Tplco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Construction', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Ravi' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Ravi', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/company');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await page.reload();
      await page.getByRole('tab', { name: 'Jobs' }).click();
      await page.getByTestId('co-jobs').getByRole('button', { name: 'Post a job' }).click();
      const form = page.getByTestId('co-job-form');
      await form.getByTestId('cj-template').selectOption({ label: 'Electrician (ITI)' });
      await expect(form.getByLabel('Job title')).toHaveValue('Electrician (ITI)');
      await expect(form.getByTestId('cj-edu')).toHaveValue('iti');
      await expect(form.getByLabel('Job description')).toHaveValue(/ITI Electrician pass/);
      await expect(form.getByLabel('Skills (comma between)')).toHaveValue(/Electrical wiring/);
      await expect(form.getByLabel('Salary from (₹)')).toHaveValue('');
      await form.getByLabel('Cities (comma between)').fill('Hyderabad');
      expect(await noSideScroll(page)).toBe(true);
      await form.getByRole('button', { name: 'Post job' }).click();
      await expect(form).toHaveCount(0); // posted: the form closes (its template list also says "Electrician (ITI)")
      await expect(page.getByTestId('co-jobs')).toContainText('Electrician (ITI)');
      const jobs = await (await request.get(`${API}/api/company/${r.company.id}/jobs`, { headers: H })).json();
      expect(jobs.find((j) => j.title === 'Electrician (ITI)').education).toBe('iti');
    });
  });
}
