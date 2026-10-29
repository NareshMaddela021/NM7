// Recruiter accounts (R1) on a desktop and a 390 px phone, against the real API: a college invites a recruiter; the
// recruiter signs in at /recruiter with only their email and an emailed code, sees My drives with the college and
// opens its students; the college revokes the invite and the students are gone at once while the drive stays in
// My drives with its counts and notes. No sideways scrolling on the phone.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, lastCode, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
const resume = (name, mail) => ({
  personal: { name, email: mail, phone: '+91 90000 00003', headline: 'B.Tech 2026' },
  summary: 'Final-year student.', exp: [], proj: [{ title: 'Sales dashboard', description: 'Cut reporting time by 30%', tech: 'Python, SQL', links: [] }],
  edu: [{ institution: 'XYZ College', degree: 'B.Tech', field: 'CSE', from: '2022-08', to: '2026-05', grade: '8.2 CGPA' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'Python, SQL' }],
  certs: [], ach: [], custom: [], langs: [], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {},
  showPhoto: false, design: { preset: 'campus' },
});
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('sign in with email + code, My drives, open students, revoke hides them at once', async ({ page, browser, playwright }) => {
      test.setTimeout(120_000);
      const owner = email(`ra-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Accounts College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'drive' }) })).status).toBe(200);
      const code = `RA${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = (await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { shareWithRecruiters: true } }) })).body;
      const mA = email(`ra-a-${label}`);
      await apiMember(playwright, mA, 'Anil Kumar', code, { roll: '26CS001', branch: 'CSE' }, resume('Anil Kumar', mA), { recruiterOptIn: true });
      const recruiter = email(`ra-rec-${label}`);
      const inv = (await call(page, `/api/org/${org.id}/recruiter-invites`, { method: 'POST', body: JSON.stringify({ company: 'Acme Analytics', recruiterName: 'Ravi K', email: recruiter, groupIds: [g.id], expiresOn: inDays(30), contact: 'hidden' }) })).body;

      // the recruiter signs in with only their email
      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const r = await rctx.newPage();
      await r.goto('/recruiter');
      await expect(r.getByRole('heading', { name: 'Recruiter sign-in' })).toBeVisible();
      await r.getByLabel('Work email').fill(recruiter);
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible();
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      await expect(r.getByRole('heading', { name: 'My drives' })).toBeVisible();
      const drive = r.getByTestId('my-drive');
      await expect(drive).toContainText(`Accounts College ${label}`);
      await expect(drive).toContainText('Active');
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // open the students (the account signs the invite in: no second code)
      await drive.getByRole('link', { name: 'Open students' }).click();
      await expect(r).toHaveURL(new RegExp(`/recruiter/i\\.${inv.id}$`));
      await expect(r.getByText('Anil Kumar').first()).toBeVisible();
      await expect(r.getByRole('link', { name: 'My drives' })).toBeVisible();

      // the college revokes: the students are gone straight away
      expect((await call(page, `/api/org/${org.id}/recruiter-invites/${inv.id}/revoke`, { method: 'POST', body: '{}' })).status).toBe(200);
      await r.reload();
      await expect(r.getByRole('heading', { name: 'This invite has expired' })).toBeVisible();
      await expect(r.getByText('Anil Kumar')).toHaveCount(0);
      await r.getByRole('link', { name: 'My drives' }).click();
      await expect(r.getByTestId('my-drive')).toContainText('Ended by the college');
      await expect(r.getByTestId('my-drive').getByRole('link', { name: 'Open students' })).toHaveCount(0);
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // sign out: back to the sign-in page
      await r.getByRole('button', { name: 'Sign out' }).click();
      await expect(r.getByRole('heading', { name: 'Recruiter sign-in' })).toBeVisible();
      await rctx.close();
    });
  });
}
