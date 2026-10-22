// Templates are look-only: switching through all 18 templates in the builder changes fonts, colours and columns,
// never which sections show, their order, titles, the photo switch or any content. A template that usually shows a
// section that is off only suggests it ("Turn it on?"), and nothing changes until Turn on. Desktop + 390 px phone.
import { expect, test } from '@playwright/test';
import { asTestPerson } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const DRAFT = 'asuraa-builder-draft-v6';
// everything but the look
const content = (page) => page.evaluate((k) => { const d = JSON.parse(localStorage.getItem(k)); delete d.design; return d; }, DRAFT);
const savedPreset = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).design?.preset, DRAFT);

async function openDesign(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
  await page.getByRole('tab', { name: /^Design/ }).click();
  const group = page.locator('section.card').filter({ has: page.getByRole('button', { name: /^Template[−+]?$/ }) });
  const buttons = group.locator('button.option');
  await expect(buttons).toHaveCount(18);
  return buttons;
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });
    // Projects, Skills, Certifications… on; Hobbies, Strengths, Personal information, Declaration off (the usual start)
    test.beforeEach(({ page }) => asTestPerson(page, { hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, showPhoto: false }));

    test('switching through all 18 templates keeps every section switch, the order and all content', async ({ page }) => {
      const buttons = await openDesign(page);
      const before = await content(page);
      const live = page.getByRole('region', { name: 'Live resume preview' });
      for (let i = 0; i < 18; i += 1) {
        const b = buttons.nth(i);
        const name = (await b.locator('strong').innerText()).trim();
        await b.click();
        await expect(page.getByText(`Live preview · ${name}`)).toBeVisible();
        await expect.poll(() => content(page), { message: `after ${name}` }).toEqual(before);
        await expect(live).toContainText('Northwind Retail'); // content still printed
        await expect(live).toContainText('Sales Dashboard Revamp'); // Projects still on (Kio and Work-first used to switch it off)
        await expect(live).not.toContainText('R. Raman'); // personal information still off (Kio and Formal used to switch it on)
      }
      expect(await savedPreset(page)).toBeTruthy();
      expect(await content(page)).toEqual(before);
    });

    test('Kio only suggests its usual sections: No thanks changes nothing, Turn on switches them on', async ({ page }) => {
      const buttons = await openDesign(page);
      const before = await content(page);
      const kio = buttons.filter({ has: page.locator('strong', { hasText: /^Kio/ }) }).first();
      await kio.click();
      const hint = page.getByTestId('template-hint');
      await expect(hint).toContainText('This template usually shows Hobbies, Strengths, Personal information and Declaration. Turn them on?');
      await hint.getByRole('button', { name: 'No thanks' }).click();
      await expect(hint).toHaveCount(0);
      expect(await content(page)).toEqual(before);
      // Formal: Personal information and Declaration; Turn on switches exactly those on
      await buttons.filter({ has: page.locator('strong', { hasText: /^Formal/ }) }).first().click();
      await expect(hint).toContainText('This template usually shows Personal information and Declaration. Turn them on?');
      await hint.getByRole('button', { name: 'Turn on' }).click();
      await expect.poll(async () => (await content(page)).hidden).toEqual({ ...before.hidden, pinfo: false, decl: false });
      const after = await content(page);
      expect({ ...after, hidden: before.hidden }).toEqual(before); // nothing else changed
      await expect(page.getByRole('region', { name: 'Live resume preview' })).toContainText('K. Rao');
    });
  });
}
