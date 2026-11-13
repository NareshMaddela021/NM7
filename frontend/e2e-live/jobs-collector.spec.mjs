// Round J: a job the morning collector found on a company's careers page. On a desktop and a 390 px phone, against
// the real API: the job page says "Source: company careers page" (no logo, Apply to the official link) and links to
// "Request removal of this job"; the form at /contact?topic=job-removal sends the request; Admin → Jobs → Removal
// requests closes the job in one click and the page then says the job is closed. No browser dialogs.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('collector job: source line, removal request, one-click close', async ({ page, browser }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}-${Date.now().toString(36)}`;
      const url = `https://careers.acmeind-${tag}.example/jobs/GET-1`;
      const job = await seed('collector-job', JSON.stringify({
        title: `Graduate Engineer Trainee ${tag}`, company: { name: 'Acme Industries' }, locations: ['Pune'], experience: 'fresher',
        description: 'Trainees help plan production, keep quality records in SAP and join safety audits at the Pune plant. Suits 2025 and 2026 B.E. graduates.',
        applyMethod: 'link', applyUrl: url,
      }));
      await page.goto(`/jobs/${job.slug}`);
      await expect(page.getByTestId('job-source')).toContainText('Source: company careers page');
      await expect(page.getByTestId('apply').first()).toHaveAttribute('href', url);
      await expect(page.locator('img.job-logo, .job-detail img')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('job-removal').click();
      await expect(page).toHaveURL(/\/contact\?topic=job-removal/);
      await expect(page.getByTestId('jr-link')).toHaveValue(`https://nm7.si/jobs/${job.slug}`);
      await page.getByLabel('Company name').fill('Acme Industries');
      await page.getByLabel('Your work email').fill(`hr-${tag}@acmeind.example`);
      await page.getByLabel('Reason (optional)').fill('This opening is filled.');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('jr-send').click();
      await expect(page.getByTestId('jr-sent')).toContainText('we have your request');
      // Admin closes the job in one click
      const owner = `jc-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const admin = await (await browser.newContext(opts)).newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/jobs');
      await admin.getByRole('tab', { name: 'Removal requests' }).click();
      const row = admin.getByTestId('removal-row').filter({ hasText: `Graduate Engineer Trainee ${tag}` });
      await expect(row).toContainText(`hr-${tag}@acmeind.example`);
      await row.getByTestId('removal-close').click();
      await expect(row).toHaveCount(0);
      expect(await noSideScroll(admin)).toBe(true);
      await page.goto(`/jobs/${job.slug}`);
      await expect(page.getByTestId('job-status')).toHaveText('Closed');
    });
  });
}
