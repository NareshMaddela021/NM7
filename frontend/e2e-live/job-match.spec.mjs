// Job match (Phase 1) on a desktop and a 390 px phone, against the real API (payments Off, no AI key):
//   match: paste a job post → score /100, verdict, breakdown, Found / Weak / Missing with honest steps; job links are
//          refused with "paste the text"; 3 free matches a day; a screenshot can't be read with AI off (paste instead)
//   pack:  Off → "Coming soon"; WhatsApp → Buy on WhatsApp makes a pending order (nothing unlocks)
//   tailor (admin grant): a copy named after the job, Accept / Skip, the copy is scored again, the original never
//          changes; saved to My applications with its score and the tailored copy; delete all job-search data
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
const RESUME = {
  ...structuredClone(TEST_PERSON),
  proj: [
    { title: 'College Fest Website', tagline: 'Event site', description: 'Built the fest website in HTML', tech: 'HTML, CSS', links: [] },
    { ...TEST_PERSON.proj[0], description: 'made sales dashboards in power bi and sql for the sponsors team' },
  ],
};

async function signIn(page, who) {
  const mail = email(who);
  seed('customer', mail, 'Sai Varsha', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await call(page, '/api/me/resumes')).body;
  await call(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME, name: 'Main' }) });
  return { mail, resumeId: r.id };
}
async function owner(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const mail = `owner-jm-${label}-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  await adminLogin(page, mail, secret);
  await expect(page).not.toHaveURL(/\/login/);
  return { ctx, page };
}
async function matchPost(page, text = POST) {
  await page.goto('/me/ats');
  await page.getByLabel('Job post', { exact: true }).fill(text);
  await page.getByTestId('jm-go').click();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('match a job post: score, verdict, breakdown, found / weak / missing; links refused; 3 free a day; pack Coming soon', async ({ page }) => {
      await signIn(page, `jm-free-${label}`);
      await page.goto('/me/ats');
      await expect(page.getByRole('tab', { name: 'Match a job' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Job links can’t be opened here.')).toBeVisible();
      await expect(page.getByTestId('jm-left')).toHaveText('3 of 3 free matches left today');
      // a link alone is refused, and doesn't use a free match
      await page.getByLabel('Job post', { exact: true }).fill('https://www.naukri.com/job-listings-data-analyst-12345');
      await page.getByTestId('jm-go').click();
      await expect(page.getByRole('alert')).toContainText('paste it here');
      await page.getByLabel('Job post', { exact: true }).fill(POST);
      await page.getByTestId('jm-go').click();
      const res = page.getByTestId('jm-result');
      await expect(res.getByTestId('jm-title')).toHaveText('Data Analyst · Brightpath Analytics');
      const score = Number(await res.getByTestId('jm-score').innerText());
      expect(score).toBeGreaterThan(40);
      await expect(res.getByTestId('jm-verdict')).toHaveText(/Strong match - apply|Good after \d+ fix|Good match - apply/);
      for (const k of ['must', 'title', 'experience', 'nice', 'education', 'duties', 'ats']) await expect(res.getByTestId(`jm-part-${k}`)).toBeVisible();
      await expect(res.getByTestId('jm-found')).toContainText('SQL');
      await expect(res.getByTestId('jm-missing')).toContainText('VLOOKUP');
      await expect(res.getByTestId('jm-missing')).toContainText('Not something you’ve done? Leave it out.'.replace('’', "'"));
      // the Tailor pack: payments are Off → Coming soon, nothing to buy
      await expect(res.getByTestId('pack-tailor-soon')).toHaveText('Coming soon');
      await expect(res.getByRole('button', { name: /Buy/ })).toHaveCount(0);
      await expect(page.getByTestId('jm-left')).toHaveText('2 of 3 free matches left today');
      // saved below; save to My applications
      await expect(page.getByTestId('jm-history')).toContainText('Data Analyst · Brightpath Analytics');
      await res.getByTestId('jm-save-app').click();
      await expect(res.getByTestId('jm-save-app')).toHaveText('Saved to My applications');
      await page.goto('/me/jobs');
      const card = page.getByRole('article').filter({ hasText: 'Brightpath Analytics' });
      await expect(card.getByTestId('app-score')).toHaveText(`Job match ${score}/100`);
      // two more free matches, then the button is off for today
      for (let i = 0; i < 2; i++) { await matchPost(page); await expect(page.getByTestId('jm-result')).toBeVisible(); }
      await page.goto('/me/ats');
      await expect(page.getByTestId('jm-left')).toHaveText('You’ve used today’s free matches');
      await expect(page.getByTestId('jm-go')).toBeDisabled();
      // the server says the same
      const r = await call(page, '/api/me/jobs/match', { method: 'POST', body: JSON.stringify({ text: POST }) });
      expect(r.status).toBe(402);
    });

    test('a screenshot can’t be read with AI off: paste the text instead', async ({ page }) => {
      await signIn(page, `jm-shot-${label}`);
      await page.goto('/me/ats');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      await page.getByLabel('Job post screenshot').setInputFiles({ name: 'job.png', mimeType: 'image/png', buffer: png });
      await expect(page.getByRole('alert')).toContainText(/paste|AI/i);
      await expect(page.getByLabel('Job post', { exact: true })).toHaveValue('');
    });

    test('tailor this resume (admin grant): a copy for the job, accept / skip, new score, original unchanged; delete all', async ({ page, browser }) => {
      const { resumeId } = await signIn(page, `jm-tailor-${label}`);
      const before = (await call(page, `/api/me/resumes/${resumeId}`)).body.data;
      const me = (await call(page, '/api/auth/me')).body;
      const o = await owner(browser, `t-${label}`);
      await o.page.goto(`/admin/customers?id=${me.id}`);
      await o.page.getByTestId('admin-job-tailor').getByRole('button', { name: 'Grant Tailor pack' }).click();
      await expect(o.page.getByTestId('admin-job-tailor')).toContainText('Granted by an admin');
      await o.ctx.close();

      await matchPost(page);
      const res = page.getByTestId('jm-result');
      await expect(page.getByTestId('jm-left')).toHaveText('Unlimited matches with your Tailor pack');
      await res.getByTestId('jm-tailor-start').click();
      const t = res.getByTestId('jm-tailor');
      await expect(t).toContainText('Copy: Data Analyst - Brightpath Analytics - ');
      await expect(t).toContainText(`Your original “Main” never changes.`);
      const cards = t.getByTestId('jm-sugg');
      expect(await cards.count()).toBeGreaterThanOrEqual(4);
      await expect(t.getByTestId('jm-sugg').filter({ hasText: 'Headline' })).toContainText('After: Data Analyst');
      // accept the headline, skip the summary, accept the rest
      await t.getByTestId('jm-sugg').filter({ hasText: 'Headline' }).getByRole('button', { name: 'Accept' }).click();
      await expect(t.getByTestId('jm-sugg').filter({ hasText: 'Headline' })).toContainText('Accepted');
      await t.getByTestId('jm-sugg').filter({ hasText: /^Summary/ }).getByRole('button', { name: 'Skip' }).click();
      await expect(t.getByTestId('jm-sugg').filter({ hasText: /^Summary/ })).toContainText('Skipped');
      while (await t.getByRole('button', { name: 'Accept' }).count()) {
        const n = await t.getByRole('button', { name: 'Accept' }).count();
        await t.getByRole('button', { name: 'Accept' }).first().click();
        await expect(t.getByRole('button', { name: 'Accept' })).toHaveCount(n - 1);
      }
      const [s0, s1] = (await t.getByTestId('jm-tailor-score').innerText()).match(/\d+/g).map(Number);
      expect(s1).toBeGreaterThanOrEqual(s0);
      // the original never changed; the copy is in My resumes
      expect((await call(page, `/api/me/resumes/${resumeId}`)).body.data).toEqual(before);
      const all = (await call(page, '/api/me/resumes')).body;
      const copy = all.find((x) => x.name.startsWith('Data Analyst - Brightpath Analytics - '));
      expect(copy.data.personal.headline).toMatch(/^Data Analyst/);
      expect(copy.data.proj[0].title).toBe('Sales Dashboard Revamp');
      // save it to My applications: the tailored copy is linked
      await res.getByTestId('jm-save-app').click();
      await page.goto('/me/jobs');
      const card = page.getByRole('article').filter({ hasText: 'Brightpath Analytics' });
      await expect(card.getByRole('button', { name: 'Open the tailored copy' })).toBeVisible();
      await card.getByRole('button', { name: 'Open the tailored copy' }).click();
      await expect(page).toHaveURL(/\/builder/);
      // delete all job-search data
      await page.goto('/me/settings');
      await page.getByRole('button', { name: 'Delete my job-search data' }).click();
      await page.getByRole('button', { name: 'Delete job-search data' }).click();
      await expect(page.getByText('Your job-search data is deleted.')).toBeVisible();
      expect((await call(page, '/api/me/jobs/matches')).body).toEqual([]);
    });

    test('WhatsApp mode: Buy on WhatsApp makes a pending Tailor pack order; nothing unlocks', async ({ page, browser }) => {
      await signIn(page, `jm-wa-${label}`);
      const o = await owner(browser, `wa-${label}`);
      const put = (mode) => call(o.page, '/api/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ mode, whatsappNumber: '+91 90000 12345', replyHours: '', cancelAfterHours: 72 }) });
      expect((await put('whatsapp')).status).toBe(200);
      try {
        await page.context().route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: 'chat' }));
        await matchPost(page);
        const pack = page.getByTestId('jm-result').getByTestId('pack-tailor');
        await expect(pack).toContainText('Tailor pack · ₹49');
        await expect(pack).toContainText('Pay by UPI through WhatsApp.');
        const popup = page.waitForEvent('popup');
        await pack.getByRole('button', { name: 'Buy on WhatsApp' }).click();
        const chat = await popup;
        await chat.waitForURL(/wa\.me/);
        expect(new URL(chat.url()).searchParams.get('text')).toMatch(/^Hi Nm7, I want to buy Tailor pack \(Rs 49\)\. Order NM7-\d+\.$/);
        await chat.close();
        await expect(page.getByTestId('wa-placed')).toBeVisible();
        expect((await call(page, '/api/me/jobs/access')).body.tailor).toBe(false);
      } finally {
        await put('off');
        await o.ctx.close();
      }
    });
  });
}
