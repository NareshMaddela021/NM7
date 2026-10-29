// Automated accessibility checks (axe-core, WCAG 2.1 A and AA rules) on the key pages: public pages, a student's
// dashboard, a coordinator's portal and the admin console; light and dark; desktop and a 390 px phone. Serious and
// critical problems fail the test (the list printed names the rule and the element). Also: 390 px at 200% zoom
// (a 195 px wide layout) never scrolls sideways on the public pages.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, college, noSideScroll } from './college.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PUBLIC = ['/', '/for-orgs', '/login', '/signup', '/builder', '/templates', '/contact', '/status', '/accessibility'];

async function check(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${path} · ${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const [label, opts] of SIZES) {
  for (const scheme of ['light', 'dark']) {
    test.describe(`${label} ${scheme}`, () => {
      test.use({ ...opts, colorScheme: scheme });

      test('public pages', async ({ page }) => {
        test.setTimeout(180_000);
        const found = [];
        for (const p of PUBLIC) found.push(...await check(page, p));
        expect(found, found.join('\n')).toEqual([]);
      });

      test('student dashboard, coordinator portal, admin console', async ({ page, browser }) => {
        test.setTimeout(240_000);
        const found = [];
        const mail = email(`a11y-${label}-${scheme}`);
        seed('customer', mail, 'Asha Rao', PASSWORD);
        await login(page, mail);
        await page.waitForURL('**/me');
        for (const p of ['/me', '/me/resumes', '/me/share', '/me/settings', '/me/help', '/me/groups']) found.push(...await check(page, p));
        const c = await college(browser, { ...opts, colorScheme: scheme }, `${label}${scheme[0]}`, { students: 1, prefix: 'ax' });
        for (const p of ['', '/dashboard', '/drives', '/offers', '/team']) found.push(...await check(c.coord, `/org/${c.org.id}${p}`));
        for (const p of ['/admin', '/admin/settings', '/admin/customers', '/admin/orgs']) found.push(...await check(c.admin, p));
        await c.close();
        expect(found, found.join('\n')).toEqual([]);
      });
    });
  }
}

test.describe('zoom 200% at 390 px', () => {
  test.use({ viewport: { width: 195, height: 422 }, deviceScaleFactor: 4 });
  test('public pages reflow without sideways scrolling', async ({ page }) => {
    test.setTimeout(120_000);
    const wide = [];
    for (const p of PUBLIC) {
      await page.goto(p);
      await page.waitForLoadState('networkidle').catch(() => {});
      if (!(await noSideScroll(page))) wide.push(p);
    }
    expect(wide).toEqual([]);
  });
});

test('dialogs: Escape closes, focus stays inside, returns to the opener', async ({ page }) => {
  const mail = email('a11y-dialog');
  seed('customer', mail, 'Asha Rao', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/me/settings');
  const opener = page.getByRole('button', { name: 'Delete account' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();
});
