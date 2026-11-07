// Jobs made simple (Phase 4, E6) on a desktop and a 390 px phone, against the real API: the top 3 as big cards (match
// with one plain reason, ₹ a month, the company's trust badge, 🔊), Save, Apply (consent tick + the company's question),
// "Let Nm7 apply for me" (role, city, a day, consent), then after the morning run: the question one per screen,
// answered by tap, and "Apply on their website" opening the company's site. No browser dialogs, no sideways scrolling.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';
const fakeVoices = () => {
  window.__spoken = [];
  const synth = { getVoices: () => [{ lang: 'en-IN', name: 'en' }], speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 5); }, cancel() {}, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function Utterance(text) { this.text = text; };
};
const axe = async (page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
  .filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('top 3 cards, save, apply, let Nm7 apply, answer, apply on their site', async ({ page, request, context }) => {
      test.setTimeout(200_000);
      const tag = `${label}j${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag, 'Simpleco');
      await co.post(`Data Analyst ${tag}`, { questions: [{ text: 'Notice period in days?', kind: 'number' }], salary: { min: 300000, max: 420000, period: 'yearly' } });
      const job = (body) => seed('job', JSON.stringify({ description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...body }));
      job({ title: `Site Analyst ${tag}`, company: { name: `Siteco ${tag}` }, applyMethod: 'link', applyUrl: `https://site${tag}.example/careers` });
      job({ title: `Shop Analyst ${tag}`, company: { name: `Shopco ${tag}` }, applyMethod: 'link', applyUrl: `https://shop${tag}.example/jobs` });
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.addInitScript(fakeVoices);
      const me = await studentWith(page, label, STRONG, 'sjobs');
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'en', mode: 'simple' }))).status).toBe(200);
      await page.goto('/me/simple');
      await page.getByTestId('sx-tile-jobs').click();
      await expect(page).toHaveURL(/\/me\/simple\/jobs$/);
      const cards = page.getByTestId('sx-job');
      await expect(cards).toHaveCount(3);
      const card = cards.filter({ hasText: `Data Analyst ${tag}` });
      await expect(card.getByTestId('sx-job-reason')).toContainText('You know SQL, Power BI');
      await expect(card.getByTestId('sx-job-salary')).toContainText('₹25,000–35,000 a month');
      await expect(card.getByTestId('sx-job-trust')).toContainText('Verified company');
      await expect(card.getByTestId('sx-job-match')).toHaveText(/\d+% match/);
      await card.getByTestId('sx-job-say').click();
      await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toContain(`Data Analyst ${tag}. Simpleco ${tag} Pvt Ltd.`);
      expect(await noSideScroll(page)).toBe(true);
      expect(await axe(page)).toEqual([]);
      // Save
      await card.getByTestId('sx-job-save').click();
      await expect(card.getByTestId('sx-job-save')).toHaveAttribute('aria-pressed', 'true');
      // Apply: the company's question and the consent tick
      await card.getByTestId('sx-job-apply').click();
      await expect(page.getByTestId('sx-apply')).toBeVisible();
      const send = page.getByTestId('sx-send');
      await expect(send).toBeDisabled();
      await page.getByTestId('sx-q-q1').fill('30');
      await expect(send).toBeDisabled();
      await page.getByTestId('sx-consent').check();
      await send.click();
      await expect(page.getByTestId('sx-applied')).toContainText('Done');
      expect(await axe(page)).toEqual([]);
      // Let Nm7 apply for me
      await page.goto('/me/simple/jobs');
      await page.getByTestId('sx-let-nm7').click();
      await page.getByTestId('sx-auto-role').fill(`Analyst ${tag}`);
      await page.getByTestId('sx-auto-city').fill('Hyderabad');
      await page.getByTestId('sx-limit-3').click();
      await expect(page.getByTestId('sx-auto-on')).toBeDisabled(); // the consent tick first
      await page.getByTestId('sx-auto-consent').check();
      await page.getByTestId('sx-auto-on').click();
      await expect(page).toHaveURL(/\/me\/simple\/jobs$/);
      await expect(page.getByText('Nm7 is applying for you every morning.')).toBeVisible();
      // the morning run: a company question waiting, the other two on their own sites
      await co.post(`Field Analyst ${tag}`, { questions: [{ text: 'Do you have a two-wheeler?', kind: 'yesno' }] });
      seed('auto-apply-run', me, 'past');
      await page.goto('/me/simple');
      await expect(page.getByTestId('sx-next')).toHaveAttribute('data-key', 'answer');
      await page.getByTestId('sx-next-go').click();
      await expect(page).toHaveURL(/\/me\/simple\/answers$/);
      const item = page.getByTestId('sx-answer-item');
      await expect(item).toContainText(`Field Analyst ${tag}`);
      await expect(item).toContainText('Do you have a two-wheeler?');
      expect(await axe(page)).toEqual([]);
      await page.getByTestId('sx-q-q1-yes').click();
      await page.getByTestId('sx-answer-send').click();
      await expect(page.getByTestId('sx-answers-none')).toBeVisible();
      // Apply on their website: one tap opens it and saves it
      await page.goto('/me/simple/jobs');
      await page.getByTestId('sx-to-outside').click();
      await context.route(`https://site${tag}.example/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Careers</h1>' }));
      const site = page.getByTestId('sx-outside-item').filter({ hasText: `Site Analyst ${tag}` });
      const [tab] = await Promise.all([context.waitForEvent('page'), site.getByTestId('sx-outside-open').click()]);
      await expect(tab).toHaveURL(`https://site${tag}.example/careers`);
      await tab.close();
      await expect(page.getByTestId('sx-outside-item').filter({ hasText: `Site Analyst ${tag}` })).toHaveCount(0);
      const apps = (await call(page, '/api/me/state')).body.apps;
      expect(apps.map((a) => a.role)).toEqual(expect.arrayContaining([`Data Analyst ${tag}`, `Site Analyst ${tag}`]));
    });
  });
}
