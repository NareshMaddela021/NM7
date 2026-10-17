// The summary writer (Layer A, no network): a note → Make my summary → three cards → pick one → edit → it is saved
// with the draft, and the note is never printed on the resume. Desktop and a 390px phone.
import { expect, test } from '@playwright/test';

async function openSummaryStep(page) {
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await expect(page.getByRole('heading', { name: 'Pick a starting look' })).toBeVisible();
  await page.getByTestId('tp-use-top').click();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await expect(page.getByLabel(/Tell us about yourself/)).toBeVisible();
}

const NOTE = 'Nenu inter chadivanu. 2 samvatsaralu delivery boy ga pani chesanu. Driver job kavali.';

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('note → Make my summary → pick a card → edit → saved with the draft, never printed', async ({ page }) => {
      await openSummaryStep(page);
      const writer = page.getByTestId('summary-writer');
      // the Speak button only when the browser has speech recognition (headless Chromium doesn't)
      const speech = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
      await expect(writer.getByTestId('sw-speak')).toHaveCount(speech ? 1 : 0);
      // a chip starts the note; the note has a 1,000-character limit
      await writer.getByRole('button', { name: 'I have work experience' }).click();
      await expect(page.getByLabel(/Tell us about yourself/)).toHaveValue(/^I have worked as/);
      await page.getByLabel(/Tell us about yourself/).fill(NOTE);
      await expect(page.getByLabel(/Tell us about yourself/)).toHaveAttribute('maxlength', '1000');
      await writer.getByTestId('sw-make').click();
      const cards = writer.getByTestId('sw-cards');
      await expect(cards.getByRole('button', { name: /tap to use/ })).toHaveCount(3);
      await expect(writer.getByTestId('sw-status')).toHaveText('3 suggestions ready. Tap one to use it.');
      const roleFirst = writer.getByTestId('sw-card-role_first');
      const text = (await roleFirst.textContent()).replace(/Role-first · tap to use$/, '').trim();
      // a guest's draft is the sample resume, and the resume's facts win over the note
      expect(text).toMatch(/Data Analyst|Python/);
      expect(text).not.toMatch(/\bI\b|\bmy\b|\{|\[/);
      if (label === 'phone') expect((await roleFirst.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await roleFirst.click();
      const box = page.getByLabel('Your summary');
      await expect(box).toHaveValue(text);
      // quick fixes without AI
      await writer.getByTestId('sw-shorter').click();
      const shorter = await box.inputValue();
      expect(shorter.length).toBeLessThan(text.length);
      await writer.getByTestId('sw-again').click();
      await expect(cards.getByRole('button', { name: /tap to use/ })).toHaveCount(3);
      // edit by hand; the summary is printed, the note is not
      await box.fill(`${shorter} Available to start immediately.`);
      const preview = page.getByRole('article', { name: 'Resume preview' });
      await expect(preview).toContainText('Available to start immediately.');
      await expect(preview).not.toContainText('samvatsaralu');
      // saved with the draft: both survive a reload
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
      await expect(page.getByLabel('Your summary')).toHaveValue(`${shorter} Available to start immediately.`);
      await expect(page.getByLabel(/Tell us about yourself/)).toHaveValue(NOTE);
    });
  });
}

test('an empty note still gives three cards from the resume alone', async ({ page }) => {
  await openSummaryStep(page);
  await page.getByTestId('sw-make').click();
  const cards = page.getByTestId('sw-cards').getByRole('button', { name: /tap to use/ });
  await expect(cards).toHaveCount(3);
  for (const t of await cards.allTextContents()) expect(t).not.toMatch(/\{|\[|undefined/);
});

test('with the resume emptied, the note alone carries the summary (a Telugu-transliterated note)', async ({ page }) => {
  await openSummaryStep(page);
  // switch off the sample's experience, education and skills so only the note is left
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /draft/i.test(x) && localStorage.getItem(x)?.includes('"summary"'));
    const d = JSON.parse(localStorage.getItem(k));
    Object.assign(d, { exp: [], edu: [], certs: [], langs: [], proj: [], ach: [], skillGroups: [], personal: { ...d.personal, headline: '' } });
    localStorage.setItem(k, JSON.stringify(d));
    window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, '');
  });
  await page.reload();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await page.getByLabel(/Tell us about yourself/).fill(NOTE);
  await page.getByTestId('sw-make').click();
  const text = await page.getByTestId('sw-card-role_first').textContent();
  expect(text).toMatch(/driver/i);
  expect(text).toMatch(/2 years/);
  expect(text).not.toMatch(/\bI\b|\bmy\b|\{|\[/);
});
