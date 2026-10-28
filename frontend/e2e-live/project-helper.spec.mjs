// Projects → "Make this project stronger", on a desktop and a 390 px phone, against the real API (no AI key here, so
// the server writes the bullets from the answers with its rules — the same path as after the 3 free AI uses):
// short questions, before → after, a tip when there is no number, Accept / Edit / Skip.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const post = (page, path, body) => page.evaluate(async ([base, p, b]) => {
  const r = await fetch(`${base}${p}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, body]);
const RESUME = {
  personal: { name: 'Sneha Reddy', email: 'sneha@example.com', phone: '+91 90000 22222', location: 'Warangal', title: 'Student' },
  proj: [{ title: 'Attendance app', description: 'made an app for attendance', tech: 'Flutter' }],
  edu: [{ institution: 'NIT Warangal', degree: 'B.Tech', field: 'CSE', from: '2022', to: '2026' }],
};
const goTo = (page, side) => page.getByRole('button', { name: new RegExp(`^.?\\s*${side}( · \\d+ hidden)?`) }).first().click();

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('answers → bullets from the answers only, tip without a number, accept / edit / skip', async ({ page }) => {
      const mail = email(`ph-${label}`);
      seed('customer', mail, 'Sneha Reddy', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      expect((await post(page, '/api/me/resumes', { id: 'r1', name: 'Main', data: RESUME, active: true })).status).toBeLessThan(300);
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Attendance app');
      await goTo(page, 'Projects');
      await page.getByTestId('ph-open').first().click();
      const ph = page.getByTestId('project-helper');
      await expect(ph.getByTestId('ph-tools')).toHaveValue('Flutter'); // the project's tech is filled in
      await ph.getByTestId('ph-built').fill('a college attendance app');
      await ph.getByTestId('ph-tools').fill('Flutter, Firebase');
      await ph.getByTestId('ph-part').fill('the login and attendance screens');
      await ph.getByTestId('ph-team').fill('3');
      await ph.getByTestId('ph-does').fill('lets teachers mark attendance from their phone');
      await ph.getByTestId('ph-write').click();
      await expect(ph.getByTestId('ph-before')).toHaveText('made an app for attendance');
      const after = ph.getByTestId('ph-after');
      await expect(after.locator('li')).toHaveText([
        'Built a college attendance app using Flutter and Firebase',
        'Project lets teachers mark attendance from their phone',
        'Handled the login and attendance screens in a team of 3',
      ]);
      await expect(ph.getByTestId('ph-tip')).toContainText('Add a number if you have one (users, accuracy, time saved)');
      expect(await after.innerText()).not.toMatch(/\d+%|users/i);
      // Skip leaves the project as it was
      await ph.getByTestId('ph-skip').click();
      await expect(page.getByTestId('project-helper')).toHaveCount(0);
      await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('made an app for attendance');
      // with a real number: no tip; Edit, then Accept writes it into the project
      await page.getByTestId('ph-open').first().click();
      await ph.getByTestId('ph-built').fill('a college attendance app');
      await ph.getByTestId('ph-result').fill('cut roll call from 10 minutes to 2');
      await ph.getByTestId('ph-write').click();
      await expect(ph.getByTestId('ph-after')).toContainText('Result: cut roll call from 10 minutes to 2');
      await expect(ph.getByTestId('ph-tip')).toHaveCount(0);
      await ph.getByTestId('ph-edit-btn').click();
      await ph.getByTestId('ph-edit').fill('Built a college attendance app using Flutter\nCut roll call from 10 minutes to 2');
      await ph.getByTestId('ph-accept').click();
      await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Cut roll call from 10 minutes to 2');
      await expect(page.getByRole('article', { name: 'Resume preview' })).not.toContainText('made an app for attendance');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  });
}
