// Admin → Skill checks (Vetting V2) on a desktop and a 390 px phone, against the real API: the Banks tab lists a
// role's questions (the banks load on first open), a question's wording is edited in the dialog and saved, then the
// Rubrics, Review queue, Integrity queue and Stats tabs open. No sideways scrolling, no browser dialogs.
// (The company "Skill verified" badge is covered by the backend tests: seed() cannot make a skill_verified record.)
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('banks: edit a question; rubrics, review, integrity and stats tabs', async ({ page }) => {
      test.setTimeout(120_000);
      const owner = `vt-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs on this page'); });

      await page.goto('/admin/skill-tests');
      await expect(page.getByRole('heading', { name: 'Skill checks', level: 1 })).toBeVisible();
      // Launch: hidden by default (only admins, demo accounts and testers see the new skill checks)
      await expect(page.getByTestId('vl-state')).toContainText('Hidden');
      await expect(page.getByRole('tab', { name: 'Banks' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('st-skills')).toContainText('Warehouse');
      await page.getByTestId('st-skills').selectOption('SQL');
      const rows = page.getByTestId('st-row');
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);

      // edit the first question's wording
      const tag = `${label}${Date.now().toString(36)}`;
      await rows.first().getByTestId('st-edit').click();
      const dlg = page.getByRole('dialog', { name: 'Edit question' });
      await expect(dlg).toBeVisible();
      const wording = `Which SQL clause filters rows after GROUP BY has grouped them (${tag})?`;
      await dlg.getByLabel('Question (English)').fill(wording);
      await dlg.getByTestId('st-save').click();
      await expect(dlg).toHaveCount(0);
      const row = rows.filter({ hasText: tag });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('✔');
      await expect(row).toContainText('Edited');

      // the other tabs
      await page.getByRole('tab', { name: 'Rubrics' }).click();
      await expect(page).toHaveURL(/tab=rubrics/);
      await page.getByTestId('vr-role').selectOption('sql');
      await expect(page.getByTestId('vr-rubric')).toContainText('Version');
      await expect(page.getByTestId('vr-rubric').getByRole('table')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      await page.getByRole('tab', { name: /Review queue/ }).click();
      await expect(page.getByRole('region', { name: 'Review queue' })).toContainText(/Nothing to review|Their answer|What they said|No written answer/);
      await page.getByTestId('vq-done').click();
      await expect(page.getByTestId('vq-done')).toHaveAttribute('aria-pressed', 'true');

      await page.getByRole('tab', { name: /Integrity queue/ }).click();
      await expect(page.getByRole('note')).toContainText('Holding never bans anyone');
      expect(await noSideScroll(page)).toBe(true);

      await page.getByRole('tab', { name: 'Stats' }).click();
      await expect(page.getByTestId('vs-days')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
