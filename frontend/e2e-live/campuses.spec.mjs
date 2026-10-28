// Multiple campuses on a desktop and a 390 px phone, against the real API: Nm7's admin makes a college group of two
// campuses with an owner; the owner sees numbers by campus (no student names), applies one college format and copies
// a drive day to the other campus; that campus's coordinator sees the copy, while campus coordinators still can't
// see each other.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('college group: roll-up by campus, shared format and drive day, campuses stay isolated', async ({ browser }) => {
      test.setTimeout(180_000);
      const A = await college(browser, opts, label, { students: 2, prefix: 'ca' });
      const B = await college(browser, opts, label, { students: 1, prefix: 'cb' });
      const omail = email(`chair-${label}`);
      const octx = await browser.newContext(opts);
      const chair = await octx.newPage();
      seed('customer', omail, 'Group Chair', PASSWORD);
      await login(chair, omail);
      await chair.waitForURL('**/me');
      // Admin → College groups
      await A.admin.goto('/admin/college-groups');
      await A.admin.getByTestId('cg-name').fill(`Vignan ${label}`);
      await A.admin.getByTestId('cg-create').click();
      const form = A.admin.getByTestId('cg-edit');
      await form.getByText(`College ${A.tag}`).click();
      await form.getByText(`College ${B.tag}`).click();
      await form.getByTestId('cg-owners').fill(omail);
      await form.getByTestId('cg-save').click();
      await expect(A.admin.getByTestId('cg-item').filter({ hasText: `Vignan ${label}` })).toContainText(omail);
      // a drive day on campus A
      const d = await call(A.coord, `/api/org/${A.org.id}/drives`, json('POST', { name: 'Infosys day', date: '2026-12-02', groupIds: [A.group.id], companies: ['Infosys'] }));
      await call(A.coord, `/api/org/${A.org.id}/drives/${d.body.id}/slots`, json('POST', { companyId: d.body.companies[0].id, round: 'test', room: 'Lab 1', start: '09:30', end: '10:30' }));

      // the owner
      await chair.goto('/me/groups');
      await chair.getByTestId('cg-link').click();
      const table = chair.getByTestId('cg-campuses');
      await expect(table).toContainText(`College ${A.tag}`);
      await expect(table).toContainText(`College ${B.tag}`);
      expect(await chair.locator('main').innerText()).not.toContain('Student ');
      await chair.getByTestId('cg-format-from').selectOption({ label: `College ${A.tag}` });
      await chair.getByTestId('cg-format').click();
      await expect(chair.getByText(/College format applied to 1 campus/)).toBeVisible();
      await chair.getByTestId('cg-share-from').selectOption({ label: `College ${A.tag}` });
      await chair.getByTestId('cg-share-item').selectOption({ label: 'Infosys day · 2026-12-02' });
      await chair.getByTestId('cg-share-to').check();
      await chair.getByTestId('cg-share').click();
      await expect(chair.getByText('Copied to 1 campus')).toBeVisible();
      expect(await noSideScroll(chair)).toBe(true);

      // campus B's coordinator sees the copy (no students placed); can't see campus A
      const list = (await call(B.coord, `/api/org/${B.org.id}/drives`)).body;
      expect(list.map((x) => x.name)).toContain('Infosys day');
      expect(list.find((x) => x.name === 'Infosys day').slots[0].students).toBe(0);
      expect((await call(B.coord, `/api/org/${A.org.id}/drives`)).status).toBe(404);
      expect((await call(A.coord, `/api/org/${B.org.id}/offers`)).status).toBe(404);
      await octx.close();
      await Promise.all([A.close(), B.close()]);
    });
  });
}
