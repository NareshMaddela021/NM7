// Vetting V3, the AI screening interview, on a desktop and a 390 px phone, against the real API: a candidate with a
// current SQL "Skill verified" badge opens /me/interviews, reads the consent card (7 questions, no audio stored,
// pasting turned off, 180 days, one try per 30 days, language) and ticks "I agree", starts in typed mode, sees that
// pasting is refused politely, types 7 answers with the countdown and "Question n of 7" on screen, and, with no AI key in
// CI, gets "Our team will grade it". An admin grades it in Admin → Skill checks → Interviews, and the candidate then
// sees the passed result: average out of 5, the 5 rubric bars, strengths, the concern and "Interview-ready until".
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const ANSWER = 'At my last job I wrote SQL reports for the sales team every week, joined orders with customers and checked the totals against the finance sheet before sending them.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('consent, typed interview, team review, then the passed result', async ({ page, browser }) => {
      test.setTimeout(240_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}${Date.now().toString(36)}`;
      const name = `Iv Candidate ${tag}`;
      const mail = email(`iv-${label}`);
      seed('customer', mail, name, PASSWORD);
      seed('skill-verified', mail, 'SQL', '1-3', '84', '86');
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);

      await page.goto('/me/interviews');
      await expect(page.getByRole('heading', { name: 'AI screening interview', level: 1 })).toBeVisible();
      const role = page.getByTestId('iv-role').filter({ hasText: 'Data analyst' });
      await expect(role).toContainText('Skill verified');
      expect(await noSideScroll(page)).toBe(true);
      await role.getByTestId('iv-start-SQL').click();

      // the consent card, in plain words, and the start options
      const consent = page.getByTestId('iv-consent');
      for (const s of ['7 questions', 'No audio is recorded', 'pasting is turned off', '180 days', 'every 30 days', 'never lowers your score']) await expect(consent).toContainText(s);
      expect(await noSideScroll(page)).toBe(true);
      await expect(page.getByTestId('iv-go')).toBeDisabled();
      await page.getByTestId('iv-mode-text').check();
      await page.getByTestId('iv-agree').check();
      await page.getByTestId('iv-go').click();

      // seven questions, typed; pasting is refused politely
      const box = page.getByTestId('iv-text');
      await expect(box).toBeVisible();
      await box.dispatchEvent('paste');
      await expect(page.getByTestId('iv-paste-note')).toContainText('Please type your answer');
      for (let n = 1; n <= 7; n += 1) {
        await expect(page.getByTestId('iv-progress')).toContainText(`Question ${n} of 7`);
        await expect(page.getByTestId('iv-time')).toContainText(/\d:\d\d/);
        if (n === 1) expect(await noSideScroll(page)).toBe(true);
        await page.getByTestId('iv-text').fill(`${ANSWER} (answer ${n})`);
        await page.getByTestId('iv-send').click();
        if (n < 7) await expect(page.getByTestId('iv-progress')).toContainText(`Question ${n + 1} of 7`, { timeout: 30_000 });
      }
      await expect(page.getByTestId('iv-review-text')).toContainText('Our team will grade it', { timeout: 60_000 });
      await expect(page).toHaveURL(/\/me\/interviews\/[0-9a-f]{24}/);
      expect(await noSideScroll(page)).toBe(true);

      // an admin grades it in Admin → Skill checks → Interviews
      const owner = `iv-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const actx = await browser.newContext({ ...opts });
      const admin = await actx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await admin.goto('/admin/skill-tests?tab=interviews');
      await expect(admin.getByRole('tab', { name: 'Interviews' })).toHaveAttribute('aria-selected', 'true');
      const item = admin.getByTestId('ivq-item').filter({ hasText: name });
      await expect(item).toBeVisible({ timeout: 20_000 });
      await expect(item).toContainText('(answer 7)');
      expect(await noSideScroll(admin)).toBe(true);
      for (const k of ['communication', 'knowledge', 'problem_solving', 'ownership', 'clarity']) await item.getByTestId(`ivq-score-${k}`).selectOption('4');
      await item.getByTestId('ivq-strength-0').fill('Clear weekly SQL reporting');
      await item.getByTestId('ivq-strength-1').fill('Checks totals before sending');
      await item.getByTestId('ivq-strength-2').fill('Owns the report end to end');
      await item.getByTestId('ivq-concern').fill('Did not mention indexing');
      await item.getByTestId('ivq-grade').click();
      await expect(admin.getByTestId('ivq-item').filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 });
      await admin.getByTestId('ivq-graded').click();
      await expect(admin.getByTestId('ivq-item').filter({ hasText: name })).toContainText('Passed');
      await actx.close();

      // the candidate sees the passed result
      await page.goto('/me/interviews');
      const card = page.getByTestId('iv-role').filter({ hasText: 'Data analyst' });
      await expect(card).toContainText('Passed');
      await card.getByTestId('iv-see').click();
      await expect(page.getByTestId('iv-pass')).toContainText('Passed');
      await expect(page.getByTestId('iv-average')).toHaveAttribute('aria-label', 'Average 4.0 out of 5');
      await expect(page.getByTestId('iv-score')).toHaveCount(5);
      await expect(page.getByTestId('iv-strengths')).toContainText('Clear weekly SQL reporting');
      await expect(page.getByTestId('iv-concern')).toContainText('Did not mention indexing');
      await expect(page.getByTestId('iv-valid')).toContainText('Interview-ready until');
      await expect(page.getByTestId('iv-again')).toContainText('Next try from');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
