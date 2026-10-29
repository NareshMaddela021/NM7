// Alumni network (Campus) on a desktop and a 390 px phone, against the real API: a past-batch student joins the
// alumni network, a current student asks for a referral, the alumnus replies inside Nm7 (no email address or phone
// anywhere on the page), and the coordinator sees counts only.
import { expect, test } from '@playwright/test';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('join as alumni, ask for a referral, reply inside Nm7, counts for the college', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 2, prefix: 'al' });
      const [alum, cur] = c.students;
      expect((await call(alum.page, `/api/me/academic/${alum.mid}`, json('PUT', { year: 2022 }))).status).toBe(200);

      // the past-batch student joins
      await alum.page.goto('/me/groups');
      await alum.page.getByTestId('alumni-link').click();
      const prof = alum.page.getByTestId('alumni-profile');
      await prof.getByTestId('al-company').fill('Infosys');
      await prof.getByTestId('al-role').fill('Systems Engineer');
      await prof.getByTestId('al-save').click();
      await expect(alum.page.getByText('Saved')).toBeVisible();
      expect(await noSideScroll(alum.page)).toBe(true);

      // a current student asks for a referral
      await cur.page.goto('/me/alumni');
      const person = cur.page.getByTestId('al-person').filter({ hasText: 'Infosys' });
      await expect(person).toContainText('Systems Engineer');
      expect(await cur.page.locator('main').innerText()).not.toMatch(/@|\+91/);
      await person.getByTestId('al-ask-referral').click();
      await person.getByTestId('al-note').fill('Could you refer me for the Infosys graduate role? I have two SQL projects.');
      await person.getByTestId('al-send').click();
      await expect(cur.page.getByText('Request sent')).toBeVisible();
      expect(await noSideScroll(cur.page)).toBe(true);

      // the alumnus replies inside Nm7
      await alum.page.reload();
      const thread = alum.page.getByTestId('al-thread').first();
      await expect(thread).toContainText('Could you refer me');
      await thread.getByTestId('al-reply-input').fill('Sure — apply on the careers page and send me the job id here.');
      await thread.getByTestId('al-reply-send').click();
      await cur.page.reload();
      await expect(cur.page.getByTestId('al-reply').first()).toContainText('apply on the careers page');

      // the coordinator: counts, not messages
      await c.coord.goto(`/org/${c.org.id}/alumni`);
      const counts = c.coord.getByTestId('alumni-counts');
      await expect(counts).toContainText('Alumni');
      expect(await c.coord.locator('main').innerText()).not.toContain('careers page');
      const s = (await call(c.coord, `/api/org/${c.org.id}/alumni/summary`)).body;
      expect([s.alumni, s.requests30d, s.replied30d]).toEqual([1, 1, 1]);
      await c.close();
    });
  });
}
