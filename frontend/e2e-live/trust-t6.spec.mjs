// Vetting Trust T6 (self-serve knock-out questions, Work preferences, verified non-tech filters in Hire now) on a
// desktop and a 390 px phone, against the real API:
//   - a tester company posts a job from the form: "Add a common question" (night shifts), its own number question; a
//     question about marital status shows the warning and blocks posting until it is removed;
//   - a tester candidate fills Work preferences (night shifts yes, a two-wheeler, Telugu), agrees to the location
//     consent and picks a city; on the job page the night-shift question is already answered (not asked again) and
//     only the number question is asked; a low answer marks the application "Not a fit for: <question>" in the
//     company's Applicants (shown, never rejected); the candidate sees their answers;
//   - Hire now shows the non-tech filters: a verified (test) DigiLocker licence with its classes, the self-declared
//     vehicle and languages, the distance rounded ("~N km"), never coordinates; filters combine and keep the person;
//   - a company and a candidate that aren't testers see none of it (5 questions, no templates, no Work preferences).
// Desktop and phone share one database: every test uses its own companies, people and names; no global setting changes.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const NIGHT = 'Are you willing to work night shifts?';
const SQL = 'How many months have you used SQL?';
const phone = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const letters = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 5).padEnd(5, 'x');

async function company(request, tag, { tester = true } = {}) {
  const site = `t6${tag}.example`;
  const mail = `hr-t6${tag}@example.com`;
  const body = { details: { legalName: `T6${tag} Logistics Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  if (tester) seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H };
}

async function openCompany(page, session, tab) {
  await page.goto('/company');
  await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), session);
  await page.reload();
  await page.getByRole('tab', { name: tab }).click();
}

async function candidate(browser, opts, who, name, { tester = true } = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  if (tester) seed('trust-tester', mail);
  seed('trust-agent-person', mail, phone()); // a resume and the adult age check
  await login(page, mail);
  await page.waitForURL('**/me');
  return { ctx, page, mail };
}

async function workPrefs(page) {
  await page.goto('/me/settings');
  const card = page.getByTestId('wp-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByTestId('wp-shift-night').check();
  await card.getByTestId('wp-night-yes').check();
  await card.getByTestId('wp-vehicle-two_wheeler').check();
  await card.getByTestId('wp-lang-Telugu').check();
  await card.getByTestId('wp-now').check();
  await card.getByTestId('wp-save').click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  // the location needs its own consent; the city is enough (never the exact place)
  const loc = card.getByTestId('wp-location');
  await expect(loc.getByTestId('wp-loc-consent')).toContainText('rounded to about 1 km');
  await loc.getByTestId('wp-loc-agree').click();
  await loc.getByTestId('wp-loc-city').selectOption('Secunderabad');
  await loc.getByTestId('wp-loc-save-city').click();
  await expect(loc.getByTestId('wp-loc-label')).toContainText('Secunderabad');
  await expect(loc).toContainText('Companies see only the distance');
  return card;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('company: templates and its own question, an unfair question is refused; candidate: asked once, Not a fit for', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const title = `Delivery Lead ${tag}`;

      // the job form
      await openCompany(page, co.session, 'Jobs');
      await page.getByRole('button', { name: 'Post a job' }).click();
      const form = page.getByTestId('co-job-form');
      await form.locator('#cj-title').fill(title);
      await form.locator('#cj-desc').fill('Plan delivery routes in SQL and Power BI for our stores in Hyderabad. Freshers are welcome.');
      await form.locator('#cj-cities').fill('Hyderabad');
      const qs = form.getByTestId('co-questions');
      await expect(qs.getByTestId('co-q-fair')).toContainText('Up to 8 questions');
      await qs.getByTestId('co-q-template').selectOption({ label: NIGHT });
      await expect(qs.locator('#cq-t0')).toHaveValue(NIGHT);
      await qs.getByRole('button', { name: 'Add a question' }).click();
      await qs.locator('#cq-t1').fill('Are you married?');
      await expect(qs.getByTestId('co-q-unfair')).toContainText('marital status');
      await expect(form.getByRole('button', { name: 'Post job' })).toBeDisabled();
      await qs.locator('#cq-t1').fill(SQL);
      await expect(qs.getByTestId('co-q-unfair')).toHaveCount(0);
      await qs.locator('#cq-k1').selectOption('number');
      await qs.locator('#cq-m1').fill('6');
      await expect(form.getByTestId('cj-pin')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await form.getByRole('button', { name: 'Post job' }).click();
      const row = page.getByTestId('co-job').filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 20_000 });
      const jobs = await (await request.get(`${API}/api/company/${co.id}/jobs`, { headers: co.H })).json();
      const j = jobs.find((x) => x.title === title);
      expect(j.questions.map((q) => q.text)).toEqual([NIGHT, SQL]);
      expect(j.questions[0].template).toBe('night_shift');
      // the server refuses one too (whatever the form does)
      const bad = await request.post(`${API}/api/company/${co.id}/jobs/check`, { headers: co.H, data: { job: { title: 'X role', description: 'Plan delivery routes in SQL for our stores. Freshers welcome.', locations: ['Hyderabad'], experience: 'fresher', questions: [{ text: 'What is your religion?', kind: 'yesno', want: 'yes' }] } } });
      expect((await bad.json()).errors[0]).toContain("aren't allowed");

      // the candidate: Work preferences, then the job asks only the new question
      const s = await candidate(browser, opts, `tt6c-${label}`, `Kiran${letters()} Rao`);
      const card = await workPrefs(s.page);
      expect(await noSideScroll(s.page)).toBe(true);
      await s.page.goto(`/jobs/${j.slug}`);
      await s.page.getByTestId('apply').first().click();
      const af = s.page.getByTestId('apply-form');
      await expect(af.getByTestId('apply-known-item')).toHaveCount(1);
      await expect(af.getByTestId('apply-known')).toContainText(NIGHT);
      await expect(af.getByText(NIGHT, { exact: true })).toHaveCount(0); // not asked again
      await af.getByLabel(SQL).fill('2');
      await af.getByTestId('apply-consent').check();
      expect(await noSideScroll(s.page)).toBe(true);
      await af.getByTestId('apply-send').click();
      await expect(s.page.getByTestId('applied')).toBeVisible({ timeout: 20_000 });
      // the candidate sees what they answered
      await s.page.goto('/me/settings');
      const answers = card.getByTestId('wp-answers');
      await answers.locator('summary').click();
      await expect(answers.getByTestId('wp-answer').filter({ hasText: title })).toContainText(`${SQL} 2`);
      await s.ctx.close();

      // the company: the person is there, labelled, not rejected
      await page.getByRole('tab', { name: 'Applicants' }).click();
      const chip = page.getByTestId('co-ap-notfit-chip').first();
      await expect(chip).toHaveText(`Not a fit for: ${SQL}`, { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Hire now: verified licence, self-declared facts, distance rounded; filters combine; no coordinates', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}h${Date.now().toString(36)}`;
      // the job's own place (its office pin is in Hyderabad): Hire now's top 10 holds only this test's person, however
      // many Hyderabad candidates the other specs left in the shared database
      const city = `Tq${letters()}pur`;
      const co = await company(request, tag);
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: { title: `Field Analyst ${tag}`, description: 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome.', locations: [city], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'], geo: { lat: 17.45, lng: 78.38 } } } })).json();
      expect(posted.status).toBe('active');
      const first = `Ravi${letters()}`;
      const s = await candidate(browser, opts, `tt6h-${label}`, `${first} Kumar`);
      seed('trust-t6-ready', s.mail, 'MCWG,LMV', city);
      await workPrefs(s.page);
      await s.ctx.close();

      await openCompany(page, co.session, 'Hire now');
      await page.getByTestId('co-hire-job').selectOption(posted.id);
      const filters = page.getByTestId('co-hire-nt-filters');
      await expect(filters).toBeVisible({ timeout: 20_000 });
      await filters.getByTestId('co-hire-nt-licence').selectOption('two_wheeler');
      await filters.getByTestId('co-hire-nt-lang').selectOption('Telugu');
      await filters.getByTestId('co-hire-nt-now').check();
      await filters.getByTestId('co-hire-nt-km').selectOption('20');
      // how many the filter leaves (shown once the list is loaded with this distance, never the count for another one)
      await expect(filters).toContainText(/Distance from the job \([1-9]\d*\)/, { timeout: 20_000 });
      const person = page.getByTestId('co-hire-row').filter({ hasText: first });
      await expect(person).toBeVisible({ timeout: 20_000 });
      await expect(person.getByTestId('co-hire-nt-licence')).toHaveText('Driving licence (two-wheeler, LMV (car)) · verified via DigiLocker (test)');
      await expect(person.getByTestId('co-hire-nt-vehicle')).toHaveText('Owns a two-wheeler · self-declared');
      await expect(person.getByTestId('co-hire-nt-distance')).toHaveText(/^~\d+ km from the job · self-declared$/);
      await expect(person.getByTestId('co-hire-nt-langs')).toContainText('Telugu');
      await expect(person.getByTestId('co-hire-nt-now')).toHaveText('Can join now · self-declared');
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/17\.\d{2}|78\.\d{2}|Secunderabad/); // never a place or coordinates
      expect(await noSideScroll(page)).toBe(true);
      // a filter nobody passes empties the list; clearing brings the person back
      await filters.getByTestId('co-hire-nt-vehicle').selectOption('car');
      await expect(person).toHaveCount(0, { timeout: 20_000 });
      await filters.getByTestId('co-hire-nt-clear').click();
      await expect(page.getByTestId('co-hire-row').filter({ hasText: first })).toBeVisible({ timeout: 20_000 });
    });

    test('switch OFF: a company and a candidate that are not testers see the old screens', async ({ page, request, browser }) => {
      test.setTimeout(120_000);
      const tag = `${label[0]}o${Date.now().toString(36)}`;
      const co = await company(request, tag, { tester: false });
      expect((await request.get(`${API}/api/company/${co.id}/trust/knockouts`, { headers: co.H })).status()).toBe(404);
      await openCompany(page, co.session, 'Jobs');
      await page.getByRole('button', { name: 'Post a job' }).click();
      const qs = page.getByTestId('co-questions');
      await expect(qs).toBeVisible();
      await expect(qs.getByTestId('co-q-template')).toHaveCount(0);
      await expect(qs.getByTestId('co-q-fair')).toHaveCount(0);
      await expect(page.getByTestId('cj-pin')).toHaveCount(0);
      const s = await candidate(browser, opts, `tt6o-${label}`, 'Meena Rao', { tester: false });
      await s.page.goto('/me/settings');
      await expect(s.page.getByTestId('s-profile').or(s.page.locator('#s-profile'))).toBeVisible();
      await expect(s.page.getByTestId('wp-card')).toHaveCount(0);
      await s.ctx.close();
    });
  });
}
