// The live preview's "My resume | Sample" switch, on a desktop and a 390 px phone. My resume shows only what the
// person typed (grey hints where nothing is typed yet, updated as they type; empty sections not printed). Sample
// shows the example person in the chosen template, read-only and never saved. A download always makes the person's
// own resume (from Sample it switches back and says so), and needs a name.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, pdfText, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const live = (page) => page.getByRole('region', { name: 'Live resume preview' });
const show = (page, name) => page.getByRole('group', { name: 'Preview shows' }).getByRole('button', { name });
const SAMPLE = ['Sai Varsha', 'Lakeview', 'Northwind', 'sai-varsha-example', 'R. Raman'];

async function openBuilder(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('My resume: grey hints on a new resume, typing shows instantly, empty sections are not printed; no name, no download', async ({ page }) => {
      await openBuilder(page);
      await expect(show(page, 'My resume')).toHaveAttribute('aria-pressed', 'true'); // the default
      const hints = live(page).getByTestId('hint');
      await expect(hints.filter({ hasText: 'Your name' })).toBeVisible();
      await expect(hints.filter({ hasText: 'Add your first job' })).toBeVisible();
      for (const t of SAMPLE) await expect(live(page)).not.toContainText(t);
      await expect(live(page)).not.toContainText('Projects'); // empty sections are not printed
      await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
      await expect(page.getByTestId('need-name')).toHaveText('Add your name to download');

      await page.getByLabel('Full name').pressSequentially('Meena R');
      await expect(live(page)).toContainText('Meena R', { timeout: 500 }); // instantly, no save needed
      await expect(hints.filter({ hasText: 'Your name' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
      await expect(page.getByTestId('need-name')).toHaveCount(0);
    });

    test('Sample: the example person in this template, read-only and never saved; Back to my resume', async ({ page }) => {
      await openBuilder(page);
      await page.getByLabel('Full name').fill('Meena R');
      await expect.poll(() => page.evaluate(() => localStorage.getItem('asuraa-builder-draft-v6') || '')).toContain('Meena R');
      const before = await page.evaluate(() => localStorage.getItem('asuraa-builder-draft-v6'));
      await show(page, 'Sample').click();
      const view = page.getByTestId('sample-view');
      await expect(view).toContainText('Sample: how this template looks when filled');
      await expect(view).toContainText('Sai Varsha');
      await expect(view.locator('input, textarea')).toHaveCount(0); // read-only
      await page.waitForTimeout(1200); // longer than the autosave wait
      expect(await page.evaluate(() => localStorage.getItem('asuraa-builder-draft-v6'))).toBe(before); // never saved
      await expect(page.getByLabel('Full name')).toHaveValue('Meena R');
      await view.getByRole('button', { name: 'Back to my resume' }).click();
      await expect(show(page, 'My resume')).toHaveAttribute('aria-pressed', 'true');
      await expect(live(page)).toContainText('Meena R');
      await expect(live(page)).not.toContainText('Sai Varsha');
    });
  });
}

test('Download from the Sample view makes the person’s own resume and says so; the server never gets the sample', async ({ page }) => {
  const mail = email('pv');
  seed('customer', mail, 'Kiran Babu', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await openBuilder(page);
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
  await page.getByLabel('Headline').fill('Accounts Assistant');
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
  await show(page, 'Sample').click();
  await expect(page.getByTestId('sample-view')).toContainText('Sai Varsha');
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download PDF' }).click()]);
  await expect(page.getByText('Downloading your resume, not the sample')).toBeVisible();
  await expect(show(page, 'My resume')).toHaveAttribute('aria-pressed', 'true');
  expect(file.suggestedFilename()).toBe('Kiran_Babu_Resume.pdf');
  const text = (await pdfText(await (await file.createReadStream()).toArray().then(Buffer.concat))).join(' ');
  expect(text).toContain('Kiran Babu');
  expect(text).toContain('Accounts Assistant');
  for (const t of SAMPLE) expect(text).not.toContain(t);
  const resumes = await page.evaluate(async (base) => (await fetch(`${base}/api/me/resumes`, { credentials: 'include' })).json(), API);
  for (const t of SAMPLE) expect(JSON.stringify(resumes)).not.toContain(t);
});
