// Transfer ownership on a desktop and a 390 px phone, against the real API: the Owner (Org > Team) hands the
// organization to its coordinator and chooses to leave; the coordinator sees "asked to become the Owner" on
// My organizations, enters the emailed code and lands in the portal as Owner; the old Owner has no access any more.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, lastCode, login, seed } from './helpers.mjs';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Owner transfers to the coordinator, who confirms with the code; the old Owner leaves', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 0, prefix: 'tr' });
      // the Owner (invited by Nm7)
      const omail = email(`own-${label}`);
      const inv = await call(c.admin, `/api/admin/orgs/${c.org.id}/staff`, json('POST', { email: omail, role: 'owner' }));
      expect(inv.status).toBe(201);
      const octx = await browser.newContext(opts);
      const own = await octx.newPage();
      seed('customer', omail, 'Old Owner', PASSWORD);
      await login(own, omail);
      await own.waitForURL('**/me');
      expect((await call(own, `/api/org-invites/${inv.body.inviteUrl.split('/').pop()}/accept`, { method: 'POST' })).status).toBe(200);
      const cmail = (await call(c.coord, '/api/auth/me')).body.email;

      await own.goto(`/org/${c.org.id}/team`);
      const box = own.getByTestId('transfer');
      await box.getByTestId('transfer-email').fill(cmail);
      await box.getByTestId('transfer-leave').check();
      own.once('dialog', (d) => d.accept());
      await box.getByTestId('transfer-start').click();
      await expect(box.getByTestId('transfer-pending')).toContainText(cmail);
      expect(await noSideScroll(own)).toBe(true);

      // the coordinator confirms
      await c.coord.goto('/org');
      await c.coord.getByTestId('transfer-waiting').click();
      await c.coord.waitForURL('**/org/transfer');
      await c.coord.getByTestId('accept-code').fill(lastCode(cmail));
      expect(await noSideScroll(c.coord)).toBe(true);
      await c.coord.getByTestId('accept-go').click();
      await c.coord.waitForURL(`**/org/${c.org.id}`);
      expect((await call(c.coord, `/api/org/${c.org.id}`)).body.isOwner).toBe(true);
      // the old Owner is out; the Activity log has both steps
      expect((await call(own, `/api/org/${c.org.id}`)).status).toBe(404);
      const log = (await call(c.coord, `/api/org/${c.org.id}/audit`)).body.map((e) => e.action);
      expect(log).toEqual(expect.arrayContaining(['owner_transfer_start', 'owner_transfer_done']));
      await octx.close();
      await c.close();
    });
  });
}
