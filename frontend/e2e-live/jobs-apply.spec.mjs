// Manual Apply and My applications (J5) on a desktop and a 390 px phone, against the real API: apply on Nm7 (one
// tap), on the company's site (the link opens and the application is saved as outside Nm7), by email (a filled-in
// mailto draft); My applications shows each with how it was sent; the admin opens the applications (Nm7 one → Viewed)
// and shortlists it, and the person sees the steps; "Make my resume fit" opens the job match; the follow-up stop page.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const DESC = 'Test our web and mobile apps by hand and write clear bug reports. Freshers who know SQL basics are welcome.';
const RESUME = { personal: { name: 'Sai Varsha', email: 'sai@example.com', location: 'Hyderabad' }, skillGroups: [{ id: 'c', label: 'Core', value: 'SQL, Manual testing' }], edu: [{ institution: 'Lakeview Institute', degree: 'B.Tech' }] };
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('apply on Nm7 / company link / email; My applications; admin shortlists; make my resume fit', async ({ page, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}a${Date.now().toString(36)}`;
      const job = (body) => seed('job', JSON.stringify({ description: DESC, company: { name: `Orbit ${tag}` }, locations: ['Hyderabad'], skills: ['SQL', 'Manual Testing'], ...body }));
      const onNm7 = job({ title: `QA Trainee ${tag}`, applyMethod: 'nm7' });
      const onLink = job({ title: `Test Analyst ${tag}`, applyMethod: 'link', applyUrl: `https://orbit.example/careers/${tag}` });
      const byMail = job({ title: `Support Tester ${tag}`, applyMethod: 'email', applyEmail: 'hr@orbit.example' });
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      const me = email('ja');
      seed('customer', me, 'Sai Varsha', PASSWORD);
      await login(page, me);
      await expect(page).not.toHaveURL(/\/login/);
      expect((await call(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: 'r1', name: 'Main', data: RESUME, active: true }) })).status).toBe(201);

      // on Nm7: one tap
      await page.goto(`/jobs/${onNm7.slug}`);
      await page.getByTestId('apply').click();
      await expect(page.getByTestId('applied')).toHaveText('Applied · Applied');
      await expect(page.getByRole('link', { name: 'See it in My applications' })).toBeVisible();
      await wide();

      // company link: the company's page opens; the application is saved
      await page.goto(`/jobs/${onLink.slug}`);
      await page.context().route('https://orbit.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Orbit careers</h1>' }));
      const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByTestId('apply').click()]);
      await expect.poll(() => tab.url()).toBe(`https://orbit.example/careers/${tag}`);
      await tab.close();
      await expect(page.getByTestId('applied')).toBeVisible();

      // email: the draft is filled in
      await page.goto(`/jobs/${byMail.slug}`);
      await page.getByTestId('apply').click();
      const box = page.getByTestId('email-apply');
      await expect(box).toContainText('Two steps to apply by email');
      const mailto = await box.getByTestId('mailto').getAttribute('href');
      expect(mailto.startsWith('mailto:hr%40orbit.example?subject=')).toBe(true);
      expect(decodeURIComponent(mailto)).toContain(`Application for Support Tester ${tag}`);
      expect(decodeURIComponent(mailto)).toContain('Sai Varsha');
      await wide();

      // My applications: all three, with how each was sent; the Nm7 one moves only with the company
      await page.goto('/me/jobs');
      const card = (title) => page.locator('article').filter({ hasText: title });
      await expect(card(`QA Trainee ${tag}`).getByTestId('app-channel')).toHaveText('Applied on Nm7');
      await expect(card(`Test Analyst ${tag}`).getByTestId('app-channel')).toHaveText('Applied (outside Nm7)');
      await expect(card(`Support Tester ${tag}`).getByTestId('app-channel')).toHaveText('Applied by email');
      await expect(card(`QA Trainee ${tag}`)).toContainText('Updated by the company');
      await expect(card(`QA Trainee ${tag}`).getByRole('button', { name: /Move .* forward/ })).toHaveCount(0);
      // the person moves an outside one
      await card(`Test Analyst ${tag}`).getByRole('button', { name: /Move .* forward/ }).click();
      await expect.poll(async () => (await call(page, '/api/me/state')).body.apps.find((a) => a.role === `Test Analyst ${tag}`).status).toBe('shortlisted');

      // the admin opens the applications (→ Viewed) and shortlists the Nm7 one
      const owner = `ja-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const admin = await ctx.newPage();
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/jobs');
      await admin.getByLabel('Search').fill(`QA Trainee ${tag}`);
      await admin.getByRole('button', { name: 'Search' }).click();
      await admin.getByTestId('admin-job').filter({ hasText: `QA Trainee ${tag}` }).getByRole('button', { name: 'Applications' }).click();
      const row = admin.getByTestId('admin-application');
      await expect(row).toContainText('Sai Varsha');
      await expect(row).toContainText('Applied on Nm7 · resume “Main”');
      await expect(row.getByRole('combobox')).toHaveValue('viewed');
      await row.getByRole('combobox').selectOption('shortlisted');
      await expect(admin.getByText('Updated: the applicant sees it in My applications')).toBeVisible();
      await ctx.close();

      // the person sees each step
      await page.reload();
      const steps = card(`QA Trainee ${tag}`).getByRole('list', { name: /Steps for/ });
      await expect(steps).toContainText('Applied');
      await expect(steps).toContainText('Viewed');
      await expect(steps).toContainText('Shortlisted');
      await wide();

      // Make my resume fit: the job match for this job
      await page.goto(`/jobs/${onNm7.slug}`);
      await page.getByTestId('make-fit').click();
      await expect(page).toHaveURL(/\/me\/ats\?match=/);
      await expect(page.getByTestId('jm-result')).toBeVisible({ timeout: 30_000 });

      // the follow-up email's stop page
      await page.goto('/stop-alerts#t=abcdefghijkl.bad&k=followups');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Follow-up reminder emails');
    });
  });
}
