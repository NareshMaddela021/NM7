// Admin → Daily report on a desktop and a 390 px phone, against the real API: it is the first item in the Admin side
// menu; with nothing (or little) in the database the page renders its five plain lines, "Needs attention", the four
// sections and "No data yet" texts without crashing; after the collector's jobs are seeded, "Refresh now" recomputes
// the report (one job created, one sent to review with its reason, Pune in "New jobs by city"). No sideways
// scrolling, no browser dialogs.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('first in the side menu; renders when empty; Refresh now picks up new collector jobs', async ({ page }) => {
      test.setTimeout(120_000);
      const owner = `dr-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs on this page'); });

      await page.goto('/admin');
      const menu = page.getByRole('navigation', { name: 'Admin sections' });
      await expect(menu.getByRole('link').first()).toHaveText(/Daily report/);
      await menu.getByRole('link', { name: /Daily report/ }).click();
      await expect(page).toHaveURL(/\/admin\/daily-report$/);
      await expect(page.getByRole('heading', { name: 'Daily report', level: 1 })).toBeVisible();

      // renders with little or no data: five plain lines, the sections, "No data yet" style texts
      await expect(page.getByTestId('dr-summary').getByRole('listitem')).toHaveCount(5, { timeout: 20_000 });
      for (const h of ['Today in plain words', 'Needs attention', 'Job collector', 'Site health', 'Users and business', 'Vetting engine']) {
        await expect(page.getByRole('heading', { name: h, level: 2 })).toBeVisible();
      }
      await expect(page.getByTestId('dr-run')).toContainText(/No run|Arrived|Failed/);
      await expect(page.getByTestId('dr-measures')).toContainText('No data yet');
      await expect(page.getByTestId('dr-github')).toContainText('Not connected');
      await expect(page.getByTestId('dr-switch')).toContainText('Vetting switch: OFF');
      await expect(page.getByTestId('dr-payments-soon')).toContainText('Payments coming soon'); // no Razorpay keys here
      await expect(page.getByTestId('dr-attention')).toContainText('Razorpay keys missing');
      await expect(page.getByTestId('dr-api')).toContainText('Up');
      await expect(page.getByTestId('dr-updated')).toContainText('Updated');
      // every sparkline says its trend in words
      const spark = page.getByTestId('dr-tile-colCreated').getByRole('img');
      await expect(spark).toHaveAttribute('aria-label', /^New jobs created\. Last 30 days: /);
      expect(await noSideScroll(page)).toBe(true);

      // the collector's jobs arrive; Refresh now recomputes today
      const tag = `${label}-${Date.now().toString(36)}`;
      seed('collector-job', JSON.stringify({
        title: `Daily Report Trainee ${tag}`, company: { name: 'Acme Industries' }, locations: ['Pune'], experience: 'fresher',
        description: 'Trainees help plan production, keep quality records in SAP and join safety audits at the Pune plant. Suits 2025 and 2026 B.E. graduates.',
        applyMethod: 'link', applyUrl: `https://careers.acme-${tag}.example/jobs/DR-1`,
      }));
      seed('collector-job', JSON.stringify({
        title: `Daily Report Plant Trainee ${tag}`, company: { name: 'Acme Industries' }, locations: ['Pune'], experience: 'fresher',
        description: 'Summary not written yet: this job is waiting for review. Open the official page for the details.',
        applyMethod: 'link', applyUrl: `https://careers.acme-${tag}.example/jobs/DR-2`,
      }), 'no_page_text');
      await page.getByTestId('dr-refresh').click();
      await expect(page.getByText('Report refreshed')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('dr-tile-colCreated')).not.toContainText('No data yet');
      await expect(page.getByTestId('dr-tile-colCreated').locator('.dr-tile-v')).toHaveText(/^[1-9][\d,]*$/);
      await expect(page.getByTestId('dr-tile-reviewQueue').locator('.dr-tile-v')).toHaveText(/^[1-9][\d,]*$/);
      await expect(page.getByRole('heading', { name: 'Why jobs went to review' }).locator('..')).toContainText('No page text to summarise');
      await expect(page.getByRole('heading', { name: 'New jobs by city' }).locator('..')).toContainText('Pune');
      await expect(page.getByTestId('dr-summary')).toContainText(/Collector added [1-9]/);
      expect(await noSideScroll(page)).toBe(true);

      // the review queue tile opens Admin → Jobs → Collector review
      await page.getByTestId('dr-tile-reviewQueue').getByRole('link', { name: 'Open' }).click();
      await expect(page).toHaveURL(/\/admin\/jobs\?tab=collector/);
    });
  });
}
