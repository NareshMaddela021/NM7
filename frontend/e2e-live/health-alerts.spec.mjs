// Resume health alerts on a desktop and a 390 px phone, against the real API: the dashboard card lists what to fix
// (no LinkedIn link, empty Certifications, still "currently studying" after the course ended), each with one button
// that opens the exact builder section, a ✕ that dismisses it for good, the Settings switch for the emails, and the
// "Stop these emails" page from the email link.
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);
const RESUME = {
  personal: { name: 'Kavya Sri', email: 'kavya@example.com', phone: '+91 90000 33333', location: 'Guntur', title: 'Student' },
  links: {},
  edu: [{ institution: 'VIT-AP', degree: 'B.Tech', field: 'ECE', from: '2020', to: '2024', current: true }],
  certs: [],
};
const token = (uid) => `${uid}.${createHmac('sha256', 'e2e-only-secret').update(`health-unsub\x1f${uid}`).digest('hex').slice(0, 32)}`;

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('dashboard alerts open the exact place to fix; dismiss; email switch and unsubscribe link', async ({ page }) => {
      const mail = email(`ha-${label}`);
      seed('customer', mail, 'Kavya Sri', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
      const [r] = (await call(page, '/api/me/resumes')).body;
      await call(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME }) });
      await page.reload();
      const card = page.getByTestId('health-card');
      await expect(card).toBeVisible();
      await expect(card.getByTestId('health-no_linkedin')).toContainText('Add your LinkedIn link');
      await expect(card.getByTestId('health-no_certs')).toContainText('Certifications section is empty');
      await expect(card.getByTestId('health-graduated')).toContainText('ends in 2024');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // one button opens the exact builder section
      await card.getByTestId('health-fix-no_certs').click();
      await expect(page).toHaveURL(/\/builder\?start=section&sec=certs/);
      await expect(page.getByRole('heading', { name: /Certifications/ }).first()).toBeVisible();
      // dismissed for good
      await page.goto('/me');
      await page.getByTestId('health-dismiss-graduated').click();
      await expect(page.getByTestId('health-graduated')).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('health-card')).toBeVisible();
      await expect(page.getByTestId('health-graduated')).toHaveCount(0);
      // the email switch in Settings
      await page.goto('/me/settings');
      const sw = page.getByTestId('health-emails');
      await expect(sw).toBeChecked();
      await sw.focus(); // (keyboard: on a phone the header that hides on scroll keeps the box moving under the pointer)
      await page.keyboard.press('Space');
      await expect.poll(async () => (await call(page, '/api/me/health')).body.emails).toBe(false);
      await expect(sw).not.toBeChecked();
      await page.keyboard.press('Space');
      await expect(sw).toBeChecked();
      await expect.poll(async () => (await call(page, '/api/me/health')).body.emails).toBe(true);
      // the email's "Stop these emails" link
      const uid = (await call(page, '/api/auth/me')).body.id;
      await page.goto(`/stop-alerts#t=${token(uid)}`);
      await page.getByTestId('stop-confirm').click();
      await expect(page.getByTestId('stop-done')).toContainText('you won’t get resume health emails any more');
      expect((await call(page, '/api/me/health')).body.emails).toBe(false);
    });
  });
}
