// Phase 5 H6 instant offer, on a desktop and a 390 px phone, against the real API: after the candidate accepts the
// invite, the company sends an offer from Hire now (salary, join date); the candidate reads the letter, must type
// their name and tick the box, accepts; the PDF downloads on both sides; the company sees Accepted. No browser
// dialogs, no sideways scrolling.
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

    test('Offer: send, candidate types name and accepts, PDF, company sees Accepted', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}o${Date.now().toString(36)}`;
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
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.10.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
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
      await co.getByTestId('co-offer-new').click();
      await co.getByTestId('co-offer-person').selectOption({ label: `${first} Rao` });
      await co.getByTestId('co-offer-amount').fill('25000');
      await co.getByTestId('co-offer-join').fill(ist(24 * 14).date);
      await co.getByTestId('co-offer-send').click();
      await expect(co.getByTestId('co-offer').filter({ hasText: `${first} Rao` }).getByTestId('co-offer-state')).toHaveText('Waiting for an answer');
      expect(await noSideScroll(co)).toBe(true);

      await page.goto('/me/hire');
      const offer = page.getByTestId('hire-offer').filter({ hasText: title });
      await expect(offer.getByTestId('hire-offer-letter')).toContainText('₹25,000 a month');
      await offer.getByTestId('hire-offer-accept').click();
      await expect(page.getByRole('alert')).toContainText('Tick the box');
      await offer.getByTestId('hire-offer-agree').check();
      await offer.getByTestId('hire-offer-name').fill('Someone Else');
      await offer.getByTestId('hire-offer-accept').click();
      await expect(page.getByRole('alert')).toContainText('Type your name');
      await offer.getByTestId('hire-offer-name').fill(`${first} Rao`);
      await offer.getByTestId('hire-offer-accept').click();
      await expect(offer.getByTestId('hire-offer-state')).toHaveText('Accepted');
      expect(await noSideScroll(page)).toBe(true); // the long "Accepted: …" invite badge wraps at 390 px
      const mine = (await call(page, '/api/me/hire/offers')).body.find((o) => o.title === title);
      const pdf = await page.evaluate(async ([base, id]) => { const x = await fetch(`${base}/api/me/hire/offers/${id}/pdf`, { credentials: 'include' }); return [x.status, (await x.text()).slice(0, 4)]; }, [API, mine.id]);
      expect(pdf).toEqual([200, '%PDF']);

      await co.reload();
      await co.getByRole('tab', { name: 'Hire now' }).click();
      await co.getByTestId('co-hire-job').selectOption({ label: title });
      await expect(co.getByTestId('co-offer').filter({ hasText: `${first} Rao` }).getByTestId('co-offer-state')).toHaveText('Accepted');
      const [dl] = await Promise.all([co.waitForEvent('download'), co.getByTestId('co-offer').filter({ hasText: `${first} Rao` }).getByTestId('co-offer-pdf').click()]);
      expect(dl.suggestedFilename()).toBe('offer.pdf');
    });
  });
}
