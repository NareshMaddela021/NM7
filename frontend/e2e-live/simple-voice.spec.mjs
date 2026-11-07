// Voice on the Easy dashboard (Phase 4, E3) on a desktop and a 390 px phone, against the real API, with the phone's
// voices mocked: 🔊 reads the screen in Telugu when there is a Telugu voice, the same words in English when there
// isn't, and says "Voice not available on this phone" when there is no voice at all; "Read screens aloud
// automatically" (off by default) reads each screen as it opens, and is kept on the profile.
import { expect, test } from '@playwright/test';
import { SIZES } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

const fakeVoices = () => {
  window.__voices = ['en-IN', 'te-IN'];
  window.__spoken = [];
  const synth = {
    getVoices: () => window.__voices.map((l) => ({ lang: l, name: `Voice ${l}` })),
    speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 5); },
    cancel() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  window.SpeechSynthesisUtterance = function Utterance(text) { this.text = text; };
};
const spoken = (page) => page.evaluate(() => window.__spoken);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('read aloud in Telugu, English fallback, no voice, auto read', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.addInitScript(fakeVoices);
      await studentWith(page, label, { ...STRONG, skillGroups: [] }, 'voice');
      await page.goto('/me/simple');
      await page.getByTestId('sx-hear-hi').click(); // the language names, each in its own voice
      await expect.poll(async () => (await spoken(page)).at(-1)).toEqual({ text: 'Hindi', lang: 'en-IN' }); // no Hindi voice here: its English name
      await page.getByTestId('sx-hear-te').click();
      await expect.poll(async () => (await spoken(page)).at(-1)).toEqual({ text: 'తెలుగు', lang: 'te-IN' });
      await page.getByTestId('sx-pick-te').click();
      await expect(page.getByTestId('sx-next')).toContainText('మీ నైపుణ్యాలు చేర్చండి');
      // a Telugu voice: the screen in Telugu
      await page.getByTestId('sx-read-screen').click();
      await expect.poll(async () => (await spoken(page)).at(-1)?.lang).toBe('te-IN');
      expect((await spoken(page)).at(-1).text).toContain('నమస్తే Asha. మీ తదుపరి అడుగు. మీ నైపుణ్యాలు చేర్చండి.');
      // no Telugu voice: the same words in English, with a note
      await page.evaluate(() => { window.__voices = ['en-IN']; });
      await page.getByTestId('sx-next-say').click();
      await expect.poll(async () => (await spoken(page)).at(-1)?.lang).toBe('en-IN');
      expect((await spoken(page)).at(-1).text).toBe('Your next step. Add your skills. Pick the things you can do. Add my skills.');
      await expect(page.getByTestId('sx-next-say-note')).toHaveText('మీ భాష వాయిస్ ఈ ఫోన్‌లో లేదు, అందుకే ఇంగ్లీష్‌లో చదివాం.');
      // no voice at all: a note, no error
      await page.evaluate(() => { window.speechSynthesis = undefined; });
      await page.getByTestId('sx-read-screen').click();
      await expect(page.getByTestId('sx-read-screen-note')).toHaveText('ఈ ఫోన్‌లో వాయిస్ అందుబాటులో లేదు');
      // "Read screens aloud automatically": off by default, then each screen reads itself
      await page.reload();
      await page.getByTestId('sx-more').click();
      const auto = page.getByTestId('sx-autoread');
      await expect(auto).toHaveAttribute('aria-checked', 'false');
      expect((await spoken(page)).length).toBe(0);
      await auto.click();
      await expect(auto).toHaveAttribute('aria-checked', 'true');
      await expect.poll(async () => (await spoken(page)).at(-1)?.text).toBe('ఇంకా. మిగతావన్నీ పూర్తి డాష్‌బోర్డ్‌లో ఉన్నాయి.');
      await page.getByRole('link', { name: 'వెనక్కి' }).click();
      await expect.poll(async () => (await spoken(page)).at(-1)?.text).toContain('నమస్తే Asha.');
      await page.reload(); // kept on the profile
      await expect.poll(async () => (await spoken(page)).at(-1)?.text).toContain('నమస్తే Asha.');
    });
  });
}
