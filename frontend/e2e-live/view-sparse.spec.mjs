// View and quick view open for every resume, on a desktop and a 390 px phone: a demo college student and an old
// resume saved without the newer fields (achievements, custom sections, hobbies, personal info…), in the admin's
// Shared resumes, the coordinator's portal and the recruiter portal (job match → quick view). The demo once crashed
// the admin's View ("Cannot read properties of undefined (reading 'filter')") and the recruiter's whole page.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, lastCode, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
// what an older builder saved: only some lists
const OLD = (name, mail) => ({
  personal: { name, email: mail, phone: '+91 90000 00004' },
  edu: [{ institution: 'Old College', degree: 'B.Tech', grade: '7.9 CGPA', to: '2026-05' }],
  skillGroups: [{ label: 'Skills', value: 'Python, SQL, Git, REST API' }],
  exp: [{ company: 'Old Co', role: 'Intern', description: 'Built 2 APIs' }],
});
const JD = 'Junior Python Developer... Required: Python, SQL, Git, REST API. Preferred: Django, Machine learning, AWS';
const fine = async (where, name) => {
  await expect(where.getByText(name).first()).toBeVisible();
  await expect(where.getByText(/couldn’t be shown/)).toHaveCount(0);
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('View opens for a demo student and an old resume: admin, coordinator and recruiter quick view', async ({ page, browser, playwright }) => {
      test.setTimeout(180_000);
      const errors = [];
      const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
      watch(page);
      const owner = email(`vs-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const made = await call(page, '/api/admin/demo-org', { method: 'POST' });
      expect(made.status).toBe(200);
      const demoId = made.body.orgId;

      // a college whose student has an old resume (shares with recruiters, Campus for job match)
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Old College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      const code = `VS${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = (await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { printBranded: true, shareWithRecruiters: true } }) })).body;
      expect((await call(page, `/api/org/${org.id}/branding`, { method: 'PUT', body: JSON.stringify({ collegeName: 'Old College of Engineering', template: 'campus', templates: ['campus'] }) })).status).toBe(200);
      const oldMail = email(`vs-old-${label}`);
      const old = await apiMember(playwright, oldMail, 'Old Resume Student', code, { roll: '26CS009', branch: 'CSE' }, OLD('Old Resume Student', oldMail), { recruiterOptIn: true });

      // admin: Shared resumes → View, the demo student and the old resume
      for (const [orgId, name] of [[demoId, 'Lakshmi Rao'], [org.id, 'Old Resume Student']]) {
        await page.goto(`/admin/shared-resumes?org=${orgId}`);
        await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'View' }).click();
        const dlg = page.getByRole('dialog');
        await fine(dlg, name);
        await dlg.getByRole('button', { name: 'Close' }).click();
      }

      // a coordinator of each college: Resumes → View
      for (const [orgId, name] of [[demoId, 'Lakshmi Rao'], [org.id, 'Old Resume Student']]) {
        const coordMail = email(`vs-coord-${label}`);
        const inv = (await call(page, `/api/admin/orgs/${orgId}/staff`, { method: 'POST', body: JSON.stringify({ email: coordMail, role: 'coordinator' }) })).body;
        seed('customer', coordMail, 'Placement Officer', PASSWORD);
        const ctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
        const c = await ctx.newPage();
        watch(c);
        await login(c, coordMail);
        await c.waitForURL(/\/(me|org)/);
        expect((await call(c, `/api/org-invites/${inv.inviteUrl.split('/').pop()}/accept`, { method: 'POST', body: '{}' })).status).toBe(200);
        await c.goto(`/org/${orgId}/resumes`);
        await c.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'View' }).click();
        await fine(c.getByRole('dialog'), name);
        await ctx.close();
      }

      // the demo recruiter: Job match → Quick view on Arjun Menon (the page stays up)
      await page.goto(made.body.recruiterPath);
      await page.getByRole('tab', { name: 'Job match' }).click();
      await page.getByLabel('Paste the job description').fill(JD);
      await page.getByRole('button', { name: 'Score every student' }).click();
      await expect(page.getByTestId('match-summary')).toContainText('Must-have: Python, SQL, Git, REST API');
      const arjun = page.getByTestId('student-card').filter({ hasText: 'Arjun Menon' });
      await arjun.getByRole('button', { name: 'Quick view' }).click();
      await fine(page.getByRole('dialog'), 'Arjun Menon');
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      await expect(page.getByRole('heading', { name: /Students for/ })).toBeVisible();
      // the scores aren't all the same
      const scores = await page.getByTestId('match-score').allTextContents();
      expect(new Set(scores).size).toBeGreaterThan(3);

      // a recruiter of the old college: quick view of the old resume, in the college format
      const recruiter = email(`vs-rec-${label}`);
      const inv = (await call(page, `/api/org/${org.id}/recruiter-invites`, { method: 'POST', body: JSON.stringify({ company: 'Acme', recruiterName: 'Ravi', email: recruiter, groupIds: [g.id], expiresOn: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) }) })).body;
      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const r = await rctx.newPage();
      watch(r);
      await r.goto(`/recruiter/${inv.url.split('/recruiter/')[1]}`);
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible(); // the code is sent
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      await r.getByTestId('student-card').filter({ hasText: 'Old Resume Student' }).getByRole('button', { name: 'Quick view' }).click();
      const dlg = r.getByRole('dialog');
      await fine(dlg, 'Old Resume Student');
      await expect(dlg.getByTestId('brand-college')).toHaveText('Old College of Engineering');
      await rctx.close();
      await old.api.dispose();
      expect(errors).toEqual([]);
    });
  });
}
