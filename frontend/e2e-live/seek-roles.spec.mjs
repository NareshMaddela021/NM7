// Phase 6 S1 role finder, on a desktop and a 390 px phone, against the real API: a job seeker answers the ten
// questions (ITI, works with machines, no laptop), gets three roles with plain reasons (Electrician first), "Not enough
// data yet" where Nm7 has too few jobs for a salary, changes the answers and gets new roles; the dashboard card and the
// easy dashboard show the same roles. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('answer the questions, see three roles, retake, easy dashboard', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`rf-${label}`);
      seed('customer', mail, 'Ravi Teja', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await expect(page.getByTestId('roles-card')).toContainText('Ten simple questions');
      await page.goto('/me/roles');
      const form = page.getByTestId('rf-form');
      await form.getByTestId('rf-find').click();
      await expect(form.getByRole('alert')).toContainText('Please answer'); // no browser alert
      await page.getByTestId('rf-studies').selectOption('iti');
      await page.getByTestId('rf-branch').fill('ITI Electrician');
      await page.getByTestId('rf-likes').getByRole('button', { name: 'Fixing things' }).click();
      await page.getByTestId('rf-likes').getByRole('button', { name: 'Hands-on work' }).click();
      await page.getByTestId('rf-style').selectOption('machines');
      await page.getByTestId('rf-langs').getByRole('button', { name: 'Telugu' }).click();
      await page.getByTestId('rf-laptop-no').check();
      await page.getByTestId('rf-hours').fill('4');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('rf-find').click();
      const roles = page.getByTestId('rf-role');
      await expect(roles).toHaveCount(3);
      await expect(roles.first()).toContainText('Electrician');
      await expect(roles.first().getByTestId('rf-why')).not.toBeEmpty();
      await expect(roles.first().getByTestId('rf-salary')).toContainText('Not enough data yet'); // never a guess
      expect(await noSideScroll(page)).toBe(true);

      // retake: a commerce graduate who likes numbers
      await page.getByTestId('rf-retake').click();
      await page.getByTestId('rf-studies').selectOption('graduate');
      await page.getByTestId('rf-branch').fill('B.Com');
      await page.getByTestId('rf-style').selectOption('numbers');
      await page.getByTestId('rf-laptop-yes').check();
      await page.getByTestId('rf-hours').fill('8');
      await page.getByTestId('rf-find').click();
      await expect(roles.first()).toContainText('Accounts assistant');

      // the dashboard card and the easy dashboard
      await page.goto('/me');
      await expect(page.getByTestId('roles-card')).toContainText('Accounts assistant');
      await page.goto('/me/simple/roles');
      await expect(page.getByTestId('sx-role')).toHaveCount(3);
      await expect(page.getByTestId('sx-role').first()).toContainText('Accounts assistant');
      await expect(page.getByTestId('sx-roles-go')).toHaveAttribute('href', '/me/roles');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
