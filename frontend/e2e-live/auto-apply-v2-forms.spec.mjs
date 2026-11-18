// Auto Apply 2.0, phase A5 (open forms) on a desktop and a 390 px phone, against the real API. A tester has 2.0 on
// (full auto); a verified company with a tester on its team has two jobs on its own website. The run and the form
// pass happen in the seed process with a fake company site (nothing leaves it): one job has a plain HTML form, which
// is filled and sent; the other page has a CAPTCHA, so that job is Ready for one tap and the site is remembered. The
// candidate's tracker shows channel "Company form" with the proof in "What was sent" (the fields, the tailored resume,
// the site's answer and a copy of its page), and the CAPTCHA job's reason. Admin → Auto Apply lists the sites: the
// CAPTCHA one is "One tap only"; Admin resets it (asked on the page) and moves it back to one tap. Every test uses its
// own candidate, company and sites (desktop and phone share one database). No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('candidate: sent through the company’s own form, with proof; a CAPTCHA page stays one tap', async ({ page, request }) => {
      test.setTimeout(200_000);
      const tag = `a5${label[0]}${Date.now().toString(36)}`;
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const co = await verifiedCompany(request, tag);
      seed('aa2-tester', `hr-${tag}@example.com`); // a tester on the team: a test company while the switch is OFF
      const me = await studentWith(page, label, STRONG, 'aa5');
      seed('aa2-tester', me);
      const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'full_auto' };
      expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
      expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);

      const out = seed('aa5-form-run', me, co.id, tag);
      expect(out.states[`careers.co${tag}.example`]).toEqual({ state: 'applied', reason: null });
      expect(out.states[`apply.co${tag}.example`]).toEqual({ state: 'ready', reason: 'captcha' });

      await page.goto('/me/auto-apply/v2');
      const row = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row).toHaveAttribute('data-stage', 'applied');
      await expect(row.getByTestId('aa2-ch')).toHaveText('▤ Company form');
      await expect(row.getByTestId('aa2-row-form')).toHaveText('Sent through the company’s own form. The company’s page confirmed it.');
      await row.getByTestId('aa2-what').click();
      const proof = row.getByTestId('aa2-form');
      await expect(proof.getByTestId('aa2-form-result')).toHaveText('Sent. The company’s page confirmed it.');
      await expect(proof.getByTestId('aa2-form-test')).toBeVisible();
      await expect(proof.getByTestId('aa2-form-fields')).toContainText(me);
      await expect(proof.getByTestId('aa2-form-fields')).toContainText('Asha Rao');
      await expect(proof.getByTestId('aa2-form-file')).toHaveText('Attached: Asha_Rao_Resume.pdf (your tailored resume)');
      await expect(proof.getByTestId('aa2-form-status')).toContainText('HTTP 200');
      await expect(proof.getByTestId('aa2-form-status')).toContainText(`careers.co${tag}.example/thanks`);
      await proof.getByText('The company’s page after sending').click();
      await expect(proof.getByTestId('aa2-form-snapshot')).toContainText('We have received your application');
      expect(await noSideScroll(page)).toBe(true);

      const ready = page.getByTestId('aa2-row').filter({ hasText: `Reporting Analyst ${tag}` });
      await expect(ready).toHaveAttribute('data-stage', 'ready');
      await expect(ready.getByTestId('aa2-ch')).toHaveText('☝ One tap');
      await expect(ready.getByTestId('aa2-row-ready')).toContainText('CAPTCHA');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Admin sees every company site, resets one and moves it to one tap', async ({ page }) => {
      test.setTimeout(150_000);
      const tag = `a5${label[0]}${Date.now().toString(36)}`;
      const blocked = `careers.${tag}-captcha.example`;
      const good = `jobs.${tag}-good.example`;
      seed('aa5-site', blocked, 'one_tap', 'captcha');
      seed('aa5-site', good, 'allowed', '');
      seed('aa5-site', `${tag}-robots.example`, 'robots', 'robots');
      const owner = `aa5-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/auto-apply');
      const panel = page.getByTestId('aa5-sites-admin');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('aa5-sites-rules')).toContainText('Nm7-AutoApply/1.0 (+https://nm7.si/bot)');
      const row = panel.locator(`[data-testid="aa5-site"][data-site="${blocked}"]`);
      await expect(row.getByTestId('aa5-site-state')).toHaveText('One tap only');
      await expect(row.getByTestId('aa5-site-reason')).toContainText('CAPTCHA');
      await expect(panel.locator(`[data-testid="aa5-site"][data-site="${good}"]`).getByTestId('aa5-site-state')).toHaveText('Allowed (simple form)');
      await expect(panel.locator(`[data-testid="aa5-site"][data-site="${tag}-robots.example"]`).getByTestId('aa5-site-state')).toHaveText('Blocked by robots.txt');
      expect(await noSideScroll(page)).toBe(true);
      // the filter
      await panel.getByTestId('aa5-sites-filter').selectOption('robots');
      await expect(panel.locator(`[data-testid="aa5-site"][data-site="${blocked}"]`)).toHaveCount(0);
      await panel.getByTestId('aa5-sites-filter').selectOption('');
      // reset: asked on the page
      await row.getByTestId('aa5-site-reset').click();
      const reset = page.waitForResponse((r) => r.url().endsWith(`/forms/sites/${blocked}/reset`) && r.request().method() === 'POST');
      await row.getByTestId('aa5-site-reset-yes').click();
      expect((await reset).ok()).toBe(true);
      await expect(row.getByTestId('aa5-site-state')).toHaveText('Not tried yet');
      expect(await noSideScroll(page)).toBe(true);
      // and back to one tap
      const moved = page.waitForResponse((r) => r.url().endsWith(`/forms/sites/${blocked}/one-tap`) && r.request().method() === 'POST');
      await row.getByTestId('aa5-site-onetap').click();
      expect((await moved).ok()).toBe(true);
      await expect(row.getByTestId('aa5-site-state')).toHaveText('One tap only');
      await expect(row.getByTestId('aa5-site-reason')).toHaveText('Moved to one tap by Admin.');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
