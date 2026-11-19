// Profile setup P3: the company and college checklists, on a desktop and a 390 px phone, against the real API:
//   - a new company sees the card at the top of its dashboard with the right next step; Next step opens the right tab;
//     finishing it ticks it; Skip for now moves on;
//   - an existing company with data sees those steps ticked; a view-only team member sees who can do each step and
//     no buttons;
//   - a college coordinator sees the college's checklist on My groups and Dashboard; Skip for now moves on; on a paid
//     plan the drive and recruiter steps appear and Next step opens Drives;
//   - nothing scrolls sideways.
// Desktop and phone share one database: every test uses its own company / college.
import { expect, test } from '@playwright/test';
import { API, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, college, noSideScroll } from './college.mjs';

const card = (page) => page.getByTestId('sc-card');
const row = (page, id) => page.locator(`[data-testid="sc-row"][data-step="${id}"]`);
async function openAll(page) {
  const t = page.getByTestId('sc-toggle');
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
  await expect(page.getByTestId('sc-list')).toBeVisible();
}

/** A company with both emails proven (Basic). Returns its id, the main admin's session and headers. */
async function company(request, tag, { about = '' } = {}) {
  const site = `sc${tag}.example`;
  const mail = `boss-${tag}@example.com`;
  const body = { details: { legalName: `Setup ${tag} Pvt Ltd`, website: site, category: 'sme', structure: 'private_limited', industry: 'Retail', size: '11_50', about }, registration: { kind: 'cin', number: 'U72900TG2019PTC123456' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Boss' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Boss', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `hr@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`hr@${site}`) }, headers: H });
  return { id: r.company.id, session: r.session, H, site };
}

async function asCompany(page, session) {
  await page.goto('/company');
  await page.evaluate((s) => { localStorage.setItem('nm7-recruiter-account', s); sessionStorage.setItem('nm7-sc-fresh', '1'); }, session);
  await page.reload();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('new company: the right next step, Next step opens the tab, finishing ticks it, Skip for now moves on', async ({ page, request }) => {
      test.setTimeout(120_000);
      const co = await company(request, `${label[0]}n${Date.now().toString(36)}`);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await asCompany(page, co.session);
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toContainText('Set up your company');
      await expect(page.getByTestId('sc-ring')).toHaveAttribute('aria-label', /^0 of \d steps done$/);
      await expect(page.getByTestId('sc-next-title')).toHaveText('Finish your company details');
      if (label === 'phone') {
        await expect(page.getByTestId('sc-skip')).toBeHidden(); // compact: the ring and one button
        expect((await page.getByTestId('sc-next').boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      expect(await noSideScroll(page)).toBe(true);

      // Next step → the Company page tab → write the about text → back on Overview it is ticked
      await page.getByTestId('sc-next').click();
      const pg = page.getByTestId('co-page');
      await expect(pg).toBeVisible();
      await pg.getByLabel('About the company').fill('We run grocery stores across Andhra Pradesh.');
      await pg.getByRole('button', { name: 'Save' }).click();
      await expect(pg.getByRole('status')).toHaveText('Saved.');
      await page.getByRole('tab', { name: 'Overview' }).click();
      await expect(page.getByTestId('sc-next-title')).toHaveText('Get your business checked (GST, Udyam or CIN)');
      await openAll(page);
      await expect(row(page, 'basics')).toHaveAttribute('data-status', 'done');
      await expect(row(page, 'team')).toContainText('About 2 min');
      expect(await noSideScroll(page)).toBe(true);

      // Skip for now: the next one is offered; the skipped row says so
      await row(page, 'business').getByTestId('sc-row-skip').click();
      await expect(page.getByTestId('sc-next-title')).toHaveText('Post your first job');
      await expect(row(page, 'business')).toContainText('Skipped');
      // Next step opens the Jobs tab
      await page.getByTestId('sc-next').click();
      await expect(page.getByTestId('co-jobs')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });

    test('existing company with data sees ticks; a view-only team member sees who can do each step', async ({ page, request, browser }) => {
      test.setTimeout(120_000);
      const tag = `${label[0]}e${Date.now().toString(36)}`;
      const co = await company(request, tag, { about: 'We hire store staff every month.' });
      seed('company-verify', co.id);
      const job = { title: `Store Supervisor ${tag}`, description: 'Run a grocery store shift: stock, billing and a team of six. Training given.', locations: ['Vijayawada'], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Retail'],
        questions: [{ text: 'Can you work from Vijayawada?', kind: 'yesno', want: 'yes' }] };
      const posted = await (await request.post(`${API}/api/company/${co.id}/jobs`, { data: { job }, headers: co.H })).json();
      expect(posted.status).toBe('active');
      const viewer = `ops-${tag}@example.com`;
      expect((await request.post(`${API}/api/company/${co.id}/team`, { data: { email: viewer, role: 'view' }, headers: co.H })).status()).toBe(201);

      await asCompany(page, co.session);
      await expect(page.getByTestId('sc-next-title')).toHaveText('Add interview times');
      await expect(page.getByTestId('sc-ring')).toHaveAttribute('aria-label', '5 of 6 steps done');
      await openAll(page);
      for (const id of ['basics', 'business', 'job', 'screening', 'team']) await expect(row(page, id)).toHaveAttribute('data-status', 'done');
      await expect(row(page, 'slots')).toHaveAttribute('data-status', 'next');
      expect(await noSideScroll(page)).toBe(true);

      // the view-only member: the same checklist, who can do the open step, no buttons and no Skip for now
      const ctx = await browser.newContext(opts);
      const vp = await ctx.newPage();
      const NET = ownNetwork();
      await request.post(`${API}/api/recruiter-account/code`, { headers: NET, data: { email: viewer } });
      const vs = (await (await request.post(`${API}/api/recruiter-account/session`, { headers: NET, data: { email: viewer, code: lastCode(viewer) } })).json()).session;
      await asCompany(vp, vs);
      await expect(vp.getByTestId('sc-next-title')).toHaveText('Add interview times');
      await expect(vp.getByTestId('sc-next-who')).toHaveText('A team admin who can post jobs can do this.');
      await expect(vp.getByTestId('sc-next')).toHaveCount(0);
      await openAll(vp);
      await expect(vp.getByTestId('sc-row-skip')).toHaveCount(0);
      await expect(vp.getByTestId('sc-remind')).toHaveCount(0);
      expect(await noSideScroll(vp)).toBe(true);
      await ctx.close();
    });

    test('college coordinator: the checklist on My groups and Dashboard, Skip for now, paid plan steps', async ({ browser }) => {
      test.setTimeout(180_000);
      const free = await college(browser, opts, label, { plan: 'free', students: 0, prefix: 'scf' });
      try {
        const p = free.coord;
        await p.goto(`/org/${free.org.id}`);
        await expect(card(p)).toBeVisible();
        await expect(card(p)).toContainText('Set up your college');
        await expect(p.getByTestId('sc-next-title')).toHaveText('Invite your students');
        await openAll(p);
        await expect(row(p, 'basics')).toHaveAttribute('data-status', 'done'); // name and city from sign-up
        await expect(row(p, 'groups')).toHaveAttribute('data-status', 'done');
        await expect(row(p, 'drive')).toHaveCount(0); // not on the Free plan
        expect(await noSideScroll(p)).toBe(true);
        await row(p, 'students').getByTestId('sc-row-skip').click();
        await expect(p.getByTestId('sc-next-title')).toHaveText('Download your first placement report');
        await p.getByTestId('sc-next').click();
        await p.waitForURL(`**/org/${free.org.id}/dashboard`);
        await expect(card(p)).toBeVisible();
        expect(await noSideScroll(p)).toBe(true);
      } finally { await free.close(); }

      const paid = await college(browser, opts, label, { plan: 'campus', students: 1, prefix: 'scp' });
      try {
        const p = paid.coord;
        await p.goto(`/org/${paid.org.id}`);
        await expect(p.getByTestId('sc-next-title')).toHaveText('Plan your first placement drive');
        await openAll(p);
        await expect(row(p, 'students')).toHaveAttribute('data-status', 'done');
        await expect(row(p, 'companies')).toHaveAttribute('data-status', 'later');
        await p.getByTestId('sc-next').click();
        await p.waitForURL(`**/org/${paid.org.id}/drives`);
        expect(await noSideScroll(p)).toBe(true);
      } finally { await paid.close(); }
    });
  });
}
