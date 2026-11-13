// Phase 6 S8 internships and live projects, on a desktop and a 390 px phone, against the real API: a Verified company
// posts a 2-week unpaid live project (a 30-place unpaid one is held for Nm7's check); a student applies with consent,
// the company accepts, the student sends a link, the company accepts the work; the student gets the certificate PDF,
// the public /verify page confirms it, and the resume entry is added only on request. No browser dialogs, no
// sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, ownNetwork, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('post, apply, accept, send, pass → certificate, verify, resume entry', async ({ page, request, browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}p${Date.now().toString(36)}`;
      const site = `pg${tag}.example`;
      const mail = `hr-${tag}@example.com`;
      const company = { details: { legalName: `Projco ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
      const NET = ownNetwork();
      await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Uma' } });
      const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Uma', code: lastCode(mail), company } })).json();
      const H = { 'X-Recruiter-Account': r.session };
      await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
      await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
      seed('company-verify', r.company.id);
      // the company posts in the UI
      const co = await (await browser.newContext(opts)).newPage();
      co.on('dialog', () => { throw new Error('no browser dialogs'); });
      await co.goto('/company');
      await co.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), r.session);
      await co.reload();
      await co.getByRole('tab', { name: 'Internships & projects' }).click();
      const post = async (title, seats) => {
        await co.getByTestId('co-pg-new').click();
        await co.getByTestId('co-pg-title').fill(title);
        await co.getByTestId('co-pg-brief').fill('Build a one-page dashboard from the sample sales data we share, with three charts and short notes.');
        await co.getByTestId('co-pg-deliverable').fill('A link to your dashboard');
        await co.getByTestId('co-pg-deadline').fill('2026-12-20');
        await co.getByTestId('co-pg-seats').fill(String(seats));
        await co.getByTestId('co-pg-post').click();
        await expect(co.getByTestId('co-pg-form')).toHaveCount(0);
      };
      await post(`Dashboard ${tag}`, 3);
      await post(`Big ${tag}`, 30);
      // 13 Nov live test: an unpaid 12-week full-time internship is held too; every field has a real label
      await co.getByTestId('co-pg-new').click();
      await co.getByRole('radio', { name: 'Internship' }).check();
      await co.getByLabel('Title', { exact: true }).fill(`Social ${tag}`);
      await co.getByLabel('What they will do').fill('Run our social media accounts full time, make daily posts and handle customer messages');
      await co.getByLabel('Weeks', { exact: true }).fill('12');
      await expect(co.getByRole('checkbox', { name: /Remote/ })).toBeChecked();
      await co.getByTestId('co-pg-post').click();
      await expect(co.getByTestId('co-pg-row').filter({ hasText: `Social ${tag}` }).getByTestId('co-pg-status')).toHaveText('Being checked');
      await expect(co.getByTestId('co-pg-row').filter({ hasText: `Big ${tag}` }).getByTestId('co-pg-status')).toHaveText('Being checked');
      expect(await noSideScroll(co)).toBe(true);

      // the student applies
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.route(`${API}/**`, (x) => x.continue({ headers: { ...x.request().headers(), 'x-forwarded-for': `10.9.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
      await page.goto('/');
      const smail = email(`pg-${label}`);
      expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: 'Asha Rao', email: smail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
      expect((await call(page, '/api/auth/verify-email', json('POST', { email: smail, code: lastCode(smail) }))).status).toBe(200);
      await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', active: true, data: { personal: { name: 'Asha Rao' }, intern: [] } }));
      await page.goto('/me/programs');
      const card = page.getByTestId('pg-open').filter({ hasText: `Dashboard ${tag}` });
      await expect(page.getByTestId('pg-open').filter({ hasText: `Big ${tag}` })).toHaveCount(0); // held: not shown
      await card.getByTestId('pg-apply-open').click();
      await card.getByTestId('pg-apply').click();
      await expect(card.getByRole('alert')).toContainText('Tick the box');
      await card.getByTestId('pg-consent').check();
      await card.getByTestId('pg-apply').click();
      await expect(page.getByTestId('pg-mine')).toContainText('Applied');
      expect(await noSideScroll(page)).toBe(true);

      // accept, send, pass
      await co.reload();
      await co.getByRole('tab', { name: 'Internships & projects' }).click();
      const row = co.getByTestId('co-pg-row').filter({ hasText: `Dashboard ${tag}` });
      await row.getByTestId('co-pg-accept').click();
      await expect(row.getByTestId('co-pg-app')).toContainText('Accepted');
      await page.reload();
      await page.getByTestId('pg-link').fill('https://example.com/my-dashboard');
      await page.getByTestId('pg-send').click();
      await expect(page.getByTestId('pg-status')).toContainText('Work sent');
      await co.reload();
      await co.getByRole('tab', { name: 'Internships & projects' }).click();
      await co.getByTestId('co-pg-row').filter({ hasText: `Dashboard ${tag}` }).getByTestId('co-pg-pass').click();
      await expect(co.getByTestId('co-pg-row').filter({ hasText: `Dashboard ${tag}` }).getByTestId('co-pg-app')).toContainText('Completed');

      // certificate, verify, resume entry
      await page.reload();
      await expect(page.getByTestId('pg-status')).toHaveText('Completed');
      const href = await page.getByTestId('pg-cert').getAttribute('href');
      const pdf = await request.get(href);
      expect(pdf.headers()['content-type']).toContain('application/pdf');
      const number = href.split('/').pop().replace('.pdf', '');
      await page.getByTestId('pg-add-resume').click();
      await expect(page.getByTestId('pg-done')).toContainText('On your resume');
      await page.goto(`/verify/${number}`);
      await expect(page.getByTestId('verify-ok')).toContainText(`completed “Dashboard ${tag}” with Projco ${tag} Pvt Ltd`);
      await page.goto('/verify/notarealnumber1');
      await expect(page.getByTestId('verify-none')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
