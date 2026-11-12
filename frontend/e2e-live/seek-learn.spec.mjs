// Phase 6 S2 learning paths, on a desktop and a 390 px phone, against the real API: from the role finder a job seeker
// starts the Data analyst path, ticks a free course (progress moves; no skill is added), sends the project link, and
// gets "Skill verified: SQL" only once the official SQL check is passed too; the public resume link shows the badge.
// Admin edits a path and can't save a project that asks for money. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('path: courses, project, check → Skill verified; admin edits', async ({ page, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`lp-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      // from the role finder
      await call(page, '/api/me/roles', json('POST', { studies: 'graduate', style: 'numbers', secondStyle: 'computers', likes: ['maths', 'reports'], languages: ['English'], laptop: true, hoursWeek: 8 }));
      await page.goto('/me/roles');
      await page.getByTestId('rf-role').filter({ hasText: 'Data analyst' }).getByTestId('rf-learn').click();
      await expect(page).toHaveURL(/\/me\/learn\?role=data-analyst/);
      await page.getByTestId('lp-start').click();
      await expect(page.getByTestId('lp-pct')).toHaveText('0% done');
      await page.getByTestId('lp-course').first().getByRole('checkbox').click();
      await expect(page.getByTestId('lp-course').first().getByRole('checkbox')).toBeChecked();
      await expect(page.getByTestId('lp-pct')).not.toHaveText('0% done');
      await page.getByTestId('lp-send').click();
      await expect(page.getByTestId('lp-project').getByRole('alert')).toBeVisible(); // nothing sent yet: told on the page
      await page.getByTestId('lp-link').fill('https://docs.google.com/spreadsheets/d/example');
      await page.getByTestId('lp-send').click();
      await expect(page.getByTestId('lp-sent')).toContainText('Sent');
      await expect(page.getByTestId('lp-badge')).toHaveCount(0); // the check isn't passed yet
      expect(await noSideScroll(page)).toBe(true);

      seed('skill-pass', mail, 'SQL', '80');
      await page.reload();
      await expect(page.getByTestId('lp-badge')).toContainText('Skill verified: SQL');
      expect(await noSideScroll(page)).toBe(true);
      // the public link shows it
      await call(page, '/api/me/resumes', json('POST', { id: `r-${label}`, name: 'Main', data: { personal: { name: 'Asha Rao' } } }));
      const slug = `asha-${label}-${Date.now().toString(36)}`;
      await call(page, '/api/me/share', json('PUT', { on: true, slug, resumeId: `r-${label}` }));
      await page.goto(`/r/${slug}`);
      await expect(page.getByTestId('pub-verified')).toContainText('Skill verified: SQL');

      // Admin → Learning paths
      const owner = `lp-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const admin = await (await browser.newContext(opts)).newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/learn-paths');
      await expect(admin.getByTestId('lp-row').first()).toBeVisible();
      const row = admin.getByTestId('lp-row').filter({ hasText: 'Software tester' });
      await row.getByRole('button', { name: 'Edit' }).click();
      await admin.getByTestId('lp-brief').fill('Pay a small fee, then write test cases for a login page');
      await admin.getByTestId('lp-save').click();
      await expect(admin.getByText('A project must be free to do')).toBeVisible();
      await admin.getByTestId('lp-brief').fill('Write test cases for the sign-in page of a public website');
      await admin.getByTestId('lp-save').click();
      await expect(admin.getByTestId('lp-form')).toHaveCount(0);
      expect(await noSideScroll(admin)).toBe(true);
    });
  });
}
