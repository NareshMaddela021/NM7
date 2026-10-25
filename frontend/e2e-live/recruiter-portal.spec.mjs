// Recruiter portal (colleges, Phase 3) on a desktop and a 390 px phone, against the real API (Campus):
//   the coordinator invites a recruiter (company, name, email, group, expiry, contact after shortlist) in the admin
//   console; the recruiter opens the emailed link, signs in with the emailed one-time code, sees only the students
//   who allowed recruiter sharing, searches by a skill synonym, scores everyone against a pasted job post (best
//   first), quick-views a resume in the college format, shortlists and moves a student on the board (contact details
//   appear after shortlisting), downloads the board as a ZIP (college cover first) and CSV; the student sees
//   "Shortlisted by <company>" once the college allows it; a student who withdraws consent disappears at once;
//   every view is in the invite's activity. No sideways scrolling on the phone.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, lastCode, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
const resume = (name, mail, skills, grade) => ({
  personal: { name, email: mail, phone: '+91 90000 00003', headline: 'B.Tech 2026' },
  summary: 'Final-year student.', exp: [{ company: 'Data Co', role: 'Intern', description: 'Built 3 reports used by 40 people' }],
  proj: [{ title: 'Sales dashboard', description: 'Cut reporting time by 30%', tech: skills, links: [] }],
  edu: [{ institution: 'XYZ College', degree: 'B.Tech', field: 'CSE', from: '2022-08', to: '2026-05', grade }],
  skillGroups: [{ id: 'core', label: 'Skills', value: skills }],
  certs: [], ach: [], custom: [], langs: [{ name: 'Telugu' }], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {},
  showPhoto: false, design: { preset: 'campus' },
});
const JD = 'Data Analyst (fresher). Must have: Python, SQL and Power BI. Good to have: Tableau. Location: Hyderabad.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('invite, email code, search, job match, quick view, board, ZIP / CSV, Shortlisted by, consent withdrawal', async ({ page, browser, playwright }) => {
      test.setTimeout(180_000);
      const owner = email(`rp-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `XYZ College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      const code = `RP${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { printBranded: true, shareWithRecruiters: true } }) });
      expect(g.status).toBe(201);
      expect((await call(page, `/api/org/${org.id}/branding`, { method: 'PUT', body: JSON.stringify({ collegeName: 'XYZ College of Engineering', header: 'Training & Placement Cell', template: 'campus', templates: ['campus'] }) })).status).toBe(200);

      // three students: two allow recruiter sharing, one doesn't
      const mA = email(`rp-a-${label}`); const mB = email(`rp-b-${label}`); const mC = email(`rp-c-${label}`);
      const a = await apiMember(playwright, mA, 'Anil Kumar', code, { roll: '26CS001', branch: 'CSE' }, resume('Anil Kumar', mA, 'Python, PostgreSQL, Power BI, Tableau', '8.6 CGPA'), { recruiterOptIn: true });
      const b = await apiMember(playwright, mB, 'Bhavya Reddy', code, { roll: '26CS002', branch: 'CSE' }, resume('Bhavya Reddy', mB, 'Java, Spring', '7.4 CGPA'), { recruiterOptIn: true });
      const c = await apiMember(playwright, mC, 'Chandu Rao', code, { roll: '26CS003', branch: 'CSE' }, resume('Chandu Rao', mC, 'Python, SQL', '9.1 CGPA'), { recruiterOptIn: false });

      // the coordinator side (admin console): a recruiter invite
      await page.goto(`/admin/orgs?org=${org.id}`);
      const inv = page.getByRole('region', { name: 'Recruiter invites' });
      await inv.getByRole('button', { name: 'New recruiter invite' }).click();
      const recruiter = email(`rp-rec-${label}`);
      const form = inv.getByRole('form', { name: 'New recruiter invite' });
      await form.getByLabel('Company').fill('Acme Analytics');
      await form.getByLabel('Recruiter name').fill('Ravi K');
      await form.getByLabel('Recruiter email').fill(recruiter);
      await form.getByLabel('B.Tech 2026').check();
      await form.getByLabel('Contact details').selectOption('after_shortlist');
      await form.getByRole('button', { name: 'Send invite' }).click();
      const made = inv.getByTestId('invite-made');
      await expect(made).toContainText(`Invite sent to ${recruiter}`);
      const url = await made.getByLabel('Invite link').inputValue();
      const token = url.split('/recruiter/')[1];
      await expect(inv.getByTestId('recruiter-invite')).toContainText('Acme Analytics');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // the recruiter: the link, then the emailed code
      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182', acceptDownloads: true });
      const r = await rctx.newPage();
      await r.goto(`/recruiter/${token}`);
      await expect(r.getByRole('heading', { name: 'Students for Acme Analytics' })).toBeVisible();
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible();
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      const cards = r.getByTestId('student-card');
      await expect(cards).toHaveCount(2);
      await expect(r.getByText('Chandu Rao')).toHaveCount(0); // didn't allow recruiter sharing
      await expect(cards.first().getByTestId('contact')).toHaveCount(0); // contact only after shortlisting
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // search: a synonym of a skill
      await r.getByLabel('Skills').fill('postgres');
      await r.getByRole('button', { name: 'Search' }).click();
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText('Anil Kumar');
      await r.getByLabel('Skills').fill('');
      await r.getByRole('button', { name: 'Search' }).click();
      await expect(cards).toHaveCount(2);

      // job match: best first
      await r.getByRole('tab', { name: 'Job match' }).click();
      await r.getByLabel('Paste the job description').fill(JD);
      await r.getByRole('button', { name: 'Score every student' }).click();
      await expect(r.getByTestId('match-summary')).toContainText('2 students');
      await expect(cards.first()).toContainText('Anil Kumar');
      const s1 = Number((await cards.nth(0).getByTestId('match-score').textContent()).replace('%', ''));
      const s2 = Number((await cards.nth(1).getByTestId('match-score').textContent()).replace('%', ''));
      expect(s1).toBeGreaterThan(s2);

      // quick view in the college format; shortlist from the card
      await cards.first().getByRole('button', { name: 'Quick view' }).click();
      const dlg = r.getByRole('dialog');
      await expect(dlg.getByTestId('brand-college')).toHaveText('XYZ College of Engineering');
      await dlg.getByRole('button', { name: 'Close' }).click();
      await cards.first().getByRole('button', { name: 'Shortlist' }).click();
      await expect(cards.first().getByTestId('contact')).toContainText(mA); // shown once shortlisted

      // the board: move to Interview with a note
      await r.getByRole('tab', { name: 'Shortlist board' }).click();
      await expect(r.getByTestId('col-shortlisted').getByTestId('board-item')).toHaveCount(1);
      await r.getByLabel('Stage for Anil Kumar').selectOption('interview');
      await expect(r.getByTestId('col-interview').getByTestId('board-item')).toHaveCount(1);
      await r.getByLabel('Note for Anil Kumar').fill('Strong SQL, call Monday');
      await r.getByLabel('Note for Anil Kumar').blur();
      await expect.poll(async () => (await call(page, `/api/org/${org.id}/recruiter-invites`)).body.invites[0].shortlisted).toBe(1);

      // downloads: ZIP (college cover first) and CSV
      const [zip] = await Promise.all([r.waitForEvent('download', { timeout: 60_000 }), r.getByRole('button', { name: 'Download ZIP' }).click()]);
      expect(zip.suggestedFilename()).toBe('Acme_Analytics_shortlist.zip');
      const names = Object.keys(unzipSync(new Uint8Array(readFileSync(await zip.path()))));
      expect(names[0]).toBe('00_Cover.pdf');
      expect(names).toHaveLength(2);
      const [csv] = await Promise.all([r.waitForEvent('download'), r.getByRole('button', { name: 'CSV' }).click()]);
      const text = readFileSync(await csv.path(), 'utf8');
      expect(text).toContain('Anil Kumar');
      expect(text).toContain('interview');
      expect(text).toContain('Strong SQL, call Monday');
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // the student sees "Shortlisted by" once the college allows it
      await page.reload();
      const show = inv.getByLabel(/Show students “Shortlisted by/);
      await show.click(); // saved first, then ticked
      await expect(page.getByText('Students will see who shortlisted them')).toBeVisible();
      await expect(show).toBeChecked();
      const sctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const s = await sctx.newPage();
      await login(s, mA);
      await s.waitForURL('**/me');
      await s.goto('/me/groups');
      await expect(s.getByTestId('shortlisted-by')).toContainText('Shortlisted by Acme Analytics');
      await sctx.close();

      // withdrawing consent removes a student at once
      await b.api.patch(`/api/me/groups/${b.membership.id}`, { data: { recruiterOptIn: false } });
      await r.getByRole('tab', { name: /^Students/ }).click();
      await r.getByRole('button', { name: 'Search' }).click();
      await expect(cards).toHaveCount(1);
      await expect(r.getByText('Bhavya Reddy')).toHaveCount(0);

      // the coordinator sees every view in the invite's activity
      await inv.getByRole('button', { name: 'Activity' }).first().click();
      await expect(page.getByTestId('invite-activity')).toContainText('Viewed a resume');
      await expect(page.getByTestId('invite-activity')).toContainText('Signed in with the email code');
      await rctx.close();
      for (const m of [a, b, c]) await m.api.dispose();
    });
  });
}
