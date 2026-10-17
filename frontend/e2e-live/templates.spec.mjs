// The builder's template picker: continuing never needs a scroll back to the top. A lower card (scrolled down) is
// picked → the bar at the bottom shows it → "Use" opens the builder with that template; the same from the button
// under the card, by double-click and by Enter. Nothing moves when a card is selected; the bar never covers a card.
import { expect, test } from '@playwright/test';

async function openPicker(page) {
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await expect(page.getByRole('heading', { name: 'Pick a starting look' })).toBeVisible();
}
const cards = (page) => page.locator('[data-testid^="tp-card-"]');
const nameOf = async (card) => (await card.getByRole('radio').getAttribute('aria-label')).replace(/ template$/, '');
const inBuilder = async (page, name) => expect(page.getByText(`Live preview · ${name}`)).toBeVisible();

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('pick a lower card → the bottom bar → Use opens the builder with it; nothing moves; the bar covers nothing', async ({ page }) => {
      await openPicker(page);
      await expect(page.getByTestId('tp-bar')).toHaveCount(0); // not before a pick
      await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
      const first = await Promise.all([0, 1, 2].map((i) => cards(page).nth(i).boundingBox()));
      const card = cards(page).last();
      const name = await nameOf(card);
      await card.scrollIntoViewIfNeeded();
      await card.getByRole('radio').click();
      await expect(card.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
      await expect(card.getByTestId('tp-use-card')).toBeVisible();
      await expect(card.getByTestId('tp-use-card')).toHaveText(new RegExp(`^Use ${name}\\s*$`));
      await expect(cards(page).first().getByTestId('tp-use-card')).toBeHidden(); // only the selected card has one
      const bar = page.getByTestId('tp-bar');
      await expect(bar).toBeVisible();
      await expect(bar).toContainText(name);
      await expect(page.getByTestId('tp-bar-meta')).toHaveText(/^ATS \d+ · [12] columns? · (Freshers|Experienced|Any level)$/);
      await expect(page.getByTestId('tp-announce')).toHaveText(`${name} selected. Use ${name} to continue.`);
      await expect(page.getByRole('button', { name: `Use ${name}` }).first()).toBeVisible(); // the top button names it too
      // no layout shift: the other cards stay where they were
      await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
      await page.waitForFunction(() => window.scrollY === 0);
      const after = await Promise.all([0, 1, 2].map((i) => cards(page).nth(i).boundingBox()));
      after.forEach((b, i) => ['x', 'y', 'width', 'height'].forEach((p) => expect(Math.abs(b[p] - first[i][p]), `card ${i} ${p}`).toBeLessThan(1)));
      // scrolled to the very bottom, the last card ends above the bar
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const lastBox = await card.boundingBox();
      const barBox = await bar.boundingBox();
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barBox.y + 1);
      const use = page.getByTestId('tp-use-bar');
      expect((await use.boundingBox()).height).toBeGreaterThanOrEqual(44);
      if (label === 'phone') expect((await use.boundingBox()).width).toBeGreaterThan(300); // full width on a phone
      await use.click();
      await inBuilder(page, name);
    });

    test('the button under the card, double-click and Enter each use the template straight away', async ({ page }) => {
      await openPicker(page);
      let card = cards(page).nth(5);
      let name = await nameOf(card);
      await card.getByRole('radio').click();
      await card.getByTestId('tp-use-card').click();
      await inBuilder(page, name);

      await openPicker(page);
      card = cards(page).nth(7);
      name = await nameOf(card);
      await card.getByRole('radio').dblclick();
      await inBuilder(page, name);

      await openPicker(page);
      card = cards(page).nth(3);
      name = await nameOf(card);
      await card.getByRole('radio').focus();
      await page.keyboard.press('Enter');
      await inBuilder(page, name);
    });
  });
}
