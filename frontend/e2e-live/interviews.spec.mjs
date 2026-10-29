// Interview scheduling (R3, Campus) on a desktop and a 390 px phone, against the real API: the recruiter schedules a
// round for a shortlisted student (IST time, place, interviewer); the student gets an email with interview.ics and
// sees it on My drive day, asks for another time with a reason; the recruiter sees the request, changes the time
// (a new email and calendar file); the student confirms; the coordinator sees the answer. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, emailsTo, lastCode, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
const resume = (name, mail) => ({
  personal: { name, email: mail, phone: '+91 90000 00003', headline: 'B.Tech 2026' },
  summary: 'Final-year student.', exp: [], proj: [{ title: 'Dashboard', description: 'Cut reporting time by 30%.', tech: 'Python', links: [] }],
  edu: [{ institution: 'XYZ College', degree: 'B.Tech', field: 'CSE', from: '2022-08', to: '2026-05', grade: '8.0 CGPA' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'Python, SQL' }],
  certs: [], ach: [], custom: [], langs: [], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {},
  showPhoto: false, design: { preset: 'campus' },
});
const ist = (days) => new Date(Date.now() + 5.5 * 3600e3 + days * 864e5).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('schedule, .ics email, ask for another time, new time, confirm, coordinator sees it', async ({ page, browser, playwright }) => {
      test.setTimeout(180_000);
      const owner = email(`iv-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Interview College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      const code = `IV${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = (await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { shareWithRecruiters: true } }) })).body;
      const student = email(`iv-s-${label}`);
      await apiMember(playwright, student, 'Anil Kumar', code, { roll: '26CS001', branch: 'CSE' }, resume('Anil Kumar', student), { recruiterOptIn: true });
      const recruiter = email(`iv-rec-${label}`);
      const inv = (await call(page, `/api/org/${org.id}/recruiter-invites`, { method: 'POST', body: JSON.stringify({ company: 'Acme Analytics', recruiterName: 'Ravi K', email: recruiter, groupIds: [g.id], expiresOn: ist(30), contact: 'hidden' }) })).body;

      // the recruiter shortlists, then schedules from the Interviews tab
      const rctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const r = await rctx.newPage();
      await r.goto(`/recruiter/${inv.url.split('/recruiter/')[1]}`);
      await r.getByRole('button', { name: 'Email me a code' }).click();
      await expect(r.getByLabel('Code from the email')).toBeVisible();
      await r.getByLabel('Code from the email').fill(lastCode(recruiter));
      await r.getByRole('button', { name: 'Sign in' }).click();
      await r.getByRole('article', { name: 'Anil Kumar' }).getByRole('button', { name: 'Shortlist' }).click();
      await expect(r.getByRole('article', { name: 'Anil Kumar' }).getByLabel('Stage for Anil Kumar')).toBeVisible();
      await r.getByRole('tab', { name: 'Interviews' }).click();
      await r.getByRole('button', { name: 'Schedule an interview' }).click();
      const f = r.getByRole('form', { name: 'Schedule an interview' });
      await f.getByLabel('Round name').fill('Technical round 1');
      await f.getByLabel('Date').fill(ist(3));
      await f.getByLabel('Time (IST)').fill('10:30');
      await f.getByLabel('Duration').selectOption('45');
      await f.getByLabel('Place').fill('Seminar hall, Block A');
      await f.getByLabel('Interviewer name').fill('Meera S');
      await f.getByLabel('Anil Kumar').check();
      await f.getByRole('button', { name: 'Send invites' }).click();
      const round = r.getByTestId('round');
      await expect(round).toContainText('Technical round 1');
      await expect(round).toContainText('10:30 AM IST');
      await expect(round.getByTestId('round-counts')).toContainText('1 waiting');
      expect(await r.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      const invite = emailsTo(student).at(-1);
      expect(invite).toContain('[attached: interview.ics');
      expect(invite).toContain('10:30 AM IST');

      // the student: My drive day, ask for another time
      const sctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const s = await sctx.newPage();
      await login(s, student);
      await expect(s).not.toHaveURL(/\/login/);
      await s.goto('/me/drive');
      const mine = s.getByTestId('my-interview');
      await expect(mine).toContainText('Acme Analytics · Technical round 1');
      await expect(mine).toContainText('Waiting for an answer');
      await mine.getByRole('button', { name: 'Ask for another time' }).click();
      await mine.getByLabel('Why do you need another time?').fill('I have an exam that morning');
      await mine.getByRole('button', { name: 'Send to the recruiter' }).click();
      await expect(mine).toContainText('Asked for another time');
      expect(await s.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // the recruiter sees it and changes the time
      await r.reload();
      await r.getByRole('tab', { name: 'Interviews' }).click();
      await expect(r.getByTestId('round-student')).toContainText('I have an exam that morning');
      await r.getByRole('button', { name: 'Change time' }).click();
      const e = r.getByRole('form', { name: 'Change the interview time' });
      await e.getByLabel('Time (IST)').fill('14:00');
      await e.getByRole('button', { name: 'Send the new time' }).click();
      await expect(r.getByTestId('round')).toContainText('2:00 PM IST');
      await expect(r.getByTestId('round-counts')).toContainText('1 waiting');
      expect(emailsTo(student).at(-1)).toContain('New time');

      // the student confirms the new time
      await s.reload();
      await expect(mine).toContainText('2:00 PM IST');
      await mine.getByRole('button', { name: 'Confirm' }).click();
      await expect(mine).toContainText('Confirmed');

      // the coordinator's view
      const col = await call(page, `/api/org/${org.id}/interviews`);
      expect(col.body.rounds[0].counts.confirmed).toBe(1);
      await rctx.close(); await sctx.close();
    });
  });
}
