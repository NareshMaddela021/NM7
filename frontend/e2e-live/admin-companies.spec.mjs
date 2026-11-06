// Admin → Companies trust queue and company account security (Phase 2, C1) on a desktop and a 390 px phone, against
// the real API: two sign-ups with the same GSTIN (one flagged), approve one (Verified), reject the other with a reason
// typed on the page (no pop-up), block and unblock; the company limits in Settings; the company admin turns on 2-step
// sign-in with an authenticator code and sees their signed-in devices. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, lastCode, seed, totp } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

async function signUp(request, tag, who, { companyEmail = true } = {}) {
  const site = `${who}${tag}.example`;
  const email = `${who}-${tag}@example.com`;
  const company = { details: { legalName: `${who} ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: 'We build software.' }, registration: { kind: 'gstin', number: '27AAPFU0939F1ZV' }, phone: '' };
  await request.post(`${API}/api/company/signup/code`, { data: { email, name: 'Ravi' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { data: { email, name: 'Ravi', code: lastCode(email), company } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  if (companyEmail) {
    await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `hr@${site}` }, headers: H });
    await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`hr@${site}`) }, headers: H });
    await request.post(`${API}/api/company/${r.company.id}/submit`, { data: { acceptTerms: true }, headers: H });
  }
  return { id: r.company.id, session: r.session, name: company.details.legalName, email };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('trust queue: flags, approve, reject with a reason, block; limits; 2-step and devices', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}${Date.now().toString(36)}`;
      const first = await signUp(request, tag, 'alpha');
      const second = await signUp(request, tag, 'beta'); // same GSTIN: flagged
      const owner = `ac-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      await page.goto('/admin/companies');
      await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
      await page.getByLabel('Search companies').fill(tag);
      await page.getByRole('button', { name: 'Search' }).click();
      const beta = page.getByTestId('admin-company').filter({ hasText: second.name });
      await expect(beta.getByTestId('company-flags')).toContainText('The same registration number is on another account.');
      await wide();

      // approve the first
      await page.getByTestId('admin-company').filter({ hasText: first.name }).getByRole('button', { name: 'Review' }).click();
      const review = page.getByTestId('company-review');
      await expect(review.getByTestId('check-reg')).toHaveAttribute('href', /services\.gst\.gov\.in/);
      await review.getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByText('Verified: the main admin was emailed')).toBeVisible();
      await expect(review).toContainText('Verified until');
      await page.getByRole('button', { name: /Close/ }).first().click();

      // reject the second with a reason typed on the page
      await page.getByTestId('admin-company').filter({ hasText: second.name }).getByRole('button', { name: 'Review' }).click();
      await review.getByRole('button', { name: 'Reject' }).click();
      await review.getByLabel('Why can’t we verify it?').fill('The GSTIN belongs to another business.');
      await review.getByRole('button', { name: 'Reject' }).click();
      await expect(page.getByText('Rejected: the main admin was emailed')).toBeVisible();
      await expect(review).toContainText('The GSTIN belongs to another business.');
      // block, then unblock
      await review.getByRole('button', { name: 'Block' }).click();
      await review.getByLabel('Why is it blocked?').fill('Asked candidates to pay a deposit.');
      await review.getByRole('button', { name: 'Block company' }).click();
      await expect(page.getByText('Blocked: its jobs are paused')).toBeVisible();
      await review.getByRole('button', { name: 'Unblock' }).click();
      await expect(page.getByText('Unblocked: back in the queue')).toBeVisible();
      await wide();

      // company limits in Settings & prices
      await page.goto('/admin/settings');
      await expect(page.getByTestId('company-limits')).toBeVisible();
      await expect(page.getByTestId('co-verifiedLiveJobs')).toHaveValue('3');

      // the company admin: 2-step sign-in and devices
      const ctx = await browser.newContext(opts);
      const co = await ctx.newPage();
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), first.session);
      await co.reload();
      await expect(co.getByTestId('co-card').getByTestId('co-trust')).toHaveText('Verified');
      await co.getByRole('tab', { name: 'Security' }).click();
      const sec = co.getByTestId('co-security');
      await expect(sec.getByTestId('co-2fa')).toHaveText('Off');
      await expect(sec.getByTestId('co-device')).toHaveCount(1);
      await sec.getByRole('button', { name: 'Turn on 2-step sign-in' }).click();
      const key = (await sec.getByTestId('co-2fa-secret').textContent()).trim();
      await expect(sec.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
      await sec.getByLabel('Code from your authenticator app').fill(totp(key));
      await sec.getByRole('button', { name: 'Turn on', exact: true }).click();
      await expect(sec.getByTestId('co-2fa')).toHaveText('On');
      expect(await co.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      await ctx.close();
    });
  });
}
