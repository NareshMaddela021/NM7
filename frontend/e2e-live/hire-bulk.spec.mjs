// Phase 5 H7 bulk hiring, on a desktop and a 390 px phone, against the real API: the company turns on bulk hiring for
// 50 openings; the board shows the accepted invite; it makes a walk-in day and shows a QR; the candidate opens the
// QR link, must tick the box, checks in; the board counts the check-in; "Move all accepted to Interview" works; the
// CSV downloads. No browser dialogs, no sideways scrolling.
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
const ist = (h) => { const d = new Date(Date.now() + h * 3600e3 + 5.5 * 3600e3); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Bulk hiring: turn on, board, walk-in QR check-in, batch Interview, CSV', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}b${Date.now().toString(36)}`;
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
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.11.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
      await page.goto('/');
      const smail = email(`hire-asha-${label}`);
      expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: `${first} Rao`, email: smail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
      expect((await call(page, '/api/auth/verify-email', json('POST', { email: smail, code: lastCode(smail) }))).status).toBe(200);
      const rs = (await call(page, '/api/me/resumes')).body;
      if (rs.length) await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data: RESUME }));
      else expect((await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', data: RESUME, active: true }))).status).toBe(201);
      expect((await call(page, '/api/me/hire', json('PUT', { on: true, consent: true, joinDate: '2026-12-01', cities: ['Hyderabad'], salary: { amount: 25000, unit: 'month' }, noticeDays: 15, jobTypes: ['full_time'] }))).status).toBe(200);

      // invite + accept through the API (H2 is tested in hire-shortlist.spec)
      const uid = (await call(page, '/api/auth/me')).body.user?.id || (await call(page, '/api/auth/me')).body.id;
      const sent = await (await request.post(`${API}/api/company/${r.company.id}/hire/invite`, { data: { job: posted.id, people: [uid] }, headers: H })).json();
      expect(sent.sent).toBe(1);
      const inv = (await call(page, '/api/me/hire/invites')).body[0];
      expect((await call(page, `/api/me/hire/invites/${inv.id}`, json('POST', { answer: 'accept' }))).status).toBe(200);

      const co = await (await browser.newContext(opts)).newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.goto('/company');
      await co.getByRole('tab', { name: 'Hire now' }).click();
      await co.getByTestId('co-hire-job').selectOption({ label: title });
      await co.getByTestId('co-bulk-openings').fill('50');
      await co.getByTestId('co-bulk-on').click();
      await expect(co.getByTestId('co-bulk')).toContainText('Bulk hiring: 50 openings');
      await expect(co.getByTestId('co-bulk-stats')).toContainText('1Accepted invites');
      await co.getByTestId('co-walkin-date').fill(ist(48).date);
      await co.getByTestId('co-walkin-place').fill('Hitech City office, ground floor');
      await co.getByTestId('co-walkin-make').click();
      await expect(co.getByTestId('co-walkin').getByRole('img')).toBeVisible();
      const link = await co.getByTestId('co-walkin').locator('.xs.muted').first().textContent();
      expect(await noSideScroll(co)).toBe(true);

      await page.goto(new URL(link).pathname);
      await page.getByTestId('walkin-go').click();
      await expect(page.getByRole('alert')).toContainText('Tick the box');
      await page.getByTestId('walkin-agree').check();
      await page.getByTestId('walkin-go').click();
      await expect(page.getByTestId('walkin-done')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      await co.reload();
      await co.getByRole('tab', { name: 'Hire now' }).click();
      await co.getByTestId('co-hire-job').selectOption({ label: title });
      await expect(co.getByTestId('co-walkin-count')).toHaveText('1 person checked in');
      await co.getByTestId('co-bulk-interview').click();
      await expect(co.getByTestId('co-bulk-msg')).toHaveText('Moved to Interview.');
      const [dl] = await Promise.all([co.waitForEvent('download'), co.getByTestId('co-bulk-csv').click()]);
      expect(dl.suggestedFilename()).toMatch(/^hiring-.+\.csv$/);
    });
  });
}
