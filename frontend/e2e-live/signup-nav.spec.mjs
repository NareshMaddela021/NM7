// "Create free account" and the phone bottom bar, against the real API, on a desktop and a 390 px phone:
// the top bar shows "Create free account" beside "Sign in" while signed out (hidden when signed in); each audience's
// hero button goes to its own sign-up (companies: For companies, colleges: For colleges, job seekers and students:
// /signup with the role in the link and picked on the page); the last call to action above the footer goes to /signup;
// no Google button while the server has no Google client ID; on a phone the job seeker dashboard's bottom bar shows
// Auto Apply (My orders in More) while Admin's Auto Apply switch is on, and My orders again when it is off.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

const HERO = [
  ['company', 'I’m a company', '/for-companies', /\/for-companies$/],
  ['college', 'I’m a college', '/for-orgs?start=1#start', /\/for-orgs\?start=1#start$/],
  ['seeker', 'I’m a job seeker', '/signup?role=jobseeker', /\/signup\?role=jobseeker$/],
  ['student', 'I’m a student', '/signup?role=student', /\/signup\?role=student$/],
];

const noSideScroll = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

for (const [label, opts] of SIZES) {
  test.describe(`create free account · ${label}`, () => {
    test.use(opts);

    test('top bar: Create free account beside Sign in, signed out only', async ({ page }) => {
      await page.goto('/');
      const bar = page.getByRole('banner');
      const join = bar.getByRole('link', { name: 'Create free account' });
      await expect(join).toBeVisible(); // on a phone too, without opening the menu
      await expect(bar.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(join).toHaveAttribute('href', '/signup');
      const box = await join.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      await noSideScroll(page);
      // other public pages use the same top bar
      await page.goto('/jobs');
      await expect(page.getByRole('banner').getByRole('link', { name: 'Create free account' })).toBeVisible();
      await page.getByRole('banner').getByRole('link', { name: 'Create free account' }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Create your free Nm7 account' })).toBeVisible();

      // signed in: gone from the top bar, the hero and the footer call to action
      const mail = email('signupnav-top');
      seed('customer', mail, 'Kiran Top', PASSWORD);
      await login(page, mail);
      await page.waitForURL(/\/me/);
      await page.goto('/');
      await expect(page.getByTestId('nh-cta')).toBeVisible();
      await expect(page.getByRole('banner').getByRole('link', { name: 'Create free account' })).toHaveCount(0);
      await expect(page.getByTestId('nh-join')).toHaveCount(0);
      await expect(page.getByTestId('nh-final-join')).toHaveCount(0);
    });

    test('each audience’s hero button goes to its own sign-up; the footer call to action goes to /signup', async ({ page }) => {
      for (const [key, tab, href, url] of HERO) {
        await page.goto('/');
        await page.getByRole('tab', { name: tab }).click();
        await expect(page).toHaveURL(new RegExp(`for=${key}`));
        const join = page.getByTestId('nh-join');
        await expect(join).toHaveText('Create free account');
        await expect(join).toHaveAttribute('href', href);
        await noSideScroll(page);
        await join.click();
        await expect(page).toHaveURL(url);
        if (href.startsWith('/signup')) {
          // job seekers and students: the one individual sign-up page (the role is ticked on the next step,
          // individual-account.spec.mjs)
          await expect(page.getByRole('heading', { level: 1, name: 'Create your free Nm7 account' })).toBeVisible();
          await expect(page.getByRole('radio')).toHaveCount(0);
        }
      }
      await page.goto('/signup?role=expert');
      await expect(page.getByRole('heading', { level: 1, name: 'Create your free Nm7 account' })).toBeVisible();

      // the last call to action, above the footer
      await page.goto('/');
      const final = page.getByTestId('nh-final-join');
      await final.scrollIntoViewIfNeeded();
      await expect(final).toBeVisible();
      await expect(final).toHaveText('Create free account');
      await final.click();
      await expect(page).toHaveURL(/\/signup$/);
    });

    test('no Google button while the server has no Google client ID', async ({ page }) => {
      const google = [];
      page.on('request', (r) => { if (r.url().includes('accounts.google.com')) google.push(r.url()); });
      for (const path of ['/signup?role=student', '/login']) {
        const flags = page.waitForResponse((r) => r.url().endsWith('/api/public/site-flags'));
        await page.goto(path);
        expect((await (await flags).json()).googleClientId).toBe('');
        await expect(page.getByLabel('Email')).toBeVisible();
        await expect(page.getByTestId('google-button')).toHaveCount(0);
        await expect(page.getByText(/continue with google/i)).toHaveCount(0);
      }
      expect(google).toEqual([]);
    });

    test('dashboard bar: Auto Apply in the bar while its switch is on, My orders when it is off', async ({ page }) => {
      const mail = email('signupnav-bar');
      seed('customer', mail, 'Kiran Bar', PASSWORD);
      seed('site-autoapply', 'on');
      try {
        await login(page, mail);
        await page.waitForURL(/\/me/);
        await page.goto('/me/resumes');
        const tabs = page.getByRole('navigation', { name: 'My dashboard (tabs)' });
        const side = page.getByRole('navigation', { name: 'My dashboard', exact: true });
        if (label === 'desktop') {
          // desktop: no bottom bar, the side menu is unchanged
          await expect(tabs).toBeHidden();
          await expect(side.getByRole('link', { name: 'My orders' })).toBeVisible();
          await expect(side.getByRole('link', { name: 'Auto Apply' })).toBeVisible();
          return;
        }
        await expect(tabs.getByRole('link')).toHaveText([/Home$/, /Auto Apply$/, /Resumes$/, /Jobs$/]);
        await expect(tabs.getByRole('link', { name: 'Auto Apply' })).toHaveAttribute('href', '/me/auto-apply');
        await noSideScroll(page);
        await tabs.getByRole('button', { name: 'More' }).click();
        let more = page.getByRole('dialog', { name: 'More' });
        await expect(more.getByRole('link', { name: 'My orders' })).toBeVisible();
        await expect(more.getByRole('link', { name: 'Auto Apply' })).toHaveCount(0);
        await more.getByRole('link', { name: 'My orders' }).click();
        await expect(page).toHaveURL(/\/me\/orders$/);
        await tabs.getByRole('link', { name: 'Auto Apply' }).click();
        await expect(page).toHaveURL(/\/me\/auto-apply$/);

        // Admin turns Auto Apply off: the bar is as before, and My orders is not in More twice
        seed('site-autoapply', 'off');
        await page.goto('/me/resumes');
        await expect(tabs.getByRole('link')).toHaveText([/Home$/, /Orders$/, /Resumes$/, /Jobs$/]);
        await tabs.getByRole('button', { name: 'More' }).click();
        more = page.getByRole('dialog', { name: 'More' });
        await expect(more.getByRole('link', { name: 'Auto Apply' })).toBeVisible();
        await expect(more.getByRole('link', { name: 'My orders' })).toHaveCount(0);
      } finally {
        seed('site-autoapply', 'on');
      }
    });
  });
}
