// Eligibility filters per company on a desktop and a 390 px phone, against the real API: students fill in "My marks
// for placements" (self-declared), the coordinator sets rules (CGPA at least 7, no active backlogs), sees who isn't
// eligible and why ("CGPA 6.4 < 7.0"), adds an exception with a note, ticks marks verified, and shares the eligible
// list with a recruiter invite (only students who allowed recruiter sharing).
import { expect, test } from '@playwright/test';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('marks, rules, reasons, exception, verified tick, share with a recruiter', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 3, shareWithRecruiters: true, prefix: 'el' });
      const [a, b, d] = c.students;
      // student a fills in marks in My groups
      await a.page.goto('/me/groups');
      const marks = a.page.getByTestId('marks');
      await expect(marks).toContainText('Not verified yet');
      await marks.getByTestId('marks-cgpa').fill('8.2');
      await marks.getByTestId('marks-backlogs').fill('0');
      await marks.getByTestId('marks-year').fill('2026');
      await marks.getByTestId('marks-save').click();
      await expect(a.page.getByText('Marks saved')).toBeVisible();
      expect(await noSideScroll(a.page)).toBe(true);
      await call(b.page, `/api/me/academic/${b.mid}`, json('PUT', { cgpa: 6.4, backlogs: 0, year: 2026 }));
      await call(d.page, `/api/me/academic/${d.mid}`, json('PUT', { cgpa: 7.9, backlogs: 2, year: 2026 }));
      for (const s of [a, b]) await call(s.page, `/api/me/groups/${s.mid}`, json('PATCH', { recruiterOptIn: true }));

      // a drive day with Infosys; a recruiter invite
      const drive = (await call(c.coord, `/api/org/${c.org.id}/drives`, json('POST', { name: 'Campus drive', date: '2026-12-01', groupIds: [c.group.id], companies: ['Infosys'] }))).body;
      const inv = await call(c.coord, `/api/org/${c.org.id}/recruiter-invites`, json('POST', { company: 'Infosys HR', recruiterName: 'Ravi', email: 'ravi@infosys.example', groupIds: [c.group.id], expiresOn: '2026-12-31' }));
      expect(inv.status).toBe(201);

      await c.coord.goto(`/org/${c.org.id}/drives`);
      await c.coord.getByTestId('drive-item').first().click();
      await c.coord.getByTestId('drive-elig').filter({ hasText: 'Infosys' }).click();
      const el = c.coord.getByTestId('eligibility');
      await expect(el.getByTestId('el-count')).toHaveText('3 of 3 eligible');
      await el.getByTestId('el-cgpaMin').fill('7');
      await el.getByTestId('el-backlogsMax').fill('0');
      await el.getByTestId('el-save').click();
      await expect(el.getByTestId('el-count')).toHaveText('1 of 3 eligible');
      const rowB = el.getByTestId('el-row').filter({ hasText: b.name });
      await expect(rowB.getByTestId('el-reasons')).toHaveText('CGPA 6.4 < 7.0');
      await expect(el.getByTestId('el-row').filter({ hasText: d.name }).getByTestId('el-reasons')).toHaveText('Backlogs 2 > 0');
      // exception with a note
      c.coord.once('dialog', (dlg) => dlg.accept('Backlogs cleared, result awaited'));
      await el.getByTestId('el-row').filter({ hasText: d.name }).getByTestId('el-except').click();
      await expect(el.getByTestId('el-count')).toHaveText('2 of 3 eligible');
      await expect(el.getByTestId('el-row').filter({ hasText: d.name })).toContainText('Exception: Backlogs cleared, result awaited');
      // verified tick
      await el.getByTestId('el-row').filter({ hasText: a.name }).getByRole('button', { name: 'Mark verified' }).click();
      await expect(el.getByTestId('el-row').filter({ hasText: a.name })).toContainText('verified');
      // share: a (eligible, opted in) only — d is eligible by exception but didn't allow recruiter sharing
      await el.getByTestId('el-share').click();
      await expect(c.coord.getByText(/Shared 1 eligible student with Infosys HR \(1 didn’t allow recruiter sharing\)/)).toBeVisible();
      expect(await noSideScroll(c.coord)).toBe(true);
      // the student sees the tick
      await a.page.reload();
      await expect(a.page.getByTestId('marks')).toContainText('Verified by');
      const log = (await call(c.coord, `/api/org/${c.org.id}/audit`)).body.map((x) => x.action);
      for (const x of ['eligibility_rules', 'eligibility_exception', 'academic_verify', 'eligibility_share']) expect(log).toContain(x);
      expect(drive.id).toBeTruthy();
      await c.close();
    });
  });
}
