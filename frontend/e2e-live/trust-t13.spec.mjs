// Vetting Trust T13 (time to hire in minutes) on a desktop and a 390 px phone, against the real API:
//   - Admin → Daily report → "Time to hire": after Refresh now, a slow real company (3 jobs first contacted 10 days after
//     posting) is in "Slowest to first contact", its live job nobody contacted is in "Needs attention", the 7 / 30 / 90
//     day buttons switch the medians, and the thresholds open, save and are put back;
//   - the company (a Trust tester): Hire now shows "Time to hire" with its own job (first shortlist 45 m, first contact
//     45 m, first interview 2 h 15 m) and the Nm7 median line; a company outside the Trust switch sees no card.
// Desktop and phone share one database: every test uses its own companies and jobs; the thresholds are restored.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

async function company(request, tag, tester = true) {
  const site = `tt${tag}.example`;
  const mail = `hr-${tag}@example.com`;
  const body = { details: { legalName: `Tt${tag} Foods Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
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

async function job(request, co, tag) {
  const title = `Store Analyst ${tag}`;
  const data = { job: { title, description: 'Build weekly sales reports in Excel and Power BI for our stores. Freshers are welcome.', locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Excel', 'Power BI'] } };
  const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { data, headers: co.H })).json();
  expect(posted.status).toBe('active');
  return { id: posted.id, title };
}

async function hireTab(page, co, title) {
  await page.goto('/company');
  await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
  await page.goto('/company');
  await page.getByRole('tab', { name: 'Hire now' }).click();
  await page.getByTestId('co-hire-job').selectOption({ label: title });
}

// the first request after the API starts can be slow (indexes on a fresh database): wake it before the first sign-in
test.beforeAll(async ({ request }) => {
  for (let i = 0; i < 20; i += 1) {
    const r = await request.get(`${API}/api/public/prices`).catch(() => null);
    if (r && r.ok()) break;
    await new Promise((ok) => { setTimeout(ok, 1500); });
  }
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Daily report: Time to hire with the slowest companies, attention, periods and thresholds', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}${Date.now().toString(36)}`;
      seed('trust-t13-admin', tag);
      const owner = `tt13-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
      await page.goto('/admin/daily-report');
      await expect(page.getByTestId('dr-summary').getByRole('listitem')).toHaveCount(5, { timeout: 20_000 });
      await page.getByTestId('dr-refresh').click();
      await expect(page.getByTestId('dr-refresh')).toHaveText('Refresh now', { timeout: 60_000 });

      await expect(page.getByRole('heading', { name: 'Time to hire', level: 2 })).toBeVisible();
      const tth = page.getByTestId('tth');
      await expect(tth).toBeVisible({ timeout: 20_000 });
      await tth.scrollIntoViewIfNeeded();
      await expect(tth.getByTestId('tth-step')).toHaveCount(6);
      await expect(tth.getByTestId('tth-slowest')).toContainText(`Tt13 ${tag} Slow Pvt Ltd`);
      await expect(tth.getByTestId('tth-slow').filter({ hasText: `Tt13 ${tag} Slow` })).toContainText('10 d');
      await expect(tth.getByTestId('tth-funnel')).toContainText('Jobs posted');
      await expect(page.getByTestId('dr-attention')).toContainText('no contact with any candidate yet');
      // the periods
      await tth.getByTestId('tth-days-90').click();
      await expect(tth.getByTestId('tth-days-90')).toHaveAttribute('aria-pressed', 'true');
      await expect(tth.locator('[data-testid="tth-step"][data-key="contact"]')).not.toContainText('No data yet');
      await tth.getByTestId('tth-days-7').click();
      await expect(tth.getByTestId('tth-days-7')).toHaveAttribute('aria-pressed', 'true');
      expect(await noSideScroll(page)).toBe(true);

      // the thresholds: change one, save, put it back
      await tth.getByTestId('tth-thresholds').locator('summary').click();
      const ch = tth.getByTestId('tth-set-contactHours');
      await expect(ch).toBeVisible();
      await ch.fill('30');
      await tth.getByTestId('tth-save').click();
      await expect(page.getByText('Saved. The median rule applies now')).toBeVisible();
      await expect(ch).toHaveValue('30');
      await ch.fill('24');
      await tth.getByTestId('tth-save').click();
      await expect(ch).toHaveValue('24');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('company: its own time to hire next to the Nm7 median; outside the switch, no card', async ({ page, request }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}c${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, tag);
      seed('trust-t13-job', co.id, j.id);
      await hireTab(page, co, j.title);
      const card = page.getByTestId('tth-co');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('[data-testid="tth-co-step"][data-key="shortlist"]')).toContainText('45 m');
      await expect(card.locator('[data-testid="tth-co-step"][data-key="contact"]')).toContainText('45 m');
      await expect(card.locator('[data-testid="tth-co-step"][data-key="interview"]')).toContainText('2 h 15 m');
      await expect(card.locator('[data-testid="tth-co-step"][data-key="offer"]')).toContainText('Not yet');
      await expect(card.getByTestId('tth-co-nm7').first()).toContainText('Nm7 median:');
      await expect(card.getByTestId('tth-co-job')).toHaveCount(1);
      await expect(card.getByTestId('tth-co-job')).toContainText(j.title);
      await expect(card.getByTestId('tth-co-job')).toContainText('First interview booked: 2 h 15 m');
      await card.getByTestId('tth-co-days-7').click();
      await expect(card.locator('[data-testid="tth-co-step"][data-key="interview"]')).toContainText('2 h 15 m');
      expect(await noSideScroll(page)).toBe(true);

      // a company that isn't on the Trust test list: no card (the API answers 404)
      const other = await company(request, `${tag}x`, false);
      const j2 = await job(request, other, `${tag}x`);
      seed('trust-t13-job', other.id, j2.id);
      const r = await request.get(`${API}/api/company/${other.id}/trust/tth`, { headers: other.H });
      expect(r.status()).toBe(404);
      await hireTab(page, other, j2.title);
      await expect(page.getByTestId('co-hire')).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('tth-co')).toHaveCount(0);
    });
  });
}
