// Profile setup P4 on a desktop and a 390 px phone, against the real API:
//   - the Easy dashboard (/me/simple) shows "Set up your profile": the progress, the checklist's next step in simple
//     words and one big "Do this step" button; "Skip for now" moves to the next step; "See all steps" lists every step
//     (the skipped one says so); Telugu words when the person picked Telugu; nothing scrolls sideways;
//   - Admin > Daily report shows the "Profile setup" funnel per role after Refresh now (role tabs, steps with how many
//     got this far), without sideways scrolling.
// Desktop and phone share one database: every test uses its own people.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed, teluguHindi } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

teluguHindi(test); // one test reads the Telugu words (item 41: Telugu / Hindi shown for this file)

const NO_SKILLS = { ...STRONG, skillGroups: [] };
const card = (page) => page.getByTestId('sx-setup');

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Easy dashboard: the checklist next step, Skip for now, all steps, Telugu', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await studentWith(page, label, NO_SKILLS, 'sxsetup');
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'en' }))).status).toBe(200);
      const c = (await call(page, '/api/me/checklist?fresh=1')).body;
      expect(c.next).toBeTruthy();

      await page.goto('/me/simple');
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toHaveAttribute('data-next', c.next);
      await expect(page.getByTestId('sx-setup-progress')).toHaveText(`${c.done} of ${c.total} steps done`);
      await expect(page.getByTestId('sx-setup-next-title')).not.toBeEmpty();
      await expect(card(page)).not.toContainText('ATS'); // simple words
      const go = page.getByTestId('sx-setup-go');
      await expect(go).toHaveText(/Do this step/);
      for (const id of ['sx-setup-go', 'sx-setup-skip', 'sx-setup-all']) expect((await page.getByTestId(id).boundingBox()).height).toBeGreaterThanOrEqual(48);
      expect(await noSideScroll(page)).toBe(true);

      // Skip for now: the next step moves on, and a note says it can be done any time
      await page.getByTestId('sx-setup-skip').click();
      await expect(page.getByTestId('sx-setup-note')).toHaveText('Skipped for now. You can do it any time.');
      await expect(card(page)).not.toHaveAttribute('data-next', c.next);
      expect(await noSideScroll(page)).toBe(true);

      // See all steps: every step with its status; the skipped one says so
      await page.getByTestId('sx-setup-all').click();
      await expect(page).toHaveURL(/\/me\/simple\/setup$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your profile steps');
      await expect(page.getByTestId('sx-step')).toHaveCount(c.steps.length);
      const skipped = page.locator(`[data-testid="sx-step"][data-step="${c.next}"]`);
      await expect(skipped).toContainText('You skipped this for now');
      await expect(page.locator('[data-testid="sx-step"][data-status="next"]')).toHaveCount(1);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('sx-setup-back').click();
      await expect(page).toHaveURL(/\/me\/simple$/);

      // Telugu: the same card in simple Telugu words
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'te' }))).status).toBe(200);
      await page.evaluate(() => sessionStorage.removeItem('nm7-simple-cache'));
      await page.reload();
      await expect(card(page)).toContainText('మీ ప్రొఫైల్ సిద్ధం చేయండి');
      await expect(page.getByTestId('sx-setup-skip')).toHaveText('ఇప్పటికి వదిలేయండి');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Admin > Daily report shows the profile setup funnel per role', async ({ page }) => {
      test.setTimeout(120_000);
      const owner = `sf-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/daily-report');
      await expect(page.getByRole('heading', { name: 'Daily report', level: 1 })).toBeVisible();
      await page.getByTestId('dr-refresh').click();
      await expect(page.getByText('Report refreshed')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Profile setup', level: 2 })).toBeVisible();
      const f = page.getByTestId('sf');
      await expect(f).toBeVisible();
      for (const r of ['jobseeker', 'fresher', 'student', 'expert', 'company', 'college']) await expect(page.getByTestId(`sf-tab-${r}`)).toBeVisible();
      // job seekers exist in this database (the tests above): the steps with how many got this far
      const js = page.locator('[data-testid="sf-role"][data-role="jobseeker"]');
      await expect(js).toBeVisible();
      await expect(js.getByTestId('sf-steps')).toBeVisible();
      await expect(js.locator('[data-testid="sf-step"][data-step="start"]')).toContainText('Signed up with this role');
      await expect(js.getByTestId('sf-reached').first()).toHaveText(/^\d[\d,]*$/);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('sf-tab-company').click();
      await expect(page.getByTestId('sf-tab-company')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-testid="sf-role"][data-role="company"]')).toContainText(/Signed up|Nobody with this role yet/);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
