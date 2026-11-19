// Vetting Trust T4 (employer business verification with the test provider, "Never pay", Report fraud) on a desktop and a
// 390 px phone, against the real API:
//   - a company (a tester) verifies its business in Settings → "Verify your business" (a typing mistake is caught before
//     any lookup) → "✓ Verified employer · GST"; a tester candidate sees the badge on the job card and the job page,
//     the "Never pay for a job on Nm7" promise with what to do, and reports fraud (told what happens next); signed out
//     (the switch is off) the job page is as before; the owner sees the Employer checks card (test mode, key not set)
//     and the fraud report with the reporter, and dismisses it;
//   - another name in the registry → "A person at Nm7 is checking this" with the reason (never a rejection); the owner
//     marks it a Verified employer; a company that isn't a tester sees no card at all;
//   - on an offer (Ready to join): the promise and "Report this offer"; Help & referral: what to do if asked for money.
// Desktop and phone share one database: every test uses its own companies, people and registration numbers, and no
// global setting is changed.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(seedText) { // a valid GSTIN (state 36, Telangana) with its check character, unique per test
  const h = [...seedText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e9, 7);
  const L = (i) => 'ABCDEFGHJKLMNPRSTUVWXY'[Math.floor(h / 22 ** i) % 22];
  const first14 = `36${L(0)}${L(1)}${L(2)}C${L(3)}${String(h % 10000).padStart(4, '0')}${L(4)}1Z`;
  let total = 0;
  [...first14].forEach((c, i) => { const p = CH.indexOf(c) * (i % 2 ? 2 : 1); total += Math.floor(p / 36) + (p % 36); });
  return first14 + CH[(36 - (total % 36)) % 36];
}

async function company(request, tag, { name, testerCo = true } = {}) {
  const site = `emp${tag}.example`;
  const mail = `hr-${tag}@example.com`;
  const legal = name || `Emp${tag} Foods Pvt Ltd`;
  const body = { details: { legalName: legal, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  if (testerCo) seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H, legal, slug: r.company.slug };
}

async function openSettings(page, session) {
  await page.goto('/company');
  await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), session);
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
}

async function candidate(browser, opts, who, name) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const ip = `10.7.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
  await page.route(`${API}/**`, (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': ip } }));
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  seed('trust-tester', mail);
  await login(page, mail);
  await page.waitForURL('**/me');
  return { ctx, page, mail };
}

