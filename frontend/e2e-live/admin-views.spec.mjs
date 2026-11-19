// Admin "Switch to" views and "View as this user (read-only)", on a desktop and a 390 px phone, against the real API:
// the admin signs in once (password + authenticator); Switch to → Job seeker / Student / Expert / Company / College
// opens that view with the coloured banner on every page (it never covers the page); Back to Admin returns to the
// console with no new sign-in; the old demo buttons (Easy dashboard student, demo college) no longer sign the admin
// out; the read-only view of a real customer hides their email, refuses a change, and its reason is in the audit log.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const VIEWS = [
  ['jobseeker', 'Job seeker', /\/me$/],
  ['student', 'Student', /\/me$/],
  ['expert', 'Expert', /\/expert/],
  ['company', 'Company', /\/company/],
  ['college', 'College', /\/org\/demo-engineering-college/],
];

async function bannerOnTop(page, label) {
  const banner = page.getByTestId('view-banner');
  await expect(banner).toContainText(`You are viewing as ${label} (admin preview)`);
  await expect(page.getByTestId('back-to-admin')).toBeVisible();
  // in the page flow above everything else: whatever comes next starts below it, so nothing is covered
  const box = await banner.boundingBox();
  expect(box.y).toBeLessThanOrEqual(1);
  const next = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="view-banner"]');
    let n = b.nextElementSibling;
    while (n && !n.getBoundingClientRect().height) n = n.nextElementSibling;
    return n ? n.getBoundingClientRect().top : null;
  });
  if (next !== null) expect(next).toBeGreaterThanOrEqual(box.y + box.height - 1);
  const back = await page.getByTestId('back-to-admin').boundingBox();
  expect(back.height).toBeGreaterThanOrEqual(44);
  expect(await noSideScroll(page)).toBe(true);
}

async function backToAdmin(page) {
  await page.getByTestId('back-to-admin').click();
  await page.waitForURL(/\/admin$/);
  await expect(page).not.toHaveURL(/login/);
  await expect(page.getByTestId('view-banner')).toHaveCount(0);
  expect((await call(page, '/api/auth/me')).body.role).toBe('admin');
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('switch to each view and back without signing in again', async ({ page }) => {
      test.setTimeout(300_000);
      page.on('dialog', (d) => d.accept());
      const owner = `owner-views-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      for (const [role, name, url] of VIEWS) {
        await page.goto('/admin');
        await page.getByRole('button', { name: /Account menu/ }).click();
        await page.getByTestId(`switch-${role}`).click();
        await page.waitForURL(url, { timeout: 60_000 });
        await bannerOnTop(page, name);
        // the banner stays on every page while the view is open
        await page.goto('/jobs');
        await expect(page.getByTestId('view-banner')).toContainText(name);
        if (role !== 'company') expect((await call(page, '/api/admin/stats')).status).toBe(403); // not the admin now
        await backToAdmin(page);
      }
      // the older demo buttons no longer sign the admin out: Easy dashboard student, then the demo college
      await page.goto('/admin/auto-apply');
      await page.getByTestId('aa-demo-simple').click();
      await page.waitForURL(/\/me\/simple$/);
      await bannerOnTop(page, 'Student');
      await backToAdmin(page);
      await page.goto('/admin/orgs');
      await page.getByTestId('demo-as-coordinator').click();
      await page.waitForURL('**/org/demo-engineering-college');
      await bannerOnTop(page, 'College');
      await backToAdmin(page);
    });

    test('view a customer read-only: masked, nothing changes, audit-logged', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', (d) => d.accept());
      const tag = `${label}${Date.now().toString(36)}`;
      const mail = `real.person.${tag}@example.com`;
      const { id } = seed('customer', mail, `Real Person ${tag}`, PASSWORD);
      const owner = `owner-ro-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await page.goto(`/admin/customers?id=${id}`);
      const box = page.getByTestId('view-as-user');
      await box.getByRole('button', { name: 'View as this user (read-only)' }).click();
      const reason = `Support ticket ${tag}: resume not saving`;
      await box.getByLabel(/Why do you need/).fill(reason);
      await box.getByRole('button', { name: 'Open read-only view' }).click();
      await page.waitForURL(/\/me/);
      await expect(page.getByTestId('view-banner')).toContainText(`You are viewing Real Person ${tag}’s screens (read-only)`);
      expect(await noSideScroll(page)).toBe(true);
      const me = (await call(page, '/api/auth/me')).body;
      expect(me.id).toBe(id);
      expect(me.email).not.toBe(mail); // partly hidden
      expect(me.email).toMatch(/^r\*+@example\.com$/);
      // a change is refused by the server
      const write = await call(page, '/api/me/resumes', json('POST', { id: 'r9', name: 'x', data: {}, active: false }));
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('read_only');
      await backToAdmin(page);
      // the audit log has it: who, whom, why
      await page.goto('/admin/team');
      await page.getByPlaceholder('e.g. settings.changed').fill('admin.view_as_user');
      await expect(page.getByRole('main')).toContainText(reason);
    });
  });
}
