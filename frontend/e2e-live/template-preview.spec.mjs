// Opening a template never makes a file: a card tap shows it large, "Use this template" opens the builder with it.
// Checked signed out and signed in, on a desktop and a 390 px phone, from the home gallery and from the builder's
// template cards — and after a guest's "download after sign-in" was left unfinished (the bug: the builder used to
// start that old download the next time it opened, e.g. from a template card). Any download event fails the test.
import { expect, test } from '@playwright/test';
import { PASSWORD, asTestPerson, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];

/** Fails the test on any download, the moment it starts. */
function noDownloads(page) {
  const seen = [];
  page.on('download', (d) => seen.push(`${d.suggestedFilename()} at ${page.url()}`));
  return { check: () => expect(seen, 'no download may start').toEqual([]) };
}
const preview = (page) => page.getByRole('dialog', { name: /template preview$/ });

async function signIn(page) {
  const mail = email('tpl');
  seed('customer', mail, 'Tara Preview', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
}

for (const [label, size] of SIZES) {
  for (const signedIn of [false, true]) {
    test.describe(`${label} · ${signedIn ? 'signed in' : 'signed out'}`, () => {
      test.use({ viewport: size });

      test('home gallery: a card tap shows the large preview, Use this template opens the builder — no download', async ({ page }) => {
        const dl = noDownloads(page);
        if (signedIn) await signIn(page);
        await page.goto('/#templates');
        const cards = page.locator('#templates').getByRole('button', { name: /^Preview the .* template$/ });
        await expect(cards).toHaveCount(6);
        for (const i of [0, 1]) {
          await cards.nth(i).scrollIntoViewIfNeeded();
          await cards.nth(i).click();
          await expect(preview(page)).toBeVisible();
          await expect(preview(page).getByTestId('template-preview')).toContainText(/\w/);
          await page.waitForTimeout(800); // time for anything that would start a download
          await preview(page).getByRole('button', { name: 'Close' }).last().click();
          await expect(preview(page)).toHaveCount(0);
        }
        const name = (await cards.nth(2).getAttribute('aria-label')).replace(/^Preview the | template$/g, '');
        await cards.nth(2).click();
        await preview(page).getByRole('button', { name: 'Use this template' }).click();
        await expect(page).toHaveURL(/\/builder$/);
        await expect(page.getByText(`Live preview · ${name}`)).toBeVisible();
        await page.waitForTimeout(1500);
        dl.check();
      });

      test('builder template cards: Preview shows it large, Use this template applies it — no download', async ({ page }) => {
        const dl = noDownloads(page);
        if (signedIn) await signIn(page);
        await page.goto('/builder?start=templates');
        await expect(page.getByRole('heading', { name: 'Pick a starting look' })).toBeVisible();
        const card = page.locator('[data-testid^="tp-card-"]').nth(4);
        const name = (await card.getByRole('radio').getAttribute('aria-label')).replace(/ template$/, '');
        await card.getByRole('button', { name: `Preview ${name}` }).click();
        await expect(preview(page)).toBeVisible();
        await expect(preview(page)).toContainText(name);
        await page.waitForTimeout(800);
        await preview(page).getByRole('button', { name: 'Use this template' }).click();
        await expect(page.getByText(`Live preview · ${name}`)).toBeVisible();
        await page.waitForTimeout(1500);
        dl.check();
      });
    });
  }

  test(`${label}: a guest's unfinished "download after sign-in" never starts later from a template card`, async ({ page }) => {
    await page.setViewportSize(size);
    await asTestPerson(page); // a guest with a name (download needs one)
    const dl = noDownloads(page);
    // a guest taps Download, picks "Sign in" in the pop-up, then leaves the sign-in page without signing in
    await page.goto('/builder');
    await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
    await page.reload();
    await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
    await page.getByRole('button', { name: 'I already have an account - Sign in' }).click();
    await page.waitForURL(/\/login/);
    await page.getByRole('link', { name: / home$/ }).first().click(); // the logo: back to the home page
    await expect(page).toHaveURL(/\/$/);
    // later they sign in from the header, then open a template from the gallery
    await signIn(page);
    await page.goto('/#templates');
    const card = page.locator('#templates').getByRole('button', { name: /^Preview the .* template$/ }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await preview(page).getByRole('button', { name: 'Use this template' }).click();
    await expect(page).toHaveURL(/\/builder$/);
    await expect(page.getByText(/^Live preview · /)).toBeVisible();
    await page.waitForTimeout(3000);
    dl.check();
  });
}
