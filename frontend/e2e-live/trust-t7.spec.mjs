// Vetting Trust T7 (job description → requirements, each Met / Not met / Unknown with quoted evidence) on a desktop and
// a 390 px phone, against the real API (no AI key: the rules read the job and check the evidence):
//   - a tester company's job gets its requirements (Jobs tab and Applicants with the job picked); each applicant card
//     shows the chip strip and, opened, each requirement with its quote and where it came from ("Resume: …");
//   - the company makes a different requirement the must-have: the list re-sorts at once (must-haves met first);
//     a requirement about gender is refused with the reason; nobody is rejected (both stay in the list);
//   - the candidate agrees to matching in Profile & settings and sees what they were checked on (their own evidence);
//   - Hire now: the strips on each person; toggling must-have re-sorts the people shown;
//   - a company and a candidate that aren't testers see none of it.
// Desktop and phone share one database: every test uses its own companies, people and names; no global setting changes.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const letters = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 5).padEnd(5, 'x');
const JOB = (title, city = 'Hyderabad') => ({ title, description: 'Build weekly dashboards in SQL and Power BI for our stores. Telugu speakers preferred. Freshers are welcome.',
  locations: [city], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'] });

async function company(request, tag, { tester = true } = {}) {
  const site = `t7${tag}.example`;
  const mail = `hr-t7${tag}@example.com`;
  const body = { details: { legalName: `T7${tag} Retail Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
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

/** A signed-in candidate with a resume of one kind (data: SQL / Power BI; acct: Tally / GST, Telugu). */
async function candidate(browser, opts, who, name, kind, { tester = true, consent = false } = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  if (tester) seed('trust-tester', mail);
  seed('trust-t7-person', mail, kind, ...(consent ? ['consent'] : []));
  await login(page, mail);
  await page.waitForURL('**/me');
  return { ctx, page, mail };
}

const applyTo = async (s, jobId) => expect((await call(s.page, `/api/jobs/${jobId}/apply`, json('POST', { consent: true, answers: {} }))).status).toBe(201);
const names = async (page, testid) => (await page.getByTestId(testid).allInnerTexts()).map((x) => x.split('\n').join(' '));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('applicants: requirements with quotes, edit re-sorts at once, unfair refused, nobody rejected; candidate sees own evidence', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const title = `Store Analyst ${tag}`;
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: JOB(title) } })).json();
      expect(posted.status).toBe('active');
      const dataName = `Dev${letters()} Rao`;
      const acctName = `Lak${letters()} Reddy`;
      const a = await candidate(browser, opts, `tt7a-${label}`, dataName, 'data');
      const b = await candidate(browser, opts, `tt7b-${label}`, acctName, 'acct', { consent: true });
      // the candidate agrees to matching in Profile & settings (the plain-language text first)
      await a.page.goto('/me/settings');
      const card = a.page.getByTestId('cr-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId('cr-consent')).toContainText('we remove your name, photo, gender, age, college');
      await card.getByTestId('cr-agree').click();
      await expect(card.getByTestId('cr-none')).toBeVisible();
      await applyTo(a, posted.id);
      await applyTo(b, posted.id);

      // the company: requirements read from the job; the data analyst meets the must-haves, so comes first
      await openCompany(page, co.session, 'Applicants');
      await page.locator('#ap-job').selectOption(posted.id);
      const editor = page.getByTestId('crit-editor');
      await expect(editor).toBeVisible({ timeout: 20_000 });
      await editor.locator('summary').click();
      await expect(editor.getByTestId('crit-row')).toHaveCount(4); // SQL, Power BI, Speaks Telugu, Can work in Hyderabad
      await expect(editor.getByTestId('crit-text').first()).toHaveValue('SQL');
      const cards = page.getByTestId('co-applicant');
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toContainText(dataName.split(' ')[0]);
      await expect(cards.first().getByTestId('crit-line')).toContainText('2 of 2 must-haves');
      await cards.first().getByTestId('crit-why').click();
      const sql = cards.first().getByTestId('crit-item').filter({ hasText: 'SQL' }).first();
      await expect(sql).toContainText('Met');
      await expect(sql).toContainText('Resume:');
      await expect(sql.getByTestId('crit-quote')).not.toBeEmpty();
      await expect(cards.nth(1).getByTestId('crit-line')).toContainText('0 of 2 must-haves');
      expect(await noSideScroll(page)).toBe(true);

      // make "Speaks Telugu" the must-have and SQL / Power BI nice: the accountant (Telugu) comes first at once
      const rows = editor.getByTestId('crit-row');
      await rows.filter({ has: page.locator('input[value="Speaks Telugu"]') }).getByTestId('crit-must').check();
      await expect(cards.first()).toContainText(dataName.split(' ')[0]); // 2 of 3 vs 1 of 3: still first
      await rows.nth(0).getByTestId('crit-must').uncheck();
      await expect(rows.nth(0).getByTestId('crit-must')).toBeEnabled();
      await rows.nth(1).getByTestId('crit-must').uncheck();
      await expect(cards.first()).toContainText(acctName.split(' ')[0], { timeout: 20_000 });
      await expect(cards.first().getByTestId('crit-line')).toContainText('1 of 1 must-haves');
      await expect(cards).toHaveCount(2); // nobody rejected or hidden

      // an unfair requirement is refused with the reason
      await editor.getByTestId('crit-add').click();
      await editor.getByTestId('crit-text').last().fill('Female candidates only');
      await editor.getByTestId('crit-save').click();
      await expect(editor.getByTestId('crit-error')).toContainText("aren't allowed");
      await editor.getByRole('button', { name: 'Cancel' }).click();
      expect(await noSideScroll(page)).toBe(true);

      // the candidate sees what they were checked on, with their own evidence only
      await a.page.goto('/me/settings');
      const app = a.page.getByTestId('cr-card').getByTestId('cr-app').filter({ hasText: title });
      await expect(app).toBeVisible({ timeout: 20_000 });
      await expect(app.getByTestId('cr-item').filter({ hasText: /^Met SQL/ }).getByTestId('cr-status')).toHaveText('Met');
      await expect(app).toContainText('Resume:');
      await expect(app).not.toContainText(acctName.split(' ')[0]);
      const telugu = app.getByTestId('cr-item').filter({ hasText: 'Speaks Telugu' });
      await expect(telugu.getByTestId('cr-status')).toHaveText('Unknown');
      await telugu.getByTestId('cr-add').click();
      await expect(telugu).toContainText('Profile > Certificates');
      expect(await noSideScroll(a.page)).toBe(true);
      await a.ctx.close();
      await b.ctx.close();
    });

    test('Hire now: strips on each person; must-have toggled re-sorts the people shown', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}h${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const city = `Tq${letters()}pur`; // the job's own place: Hire now's top 10 holds only this test's people
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: JOB(`Field Analyst ${tag}`, city) } })).json();
      const dataName = `Ved${letters()} Rao`;
      const acctName = `Ana${letters()} Reddy`;
      const a = await candidate(browser, opts, `tt7ha-${label}`, dataName, 'data', { consent: true });
      const b = await candidate(browser, opts, `tt7hb-${label}`, acctName, 'acct', { consent: true });
      seed('trust-t6-ready', a.mail, '', city);
      seed('trust-t6-ready', b.mail, '', city);
      await a.ctx.close();
      await b.ctx.close();

      await openCompany(page, co.session, 'Hire now');
      await page.getByTestId('co-hire-job').selectOption(posted.id);
      const pa = page.getByTestId('co-hire-row').filter({ hasText: dataName.split(' ')[0] });
      const pb = page.getByTestId('co-hire-row').filter({ hasText: acctName.split(' ')[0] });
      await expect(pa).toBeVisible({ timeout: 20_000 });
      await expect(pb).toBeVisible();
      await expect(pa.getByTestId('crit-line')).toContainText('2 of 2 must-haves');
      await expect(pb.getByTestId('crit-line')).toContainText('0 of 2 must-haves');
      const order = async () => (await names(page, 'co-hire-row')).map((x) => (x.includes(dataName.split(' ')[0]) ? 'a' : x.includes(acctName.split(' ')[0]) ? 'b' : '-')).filter((x) => x !== '-');
      expect(await order()).toEqual(['a', 'b']);
      const editor = page.getByTestId('crit-editor');
      await editor.locator('summary').click();
      const rows = editor.getByTestId('crit-row');
      await rows.filter({ has: page.locator('input[value="Speaks Telugu"]') }).getByTestId('crit-must').check();
      await expect(rows.nth(0).getByTestId('crit-must')).toBeEnabled();
      await rows.nth(0).getByTestId('crit-must').uncheck();
      await expect(rows.nth(1).getByTestId('crit-must')).toBeEnabled();
      await rows.nth(1).getByTestId('crit-must').uncheck();
      await expect(pb.getByTestId('crit-line')).toContainText('1 of 1 must-haves', { timeout: 20_000 });
      await expect.poll(order).toEqual(['b', 'a']);
      await pb.getByTestId('crit-why').click();
      await expect(pb.getByTestId('crit-item').filter({ hasText: 'Speaks Telugu' })).toContainText('Resume:');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch OFF: a company and a candidate that are not testers see none of it', async ({ page, request, browser }) => {
      test.setTimeout(120_000);
      const tag = `${label[0]}o${Date.now().toString(36)}`;
      const co = await company(request, tag, { tester: false });
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: JOB(`Quiet Analyst ${tag}`) } })).json();
      expect((await request.get(`${API}/api/company/${co.id}/trust/criteria/${posted.id}`, { headers: co.H })).status()).toBe(404);
      const s = await candidate(browser, opts, `tt7o-${label}`, 'Meena Rao', 'data', { tester: false });
      await applyTo(s, posted.id);
      await s.page.goto('/me/settings');
      await expect(s.page.locator('#s-profile')).toBeVisible();
      await expect(s.page.getByTestId('cr-card')).toHaveCount(0);
      expect((await call(s.page, '/api/me/trust/criteria')).status).toBe(404);
      await s.ctx.close();
      await openCompany(page, co.session, 'Applicants');
      await page.locator('#ap-job').selectOption(posted.id);
      await expect(page.getByTestId('co-applicant')).toHaveCount(1, { timeout: 20_000 });
      await expect(page.getByTestId('crit-editor')).toHaveCount(0);
      await expect(page.getByTestId('crit-strip')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Jobs' }).click();
      await expect(page.getByTestId('co-job').first()).toBeVisible();
      await expect(page.getByTestId('crit-editor')).toHaveCount(0);
    });
  });
}
