// Versions → compare, on a desktop and a 390 px phone, against the real API: any two versions (or a version and the
// current resume) side by side by section, added green / removed red / changed lines with the changed words marked,
// template and design changes listed on their own, "Restore this version" as before; stacked on a phone.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const post = (page, path, body) => page.evaluate(async ([base, p, b]) => {
  const r = await fetch(`${base}${p}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, body]);

const base = (over = {}) => ({
  personal: { name: 'Ravi Teja', email: 'ravi@example.com', phone: '+91 90000 11111', location: 'Vizag', title: 'Analyst' },
  summary: 'Analyst who builds dashboards.',
  exp: [{ id: 'e1', company: 'Acme', role: 'Intern', from: '2024-01', to: '2024-06', description: 'Built 12 Power BI dashboards for sales\nCleaned CSV files in Python\nAnswered support emails' }],
  edu: [{ id: 'd1', institution: 'Andhra University', degree: 'B.Sc', field: 'Statistics', from: '2020', to: '2023' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python' }],
  design: { preset: 'fresher', font: 'source-sans-3', accent: '#111827' },
  ...over,
});
const CURRENT = base({
  summary: 'Analyst who builds dashboards and weekly reports.',
  exp: [{ id: 'e1', company: 'Acme', role: 'Intern', from: '2024-01', to: '2024-06', description: 'Built 15 Power BI dashboards for sales\nCleaned CSV files in Python\nTrained 3 new interns' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python, Excel' }],
  design: { preset: 'fresher', font: 'lora', accent: '#1d4ed8' },
});
const MIDDLE = base({ summary: 'Analyst who builds dashboards and reports.' });

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('compare any two versions by section, words marked, design listed, restore', async ({ page }) => {
      const mail = email(`vc-${label}`);
      seed('customer', mail, 'Ravi Teja', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      const t = Date.now();
      const r = await post(page, '/api/me/resumes', { id: 'r1', name: 'Main', data: CURRENT, active: true,
        versions: [{ at: t - 3 * 864e5, label: 'First version', data: base() }, { at: t - 864e5, label: 'Auto-saved', data: MIDDLE }] });
      expect(r.status).toBeLessThan(300);
      await page.goto('/me/resumes');
      await page.getByRole('button', { name: 'Versions', exact: true }).first().click();
      const vc = page.getByTestId('version-compare');
      await expect(vc).toBeVisible();
      // the newest saved version vs current by default
      await expect(page.locator('#vc-left')).toHaveValue('v0');
      await expect(page.locator('#vc-right')).toHaveValue('current');
      await page.locator('#vc-left').selectOption('v1');
      await expect(vc.getByTestId('vc-design')).toContainText('Font: source-sans-3 → lora');
      await expect(vc.getByTestId('vc-design')).toContainText('Accent colour: #111827 → #1d4ed8');
      const exp = vc.locator('[data-testid^="vc-section-"]').filter({ hasText: 'Answered support emails' });
      await expect(exp.locator('[data-change="removed"]')).toHaveText('Answered support emails');
      await expect(exp.locator('[data-change="added"]')).toHaveText('Trained 3 new interns');
      await expect(exp.locator('[data-change="changed-old"] mark')).toHaveText('12');
      await expect(exp.locator('[data-change="changed-new"] mark')).toHaveText('15');
      await expect(vc.getByTestId('vc-summary')).toContainText('sections changed');
      // two saved versions against each other
      await page.locator('#vc-right').selectOption('v0');
      await expect(vc.getByTestId('vc-design')).toHaveCount(0);
      const sum = vc.locator('[data-testid^="vc-section-"]').filter({ has: page.locator('[data-change="changed-new"]') }).first();
      expect((await sum.locator('[data-change="changed-new"] mark').allTextContents()).join(' ')).toContain('reports.');
      await expect(sum.locator('[data-change="changed-old"]')).toHaveText('Analyst who builds dashboards.');
      // phone: one column, no sideways scrolling
      const cols = await vc.locator('.vc-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(label === 'phone' ? 1 : 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // restore stays as before
      await page.locator('#vc-left').selectOption('v1');
      await vc.getByRole('button', { name: 'Restore this version' }).click();
      await expect(page.getByText('Restored — the current one is saved as a version too')).toBeVisible();
    });
  });
}
