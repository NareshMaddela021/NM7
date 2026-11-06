// The company dashboard and public company page (Phase 2, C2) on a desktop and a 390 px phone: overview numbers and
// trust level, upload a logo and write the about text, the public page at /companies/<slug> with the trust badge,
// change a team admin's role, settings (details not locked yet) and the activity log. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, lastCode, ownNetwork } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNgYGD4z8DAwMDEwMDAAAAJBAED6ZqXjgAAAABJRU5ErkJggg==', 'base64');

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('overview, company page with logo, public page, team role, settings, activity', async ({ page, request }) => {
      test.setTimeout(120_000);
      const tag = `${label}d${Date.now().toString(36)}`;
      const site = `dash${tag}.example`;
      const email = `boss-${tag}@example.com`;
      const company = { details: { legalName: `Dash ${tag} Pvt Ltd`, website: site, category: 'sme', structure: 'private_limited', industry: 'Retail', size: '51_200', about: '' }, registration: { kind: 'cin', number: 'U72900TG2019PTC123456' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email, name: 'Boss' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email, name: 'Boss', code: lastCode(email), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `hr@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`hr@${site}`) }, headers: H });
      await request.post(`${API}/api/company/${r.company.id}/team`, { data: { email: `ops@${site}`, role: 'view' }, headers: H });
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });

      await page.goto('/company');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await page.reload();
      // overview
      await expect(page.getByTestId('co-card').getByTestId('co-trust')).toHaveText('Basic');
      await expect(page.getByTestId('co-tiles')).toContainText('Live jobs');
      await wide();
      // company page: logo + about
      await page.getByRole('tab', { name: 'Company page' }).click();
      const pg = page.getByTestId('co-page');
      await pg.getByTestId('co-logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
      await expect(pg.getByTestId('co-logo')).toBeVisible();
      await pg.getByLabel('About the company').fill('We run 40 grocery stores across Telangana.');
      await pg.getByRole('button', { name: 'Save' }).click();
      await expect(pg.getByRole('status')).toHaveText('Saved.');
      // team: change a role
      await page.getByRole('tab', { name: 'Team' }).click();
      await page.getByTestId('co-team').getByLabel(`What they can do: ops@${site}`).selectOption('posting');
      await expect(page.getByTestId('co-team').getByLabel(`What they can do: ops@${site}`)).toHaveValue('posting');
      // settings: not verified yet, so details can be edited
      await page.getByRole('tab', { name: 'Settings' }).click();
      await expect(page.getByTestId('co-settings')).toContainText('U72900TG2019PTC123456');
      await expect(page.getByRole('link', { name: 'Edit company details' })).toBeVisible();
      // activity
      await page.getByRole('tab', { name: 'Activity' }).click();
      await expect(page.getByTestId('co-activity')).toContainText('Company page updated');
      await expect(page.getByTestId('co-activity')).toContainText('Team role changed');
      await wide();
      // the public page
      await page.getByRole('tab', { name: 'Overview' }).click();
      await page.getByTestId('co-public-link').click();
      const pub = page.getByTestId('company-public');
      await expect(pub.getByRole('heading', { level: 1 })).toHaveText(`Dash ${tag} Pvt Ltd`);
      await expect(pub.getByTestId('company-badge')).toHaveText('Emails confirmed');
      await expect(pub).toContainText('We run 40 grocery stores across Telangana.');
      await expect(pub.locator('img.co-logo')).toBeVisible();
      await expect(page.getByText('No open jobs right now.')).toBeVisible();
      await wide();
      await page.goto('/companies/no-such-company-00');
      await expect(page.getByTestId('company-gone')).toBeVisible();
    });
  });
}
