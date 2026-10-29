// Faculty reviewers on a desktop and a 390 px phone, against the real API: the coordinator invites a reviewer and
// assigns one student; the reviewer sees only that student, comments on a line of the Projects section and marks
// "needs changes"; the student sees the comment in the builder next to Projects and marks it resolved; the reviewer
// can't open the organization's other pages.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, college, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('invite, assign, comment on a section, needs changes, student resolves in the builder', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 2, prefix: 'rv' });
      const [s0, s1] = c.students;
      // invite a reviewer from Org > Reviewers
      const pmail = email(`prof-${label}`);
      await c.coord.goto(`/org/${c.org.id}/reviewers`);
      await c.coord.getByTestId('rv-email').fill(pmail);
      await c.coord.getByTestId('rv-invite').click();
      const link = await c.coord.getByTestId('rv-link').textContent();
      const rctx = await browser.newContext(opts);
      const prof = await rctx.newPage();
      seed('customer', pmail, 'Prof Rao', PASSWORD);
      await login(prof, pmail);
      await prof.waitForURL('**/me');
      expect((await call(prof, `/api/org-invites/${link.split('/').pop()}/accept`, { method: 'POST' })).status).toBe(200);
      // assign s0
      await c.coord.reload();
      await c.coord.getByTestId('rv-row').first().getByTestId('rv-assign').click();
      await c.coord.getByRole('dialog').getByText(s0.name).click();
      await c.coord.getByTestId('rv-save').click();
      await expect(c.coord.getByTestId('rv-row').first()).toContainText('1 student');

      // the reviewer: /org leads to their review screen with only s0
      await prof.goto('/org');
      await prof.waitForURL(`**/review/${c.org.id}`);
      await expect(prof.getByTestId('rv-item')).toHaveCount(1);
      await expect(prof.getByTestId('rv-item')).toContainText(s0.name);
      expect((await call(prof, `/api/review/${c.org.id}/students/${s1.mid}`)).status).toBe(404);
      for (const p of ['', '/shared-resumes', '/placement']) expect((await call(prof, `/api/org/${c.org.id}${p}`)).status).toBe(404);
      await prof.getByTestId('rv-item').click();
      await prof.getByTestId('rv-section').selectOption('proj');
      await prof.getByTestId('rv-line').fill('Built a dashboard');
      await prof.getByTestId('rv-text').fill('Say what it changed, with a number.');
      await prof.getByTestId('rv-comment').click();
      await expect(prof.getByTestId('rv-comment-item')).toContainText('Projects');
      await prof.getByTestId('rv-needs').click();
      await expect(prof.getByTestId('rv-status')).toHaveText('Needs changes');
      expect(await noSideScroll(prof)).toBe(true);

      // the student sees it next to Projects and resolves it
      await s0.page.goto('/builder?start=section&sec=proj');
      const notes = s0.page.getByTestId('review-notes');
      await expect(notes).toContainText('Say what it changed, with a number.');
      await expect(notes).toContainText('“Built a dashboard”');
      await notes.getByTestId('review-resolve').click();
      await expect(notes).toHaveCount(0);
      const mine = (await call(s0.page, '/api/me/review-comments')).body;
      expect(mine[0].resolved).toBe(true);
      expect((await call(s1.page, '/api/me/review-comments')).body).toEqual([]);
      // the placement office sees the same review status
      const groups = (await call(s0.page, '/api/me/groups')).body;
      expect(groups[0].reviewStatus).toBe('needs_changes');
      await rctx.close();
      await c.close();
    });
  });
}
