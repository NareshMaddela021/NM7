// Fix round (7 Nov live test), site-wide, on a desktop and a 390 px phone, against the real API:
// 16 the dashboard says "ready" only from a resume score of 60; 17 the three scores are explained; 24 the home page
// shows the job board, Auto Apply, the easy dashboard and For companies; 26 /pricing opens the pricing section;
// 27 a browser-autofilled admin sign-in can press Continue; 28 no focus ring round the whole page after a route
// change; 29 the sign-in subtitle mentions jobs; 30 pricing says the job board, match score and Manual Apply are free.
import { expect, test } from '@playwright/test';
import { PASSWORD, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';
import { studentWith } from './autoapply.mjs';

const WEAK = { personal: { name: 'Asha Rao' }, edu: [{ institution: 'JNTU', degree: 'B.Tech', field: 'CSE', from: '', to: '2025', grade: '' }], skillGroups: [{ id: 'core', label: 'Skills', value: 'Excel' }], proj: [], exp: [] };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('home, pricing, sign-in', async ({ page }) => {
      test.setTimeout(90_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      // 24: the jobs side of Nm7 on the home page
      await page.goto('/old-home'); // round P: the previous home page has this section
      const jobs = page.getByTestId('home-jobs');
      await expect(jobs.getByRole('heading', { name: 'Jobs on Nm7' })).toBeVisible();
      for (const [k, href] of [['board', '/jobs'], ['auto', '/me/auto-apply'], ['simple', '/me/simple'], ['companies', '/for-companies']]) await expect(jobs.getByTestId(`home-jobs-${k}`)).toHaveAttribute('href', href);
      expect(await noSideScroll(page)).toBe(true);
      // 26 + 30: /pricing lands on the pricing section, which says what is free
      await page.goto('/pricing');
      await expect(page).toHaveURL(/\/pricing$/); // round P: its own page
      await expect(page.locator('#pricing')).toContainText('The job board, your match score on every job and Manual Apply are free too.');
      // 29: the sign-in subtitle mentions jobs
      await page.goto('/login');
      await expect(page.getByText('Find jobs and track your applications')).toBeVisible();
      // 28: when the app moves focus to the page's main area (route changes, the skip link), it draws no ring,
      // even in keyboard mode (where :focus-visible is on)
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const main = document.querySelector('main');
        main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true }); // what focusMain() in App.jsx does
        return { tag: document.activeElement.tagName, outline: getComputedStyle(main).outlineStyle };
      });
      expect(ring).toEqual({ tag: 'MAIN', outline: 'none' });
    });

    test('admin sign-in with browser autofill', async ({ page }) => {
      const owner = `fx-autofill-${label}-${Date.now().toString(36)}@nm7.si`;
      seed('admin', owner, 'owner', PASSWORD);
      await page.goto('/admin/login');
      await expect(page.getByLabel('Work email')).toBeVisible(); // the page is loaded on demand
      // 27: autofill sets the values without the change events React listens to
      await page.evaluate(([e, p]) => { document.getElementById('ad-e').value = e; document.getElementById('ad-p').value = p; }, [owner, PASSWORD]);
      await expect(page.getByTestId('admin-continue')).toBeEnabled();
      await page.getByTestId('admin-continue').click();
      await expect(page.getByText('STEP 2 OF 2 · AUTHENTICATOR')).toBeVisible();
    });

    test('dashboard: ready only from 60, the scores explained', async ({ page }) => {
      test.setTimeout(90_000);
      const me = await studentWith(page, label, WEAK, 'fxready');
      seed('paid-order', me, 'diy'); // a finished order with nothing to do: the case that used to say "ready"
      await page.goto('/me');
      const banner = page.getByTestId('me-banner');
      await expect(banner).toHaveAttribute('data-state', 'fix'); // 16
      await expect(banner).toContainText('Fix a few things to reach 60');
      await expect(page.getByText('Your resume is ready. Time to apply.')).toHaveCount(0);
      const why = page.getByTestId('scores-explained'); // 17
      await why.getByText('What do the three scores mean?').click();
      await expect(why).toContainText('Resume score (ATS)');
      await expect(why).toContainText('Job readiness');
      await expect(why).toContainText('Profile strength');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
