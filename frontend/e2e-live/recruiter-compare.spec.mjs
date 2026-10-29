// Compare candidates (R2, Campus) on a desktop and a 390 px phone, against the real API: the recruiter ticks two
// students, compares them after a job match (score, must-haves found / missing, CGPA, projects), contact details stay
// hidden until a student is shortlisted, and on the phone the comparison is stacked cards with no sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, lastCode, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
const resume = (name, mail, skills, grade) => ({
  personal: { name, email: mail, phone: '+91 90000 00003', headline: 'B.Tech 2026' },
  summary: 'Final-year student.', exp: [{ company: 'Data Co', role: 'Analyst intern', description: 'Built reports', from: '2025-05', to: '2025-07' }],
  proj: [{ title: `${name.split(' ')[0]} dashboard`, description: 'Cut reporting time by 30%.', tech: skills, links: [] }],
  edu: [{ institution: 'XYZ College', degree: 'B.Tech', field: 'CSE', from: '2022-08', to: '2026-05', grade }],
  skillGroups: [{ id: 'core', label: 'Skills', value: skills }],
  certs: [], ach: [], custom: [], langs: [], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {},
  showPhoto: false, design: { preset: 'campus' },
});
const JD = 'Data Analyst (fresher). Must have: Python, SQL and Power BI. Good to have: Tableau. Location: Hyderabad.';
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('tick two, compare with match score and must-haves; contact after shortlist; stacked on a phone', async ({ page, browser, playwright }) => {
      test.setTimeout(150_000);
      const owner = email(`rc-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Compare College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      const code = `RC${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = (await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { shareWithRecruiters: true } }) })).body;
      const mA = email(`rc-a-${label}`); const mB = email(`rc-b-${label}`);
      await apiMember(playwright, mA, 'Anil Kumar', code, { roll: '26CS001', branch: 'CSE' }, resume('Anil Kumar', mA, 'Python, SQL, Power BI', '8.6 CGPA'), { recruiterOptIn: true });
      await apiMember(playwright, mB, 'Bhavya Reddy', code, { roll: '26CS002', branch: 'CSE' }, resume('Bhavya Reddy', mB, 'Java, Spring', '7.4 CGPA'), { recruiterOptIn: true });
      const recruiter = email(`rc-rec-${label}`);
      const inv = (await call(page, `/api/org/${org.id}/recruiter-invites`, { method: 'POST', body: JSON.stringify({ company: 'Acme Analytics', recruiterName: 'Ravi K', email: recruiter, groupIds: [g.id], expiresOn: inDays(30), contact: 'after_shortlist' }) })).body;
      const token = inv.url.split('/recruiter/')[1];

      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const r = await rctx.newPage();
      await r.goto(`/recruiter/${token}`);
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible();
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      await expect(r.getByTestId('student-card')).toHaveCount(2);

      // job match first, then tick both and compare
      await r.getByRole('tab', { name: 'Job match' }).click();
      await r.getByLabel('Paste the job description').fill(JD);
      await r.getByRole('button', { name: 'Score every student' }).click();
      await expect(r.getByTestId('match-summary')).toContainText('2 students');
      await r.getByLabel('Compare Anil Kumar').check();
      await expect(r.getByRole('button', { name: 'Compare 1' })).toBeDisabled();
      await r.getByLabel('Compare Bhavya Reddy').check();
      await r.getByRole('button', { name: 'Compare 2' }).click();
      const dlg = r.getByRole('dialog', { name: 'Compare 2 students' });
      const cardsC = dlg.getByTestId('compare-card');
      await expect(cardsC).toHaveCount(2);
      await expect(cardsC.nth(0)).toContainText('Anil Kumar');
      await expect(cardsC.nth(0)).toContainText('8.6');
      await expect(cardsC.nth(0)).toContainText('Must-haves found');
      await expect(cardsC.nth(1)).toContainText('Must-haves missing');
      await expect(cardsC.nth(0)).toContainText('Anil dashboard');
      await expect(cardsC.nth(0)).toContainText('Through the college'); // not shortlisted yet
      if (label === 'phone') {
        const a = await cardsC.nth(0).boundingBox(); const b = await cardsC.nth(1).boundingBox();
        expect(b.y).toBeGreaterThan(a.y + a.height - 1); // stacked
      }
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      await r.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);

      // shortlist Anil: his contact shows in the next comparison, Bhavya's doesn't
      await r.getByRole('article', { name: 'Anil Kumar' }).getByRole('button', { name: 'Shortlist' }).click();
      await expect(r.getByRole('article', { name: 'Anil Kumar' }).getByTestId('contact')).toBeVisible();
      await r.getByRole('button', { name: 'Compare 2' }).click();
      await expect(cardsC.nth(0)).toContainText(mA);
      await expect(cardsC.nth(1)).toContainText('Through the college');
      await rctx.close();
    });
  });
}
