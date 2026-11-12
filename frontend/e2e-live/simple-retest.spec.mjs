// Re-test 12 Nov, on a desktop and a 390 px phone, against the real API, as demo Ravi (English: Telugu and Hindi
// hidden, the default): N1 the easy dashboard's practice interview gives clarity feedback after each answer, and
// practising counts for readiness; N2 the skills step opens with Ravi's skills ticked (Excel as "MS Excel"),
// untapping one takes it off and nothing is added twice; N3 the full dashboard's "Jobs for you" shows the same
// jobs and scores as the easy dashboard's Jobs screen.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Ravi: practice feedback, skills ticked, one jobs list', async ({ browser }) => {
      test.setTimeout(150_000);
      const owner = `sx-retest-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/); // signed in before moving on
      await page.goto('/admin/auto-apply');
      await page.getByTestId('aa-demo-simple').click();
      await expect(page).toHaveURL(/\/me\/simple$/);

      // N2: Ravi's skills start ticked; untap SQL, tap Python
      await page.goto('/me/simple/resume?step=skills');
      for (const s of ['AutoCAD', 'MS Excel', 'SQL', 'Communication']) await expect(page.getByTestId(`sx-skill-${s}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('sx-skill-Python')).toHaveAttribute('aria-pressed', 'false');
      await page.getByTestId('sx-skill-SQL').click();
      await page.getByTestId('sx-skill-Python').click();
      await page.getByTestId('sx-next-q').click();
      await expect(page.getByTestId('sx-guided')).not.toHaveAttribute('data-step', 'skills');
      const rs = (await call(page, '/api/me/resumes')).body;
      const skills = (rs.find((x) => x.active) || rs[0]).data.skillGroups.flatMap((g) => g.value.split(',').map((x) => x.trim()).filter(Boolean));
      expect(skills).not.toContain('SQL');
      expect(skills).toContain('Python');
      expect(skills.filter((x) => /excel/i.test(x))).toHaveLength(1); // never twice
      expect(new Set(skills.map((x) => x.toLowerCase())).size).toBe(skills.length);

      // N1: feedback after each answer, then Next; three answers count for readiness
      await page.goto('/me/simple/practice');
      await page.getByTestId('sx-pr-common').click();
      for (const answer of ['Um, I am Ravi, I like, basically studied civil engineering.', 'I want to learn design work.', 'In my final year I had to plan a road, I drew it in AutoCAD and it was approved.']) {
        await page.getByTestId('sx-pr-answer').fill(answer);
        await page.getByTestId('sx-pr-check').click();
        const fb = page.getByTestId('sx-pr-feedback');
        await expect(fb).toBeVisible();
        await expect(fb).toContainText('Length');
        await expect(page.getByTestId('sx-pr-better')).not.toBeEmpty();
        await expect(page.getByTestId('sx-pr-fb-say')).toBeVisible(); // Read aloud
        expect(await noSideScroll(page)).toBe(true);
        await page.getByTestId('sx-pr-next').click();
      }
      await page.goto('/me/simple/ready');
      await expect(page.getByTestId('sx-ready')).toBeVisible();
      await expect(page.getByTestId('sx-left-interview')).toHaveCount(0);

      // N3: the same jobs and scores on both dashboards
      const easy = (await call(page, '/api/me/simple/jobs')).body.items.map((j) => [j.title, j.match]);
      expect(easy.length).toBeGreaterThan(0);
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { mode: 'full' }))).status).toBe(200); // the full dashboard, as Naresh did
      await page.goto('/me');
      const card = page.getByTestId('jobs-for-you');
      await expect(card.getByTestId('jfy-job')).toHaveCount(easy.length);
      for (const [k, [title, score]] of easy.entries()) { // the same jobs, in the same order, with the same scores
        await expect(card.getByTestId('jfy-job').nth(k)).toContainText(title);
        await expect(card.getByTestId('jfy-job').nth(k)).toContainText(`${score}% match`);
      }
      await ctx.close();
    });
  });
}
