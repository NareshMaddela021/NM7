// Mock interview by voice, on a desktop and a 390 px phone (Android Chrome size), against the real API. The browser's
// speech recognition and speech synthesis are stood in (the test machine has neither):
//   the question is read aloud (English voice; a missing Telugu voice falls back to the text with a note), the answer
//   is spoken with Speak and shows as a transcript, and "Clarity feedback" gives length, speaking pace (words a
//   minute), filler words, structure and result — nothing about emotions; progress is saved; a blocked microphone
//   says so and typing still works.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, seed } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const POST = readFileSync(join(here, 'fixtures', 'job-data-analyst.txt'), 'utf8');
const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const SAID = 'I am a statistics graduate um and I built sales dashboards in Power BI and SQL basically for the sponsors team at college';

/** Fake speech: recognition "hears" window.__say (or fails with window.__micError); synthesis records what it read. */
function fakeSpeech() {
  window.__spoken = [];
  class Rec {
    start() {
      setTimeout(() => {
        if (window.__micError) { this.onerror?.({ error: window.__micError }); return; }
        const alt = { transcript: window.__say || '', confidence: 0.95 };
        const res = Object.assign([alt], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [res] });
      }, 300);
    }
    stop() { setTimeout(() => this.onend?.(), 30); }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = Rec;
  window.webkitSpeechRecognition = Rec;
  const voices = [{ lang: 'en-IN', name: 'English India', default: true }];
  window.SpeechSynthesisUtterance = function U(text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() {},
    speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 20); },
  } });
}

async function setUp(page, who) {
  await page.addInitScript(fakeSpeech);
  const mail = email(who);
  seed('customer', mail, 'Sai Varsha', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await call(page, '/api/me/resumes')).body;
  await call(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: TEST_PERSON, name: 'Main' }) });
  await page.goto('/me/ats');
  await page.getByLabel('Job post', { exact: true }).fill(POST);
  await page.getByTestId('jm-go').click();
  await page.getByTestId('jm-result').getByTestId('jm-interview').click();
  await expect(page).toHaveURL(/\/me\/interview\//);
  await page.getByTestId('iv-make').click();
  await page.getByTestId('iv-practise').click();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('question read aloud, answer by voice, clarity feedback with pace, progress saved', async ({ page }) => {
      await setUp(page, `mv-${label}`);
      const pr = page.getByTestId('iv-practice');
      const question = await pr.getByTestId('iv-practice-q').innerText();
      await pr.getByTestId('iv-read').click();
      await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: question, lang: 'en-IN' });
      // no Telugu voice on this device: the text stays on screen with a note
      await pr.getByTestId('iv-read-lang').selectOption('te-IN');
      await pr.getByTestId('iv-read').click();
      await expect(pr.getByTestId('iv-read-note')).toContainText('no voice for that language');
      // answer by voice: the transcript fills the answer box
      await page.evaluate((s) => { window.__say = s; }, SAID);
      await pr.getByTestId('iv-speak').click();
      await expect(pr.getByTestId('iv-answer')).toHaveValue(new RegExp('statistics graduate'));
      await page.waitForTimeout(3500); // speaking time counts for the pace
      await pr.getByTestId('iv-speak').click();
      await pr.getByTestId('iv-send').click();
      const fb = pr.getByTestId('iv-feedback');
      await expect(fb).toContainText('Clarity feedback');
      await expect(fb).toContainText('Nothing about your feelings or confidence is read from your voice');
      await expect(fb.getByTestId('iv-fb-speaking')).toContainText(/\d+ words a minute/);
      await expect(fb.getByTestId('iv-fb-filler')).toContainText('“um” ×1');
      await expect(fb.getByTestId('iv-fb-length')).toContainText('seconds');
      await expect(fb.getByTestId('iv-better')).not.toContainText(' um ');
      // saved: the question shows as practised after a reload
      await page.reload();
      await expect(page.getByTestId('iv-progress')).toHaveText('1 of 3 practised');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
    });

    test('microphone blocked: it says so and a typed answer still gets feedback (no pace without voice)', async ({ page }) => {
      await setUp(page, `mvb-${label}`);
      await page.evaluate(() => { window.__micError = 'not-allowed'; });
      const pr = page.getByTestId('iv-practice');
      await pr.getByTestId('iv-speak').click();
      await expect(pr.getByTestId('iv-mic-error')).toContainText('Allow microphone in your browser settings');
      await expect(pr.getByTestId('iv-mic-error')).toContainText('You can type your answer instead.');
      await pr.getByTestId('iv-answer').fill('I built sales dashboards in Power BI for the sponsors team at college and the team used them every week.');
      await pr.getByTestId('iv-send').click();
      const fb = pr.getByTestId('iv-feedback');
      await expect(fb).toContainText('Clarity feedback');
      await expect(fb.getByTestId('iv-fb-speaking')).toHaveCount(0);
    });
  });
}
