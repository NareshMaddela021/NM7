// One Nm7 account for job seekers, students and experts, on a desktop and a 390 px phone, against the real API:
//   - sign up on the one individual page (no tabs, one tick) → "What would you like to do?" (the role from the link
//     ticked already) → the chosen role's setup; then "Switch to: …" in the account menu opens each role's own dashboard;
//   - an older account adds another role (expert): the expert application opens, and no paid work before approval;
//   - old sign-up links (the tabs ?as=expert, ?as=customer, and /signup/expert by path) come to the new page with the role kept;
//   - the page names hiring / companies / colleges only in its footer link; company, college and admin sign-up and
//     sign-in pages are their own, as before; nothing scrolls sideways on the phone.
// Desktop and phone share one database: every test uses its own people.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, lastCode, login, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';

const ORG_LINK = 'Hiring or placements? Go to Nm7 for companies / colleges';

async function signUpOnPage(page, mail, name) {
  await expect(page.getByRole('heading', { level: 1, name: 'Create your free Nm7 account' })).toBeVisible();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Re-type password').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(lastCode(mail));
  await page.getByRole('button', { name: 'Confirm & continue' }).click();
  await page.waitForURL(/\/welcome/);
  await expect(page.getByRole('heading', { level: 1, name: 'What would you like to do?' })).toBeVisible();
}
const menu = (page, name) => page.getByRole('button', { name: `Account menu: ${name}` });
async function switchTo(page, name, role) {
  await menu(page, name).click();
  await page.getByTestId('account-roles').getByRole('menuitem', { name: role, exact: true }).click();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('sign up → pick roles → the right dashboard; switch roles from the account menu', async ({ page }) => {
      const mail = email(`indiv-${label}`);
      const name = `Asha ${label === 'phone' ? 'Phone' : 'Desk'}`;
      await page.goto('/signup?role=student');
      // one simple page: no tabs, one consent tick, Google on top only once its client ID is set
      await expect(page.getByRole('radiogroup')).toHaveCount(0);
      await expect(page.getByText('Get my resume done')).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(2); // show passwords + the one tick
      await expect(page.getByText('Find jobs, build your career, or work as an expert, all in one account.')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      // no hiring / company / college words except the footer link
      const words = (await page.locator('body').innerText()).replace(ORG_LINK, '');
      expect(words).not.toMatch(/hir(e|ing)|compan|college|placement|recruit/i);
      await expect(page.getByRole('link', { name: ORG_LINK })).toHaveAttribute('href', '/for-orgs');

      await signUpOnPage(page, mail, name);
      expect(await noSideScroll(page)).toBe(true);
      const student = page.getByRole('checkbox', { name: /I’m a student/ });
      await expect(student).toBeChecked(); // from the link
      await expect(page.getByRole('checkbox', { name: /Find a job/ })).not.toBeChecked();
      await page.getByRole('checkbox', { name: /Find a job/ }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL('**/me/roles'); // student setup: the role finder
      await expect(page.getByRole('heading', { level: 1, name: 'Find my role' })).toBeVisible();
      const me = (await call(page, '/api/auth/me')).body;
      expect(me.roles).toEqual(['jobseeker', 'student']);
      expect(me.activeRole).toBe('student');
      expect(me.rolesPending).toBe(false);

      // the account menu: switch to the job seeker dashboard and back to the student one
      await switchTo(page, name, 'Job seeker');
      await page.waitForURL(/\/me$/);
      await expect(page.getByRole('heading', { level: 1, name: /^Hi Asha/ })).toBeVisible();
      await menu(page, name).click();
      await expect(page.getByTestId('account-roles')).toContainText('Now: Job seeker');
      await page.getByTestId('account-roles').getByRole('menuitem', { name: 'Student', exact: true }).click();
      await page.waitForURL('**/me/learn');
      await expect(page.getByRole('heading', { level: 1, name: 'Learning paths' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      // signing in again opens the last role's dashboard
      await page.context().clearCookies();
      await login(page, mail);
      await page.waitForURL('**/me/learn');
    });

    test('an older account adds the expert role; no paid work before approval', async ({ page }) => {
      const mail = email(`older-${label}`);
      const name = `Ravi ${label === 'phone' ? 'Phone' : 'Desk'}`;
      seed('customer', mail, name, PASSWORD); // made before roles existed
      await login(page, mail);
      await page.waitForURL(/\/me$/);
      expect((await call(page, '/api/auth/me')).body.roles).toEqual(['jobseeker']);
      await menu(page, name).click();
      await expect(page.getByTestId('account-roles').getByText('Switch to:')).toHaveCount(0); // one role: nothing to switch
      await page.getByRole('menuitem', { name: 'Add another role' }).click();
      await page.waitForURL('**/welcome?add=1');
      await expect(page.getByRole('heading', { level: 1, name: 'Add another role' })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Find a job/ })).toBeDisabled(); // already theirs
      await page.getByRole('checkbox', { name: /Work as an expert/ }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('alert')).toContainText('Expert Terms');
      await page.getByRole('checkbox', { name: /I agree to the Expert Terms/ }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL('**/expert/profile'); // the expert application
      expect(await noSideScroll(page)).toBe(true);
      const me = (await call(page, '/api/auth/me')).body;
      expect(me).toMatchObject({ roles: ['jobseeker', 'expert'], activeRole: 'expert', role: 'expert', expertStatus: 'draft' });

      // the gate: paid-work pages send an unapproved expert back to the application; no orders reach them
      await page.goto('/expert/orders');
      await page.waitForURL('**/expert/profile');
      expect((await call(page, '/api/work')).body).toEqual([]);

      // back to the job seeker dashboard; a job seeker link switches roles by itself
      await switchTo(page, name, 'Job seeker');
      await page.waitForURL(/\/me$/);
      await switchTo(page, name, 'Expert');
      await page.waitForURL('**/expert/profile');
      await page.goto('/me/resumes');
      await page.waitForURL('**/me/resumes');
      await expect(page.getByRole('heading', { level: 1, name: 'My resumes' })).toBeVisible();
      expect((await call(page, '/api/auth/me')).body.activeRole).toBe('jobseeker');
    });

    test('old sign-up links come to the new page with the role kept', async ({ page }) => {
      for (const [from, role] of [['/signup?as=expert', 'expert'], ['/signup/expert', 'expert'], ['/signup?as=customer', 'jobseeker'], ['/signup/student', 'student']]) {
        await page.goto(from);
        await page.waitForURL(`**/signup?role=${role}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Create your free Nm7 account' })).toBeVisible();
      }
      // the role survives the email code: the picker has it ticked
      const mail = email(`oldlink-${label}`);
      await page.goto('/signup?as=expert');
      await page.waitForURL('**/signup?role=expert');
      await signUpOnPage(page, mail, 'Kiran Old');
      await expect(page.getByRole('checkbox', { name: /Work as an expert/ })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: /I agree to the Expert Terms/ })).toBeVisible();
      // signed in, a role link offers to add that role
      await page.goto('/signup?role=student');
      await page.waitForURL('**/welcome?add=1&role=student');
    });

    test('companies, colleges and admins keep their own sign-up and sign-in', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('link', { name: ORG_LINK })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await page.goto('/signup');
      await page.getByRole('link', { name: ORG_LINK }).click();
      await page.waitForURL('**/for-orgs');
      await expect(page.getByRole('heading', { level: 1, name: 'Every student’s resume, ready for placements' })).toBeVisible();
      await page.goto('/for-companies');
      await expect(page.getByRole('heading', { level: 1, name: 'Hire freshers and experienced talent on Nm7' })).toBeVisible();
      await expect(page.getByLabel('Legal name of the company')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await page.goto('/admin/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Admin sign in' })).toBeVisible();
      await expect(page.getByLabel('Work email')).toBeVisible();
      await expect(page.getByText(/authenticator/).first()).toBeVisible();
    });
  });
}
