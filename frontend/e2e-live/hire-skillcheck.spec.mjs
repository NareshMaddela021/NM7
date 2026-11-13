// Phase 5 H3 skill checks, on a desktop and a 390 px phone, against the real API: a candidate takes a 10-minute SQL
// check (10 questions, a timer, leaving the tab is counted), answers one spoken question by typing, sees the score and
// clarity feedback, shares it, and can't start the same check again for 30 days; Admin adds a question to the bank.
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('take a skill check, see the score, share it; admin adds a question', async ({ page, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`sk-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/skill-checks');
      await expect(page.getByTestId('sk-list')).toContainText('Electrical');
      // 13 Nov live test: the ten new tests are listed (a long list still fits a 390 px phone)
      for (const s of ['Java', 'Web basics', 'Software testing', 'Spoken English', 'Nursing basics', 'Mechanical basics', 'Delivery and logistics', 'Tally and GST', 'Data entry', 'Retail']) await expect(page.getByTestId('sk-list')).toContainText(s);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('sk-start-SQL').click();
      await expect(page.getByTestId('sk-q')).toHaveCount(10);
      await expect(page.getByTestId('sk-timer')).toContainText(/^(10:00|9:5\d) left/);
      for (const q of await page.getByTestId('sk-q').all()) await q.getByRole('radio').first().check();
      await expect(page.getByTestId('sk-timer')).toContainText('10 of 10 answered');
      // leaving the tab is counted
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
      await expect(page.getByTestId('sk-timer')).toContainText('left the tab 1×');
      await page.getByText('Optional: 3 spoken answers').click();
      await page.getByTestId('sk-spoken-0').fill('I used SQL in my final year project. I wrote joins for a sales report and it cut the time by 2 hours.');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('sk-submit').click();
      const res = page.getByTestId('sk-result');
      await expect(res.getByTestId('sk-score')).toContainText(/\d+% · \d+ of 10 right/);
      await expect(res).toContainText('left the tab 1×');
      await expect(res).toContainText('I used SQL in my final year project');
      await res.getByTestId('sk-share').click(); // saved first, then ticked
      await expect(res.getByTestId('sk-share')).toBeChecked();
      const again = await call(page, '/api/me/skill-checks/start', json('POST', { skill: 'SQL' }));
      expect(again.status).toBe(409); // once in 30 days
      expect(await noSideScroll(page)).toBe(true);

      // Admin → Skill tests
      const owner = `sk-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const admin = await (await browser.newContext(opts)).newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/skill-tests');
      await expect(admin.getByTestId('st-skills')).toContainText('Warehouse');
      await admin.getByTestId('st-new').click();
      const q = `Which document comes with goods sent to a store? ${label}`;
      await admin.getByTestId('st-skill').fill('Delivery');
      await admin.getByTestId('st-question').fill(q);
      for (const [i, o] of ['A delivery challan', 'A school report', 'A movie ticket', 'A recipe'].entries()) await admin.getByTestId(`st-opt-${i}`).fill(o);
      await admin.getByTestId('st-save').click();
      await expect(admin.getByTestId('st-row').filter({ hasText: q })).toContainText('✔ A delivery challan');
      expect(await noSideScroll(admin)).toBe(true);
    });
  });
}
