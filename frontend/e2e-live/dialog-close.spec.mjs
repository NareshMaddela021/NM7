// "Check before you download" and My resumes → Versions on a desktop and a 390 px phone: Escape closes them (even
// when focus has left the dialog's buttons), each has a ✕, and focus goes back to the button that opened it.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const post = (page, path, body) => page.evaluate(async ([base, p, b]) => {
  const r = await fetch(`${base}${p}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status };
}, [API, path, body]);
const RESUME = {
  personal: { name: 'Kiran Rao', email: 'kiran@example.com', phone: '+91 90000 11111', location: 'Pune', title: 'Data Analyst' },
  links: { linkedin: 'linkedin.com/in/kiran-rao' },
  summary: 'Data analyst who builds dashboards.',
  edu: [{ id: 'd1', institution: 'Pune University', degree: 'B.Sc', field: 'Statistics', from: '2020', to: '2023' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python, Excel' }],
};
const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() || '');

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Escape and ✕ close the download check and Versions; focus returns to the opener; 1 link is singular', async ({ page }) => {
      const mail = email(`dc-${label}`);
      seed('customer', mail, 'Kiran Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      const t = Date.now();
      expect((await post(page, '/api/me/resumes', { id: 'r1', name: 'Main', data: RESUME, active: true, versions: [{ at: t - 864e5, label: 'Auto-saved', data: { ...RESUME, summary: 'Analyst.' } }] })).status).toBeLessThan(300);

      // the download check
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByRole('article', { name: 'Resume preview' })).toBeVisible();
      const open = page.getByRole('button', { name: 'Download PDF', exact: true }).first();
      const check = page.getByRole('dialog', { name: 'Check before you download' });
      await open.click();
      await expect(check.getByTestId('check-links')).toContainText('1 link looks right and is clickable', { timeout: 30_000 });
      await page.evaluate(() => document.activeElement?.blur()); // focus outside the dialog's buttons
      await page.keyboard.press('Escape');
      await expect(check).toHaveCount(0);
      await expect.poll(() => focusedText(page)).toBe('Download PDF');
      await open.click();
      await expect(check.getByTestId('check-close')).toBeVisible();
      await check.getByTestId('check-close').click();
      await expect(check).toHaveCount(0);
      await expect.poll(() => focusedText(page)).toBe('Download PDF');

      // Versions
      await page.goto('/me/resumes');
      const versions = page.getByRole('button', { name: 'Versions', exact: true }).first();
      const dlg = page.getByRole('dialog', { name: /^Versions/ });
      await versions.click();
      await expect(dlg.getByTestId('version-compare')).toBeVisible();
      await page.locator('#vc-left').focus();
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
      await expect.poll(() => focusedText(page)).toBe('Versions');
      await versions.click();
      await dlg.getByRole('button', { name: 'Close' }).click();
      await expect(dlg).toHaveCount(0);
      await expect.poll(() => focusedText(page)).toBe('Versions');
    });
  });
}
