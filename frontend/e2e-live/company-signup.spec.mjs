// Company sign-up (Phase 2, C1) on a desktop and a 390 px phone, against the real API: step 1 details, step 2 the
// GSTIN check (a typo is caught before sending), step 3 the admin's email code then the company email (on the
// website's domain) code, step 4 invite a team admin and remove one with the in-page confirm, step 5 terms and
// submit; /company then shows Basic, "with our team for review" and the posting allowance. The individual
// recruiter path asks for LinkedIn + a declaration and never for ID numbers. Telugu. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { lastCode, teluguHindi } from './helpers.mjs';

teluguHindi(test); // these tests are about Telugu / Hindi: shown for this file (item 41)

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('5-step company sign-up, then the company account', async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${label}${Date.now().toString(36)}`;
      const site = `acme${tag}.example`;
      const founder = `founder-${tag}@example.com`;
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      await page.goto('/for-companies');
      await expect(page.getByRole('heading', { level: 1, name: 'Hire freshers and experienced talent on Nm7' })).toBeVisible();
      // step 1
      await page.getByLabel('Legal name of the company').fill(`Acme Labs ${tag} Pvt Ltd`);
      await page.getByLabel('Industry').fill('Software');
      await page.getByLabel('About the company').fill('We build analytics tools for retail shops.');
      // fix round item 21: an email service is never the company website
      await page.getByLabel('Company website').fill('gmail.com');
      await page.getByRole('button', { name: 'Next' }).click();
      // re-test N4: the message is under the website field (in view on a phone), tied to it, and the cursor is there
      const siteErr = page.getByTestId('co-site-err');
      await expect(siteErr).toContainText('not an email service like gmail.com');
      await expect(siteErr).toBeInViewport();
      await expect(page.getByLabel('Company website')).toBeFocused();
      await expect(page.getByLabel('Company website')).toHaveAttribute('aria-invalid', 'true');
      expect(await page.getByLabel('Company website').getAttribute('aria-describedby')).toContain('co-site-err');
      await expect(page.locator('.co-error')).toHaveCount(0); // not at the top of the page
      await page.getByLabel('Company website').fill(site);
      await wide();
      await page.getByRole('button', { name: 'Next' }).click();
      // step 2: a typo in the GSTIN is caught at once
      await page.getByLabel('Registration number').fill('27AAPFU0939F1ZW');
      await expect(page.getByTestId('co-reg-check')).toContainText('last character doesn’t match');
      await page.getByLabel('Registration number').fill('27AAPFU0939F1ZV');
      await expect(page.getByTestId('co-reg-check')).toContainText('27AAPFU0939F1ZV looks right');
      // the draft is kept in this browser
      await page.reload();
      await expect(page.getByLabel('Registration number')).toHaveValue('27AAPFU0939F1ZV');
      await page.getByRole('button', { name: 'Next' }).click();
      // step 3: the admin's email, then the company email
      await page.getByLabel('Your full name').fill('Ravi Teja');
      await page.getByLabel('Your email', { exact: true }).fill(founder);
      await page.getByRole('button', { name: 'Email me a code' }).click();
      await expect(page.getByLabel('Code from the email')).toBeVisible();
      await page.getByLabel('Code from the email').fill(lastCode(founder));
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByTestId('co-admin-ok')).toContainText(`${founder} is confirmed`);
      await page.getByLabel('Company email', { exact: true }).fill(`hr@gmail.com`);
      await page.getByRole('button', { name: 'Email me a code' }).click();
      await expect(page.getByRole('alert')).toContainText('company email');
      await page.getByLabel('Company email', { exact: true }).fill(`hr@${site}`);
      await page.getByRole('button', { name: 'Email me a code' }).click();
      await expect(page.getByLabel('Code from the email')).toBeVisible();
      await page.getByLabel('Code from the email').fill(lastCode(`hr@${site}`));
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByTestId('co-company-ok')).toContainText(`hr@${site}`);
      await wide();
      await page.getByRole('button', { name: 'Next' }).click();
      // step 4: invite two, remove one (in-page confirm)
      const team = page.getByTestId('co-step-team');
      await team.getByLabel('Their email').fill(`posts@${site}`);
      await team.getByLabel('What they can do').selectOption('posting');
      await team.getByRole('button', { name: 'Invite' }).click();
      await expect(team.getByTestId('co-member').filter({ hasText: `posts@${site}` })).toContainText('Posting only');
      await team.getByLabel('Their email').fill(`viewer@${site}`);
      await team.getByLabel('What they can do').selectOption('view');
      await team.getByRole('button', { name: 'Invite' }).click();
      const viewer = team.getByTestId('co-member').filter({ hasText: `viewer@${site}` });
      await viewer.getByRole('button', { name: `Remove: viewer@${site}` }).click();
      await viewer.getByRole('alert').getByRole('button', { name: 'Remove' }).click();
      await expect(team.getByTestId('co-member')).toHaveCount(2);
      await wide();
      await page.getByRole('button', { name: 'Next' }).click();
      // step 5
      const review = page.getByTestId('co-step-review');
      await expect(review).toContainText('27AAPFU0939F1ZV');
      await expect(review.getByRole('button', { name: 'Send for review' })).toBeDisabled();
      await review.getByRole('checkbox').check();
      await review.getByRole('button', { name: 'Send for review' }).click();
      await expect(page.getByTestId('co-submitted')).toContainText('Sent for review');
      // the company account
      await page.getByRole('link', { name: 'Open your company account' }).click();
      const card = page.getByTestId('co-card');
      await expect(card.getByTestId('co-trust')).toHaveText('Basic');
      await expect(card.getByTestId('co-review')).toHaveText('With our team for review.');
      await expect(card.getByTestId('co-room')).toHaveText('Jobs this week: 0 of 1.');
      await wide();
      // Telugu
      await page.getByRole('button', { name: 'తెలుగు' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('కంపెనీ ఖాతా');
      await page.getByRole('button', { name: 'English' }).click();
    });

    test('individual recruiter: LinkedIn and a declaration, never ID numbers', async ({ page }) => {
      await page.goto('/for-companies');
      await page.evaluate(() => localStorage.removeItem('nm7-company-signup'));
      await page.reload();
      await page.getByLabel('An individual recruiter (no registered business)').check();
      await expect(page.getByLabel('Company website')).toHaveCount(0);
      await page.getByLabel('Your full name').fill('Priya Sharma');
      await page.getByRole('button', { name: 'Next' }).click();
      const step = page.getByTestId('co-step-registration');
      await expect(step).toContainText('We never ask individual recruiters for Aadhaar, PAN or ID photos');
      await expect(step.getByLabel(/Aadhaar|PAN/)).toHaveCount(0);
      await step.getByLabel('Your LinkedIn profile link').fill('https://www.linkedin.com/in/priya-sharma-hr');
      await step.getByRole('checkbox').check();
      await step.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByTestId('co-step-emails')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
    });
  });
}
