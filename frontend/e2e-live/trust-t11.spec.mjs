// Vetting Trust T11 (one-tap interview booking and the joining day) on a desktop and a 390 px phone, against the real
// API, with no sign-in on the link pages:
//   - a tester candidate shortlisted by a test company opens the signed booking link (as in the WhatsApp message and
//     the email), books one of two interview times with one tap, moves it to the other, cancels it with a reason and
//     books again; the company's Hire now tab shows "Bookings by one-tap link" live with the candidate's name;
//   - the joining day in Hindi: the day before, "Yes, I'm coming" and "Need to reschedule" with a reason; on the day,
//     "I've joined"; the company's own link answers "Joined"; both answers are on the company's card;
//   - a link that was changed shows a plain error; the owner's Admin card shows the settings and the templates.
// Desktop and phone share one database: every test uses its own company, people and offers; no global setting changes.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

async function company(request, tag) {
  const site = `tb${tag}.example`;
  const mail = `hr-${tag}@example.com`;
  const body = { details: { legalName: `Tb${tag} Foods Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H, mail };
}

async function job(request, co, tag) {
  const title = `Store Analyst ${tag}`;
  const data = { job: { title, description: 'Build weekly sales reports in Excel and Power BI for our stores. Freshers are welcome.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Excel', 'Power BI'] } };
  const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { data, headers: co.H })).json();
  expect(posted.status).toBe('active');
  const d = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const r = await request.post(`${API}/api/company/${co.id}/hire/slots`, { headers: co.H, data: { job: posted.id, slots: [{ date: d, time: '10:00', minutes: 30, place: 'Hitech City office' }, { date: d, time: '11:30', minutes: 30, link: 'https://meet.example.com/t11' }] } });
  expect(r.status()).toBe(201);
  return { id: posted.id, title };
}

function person(who) {
  const mail = email(who);
  seed('customer', mail, 'Asha Rao', PASSWORD);
  seed('trust-tester', mail);
  return mail;
}

async function fresh(browser, opts) {
  const ctx = await browser.newContext(opts); // no sign-in: the link is enough
  const page = await ctx.newPage();
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  return { ctx, page };
}

async function hireTab(page, co, title) {
  await page.goto('/company');
  await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
  await page.goto('/company');
  await page.getByRole('tab', { name: 'Hire now' }).click();
  await page.getByTestId('co-hire-job').selectOption({ label: title });
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('one-tap booking link: book, move, cancel, book again; the company sees it live', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}b${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, tag);
      const mail = person(`tt11b-${label}`);
      const { token } = seed('trust-t11-book', mail, co.id, j.id);

      const { ctx, page: p } = await fresh(browser, opts);
      await p.goto(`/stop-alerts#k=book&t=${token}`);
      const bk = p.getByTestId('bk');
      await expect(bk).toBeVisible({ timeout: 20_000 });
      await expect(p.getByRole('heading', { name: 'Book your interview' })).toBeVisible();
      await expect(bk).toContainText(j.title);
      await expect(bk.getByTestId('bk-slot')).toHaveCount(2);
      await expect(bk.getByTestId('bk-slot').first()).toContainText('Hitech City office');
      expect(await noSideScroll(p)).toBe(true);
      await bk.getByTestId('bk-pick').first().click();
      await expect(bk.getByTestId('bk-mine')).toContainText('10:00');
      await expect(bk.getByTestId('bk-mine')).toContainText('Map');
      await expect(bk.getByTestId('bk-slot')).toHaveCount(1);
      // the other time moves it (one booking per link)
      await bk.getByTestId('bk-pick').click();
      await expect(bk.getByTestId('bk-mine')).toContainText('11:30');
      await expect(bk.getByTestId('bk-mine')).toContainText('Join online');
      // cancel needs a reason
      await bk.getByTestId('bk-cancel').click();
      await expect(bk.getByTestId('bk-cancel-send')).toBeDisabled();
      await bk.getByTestId('bk-cancel-why').fill('College exam that day');
      await bk.getByTestId('bk-cancel-send').click();
      await expect(bk.getByTestId('bk-mine')).toHaveCount(0);
      await expect(bk.getByTestId('bk-slot')).toHaveCount(2);
      await bk.getByTestId('bk-pick').first().click();
      await expect(bk.getByTestId('bk-mine')).toContainText('10:00');
      expect(await noSideScroll(p)).toBe(true);
      await ctx.close();

      // the company: the booking is on Interview times and on the live card
      await hireTab(page, co, j.title);
      const tb = page.getByTestId('tb');
      await expect(tb).toBeVisible({ timeout: 20_000 });
      await expect(tb.getByTestId('tb-event').first()).toContainText('Booked a time');
      await expect(tb.getByTestId('tb-event').first()).toContainText('Asha Rao');
      await expect(tb.getByTestId('tb-events')).toContainText('Cancelled');
      await expect(tb.getByTestId('tb-events')).toContainText('College exam that day');
      await expect(page.getByTestId('co-slot').filter({ hasText: 'Asha Rao' })).toHaveCount(1);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('joining day in Hindi: coming, reschedule, I have joined; the company confirms with its own link', async ({ request, browser }) => {
      test.setTimeout(180_000);
      const tag = `${label}j${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const mail = person(`tt11j-${label}`);
      const before = seed('trust-t11-offer', mail, co.id, '1', co.mail, 'hi');
      const today = seed('trust-t11-offer', mail, co.id, '0', co.mail, 'hi');

      const { ctx, page: p } = await fresh(browser, opts);
      await p.goto(`/stop-alerts#k=join&t=${before.join}`);
      const jn = p.getByTestId('jn');
      await expect(jn).toBeVisible({ timeout: 20_000 });
      await expect(jn.getByTestId('jn-when')).toContainText('10:00');
      await expect(jn).toContainText('Hitech City, Gate 2');
      await jn.getByTestId('jn-yes').click();
      await expect(jn.getByTestId('jn-said')).toContainText('धन्यवाद');
      await p.reload();
      await p.getByTestId('jn-resched').click();
      await p.getByTestId('jn-resched-why').fill('Can I join on Monday?');
      await p.getByTestId('jn-resched-send').click();
      await expect(p.getByTestId('jn-said')).toContainText('कंपनी');
      expect(await noSideScroll(p)).toBe(true);

      await p.goto(`/stop-alerts#k=join&t=${today.join}`);
      await p.reload();
      await expect(p.getByTestId('jn-joined-btn')).toHaveText('मैंने जॉइन किया', { timeout: 20_000 });
      await p.getByTestId('jn-joined-btn').click();
      await expect(p.getByTestId('jn-joined')).toBeVisible();
      await ctx.close();

      // the company's one-tap link (from its "Did they join?" email)
      const c = await fresh(browser, opts);
      await c.page.goto(`/stop-alerts#k=cjoin&t=${today.company}`);
      const cj = c.page.getByTestId('cj');
      await expect(cj).toBeVisible({ timeout: 20_000 });
      await expect(cj).toContainText('Asha Rao');
      await cj.getByTestId('cj-yes').click();
      await expect(cj.getByTestId('cj-done')).toContainText('joined');
      expect(await noSideScroll(c.page)).toBe(true);
      await c.ctx.close();

      // both answers kept, as the company's card shows them
      const r = await request.get(`${API}/api/company/${co.id}/trust/booking`, { headers: co.H });
      const live = await r.json();
      const day0 = live.joinings.find((x) => x.id === today.id);
      expect(day0.answers.map((a) => `${a.side}:${a.kind}`)).toEqual(['candidate:joined', 'company:joined']);
      const day1 = live.joinings.find((x) => x.id === before.id);
      expect(day1.answers.map((a) => a.kind)).toEqual(['coming', 'reschedule']);
    });

    test('a changed link shows a plain error; the owner sees the Admin card', async ({ browser }) => {
      test.setTimeout(120_000);
      const { ctx, page: p } = await fresh(browser, opts);
      await p.goto(`/stop-alerts#k=book&t=b.0123456789abcdef01234567.9999999999.${'0'.repeat(32)}`);
      await expect(p.getByTestId('bk-error')).toContainText('expired or isn’t complete', { timeout: 20_000 });
      expect(await noSideScroll(p)).toBe(true);
      await ctx.close();

      const mail = `tt11-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      const a = await browser.newContext(opts);
      const admin = await a.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, mail, secret);
      await expect(admin).not.toHaveURL(/\/login/, { timeout: 15_000 });
      await admin.goto('/admin/skill-tests?tab=trust');
      const card = admin.getByTestId('tbk-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId('tbk-eveAt')).toHaveValue('19:00');
      await expect(card.getByTestId('tbk-soonHours')).toHaveValue('2');
      await card.getByTestId('tbk-templates').locator('summary').click();
      await expect(card.getByTestId('tbk-templates')).toContainText('nm7_interview_reminder');
      await expect(card.getByTestId('tbk-templates')).toContainText('नमस्ते');
      expect(await noSideScroll(admin)).toBe(true);
      await a.close();
    });
  });
}
