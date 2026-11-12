// Phase 5 H1 "Ready to join", on a desktop and a 390 px phone, against the real API: consent is needed, the
// details save, the dashboard card and the easy dashboard show "visible until …", Pause and Resume work, the email's
// one-tap Still ready page works without signing in, nothing scrolls sideways, and no browser dialogs.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Ready to join: consent, save, card, easy screen, pause, one-tap link', async ({ page, browser }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`hire-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/hire');
      await expect(page.getByTestId('hire-badge')).toHaveText('Off');
      await page.getByLabel('Earliest join date').fill('2026-12-01');
      await page.getByLabel(/Cities you can work in/).fill('Hyderabad, Pune');
      await page.getByLabel('Expected salary').fill('25000');
      await page.getByLabel('Full-time').check();
      await page.getByTestId('hire-save').click();
      await expect(page.getByRole('alert')).toContainText('Tick the box'); // consent first
      await page.getByTestId('hire-consent').check();
      await page.getByTestId('hire-save').click();
      await expect(page.getByTestId('hire-badge')).toHaveText('Visible');
      await expect(page.getByTestId('hire-line')).toContainText('Visible to companies hiring now until');
      // H4: a new candidate has no history, and is told so in plain words
      await expect(page.getByTestId('hire-rel-label')).toHaveText('New - no history yet');
      expect(await noSideScroll(page)).toBe(true);
      const saved = (await call(page, '/api/me/hire')).body;
      expect(saved.cities).toEqual(['Hyderabad', 'Pune']);
      expect(saved.salary).toEqual({ amount: 25000, unit: 'month' });

      await page.getByTestId('hire-pause').click();
      await expect(page.getByTestId('hire-badge')).toHaveText('Paused');
      await page.getByTestId('hire-pause').click();
      await expect(page.getByTestId('hire-badge')).toHaveText('Visible');

      await page.goto('/me');
      await expect(page.getByTestId('hire-card-line')).toContainText('Visible to companies hiring now until');

      await page.goto('/me/simple/hire');
      await expect(page.getByTestId('sx-hire-line')).toContainText('Companies hiring now can see you until');
      await page.getByTestId('sx-hire-pause').click();
      await expect(page.getByTestId('sx-hire-line')).toContainText('Paused');
      await page.getByTestId('sx-hire-pause').click();
      await page.getByTestId('sx-hire-still').click();
      await expect(page.getByTestId('sx-hire-note')).toContainText('another week');
      expect(await noSideScroll(page)).toBe(true);

      // the reminder email's link: a fresh browser, no sign-in
      const { token } = seed('hire-token', mail);
      const anon = await browser.newContext(opts);
      const p2 = await anon.newPage();
      p2.on('dialog', () => { throw new Error('no browser dialogs'); });
      await p2.goto(`/hire/still-ready#t=${token}`);
      await p2.getByTestId('still-confirm').click();
      await expect(p2.getByTestId('still-done')).toContainText('another week');
      expect(await noSideScroll(p2)).toBe(true);
      await anon.close();
    });
  });
}
