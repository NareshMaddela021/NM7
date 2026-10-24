// Cover letter from the match screen (Phase 2) on a desktop and a 390 px phone, against the real API (payments Off,
// no AI key): lengths and tones, [Hiring Manager] with a reminder, facts from the resume marked, copy as email with
// a subject line, a cold message under 300 characters, 1 free letter a day then the Tailor pack (Coming soon), an
// admin grant unlocks more, letters are saved with the job and can be deleted.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, adminLogin, email, login, seed } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const POST = readFileSync(join(here, 'fixtures', 'job-data-analyst.txt'), 'utf8');
const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const RESUME = { ...structuredClone(TEST_PERSON), proj: [{ ...TEST_PERSON.proj[0], description: 'made sales dashboards in power bi and sql for the sponsors team' }] };

async function signIn(page, who) {
  const mail = email(who);
  seed('customer', mail, 'Sai Varsha', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await call(page, '/api/me/resumes')).body;
  await call(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME, name: 'Main' }) });
  return (await call(page, '/api/auth/me')).body.id;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('write a cover letter: [Hiring Manager] reminder, marked facts, email + subject, cold message, 1 free then grant', async ({ page, browser, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const uid = await signIn(page, `jc-${label}`);
      await page.goto('/me/ats');
      await page.getByLabel('Job post', { exact: true }).fill(POST);
      await page.getByTestId('jm-go').click();
      const jc = page.getByTestId('jm-result').getByTestId('jc');
      await expect(jc.getByTestId('jc-left')).toHaveText('1 free cover letter left today');
      await jc.getByLabel('Length').selectOption('standard');
      await jc.getByLabel('Tone').selectOption('fresher');
      await jc.getByTestId('jc-go').click();
      const letter = jc.getByTestId('jc-letter');
      await expect(letter.getByTestId('jc-body')).toContainText('Dear [Hiring Manager],');
      await expect(letter.getByTestId('jc-body')).toContainText('I am writing to apply for the Data Analyst role at Brightpath Analytics');
      await expect(letter.getByTestId('jc-reminder')).toContainText('[Hiring Manager]');
      expect(await letter.locator('mark.fact').count()).toBeGreaterThan(0);
      await expect(letter.getByText('Written from your resume')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width); // no sideways scroll
      // the cold message is under 300 characters
      const cold = await letter.getByTestId('jc-cold').locator('span.small').innerText();
      expect(cold.length).toBeGreaterThan(20);
      expect(cold.length).toBeLessThanOrEqual(300);
      // copy as email: subject line, greeting, letter, sign-off
      await letter.getByTestId('jc-copy-email').click();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toMatch(/^Subject: Application for Data Analyst - Sai Varsha\n\nDear \[Hiring Manager\],\n\n/);
      // one free letter a day: the button is off and the Tailor pack is Coming soon (payments Off)
      await expect(jc.getByTestId('jc-left')).toHaveText('You’ve used today’s free cover letter');
      await expect(jc.getByTestId('jc-go')).toBeDisabled();
      await expect(jc.getByTestId('pack-tailor-soon')).toHaveText('Coming soon');
      const m = (await call(page, '/api/me/jobs/matches')).body[0];
      expect((await call(page, `/api/me/jobs/matches/${m.id}/cover`, { method: 'POST', body: '{}' })).status).toBe(402);

      // an admin grant unlocks more letters; a known manager's name replaces the placeholder
      const ctx = await browser.newContext();
      const o = await ctx.newPage();
      const mail = `owner-jc-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      await adminLogin(o, mail, secret);
      await expect(o).not.toHaveURL(/\/login/);
      expect((await call(o, `/api/admin/customers/${uid}/job-pack`, { method: 'POST', body: JSON.stringify({ feature: 'tailor', granted: true }) })).status).toBeLessThan(300);
      await ctx.close();

      await page.goto('/me/ats');
      await page.getByTestId('jm-history').getByRole('button', { name: /Brightpath Analytics/ }).click();
      const jc2 = page.getByTestId('jm-result').getByTestId('jc');
      await expect(jc2.getByTestId('jc-left')).toHaveText('Unlimited letters with your Tailor pack');
      await expect(jc2.getByTestId('jc-saved').getByRole('listitem')).toHaveCount(1); // the first letter was saved with the job
      await jc2.getByLabel('Length').selectOption('short');
      await jc2.getByLabel('Tone').selectOption('switch');
      await jc2.getByLabel('Hiring manager’s name (if you know it)').fill('Priya Menon');
      await jc2.getByTestId('jc-go').click();
      await expect(jc2.getByTestId('jc-body')).toContainText('Dear Priya Menon,');
      await expect(jc2.getByTestId('jc-reminder')).toHaveCount(0);
      await expect(jc2.getByTestId('jc-cold')).toContainText('Hi Priya');
      const words = Number((await jc2.getByTestId('jc-letter').locator('span.xs.muted').first().innerText()).match(/\d+/)[0]);
      expect(words).toBeLessThanOrEqual(120);
      await expect(jc2.getByTestId('jc-saved').getByRole('listitem')).toHaveCount(2);
      // delete one
      await jc2.getByTestId('jc-saved').getByRole('button', { name: 'Delete' }).first().click();
      await expect(jc2.getByTestId('jc-saved').getByRole('listitem')).toHaveCount(1);
      expect((await call(page, `/api/me/jobs/matches/${m.id}`)).body.covers).toHaveLength(1);
    });
  });
}