async function owner(browser, opts, label) {
  const mail = `tt4-owner-${label}-${Date.now().toString(36)}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  const ctx = await browser.newContext({ ...opts });
  const admin = await ctx.newPage();
  admin.on('dialog', () => { throw new Error('no browser dialogs'); });
  await adminLogin(admin, mail, secret);
  await expect(admin).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await admin.goto('/admin/skill-tests?tab=trust');
  return { ctx, admin };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('company verifies its business; candidates see the badge and the promise and report fraud; owner dismisses', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}a${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const title = `Store Trainee ${tag}`;
      const job = { title, description: 'Help customers in our store, keep shelves tidy and update stock in a tablet app. Training given; freshers welcome.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Communication'] };
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { data: { job }, headers: co.H })).json();
      expect(posted.status).toBe('active');

      // the company: Settings → Verify your business
      await openSettings(page, co.session);
      const vb = page.getByTestId('co-verify-business');
      await expect(vb.getByTestId('vb-state')).toHaveText('Not verified yet');
      await vb.getByTestId('vb-kind').selectOption('gstin');
      const number = gstin(tag);
      const wrong = number.slice(0, 14) + (number[14] === 'A' ? 'B' : 'A');
      await vb.getByTestId('vb-number-input').fill(wrong);
      await vb.getByTestId('vb-agree').check();
      await vb.getByTestId('vb-send').click();
      await expect(vb.getByRole('alert')).toContainText('last character'); // caught before any lookup
      await vb.getByTestId('vb-number-input').fill(number.toLowerCase());
      await vb.getByTestId('vb-send').click();
      await expect(vb.getByTestId('vb-state')).toHaveText('✓ Verified employer · GST (test)');
      await expect(vb.getByTestId('vb-number')).toContainText('36');
      await expect(vb.getByTestId('vb-number')).not.toContainText(number);
      await expect(vb.getByTestId('vb-facts')).toContainText(co.legal);
      await expect(vb.getByTestId('vb-facts')).toContainText('Telangana');
      expect(await noSideScroll(page)).toBe(true);

      // a candidate Vetting Trust is on for: the badge, the promise, Report fraud
      const s = await candidate(browser, opts, `tt4c-${label}`, `Ravi Jobs ${label}`);
      await s.page.goto(`/jobs?q=${encodeURIComponent(title)}`);
      const card = s.page.getByTestId('job-card').filter({ hasText: title });
      await expect(card.getByTestId('employer-badge')).toHaveText('Verified employer · GST (test)');
      await card.getByRole('link', { name: title }).click();
      const detail = s.page.getByTestId('job-detail');
      await expect(detail.getByTestId('employer-badge')).toContainText('Verified employer · GST, checked');
      await expect(detail.getByTestId('never-pay')).toContainText('Never pay for a job on Nm7.');
      await detail.getByText('What to do if anyone asks you for money').click();
      await expect(detail.getByTestId('never-pay-help')).toContainText('1930');
      await detail.getByTestId('fraud-open').click();
      const form = detail.getByTestId('fraud-form');
      await form.getByTestId('fraud-send').click();
      await expect(form.getByRole('alert')).toHaveText('Pick what happened.');
      await form.getByTestId('fraud-reason-money').check();
      await form.getByTestId('fraud-note').fill(`They asked me to pay 1500 for a uniform ${tag}`);
      expect(await noSideScroll(s.page)).toBe(true);
      await form.getByTestId('fraud-send').click();
      await expect(detail.getByTestId('fraud-done')).toContainText('The company is never told who reported it.');
      await s.ctx.close();

      // signed out, with the switch off: the job page is as before (no badge, no promise, the old report link)
      const anon = await (await browser.newContext(opts)).newPage();
      await anon.goto(`/jobs/${posted.slug}`);
      await expect(anon.getByTestId('job-detail')).toBeVisible();
      await expect(anon.getByTestId('report-signin')).toBeVisible();
      await expect(anon.getByTestId('employer-badge')).toHaveCount(0);
      await expect(anon.getByTestId('never-pay')).toHaveCount(0);
      await anon.goto(`/companies/${co.slug}`);
      await expect(anon.getByTestId('company-public')).toBeVisible();
      await expect(anon.getByTestId('company-safety')).toHaveCount(0);
      await anon.context().close();

      // the owner: Employer checks (test mode, the key not set) and the fraud report with who sent it; dismiss
      const { ctx, admin } = await owner(browser, opts, label);
      const te = admin.getByTestId('te-card');
      await expect(te.getByTestId('te-state')).toHaveText('Test mode: only testers and the demo company on the live site', { timeout: 20_000 });
      await expect(te.getByTestId('te-keys-surepass')).toContainText('SUREPASS_TOKEN: not set');
      const fr = admin.getByTestId('tfr-card').getByTestId('tfr-case').filter({ hasText: title });
      await expect(fr).toContainText('Asked me for money');
      await expect(fr).toContainText(`uniform ${tag}`);
      await expect(fr).toContainText(s.mail);
      expect(await noSideScroll(admin)).toBe(true);
      await fr.getByTestId('tfr-dismiss').click();
      await expect(fr).toHaveCount(0);
      await ctx.close();
    });

    test('another name in the registry: a person checks (never a rejection), the owner verifies; not a tester: no card', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}b${Date.now().toString(36)}`;
      const co = await company(request, tag, { name: `Emp${tag} mismatch Foods` });
      await openSettings(page, co.session);
      const vb = page.getByTestId('co-verify-business');
      await vb.getByTestId('vb-number-input').fill(gstin(tag));
      await vb.getByTestId('vb-agree').check();
      await vb.getByTestId('vb-send').click();
      await expect(vb.getByTestId('vb-state')).toHaveText('A person at Nm7 is checking this (test)');
      await expect(vb.getByTestId('vb-reasons')).toContainText('doesn’t match your company name');
      await expect(vb.getByTestId('vb-reasons')).toContainText('Nothing changes for your jobs meanwhile');
      expect(await noSideScroll(page)).toBe(true);

      const { ctx, admin } = await owner(browser, opts, `${label}b`);
      const item = admin.getByTestId('te-review-item').filter({ hasText: co.legal });
      await expect(item.getByTestId('te-why')).toContainText('Sunrise Traders and Exports', { timeout: 20_000 });
      await item.getByTestId('te-note').fill('Checked the GST certificate on a call.');
      await item.getByTestId('te-verified').click();
      await expect(item).toHaveCount(0);
      await ctx.close();
      await page.reload();
      await page.getByRole('tab', { name: 'Settings' }).click();
      await expect(page.getByTestId('co-verify-business').getByTestId('vb-state')).toHaveText('✓ Verified employer · GST (test)');

      // a company Vetting Trust is not on for sees nothing new
      const other = await company(request, `${tag}x`, { testerCo: false });
      await openSettings(page, other.session);
      await expect(page.getByTestId('co-settings')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('co-verify-business')).toHaveCount(0);
    });

    test('an offer shows the promise and Report this offer; Help explains what to do', async ({ browser }) => {
      test.setTimeout(120_000);
      const s = await candidate(browser, opts, `tt4o-${label}`, `Sita Offer ${label}`);
      seed('trust-offer', s.mail, '10');
      await s.page.goto('/me/hire');
      const offers = s.page.getByTestId('hire-offers');
      await expect(offers.getByTestId('never-pay')).toContainText('Never pay for a job on Nm7.', { timeout: 20_000 });
      const offer = offers.getByTestId('hire-offer').first();
      await offer.getByTestId('fraud-open').click();
      await offer.getByTestId('fraud-reason-fake_company').check();
      await offer.getByTestId('fraud-send').click();
      await expect(offer.getByTestId('fraud-done')).toContainText('A person at Nm7 checks every report');
      expect(await noSideScroll(s.page)).toBe(true);
      // Help & referral: what to do if anyone asks for money
      await s.page.goto('/me/help');
      await expect(s.page.getByTestId('never-pay-card')).toContainText('call 1930', { timeout: 20_000 });
      expect(await noSideScroll(s.page)).toBe(true);
      await s.ctx.close();
    });
  });
}
