// Vetting Trust T5 (the calling agent with the test providers) on a desktop and a 390 px phone, against the real API:
//   - a tester candidate agrees to "Calls and WhatsApp" in Profile & settings (WhatsApp on, Hindi); a test company
//     turns on "Call / message matching candidates" for a job that asks a yes/no question and has interview times; a
//     pass at a daytime hour (the e2e may run at night in India: quiet hours) messages the candidate; the owner plays
//     the candidate in Admin's test console (Interested → Yes → time 1) → the interview is booked; the company sees
//     1 booked with the answer and the time; the candidate reads "What we said" (no recordings);
//   - a candidate who types "band karo" is opted out at once: the card says they said Stop, WhatsApp is off, and turning
//     it back on clears it; the owner's card shows the providers in test mode and keys not set;
//   - a company that isn't a tester sees no card; a candidate who isn't a tester sees no Calls & WhatsApp card.
// Desktop and phone share one database: every test uses its own companies, people and phone numbers, and no global
// setting is changed.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const phone = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const QUESTION = 'Can you work from Hyderabad?';

async function company(request, tag, { testerCo = true } = {}) {
  const site = `ag${tag}.example`;
  const mail = `hr-${tag}@example.com`;
  const body = { details: { legalName: `Ag${tag} Analytics Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  if (testerCo) seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H };
}

async function job(request, co, tag, slots = 2) {
  const title = `Data Analyst ${tag}`;
  const data = { job: { title, description: 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'], questions: [{ text: QUESTION, kind: 'yesno', want: 'yes' }] } };
  const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { data, headers: co.H })).json();
  expect(posted.status).toBe('active');
  if (slots) {
    const d = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const r = await request.post(`${API}/api/company/${co.id}/hire/slots`, { headers: co.H, data: { job: posted.id, slots: Array.from({ length: slots }, (_, i) => ({ date: d, time: `${10 + i}:00`, minutes: 30, place: 'Hitech City office' })) } });
    expect(r.status()).toBe(201);
  }
  return { id: posted.id, title };
}

async function candidate(browser, opts, who, { tester = true } = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  const mail = email(who);
  seed('customer', mail, 'Asha Rao', PASSWORD);
  if (tester) seed('trust-tester', mail);
  const num = phone();
  seed('trust-agent-person', mail, num);
  await login(page, mail);
  await page.waitForURL('**/me');
  return { ctx, page, mail, num };
}

async function owner(browser, opts, label) {
  const mail = `tt5-owner-${label}-${Date.now().toString(36)}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  const ctx = await browser.newContext({ ...opts });
  const admin = await ctx.newPage();
  admin.on('dialog', () => { throw new Error('no browser dialogs'); });
  await adminLogin(admin, mail, secret);
  await expect(admin).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await admin.goto('/admin/skill-tests?tab=trust');
  return { ctx, admin };
}

async function agree(page, lang) {
  await page.goto('/me/settings');
  const card = page.getByTestId('ag-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('ag-consent')).toContainText('never contact you between 9 PM and 9 AM');
  await card.getByTestId('ag-agree').click();
  await expect(card.getByTestId('ag-wa')).toBeChecked();
  if (lang) {
    await card.getByTestId('ag-lang').selectOption(lang);
    await card.getByTestId('ag-save').click();
    await expect(card.getByTestId('ag-lang')).toHaveValue(lang);
  }
  return card;
}

async function openJobs(page, session) {
  await page.goto('/company');
  await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), session);
  await page.reload();
  await page.getByRole('tab', { name: 'Jobs' }).click();
}

async function console_(admin, mail, button) {
  const box = admin.getByTestId('ta-console');
  await expect(box).toBeVisible({ timeout: 20_000 });
  const opt = box.getByTestId('ta-convo').locator('option', { hasText: mail });
  await box.getByTestId('ta-convo').selectOption(await opt.getAttribute('value'));
  return box;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('job posted with the toggle: WhatsApp, the yes/no question, a time booked; company and candidate see it', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}a${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, tag);
      const s = await candidate(browser, opts, `tt5c-${label}`);
      await agree(s.page, 'hi');
      expect(await noSideScroll(s.page)).toBe(true);

      // the company turns it on for the job
      await openJobs(page, co.session);
      const card = page.getByTestId('ag-co');
      const row = card.getByTestId('ag-co-job').filter({ hasText: j.title });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText(QUESTION);
      await row.getByTestId('ag-co-toggle').click(); // saved at once (the box follows the answer)
      await expect(row.getByTestId('ag-co-toggle')).toBeChecked();
      await expect(row.getByTestId('ag-co-status')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      // a pass at 11 AM IST (the e2e may run during the quiet hours)
      seed('trust-agent-run', '11');

      // the owner plays the candidate's side with the test provider
      const { ctx, admin } = await owner(browser, opts, `${label}a`);
      const ta = admin.getByTestId('ta-card');
      await expect(ta.getByTestId('ta-whatsapp-state')).toHaveText('Test mode: nothing real is sent');
      let box = await console_(admin, s.mail);
      await box.getByTestId('ta-btn-interested').click();
      await expect(admin.getByText('Sent as the candidate')).toBeVisible();
      box = await console_(admin, s.mail);
      await box.getByTestId('ta-btn-yes').click();
      await expect(ta.getByTestId('ta-convo-row').filter({ hasText: s.mail }).first()).toContainText('slots');
      box = await console_(admin, s.mail);
      await box.getByTestId('ta-btn-slot1').click();
      await expect(ta.getByTestId('ta-convo-row').filter({ hasText: s.mail }).first()).toContainText('booked');
      expect(Number(await ta.getByTestId('ta-today-booked').textContent())).toBeGreaterThan(0);
      expect(await noSideScroll(admin)).toBe(true);
      await ctx.close();

      // the company: 1 booked, the answer and the time (no transcript, no phone number)
      await page.reload();
      await page.getByRole('tab', { name: 'Jobs' }).click();
      const row2 = page.getByTestId('ag-co').getByTestId('ag-co-job').filter({ hasText: j.title });
      await expect(row2.getByTestId('ag-co-booked')).toHaveText('1 booked');
      await expect(row2.getByTestId('ag-co-interested')).toHaveText('1 interested');
      await row2.getByTestId('ag-co-people').locator('summary').click();
      const person = row2.getByTestId('ag-co-person').first();
      await expect(person).toContainText('Asha Rao');
      await expect(person).toContainText('Interview booked');
      await expect(person).toContainText(`${QUESTION} yes`);
      await expect(row2).not.toContainText(s.num.slice(-5));

      // the candidate: "What we said"
      await s.page.reload();
      const said = s.page.getByTestId('ag-said');
      const item = said.getByTestId('ag-said-item').filter({ hasText: j.title });
      await expect(item).toContainText('Interview booked');
      await item.locator('summary').click();
      await expect(item.getByTestId('ag-line-nm7').first()).toContainText('Nm7'); // the Hindi template
      await expect(item.getByTestId('ag-line-candidate').first()).toBeVisible();
      await expect(said).toContainText('never keep recordings');
      expect(await noSideScroll(s.page)).toBe(true);
      await s.ctx.close();
    });

    test('Stop ("band karo") opts out at once; turning WhatsApp back on clears it; non-testers see nothing', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}b${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, tag, 0);
      const s = await candidate(browser, opts, `tt5s-${label}`);
      await agree(s.page);
      await request.put(`${API}/api/company/${co.id}/trust/agent/jobs/${j.id}`, { headers: co.H, data: { on: true } });
      seed('trust-agent-run', '11');

      const { ctx, admin } = await owner(browser, opts, `${label}b`);
      const box = await console_(admin, s.mail);
      await box.getByTestId('ta-text').fill('band karo');
      await box.getByTestId('ta-send').click();
      await expect(admin.getByTestId('ta-card').getByTestId('ta-convo-row').filter({ hasText: s.mail }).first()).toContainText('stopped');
      const meta = admin.getByTestId('ta-card');
      await meta.getByTestId('ta-whatsapp').selectOption('meta');
      await expect(meta).toContainText('WHATSAPP_ACCESS_TOKEN: not set');
      await meta.getByTestId('ta-whatsapp').selectOption('mock'); // not saved: nothing global changes
      await ctx.close();

      await s.page.reload();
      const card = s.page.getByTestId('ag-card');
      await expect(card.getByTestId('ag-wa-stopped')).toContainText('You said Stop');
      await expect(card.getByTestId('ag-wa')).not.toBeChecked();
      const item = card.getByTestId('ag-said-item').filter({ hasText: j.title });
      await expect(item).toContainText('You said stop');
      await card.getByTestId('ag-wa').check();
      await card.getByTestId('ag-save').click();
      await expect(card.getByTestId('ag-wa-stopped')).toHaveCount(0);
      await expect(card.getByTestId('ag-wa')).toBeChecked();
      expect(await noSideScroll(s.page)).toBe(true);
      await s.ctx.close();

      // a company that isn't a tester: no card; a candidate who isn't a tester: no Calls & WhatsApp card
      const other = await company(request, `${tag}x`, { testerCo: false });
      await job(request, other, `${tag}x`, 0);
      await openJobs(page, other.session);
      await expect(page.getByTestId('co-jobs')).toBeVisible();
      await expect(page.getByTestId('ag-co')).toHaveCount(0);
      const n = await candidate(browser, opts, `tt5n-${label}`, { tester: false });
      await n.page.goto('/me/settings');
      await expect(n.page.locator('#s-password')).toBeVisible({ timeout: 20_000 });
      await expect(n.page.getByTestId('ag-card')).toHaveCount(0);
      await n.ctx.close();
    });
  });
}
