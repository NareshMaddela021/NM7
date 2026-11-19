// Auto Apply 2.0, phase A4 (partner integrations) on a desktop and a 390 px phone, against the real API. The test
// server offers a no-network "Test system" as a partner, so nothing leaves Nm7. A verified company with a tester on its
// team opens "Connect your hiring system": a wrong key is refused with a plain message (and never shown back); the
// right key connects and only "•••• last 4" comes back (no response from the page carries the key); Test connection
// works; a job is linked to a job in the test system; the tester's full-auto application to it is delivered there and
// the candidate's tracker shows "Partner · Test system" and "Delivered"; Disconnect asks on the page and removes it.
// Admin → Auto Apply shows each hiring system's health without secrets, and the demo company shows its "Connected
// (demo)" system. Every test uses its own company, candidate and jobs (desktop and phone share one database).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

const tracker = async (page) => (await call(page, '/api/me/auto-apply/v2/tracker')).body;

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('company connects its hiring system, links a job, the auto application is delivered there', async ({ page, request, browser }) => {
      test.setTimeout(200_000);
      const tag = `a4${label[0]}${Date.now().toString(36)}`;
      const KEY = `sbx-secret-${tag}-K7Q9`;
      const co = await verifiedCompany(request, tag);
      seed('aa2-tester', `hr-${tag}@example.com`); // a tester on the team: a test company while the switch is OFF
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'aa4p');
      seed('aa2-tester', me);
      const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'full_auto' };
      expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
      expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);

      // the company's page: no response may carry the key
      const cctx = await browser.newContext(opts);
      const cp = await cctx.newPage();
      cp.on('dialog', () => { throw new Error('no browser dialogs'); });
      const bodies = [];
      cp.on('response', async (r) => { if (r.url().includes('/ats')) bodies.push(await r.text().catch(() => '')); });
      await cp.goto('/company');
      await cp.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
      await cp.reload();
      await cp.getByRole('tab', { name: 'Connect your hiring system' }).click();
      const form = cp.getByTestId('ats-form');
      await form.getByTestId('ats-partner').selectOption('sandbox');
      await expect(form.getByTestId('ats-how')).toContainText('nothing leaves Nm7');
      expect(await noSideScroll(cp)).toBe(true);
      // a wrong key: refused, plainly, nothing saved
      await form.getByTestId('ats-f-api_key').fill(`fail-${KEY}`);
      await form.getByTestId('ats-connect').click();
      await expect(form.getByTestId('ats-error')).toContainText('key isn’t valid');
      // the right key
      await form.getByTestId('ats-f-api_key').fill(KEY);
      const connected = cp.waitForResponse((r) => r.url().includes('/ats/connect') && r.request().method() === 'POST');
      await form.getByTestId('ats-connect').click();
      expect((await connected).ok()).toBe(true);
      const card = cp.getByTestId('ats-connected');
      await expect(card.getByTestId('ats-state')).toHaveText('Connected');
      await expect(card.getByTestId('ats-name')).toHaveText('Test system (no network)');
      await expect(card.getByTestId('ats-last4')).toHaveText('•••• K7Q9');
      await expect(card.getByTestId('ats-connected-at')).not.toBeEmpty();
      expect(await noSideScroll(cp)).toBe(true);
      await card.getByTestId('ats-test').click();
      await expect(card.getByTestId('ats-msg')).toHaveText('The connection works.');

      // a job (auto applications off for now), linked to a job in the test system
      const job = await co.post(`Data Analyst ${tag}`, { autoApply: { accept: false } });
      expect(job.status).toBe('active');
      await cp.getByRole('tab', { name: 'Jobs' }).click();
      await cp.getByRole('tab', { name: 'Connect your hiring system' }).click();
      const jobs = cp.getByTestId('ats-jobs');
      await jobs.getByTestId('ats-load-jobs').click();
      const row = jobs.getByTestId('ats-job').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row.getByTestId('ats-job-link')).toHaveText('· not linked');
      await row.getByTestId('ats-job-pick').selectOption('sbx-101');
      const linked = cp.waitForResponse((r) => r.url().includes(`/jobs/${job.id}/ats`) && r.request().method() === 'PUT');
      await row.getByTestId('ats-job-save').click();
      expect((await linked).ok()).toBe(true);
      await expect(row.getByTestId('ats-job-link')).toHaveText('→ Data Analyst (sandbox)');
      expect(await noSideScroll(cp)).toBe(true);

      // auto applications on: the tester's application is made on Nm7 and delivered to the test system
      const on = await request.put(`${API}/api/company/${co.id}/jobs/${job.id}/auto-apply`, { headers: { 'X-Recruiter-Account': co.session }, data: { accept: true, max: 50 } });
      expect(on.ok()).toBe(true);
      await expect.poll(async () => (await tracker(page)).items.filter((x) => x.job.id === job.id).map((x) => x.partner?.state), { timeout: 30_000 }).toEqual(['delivered']);
      await page.goto('/me/auto-apply/v2');
      const trow = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(trow.getByTestId('aa2-ch')).toHaveText('Partner · Test system (no network)');
      await expect(trow.getByTestId('aa2-row-partner')).toContainText('Delivered to the company’s hiring system');
      expect(await noSideScroll(page)).toBe(true);
      await cp.getByRole('tab', { name: 'Jobs' }).click();
      await cp.getByRole('tab', { name: 'Connect your hiring system' }).click();
      await expect(cp.getByTestId('ats-connected').getByTestId('ats-today')).toHaveText('1');

      // disconnect: asked on the page, then the form is back
      await cp.getByTestId('ats-disconnect').click();
      const gone = cp.waitForResponse((r) => r.url().endsWith('/ats') && r.request().method() === 'DELETE');
      await cp.getByTestId('ats-disconnect-yes').click();
      expect((await gone).ok()).toBe(true);
      await expect(cp.getByTestId('ats-form')).toBeVisible();
      expect(await noSideScroll(cp)).toBe(true);
      expect(bodies.length).toBeGreaterThan(3);
      for (const b of bodies) expect(b.includes(KEY)).toBe(false);
      expect(await cp.content()).not.toContain(KEY);
      await cctx.close();
    });

    test('Admin sees each hiring system’s health without secrets; the demo company is connected (demo)', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `aa4-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/auto-apply');
      const panel = page.getByTestId('aa2-partners-admin');
      await expect(panel).toBeVisible();
      for (const name of ['Zoho Recruit', 'Greenhouse', 'Lever', 'Darwinbox']) await expect(panel.getByTestId('aa2-partner').filter({ hasText: name })).toHaveCount(1);
      await expect(panel.getByTestId('aa2-partner').filter({ hasText: 'Darwinbox' })).toContainText('needs Darwinbox to confirm');
      const sbx = panel.locator('[data-testid="aa2-partner"][data-key="sandbox"]');
      await expect(sbx).toHaveCount(1);
      expect(Number(await sbx.getByTestId('aa2-partner-today').textContent())).toBeGreaterThanOrEqual(1);
      expect(await page.content()).not.toMatch(/sbx-secret-/);
      expect(await noSideScroll(page)).toBe(true);
      // the demo company: Greenhouse (demo), connected, no key
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      await page.getByRole('tab', { name: 'Connect your hiring system' }).click();
      const card = page.getByTestId('ats-connected');
      await expect(card.getByTestId('ats-state')).toHaveText('Connected (demo)');
      await expect(card.getByTestId('ats-name')).toHaveText('Greenhouse (demo)');
      await expect(card.getByTestId('ats-last4')).toHaveText('demo, no key');
      await expect(page.getByTestId('ats-job').first()).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
