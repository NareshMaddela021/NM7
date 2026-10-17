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
      await expect(writer.getByTestId('sw-tip')).toBeVisible();
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
      if (label === 'phone') expect(Math.round((await roleFirst.boundingBox()).height)).toBeGreaterThanOrEqual(44);
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

// Speak, with the browser's SpeechRecognition replaced by a fake the test drives: results accumulate within a run
// the way Chrome's do (an interim replaces the last interim, a final is appended), `end()` ends a run.
const FAKE_SPEECH = `
  window.__speech = { instances: [] };
  class FakeRecognition {
    constructor() { this.results = []; this.started = false; window.__speech.instances.push(this); }
    start() { this.started = true; }
    stop() { this.started = false; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.started = false; this.aborted = true; }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.__speech.last = () => window.__speech.instances[window.__speech.instances.length - 1];
  window.__speech.say = (alts, isFinal) => {
    const r = window.__speech.last();
    const result = alts.map(([transcript, confidence]) => ({ transcript, confidence }));
    result.isFinal = isFinal;
    const last = r.results[r.results.length - 1];
    const index = last && !last.isFinal ? r.results.length - 1 : r.results.length;
    r.results[index] = result;
    r.onresult({ resultIndex: index, results: r.results });
  };
  window.__speech.end = () => { const r = window.__speech.last(); r.started = false; r.onend(); };
  window.__speech.error = (code) => window.__speech.last().onerror({ error: code });
`;

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test(`Speak (${label}): keeps listening, shows interim text, appends final words to the typed note, Stop`, async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH);
    await page.setViewportSize(size);
    await openSummaryStep(page);
    const writer = page.getByTestId('summary-writer');
    const noteBox = page.getByLabel(/Tell us about yourself/);
    await noteBox.fill('I am Angelin');
    // the tip and the language picker (full locale codes, English + mixed first)
    await expect(writer.getByTestId('sw-tip')).toHaveText('Tip: you can also use your phone keyboard’s mic 🎤');
    const picker = writer.getByLabel('Speaking language');
    await expect(picker).toHaveValue('en-IN');
    expect(await picker.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]))).toEqual([
      ['en-IN', 'English + mixed'], ['te-IN', 'Telugu'], ['hi-IN', 'Hindi'], ['ta-IN', 'Tamil'], ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'],
    ]);
    await picker.selectOption('te-IN');
    expect(await page.evaluate(() => localStorage.getItem('nm7.speechLang'))).toBe('te-IN');

    const speak = writer.getByTestId('sw-speak');
    if (label === 'phone') expect(Math.round((await speak.boundingBox()).height)).toBeGreaterThanOrEqual(52);
    await speak.click();
    await expect(speak).toHaveText(/Stop/);
    await expect(speak).toHaveAttribute('aria-pressed', 'true');
    await expect(writer.getByTestId('sw-speech-state')).toContainText('Listening');
    await expect(writer.getByTestId('sw-timer')).toHaveText(/^\d:\d\d$/);
    await expect(writer.locator('.pulse-dot')).toBeVisible();
    expect(await page.evaluate(() => { const r = window.__speech.last(); return [r.lang, r.continuous, r.interimResults, r.maxAlternatives, r.started]; })).toEqual(['te-IN', true, true, 3, true]);

    // interim words show in grey and are not in the note yet
    await page.evaluate(() => window.__speech.say([['nenu inter', 0.4]], false));
    await expect(writer.getByTestId('sw-interim')).toHaveText('nenu inter…');
    await expect(noteBox).toHaveValue('I am Angelin');
    // a final result is appended after what was typed, with a full stop, keeping the best alternative
    await page.evaluate(() => window.__speech.say([['nenu inter chadivanu', 0.6], ['nenu inter chadivaanu', 0.9]], true));
    await expect(noteBox).toHaveValue('I am Angelin. Nenu inter chadivaanu');
    await expect(writer.getByTestId('sw-interim')).toHaveCount(0);
    // the browser ends the run after a pause: a new run starts on its own, still listening
    await page.evaluate(() => window.__speech.end());
    await expect.poll(() => page.evaluate(() => window.__speech.instances.length)).toBe(2);
    await expect(speak).toHaveText(/Stop/);
    await page.evaluate(() => window.__speech.say([['driver job kavali', 0.8]], true));
    await expect(noteBox).toHaveValue('I am Angelin. Nenu inter chadivaanu. Driver job kavali');
    // Stop: no more runs, the state says Stopped, typed text is untouched
    await speak.click();
    await expect(speak).toHaveText(/Speak/);
    await expect(writer.getByTestId('sw-speech-state')).toContainText('Stopped');
    expect(await page.evaluate(() => window.__speech.instances.length)).toBe(2);
    await expect(noteBox).toHaveValue('I am Angelin. Nenu inter chadivaanu. Driver job kavali');
    // the language choice survives a reload
    await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
    await page.reload();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
    await expect(page.getByLabel('Speaking language')).toHaveValue('te-IN');
    // a blocked microphone gets a plain message
    await page.getByTestId('sw-speak').click();
    await page.evaluate(() => { window.__speech.error('not-allowed'); window.__speech.end(); });
    await expect(page.getByTestId('sw-speech-error')).toHaveText('Allow microphone in your browser settings');
    await expect(page.getByTestId('sw-speak')).toHaveText(/Speak/);
  });
}

test('without speech recognition the Speak button is gone and the keyboard tip stays', async ({ page }) => {
  await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await openSummaryStep(page);
  const writer = page.getByTestId('summary-writer');
  await expect(writer.getByTestId('sw-speak')).toHaveCount(0);
  await expect(writer.getByTestId('sw-tip')).toBeVisible();
});
