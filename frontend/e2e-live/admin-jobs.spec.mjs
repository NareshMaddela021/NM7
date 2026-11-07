// Admin → Jobs (job board J1) on a desktop and a 390 px phone, against the real API: add a job with the form, find
// it, pause it, close it, delete it with the in-page confirm (no browser dialog); bulk import a JSON array with one
// bad row (preview shows the row's problem, nothing saved), then import the good one. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('add, find, pause, close, delete (in-page confirm); bulk import preview then import', async ({ page }) => {
      test.setTimeout(120_000);
      const owner = `aj-owner-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs on this page'); });
      const tag = `${label}${Date.now().toString(36)}`;
      await page.goto('/admin/jobs');
      await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();

      // add
      await page.getByRole('button', { name: 'Add job' }).click();
      const f = page.getByRole('form', { name: 'Add a job' });
      await f.getByLabel('Job title *').fill(`QA Analyst ${tag}`);
      await f.getByLabel('Company *').fill('Cobalt Systems');
      await f.getByLabel('Cities (comma between)').fill('Hyderabad, Chennai');
      await f.getByLabel('Experience').selectOption('fresher');
      await f.getByLabel('Salary from (₹)').fill('300000');
      await f.getByLabel('Salary to (₹)').fill('420000');
      await f.getByLabel('Skills (comma between)').fill('Selenium, sql');
      await f.getByLabel('Description *').fill('Test our web app by hand and with Selenium scripts. Freshers who have done a testing course are welcome.');
      await f.getByLabel('Apply link *').fill(`https://cobalt.example/jobs/${tag}`);
      await f.getByRole('button', { name: 'Add job' }).click();
      await expect(f).toHaveCount(0);

      // find it
      await page.getByLabel('Search').fill(tag);
      await page.getByRole('button', { name: 'Search' }).click();
      const row = page.getByTestId('admin-job').filter({ hasText: `QA Analyst ${tag}` });
      await expect(row).toContainText('Cobalt Systems · Hyderabad, Chennai · Fresher · Full-time · ₹3,00,000 – ₹4,20,000 a year');
      await expect(row).toContainText('Active');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // pause, close, delete with the in-page confirm
      await row.getByRole('button', { name: 'Pause' }).click();
      await expect(row).toContainText('Paused');
      await row.getByRole('button', { name: 'Close' }).click();
      await expect(row).toContainText('Closed');
      await row.getByRole('button', { name: 'Delete' }).click();
      await expect(row.getByRole('alert')).toContainText('Delete “QA Analyst');
      await row.getByRole('alert').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('admin-job').filter({ hasText: `QA Analyst ${tag}` })).toHaveCount(0);

      // bulk import: preview with a bad row, then import the good one
      await page.getByRole('tab', { name: 'Bulk import' }).click();
      const good = { title: `Support Engineer ${tag}`, company: { name: 'Bluepeak' }, locations: ['Chennai'], experience: '0_1', description: 'Help customers fix issues with our cloud product, by phone and chat.', applyMethod: 'email', applyEmail: 'hr@bluepeak.example' };
      await page.getByLabel('Jobs to import').fill(JSON.stringify([good, { title: 'x', company: { name: 'Y' } }]));
      await page.getByRole('button', { name: 'Preview' }).click();
      const preview = page.getByTestId('import-preview');
      await expect(preview).toContainText('1 new');
      await expect(preview).toContainText('1 with errors');
      await expect(preview.getByTestId('import-row').nth(1)).toContainText('Error');
      await expect(preview.getByTestId('import-row').nth(1)).toContainText('Description is missing.'); // plain words (item 34)
      await expect(preview.getByTestId('import-row').nth(1)).toContainText('Job title is too short: use at least 2 letters.');
      await expect(preview).not.toContainText('String should');
      await expect(page.getByRole('radio', { name: 'JSON' })).toBeChecked(); // a real name, not "on" (item 35)
      await page.getByRole('button', { name: 'Import 1 job' }).click();
      await expect(page.getByLabel('Search')).toBeVisible();
      await page.getByLabel('Search').fill(tag);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByTestId('admin-job').filter({ hasText: `Support Engineer ${tag}` })).toContainText('Bulk import');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
    });
  });
}
