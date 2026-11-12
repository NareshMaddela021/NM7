// Fix round (7 Nov live test), the easy dashboard, on a desktop and a 390 px phone, against the real API:
// 3 Practice interview opens practice; 4 My resume shows the resume with Download PDF; 5 "Fix my resume" is a simple
// list of fixes, each to the exact place; 6 "Write it for me" reads as English; 12 My applications are simple cards;
// 13 "Choose the jobs you want" stays simple; 15 the account's email and phone go on the resume; 31 skill chips
// don't move when tapped.
import { expect, test } from '@playwright/test';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

const WEAK = { personal: { name: 'Asha Rao' }, edu: [{ institution: 'JNTU', degree: 'B.Tech', field: 'CSE', from: '', to: '2025', grade: '' }], skillGroups: [{ id: 'core', label: 'Skills', value: 'Excel' }], proj: [{ title: 'Canteen dashboard', description: '', tech: 'Excel' }], exp: [] };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('every tile and button stays simple; fixes; practice; resume view', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await studentWith(page, label, WEAK, 'fixr');
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { mode: 'simple' }))).status).toBe(200);
      await page.goto('/me/simple');
      // 5: the next step is "Fix my resume" → a simple list of fixes
      await expect(page.getByTestId('sx-next')).toHaveAttribute('data-key', 'fix_score');
      await page.getByTestId('sx-next-go').click();
      await expect(page).toHaveURL(/\/me\/simple\/fixes$/);
      await expect(page.getByTestId('sx-fx-score')).toContainText('It needs 60');
      await expect(page.getByTestId('sx-fix-summary')).toHaveAttribute('href', '/builder?start=section&sec=summary');
      await expect(page.getByTestId('sx-fix-contact')).toHaveAttribute('href', '/me/simple/resume?step=about');
      expect(await noSideScroll(page)).toBe(true);
      // 4: My resume shows it, with Download PDF
      await page.goto('/me/simple');
      await page.getByTestId('sx-tile-resume').click();
      await expect(page).toHaveURL(/\/me\/simple\/myresume$/);
      await expect(page.getByTestId('sx-mr-projects')).toContainText('Canteen dashboard');
      await expect(page.getByTestId('sx-pdf')).toBeVisible();
      // 12: applications as cards
      await page.goto('/me/simple');
      await page.getByTestId('sx-tile-apps').click();
      await expect(page).toHaveURL(/\/me\/simple\/apps$/);
      await expect(page.getByText('You have not applied yet.')).toBeVisible();
      // 3: practice interview
      await page.goto('/me/simple');
      await page.getByTestId('sx-tile-practice').click();
      await expect(page).toHaveURL(/\/me\/simple\/practice$/);
      await page.getByTestId('sx-pr-common').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tell me about yourself.');
      await page.getByTestId('sx-pr-answer').fill('I am Asha, I studied CSE');
      await page.getByTestId('sx-pr-check').click(); // re-test N1: feedback first, then Next
      await expect(page.getByTestId('sx-pr-feedback')).toBeVisible();
      await page.getByTestId('sx-pr-next').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Why do you want this job?');
      // 13: "Choose the jobs you want" stays inside
      await page.goto('/me/simple/ready');
      await expect(page.getByTestId('sx-left-roles')).toHaveAttribute('href', '/me/simple/auto');
    });

    test('resume by talking: account contact, English lines, steady chips', async ({ page }) => {
      test.setTimeout(120_000);
      await studentWith(page, label, { personal: {} }, 'fixt');
      expect((await call(page, '/api/me/profile', json('PATCH', { phone: '98765 43210' }))).status).toBeLessThan(300);
      // 15: answering a later question first still puts the account's email and phone on the resume
      await page.goto('/me/simple/resume?step=skills');
      const chip = page.getByTestId('sx-skill-Communication');
      const next = page.getByTestId('sx-skill-Teamwork');
      const before = await next.boundingBox();
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      const after = await next.boundingBox();
      expect(Math.round(after.x)).toBe(Math.round(before.x)); // 31: the chips don't move
      expect(Math.round(after.y)).toBe(Math.round(before.y));
      await page.getByTestId('sx-next-q').click();
      await expect(page.getByTestId('sx-guided')).toHaveAttribute('data-step', 'projects'); // saved
      const rs = (await call(page, '/api/me/resumes')).body;
      const d = (rs.find((x) => x.active) || rs[0]).data;
      expect(d.personal.email).toMatch(/@example\.com$/);
      expect(d.personal.phone).toMatch(/98765/);
      // 6: "Write it for me" reads as English
      await page.goto('/me/simple/resume?step=projects');
      await page.getByTestId('sx-projects-built').fill('A sales dashboard for a college canteen');
      await page.getByTestId('sx-projects-tools').fill('Excel and Power BI');
      await page.getByTestId('sx-projects-does').fill('Shows daily sales and the most sold items');
      await page.getByTestId('sx-write').click();
      await expect(page.getByTestId('sx-wrote')).toContainText('Built a sales dashboard for a college canteen using Excel and Power BI');
      await expect(page.getByTestId('sx-wrote')).toContainText('Designed it to show daily sales and the most sold items');
      await expect(page.getByTestId('sx-wrote')).not.toContainText('Project Shows');
      // the about step: the account's phone is filled in
      await page.goto('/me/simple/resume?step=about');
      await expect(page.getByTestId('sx-about-phone')).toHaveValue(/98765/);
      await expect(page.getByTestId('sx-about-linkedin')).toBeVisible();
      expect(STRONG).toBeTruthy();
    });
  });
}
