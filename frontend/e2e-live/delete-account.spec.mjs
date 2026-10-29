// Delete my account on a desktop and a 390 px phone, against the real API: Profile & settings explains what is
// removed, emails a code, then the account is set to be deleted in 7 days (the public link stops at once); Undo
// keeps it; Admin > Customers > Deletion requests lists it.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, lastCode, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('explain, email code, 7 days to undo, public link off, admin sees it', async ({ page, browser }) => {
      test.setTimeout(120_000);
      const mail = email(`del-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
      const [r] = (await call(page, '/api/me/resumes')).body;
      const slug = `asha-del-${label}-${Date.now().toString(36)}`;
      expect((await call(page, '/api/me/share', json('PUT', { on: true, slug, resumeId: r.id }))).status).toBe(200);

      await page.goto('/me/settings');
      await page.getByTestId('delete-open').click();
      const dlg = page.getByRole('dialog');
      await expect(dlg).toContainText('your resumes and their versions');
      await expect(dlg).toContainText('7 days to undo');
      await dlg.getByTestId('delete-send').click();
      await expect(dlg.getByTestId('delete-code')).toBeVisible(); // the code was emailed before this step shows
      await dlg.getByTestId('delete-code').fill(lastCode(mail));
      expect(await noSideScroll(page)).toBe(true);
      await dlg.getByTestId('delete-confirm').click();
      await expect(page.getByTestId('delete-pending')).toContainText('will be deleted on');
      expect((await call(page, `/api/public/resumes/${slug}`)).status).toBe(404);

      // admin sees the open request
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      const owner = `owner-del-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/customers?tab=deletions');
      await expect(admin.getByTestId('deletions')).toContainText(mail);
      await expect(admin.getByTestId('deletions')).toContainText('Waiting 7 days');
      expect(await noSideScroll(admin)).toBe(true);
      await actx.close();

      // undo
      await page.getByTestId('delete-undo').click();
      await expect(page.getByTestId('delete-open')).toBeVisible();
      expect((await call(page, '/api/me/account/deletion')).body.requested).toBe(false);
    });
  });
}
