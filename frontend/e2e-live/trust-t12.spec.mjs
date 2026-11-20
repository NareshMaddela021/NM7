// Vetting Trust T12 (fairness upgrades) on a desktop and a 390 px phone, against the real API:
//   - a tester company writes a job: Check shows "Can’t be used" for a direct filter ("Freshers under 25") with why and a
//     neutral wording, and Post stays off; a proxy ("Only from IIT or NIT") is "May be unfair" and can still be posted;
//   - the job's requirements: a proxy saved shows the warning; a direct one is refused with why;
//   - Hire now: a language filter the job doesn't need is warned; "Keep it" is noted, "Remove this filter" clears it;
//   - Admin → Vetting Trust → Fairness: blind grading places, a snapshot with a city-tier pass-rate gap (four-fifths rule,
//     no person), a T9 re-grade decided by a person, the settings saved and put back;
//   - while the switch is off, a company that isn't a tester sees no fairness notes.
// Desktop and phone share one database: every test uses its own company / people and puts any setting back.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores in Hyderabad. Freshers are welcome.';

async function company(request, tag, { tester = true } = {}) {
  const site = `t12${tag}.example`;
  const mail = `hr-t12${tag}@example.com`;
  const body = { details: { legalName: `T12${tag} Retail Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
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

const postJob = (request, co, title, description = DESC) => request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: { title, description, locations: ['Hyderabad'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['SQL', 'Power BI'] } } }).then((r) => r.json());

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('job post: a direct filter can’t be used, a proxy is warned with a neutral wording and can be posted', async ({ page, request }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}${uniq()}`;
      const co = await company(request, tag);
      const title = `Data Analyst ${tag}`;
      await openCompany(page, co.session, 'Jobs');
      await page.getByRole('button', { name: 'Post a job' }).click();
      const form = page.getByTestId('co-job-form');
      await form.locator('#cj-title').fill(title);
      await form.locator('#cj-desc').fill(`${DESC} Freshers under 25 only. Only from IIT or NIT.`);
      await form.locator('#cj-cities').fill('Hyderabad');
      await form.getByRole('button', { name: 'Check' }).click();
      const fair = form.getByTestId('co-job-fair');
      await expect(fair.getByTestId('co-job-fair-refuse')).toContainText('Can’t be used (age): “Freshers under 25”', { timeout: 20_000 });
      await expect(fair.getByTestId('co-job-fair-refuse')).toContainText('Try instead:');
      await expect(fair.getByTestId('co-job-fair-warn')).toContainText('May be unfair (which college)');
      await expect(fair.getByTestId('co-job-fair-warn')).toContainText('Ask for the skill instead');
      await expect(form.getByRole('button', { name: 'Post job' })).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);
      await form.locator('#cj-desc').fill(`${DESC} Only from IIT or NIT.`);
      await form.getByRole('button', { name: 'Check' }).click();
      await expect(fair.getByTestId('co-job-fair-refuse')).toHaveCount(0, { timeout: 20_000 });
      await expect(fair.getByTestId('co-job-fair-warn')).toBeVisible();
      await expect(form.getByRole('button', { name: 'Post job' })).toBeEnabled();
      await form.getByRole('button', { name: 'Post job' }).click();
      await expect(page.getByTestId('co-job').filter({ hasText: title })).toBeVisible({ timeout: 20_000 });
      // the server refuses a direct one whatever the page does
      const bad = await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: { title: `X ${tag}`, description: `${DESC} Girls preferred for the front desk.`, locations: ['Hyderabad'], experience: 'fresher' } } });
      expect(bad.status()).toBe(400);
      expect((await bad.json()).error.fairness[0].topic).toBe('gender');
    });

    test('requirements and Hire now: proxies warned, a direct requirement refused, keep or remove a filter', async ({ page, request }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}${uniq()}`;
      const co = await company(request, tag);
      const job = await postJob(request, co, `Store Analyst ${tag}`);
      expect(job.status).toBe('active');
      // requirements (through the API the editor uses), then the editor shows the warning after a save
      const url = `${API}/api/company/${co.id}/trust/criteria/${job.id}`;
      const refused = await request.put(url, { headers: co.H, data: { items: [{ kind: 'other', text: 'Freshers under 25 only', must: true }] } });
      expect(refused.status()).toBe(400);
      expect((await refused.json()).error.message).toContain('experience');
      await openCompany(page, co.session, 'Jobs');
      const row = page.getByTestId('co-job').filter({ hasText: `Store Analyst ${tag}` });
      const ed = row.getByTestId('crit-editor');
      await ed.locator('summary').click();
      await expect(ed.getByTestId('crit-row').first()).toBeVisible({ timeout: 20_000 });
      await ed.getByTestId('crit-add').click();
      await ed.getByTestId('crit-text').last().fill('No family commitments');
      await ed.getByTestId('crit-save').click();
      await expect(ed.getByTestId('crit-fair-warn')).toContainText('May be unfair (marital status)', { timeout: 20_000 });
      await expect(ed.getByTestId('crit-fair-warn')).toContainText('shift timings');
      expect(await noSideScroll(page)).toBe(true);
      // Hire now: a language the job doesn't mention
      await page.getByRole('tab', { name: 'Hire now' }).click();
      await page.getByTestId('co-hire-job').selectOption(job.id);
      const filters = page.getByTestId('co-hire-nt-filters');
      await expect(filters.getByTestId('co-hire-nt-lang')).toBeVisible({ timeout: 20_000 });
      await filters.getByTestId('co-hire-nt-lang').selectOption('Tamil');
      const notes = page.getByTestId('co-hire-fair');
      await expect(notes.getByTestId('co-hire-fair-warn')).toContainText('May be unfair (mother tongue / language): “Speaks Tamil”', { timeout: 20_000 });
      const kept = page.waitForResponse((r) => r.url().endsWith('/trust/fairness/ack') && r.status() === 200);
      await notes.getByTestId('co-hire-fair-keep').click();
      await kept;
      await expect(notes.getByTestId('co-hire-fair-keep')).toHaveText('Kept (noted)');
      expect(await noSideScroll(page)).toBe(true);
      await notes.getByTestId('co-hire-fair-remove').click();
      await expect(filters.getByTestId('co-hire-nt-lang')).toHaveValue('');
      await expect(page.getByTestId('co-hire-fair')).toHaveCount(0, { timeout: 20_000 });
    });

    test('Admin: blind grading, a pass-rate gap in the snapshot, a re-grade decided by a person, settings', async ({ page }) => {
      const tag = `${label[0]}${uniq()}`;
      seed('trust-t12-gaps', tag);
      const rg = seed('trust-t12-regrade', tag);
      const owner = `tt12-owner-${label}-${uniq()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('tfa-card');
      await expect(card.getByTestId('tfa-save')).toBeVisible({ timeout: 30_000 });
      await card.getByTestId('tfa-blind').locator('summary').click();
      await expect(card.getByTestId('tfa-blind')).toContainText('V2 practical task grading');
      await expect(card.getByTestId('tfa-blind')).toContainText('college names');
      // a snapshot now: the city-tier gap, with no person in it
      const snap = page.waitForResponse((r) => r.url().endsWith('/api/admin/trust/fairness/report/run') && r.status() === 200);
      await card.getByTestId('tfa-run-report').click();
      const body = await (await snap).json();
      expect(JSON.stringify(body)).not.toContain(`t12-${tag}`);
      await expect(card.getByTestId('tfa-flag').filter({ hasText: 'Skill checks' }).filter({ hasText: 'Tier 3' }).first()).toContainText('under 80% of the best group', { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
      // the T9 re-grade a person decides
      const row = card.getByTestId('tfa-rv-t9').filter({ hasText: 'strong then weak' }).first();
      await expect(row).toBeVisible();
      const decided = page.waitForResponse((r) => r.url().endsWith(`/regrades/${rg.id}/decide`) && r.status() === 200);
      await row.getByTestId('tfa-second').click();
      await decided;
      await expect(card.getByTestId('tfa-rv-t9').filter({ hasText: 'Changed by a person' }).first()).toBeVisible({ timeout: 20_000 });
      // settings saved and put back (shared database)
      const saved = () => page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/trust/fairness' && r.request().method() === 'GET');
      await card.getByTestId('tfa-r-sample').fill('7');
      let back = saved();
      await card.getByTestId('tfa-save').click();
      await back;
      await expect(card.getByTestId('tfa-r-sample')).toHaveValue('7');
      await card.getByTestId('tfa-r-sample').fill('5');
      back = saved();
      await card.getByTestId('tfa-save').click();
      await back;
      await expect(card.getByTestId('tfa-r-sample')).toHaveValue('5');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch off: a company that is not a tester sees no fairness notes', async ({ page, request }) => {
      const tag = `${label[0]}${uniq()}`;
      const co = await company(request, tag, { tester: false });
      await openCompany(page, co.session, 'Jobs');
      await page.getByRole('button', { name: 'Post a job' }).click();
      const form = page.getByTestId('co-job-form');
      await form.locator('#cj-title').fill(`Analyst ${tag}`);
      await form.locator('#cj-desc').fill(`${DESC} Only from IIT or NIT.`);
      await form.locator('#cj-cities').fill('Hyderabad');
      await form.getByRole('button', { name: 'Check' }).click();
      await expect(form.getByTestId('co-job-check')).toBeVisible({ timeout: 20_000 });
      await expect(form.getByTestId('co-job-fair')).toHaveCount(0);
      const chk = await request.post(`${API}/api/company/${co.id}/trust/fairness/check`, { headers: co.H, data: { text: 'Locals only' } });
      expect(chk.status()).toBe(404);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
