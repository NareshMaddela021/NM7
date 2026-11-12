// Phase 6 S3 practice tests, on a desktop and a 390 px phone, against the real API: a job seeker takes the numbers
// test, sees right / not right with the reason after every question and the score by topic; a coding question shows
// its code; practice never gives "Skill verified" (weak topics + courses: tests/test_seek_practice.py). No browser
// dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('practice: explained answers, topic scores, code shown, never verified', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`pr-${label}`);
      seed('customer', mail, 'Kiran Das', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/practice');
      await expect(page.getByTestId('me-practice')).toContainText('never counts as a verified score');
      await page.getByTestId('pr-start-aptitude-numbers').click();
      const t = page.getByTestId('pr-test');
      await t.getByTestId('pr-check').click();
      await expect(t.getByRole('alert')).toContainText('Pick an answer first'); // on the page, not a pop-up
      for (let i = 0; i < 10; i += 1) {
        await expect(t.getByTestId('pr-count')).toContainText(`Question ${i + 1} of 10`);
        await t.getByTestId('pr-opt').first().check();
        await t.getByTestId('pr-check').click();
        await expect(t.getByTestId('pr-why')).toBeVisible(); // right or not, and why
        if (i === 0) expect(await noSideScroll(page)).toBe(true);
        await t.getByTestId('pr-next').click();
      }
      await expect(page.getByTestId('pr-score')).toContainText('of 10 right');
      await expect(page.getByTestId('pr-end')).toContainText('not a verified score');
      await expect(page.getByTestId('pr-topics')).toContainText('%');
      // a coding question shows its code
      await page.getByTestId('pr-start-coding-basics').click();
      const ct = page.getByTestId('pr-test');
      // the order is random and one question in this set has no code: answer until a code question shows
      for (let i = 0; i < 2 && !(await ct.locator('pre').count()); i += 1) {
        await ct.getByTestId('pr-opt').first().check();
        await ct.getByTestId('pr-check').click();
        await ct.getByTestId('pr-next').click();
      }
      await expect(ct.locator('pre')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      // practice never verifies a skill
      const learn = await call(page, '/api/me/learn/data-analyst');
      expect(learn.status).toBe(200);
      expect(learn.body.verified).toBeNull();
    });
  });
}
