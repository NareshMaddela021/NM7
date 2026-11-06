// Email applications and "Ready to apply" (Phase 3, A4 + A5) on a desktop and a 390 px phone, against the real API:
// the morning run emails the email job (Applied by Auto Apply: "Sent by email to …"; My applications: "Sent by email"
// with exactly what was sent) and puts the website job in "Ready to apply" (never submitted by a bot): the tailored
// resume downloads as a PDF, and one tap opens the company site in a new tab and saves it. No browser dialogs, no
// sideways scrolling.
import { expect, test } from '@playwright/test';
import { seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('email application with a copy; ready to apply: PDF and one tap', async ({ page, context }) => {
      test.setTimeout(150_000);
      const tag = `${label}m${Date.now().toString(36)}`;
      const job = (body) => seed('job', JSON.stringify({ description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...body }));
      job({ title: `Mail Analyst ${tag}`, company: { name: `Mailco ${tag}` }, applyMethod: 'email', applyEmail: `hr@mail${tag}.example` });
      job({ title: `Site Analyst ${tag}`, company: { name: `Siteco ${tag}` }, applyMethod: 'link', applyUrl: `https://site${tag}.example/careers` });
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'mail');
      expect((await call(page, '/api/me/auto-apply', json('PUT', { roles: [`Analyst ${tag}`], cities: ['Hyderabad'], minScore: 60, dailyLimit: 5, consent: true }))).status).toBe(200);
      seed('auto-apply-run', me, 'past');

      await page.goto('/me/auto-apply');
      await expect(page.getByTestId('aa-applied')).toContainText(`Mail Analyst ${tag}`);
      await expect(page.getByTestId('aa-sent')).toContainText(`Sent by email to hr@mail${tag}.example`);
      const ready = page.getByTestId('aa-ready-item').filter({ hasText: `Site Analyst ${tag}` });
      await expect(ready).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      // the tailored resume as a PDF
      const [download] = await Promise.all([page.waitForEvent('download'), ready.getByTestId('aa-pdf').click()]);
      expect(download.suggestedFilename()).toBe('Asha_Rao_Resume.pdf');
      // one tap: the company site opens in a new tab and the application is saved
      await context.route(`https://site${tag}.example/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Careers</h1>' }));
      const [tab] = await Promise.all([context.waitForEvent('page'), ready.getByTestId('aa-open').click()]);
      await expect(tab).toHaveURL(`https://site${tag}.example/careers`);
      await tab.close();
      await expect(page.getByTestId('aa-ready-item').filter({ hasText: `Site Analyst ${tag}` })).toHaveCount(0);

      // My applications: the email one is "Sent by email" with what was sent; the website one is Applied (outside Nm7)
      await page.goto('/me/jobs');
      const mail = page.locator('article').filter({ hasText: `Mailco ${tag}` });
      await expect(mail.getByTestId('app-channel')).toContainText('Sent by email');
      await mail.getByText('See what was sent').click();
      await expect(mail.getByTestId('app-sent-email')).toContainText(`Application for Mail Analyst ${tag} – Asha Rao`);
      await expect(mail.getByTestId('app-sent-email')).toContainText('My resume is attached.');
      await expect(page.locator('article').filter({ hasText: `Siteco ${tag}` }).getByTestId('app-channel')).toContainText('Applied (outside Nm7)');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
