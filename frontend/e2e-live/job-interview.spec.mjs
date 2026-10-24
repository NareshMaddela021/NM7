// Interview prep (Phase 3) on a desktop and a 390 px phone, against the real API (payments Off, no AI key):
//   free: make the pack from a job match → the first 3 questions with model answers and tips, "Tell me about yourself"
//         (60 s), the other 7 locked with the Interview pack "Coming soon"; practice one question at a time with
//         feedback (structure, result, length, filler words, a better version) and saved progress
//   pack (admin grant): all 10 questions (STAR for the situation question), the 2-minute intro, weak spots, 5
//         questions to ask, homework; progress "N of 10 practised" shows on the match screen too
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

    test('interview prep: 3 free questions, practice with feedback and progress, then the Interview pack unlocks all', async ({ page, browser }) => {
      const uid = await signIn(page, `iv-${label}`);
      await page.goto('/me/ats');
      await page.getByLabel('Job post', { exact: true }).fill(POST);
      await page.getByTestId('jm-go').click();
      await page.getByTestId('jm-result').getByTestId('jm-interview').click();
      await expect(page).toHaveURL(/\/me\/interview\//);
      await expect(page.getByText('Data Analyst · Brightpath Analytics').first()).toBeVisible();
      await page.getByTestId('iv-make').click();

      // free: 3 questions, the rest locked (Coming soon with payments Off)
      await expect(page.getByTestId('iv-q')).toHaveCount(3);
      await expect(page.getByTestId('iv-q').first()).toContainText('Tell me about yourself.');
      await expect(page.getByTestId('iv-q').first()).toContainText('Make it yours');
      await expect(page.getByTestId('iv-locked')).toContainText('7 more questions in the Interview pack');
      await expect(page.getByTestId('iv-locked').getByTestId('pack-interview-soon')).toHaveText('Coming soon');
      await expect(page.getByTestId('iv-intro-text')).toContainText('Sai Varsha');
      await expect(page.getByRole('tab', { name: '2 minutes' })).toBeDisabled();
      await expect(page.getByTestId('iv-weak')).toHaveCount(0);
      await expect(page.getByTestId('iv-progress')).toHaveText('0 of 3 practised');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // practice: one question at a time, typed (Speak is next to it where the browser has speech)
      await page.getByTestId('iv-practise').click();
      const pr = page.getByTestId('iv-practice');
      await expect(pr.getByTestId('iv-practice-q')).toHaveText('Tell me about yourself.');
      await pr.getByLabel('Your answer (type it, or tap Speak and say it)').fill('Um so basically I am Sai, like, I made dashboards in Power BI, you know.');
      await pr.getByTestId('iv-send').click();
      const fb = pr.getByTestId('iv-feedback');
      await expect(fb).toContainText('filler words');
      await expect(fb).toContainText('a bit short');
      await expect(fb).toContainText('No result or number');
      await expect(pr.getByTestId('iv-better')).not.toContainText('basically');
      await expect(page.getByTestId('iv-progress')).toHaveText('1 of 3 practised');
      await pr.getByTestId('iv-next').click();
      await expect(pr.getByTestId('iv-practice-q')).toContainText('Why do you want to work as Data Analyst at Brightpath Analytics?');
      // the 4th question is locked on the server too
      const m = (await call(page, '/api/me/jobs/matches')).body[0];
      expect((await call(page, `/api/me/jobs/matches/${m.id}/interview/practice`, { method: 'POST', body: JSON.stringify({ qid: 'q4', answer: 'x' }) })).status).toBe(402);

      // the Interview pack (admin grant) unlocks everything
      const ctx = await browser.newContext();
      const o = await ctx.newPage();
      const mail = `owner-iv-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      await adminLogin(o, mail, secret);
      await expect(o).not.toHaveURL(/\/login/);
      await o.goto(`/admin/customers?id=${uid}`);
      await o.getByTestId('admin-job-interview').getByRole('button', { name: /Grant/ }).click();
      await expect(o.getByTestId('admin-job-interview')).toContainText('Granted by an admin');
      await ctx.close();

      await page.reload();
      await expect(page.getByTestId('iv-q')).toHaveCount(10);
      await expect(page.getByTestId('iv-locked')).toHaveCount(0);
      await expect(page.getByTestId('iv-progress')).toHaveText('1 of 10 practised');
      const star = page.getByTestId('iv-q').nth(9);
      await star.getByRole('button', { expanded: false }).click();
      for (const part of ['Situation', 'Task', 'Action', 'Result']) await expect(star.getByText(part, { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: '2 minutes' }).click();
      await expect(page.getByTestId('iv-intro-text')).toContainText('Sales Dashboard Revamp');
      await expect(page.getByTestId('iv-weak')).toContainText('What is your biggest weakness?');
      await expect(page.getByTestId('iv-ask').getByRole('listitem')).toHaveCount(5);
      await expect(page.getByTestId('iv-homework')).toContainText('Brightpath Analytics');
      await page.getByTestId('iv-homework').getByRole('checkbox').first().check();
      // the match screen shows the progress
      await page.goto('/me/ats');
      await page.getByTestId('jm-history').getByRole('button', { name: /Brightpath Analytics/ }).click();
      await expect(page.getByTestId('jm-interview')).toHaveText('Interview prep · 1 of 10 practised');
    });
  });
}
