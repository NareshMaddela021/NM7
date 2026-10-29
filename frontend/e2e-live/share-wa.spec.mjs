// WhatsApp sharing and the short public link, on a desktop and a 390 px phone, against the real API: the public link
// is opt-in (the WhatsApp button asks first, with hide phone / email); wa.me carries only a short message and the
// link; the short link nm7.si/r/<code> opens the resume without the hidden phone and email; its QR PNG decodes to
// the short link; turning the link off stops it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, readQrPng, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const POST = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'job-data-analyst.txt'), 'utf8');
const RESUME = { personal: { name: 'Asha Rao', email: 'asha.rao@example.com', phone: '+91 98765 43210', title: 'Data Analyst' }, summary: 'Analyst who likes clean data.' };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('opt-in, wa.me message + link only, short link hides phone and email, QR, revoke', async ({ page, browser }) => {
      test.setTimeout(120_000);
      const mail = email(`share-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
      const [r] = (await call(page, '/api/me/resumes')).body;
      expect((await call(page, `/api/me/resumes/${r.id}`, json('PATCH', { data: RESUME, name: 'Main' }))).status).toBe(200);

      // My resumes: the link is off, so the button asks first
      await page.goto('/me/resumes');
      await page.getByTestId('resumes-share-wa').click();
      const dlg = page.getByRole('dialog');
      await expect(dlg).toContainText('turn on your public resume link');
      await expect(dlg.getByTestId('share-hide-phone')).toBeChecked();
      await expect(dlg.getByTestId('share-hide-email')).toBeChecked();
      await dlg.getByTestId('share-turn-on').click();
      const open = dlg.getByTestId('share-open-wa');
      await expect(open).toBeVisible();
      const href = new URL(await open.getAttribute('href'));
      expect(href.origin + href.pathname).toBe('https://wa.me/');
      expect([...href.searchParams.keys()]).toEqual(['text']);
      const text = href.searchParams.get('text');
      expect(text).toMatch(/^Hi, here is my resume: https:\/\/nm7\.si\/r\/[2-9a-z]{6}$/);
      expect(text).not.toContain('98765');
      expect(text).not.toContain('@');
      const short = text.split('/r/')[1];
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // now a plain link to WhatsApp
      await expect(page.getByTestId('resumes-share-wa')).toHaveAttribute('href', href.toString());
      expect(await noSideScroll(page)).toBe(true);

      // Share link page: the short link, QR PNG, settings
      await page.goto('/me/share');
      await expect(page.getByTestId('share-short')).toHaveText(`nm7.si/r/${short}`);
      const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('share-qr').click()]);
      expect(file.suggestedFilename()).toMatch(/_QR\.png$/);
      const qr = await readQrPng(readFileSync(await file.path()));
      expect(qr.text).toBe(`https://nm7.si/r/${short}`);
      await expect(page.getByTestId('share-hide-email-page')).toBeChecked();
      expect(await noSideScroll(page)).toBe(true);

      // a stranger opens the short link: no phone, no email
      const ctx = await browser.newContext(opts);
      const anon = await ctx.newPage();
      await anon.goto(`/r/${short}`);
      await expect(anon.getByRole('heading', { name: 'Asha Rao' })).toBeVisible();
      const body = await anon.locator('main').innerText();
      expect(body).not.toContain('98765');
      expect(body).not.toContain('asha.rao@example.com');
      expect((await call(page, '/api/me/share')).body.viewCount).toBeGreaterThanOrEqual(1);

      // job match: the message names the job
      await page.goto('/me/ats');
      await page.getByLabel('Job post', { exact: true }).fill(POST);
      await page.getByTestId('jm-go').click();
      const jm = new URL(await page.getByTestId('jm-share-wa').getAttribute('href'));
      expect(jm.searchParams.get('text')).toMatch(new RegExp(`^Hi, here is my resume for the .+ role.*: https://nm7\\.si/r/${short}$`));

      // revoke: the short link stops
      const sh = (await call(page, '/api/me/share')).body;
      expect((await call(page, '/api/me/share', json('PUT', { ...sh, on: false }))).status).toBe(200);
      await anon.goto(`/r/${short}`);
      await expect(anon.getByText('This resume link is turned off')).toBeVisible();
      await ctx.close();
    });
  });
}
