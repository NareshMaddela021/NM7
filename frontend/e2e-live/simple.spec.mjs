// The Easy dashboard (Phase 4, E1 + E2 + E7) on a desktop and a 390 px phone, against the real API: the language is
// asked first (three big buttons, each in its own script) and kept on the profile; one "Your next step" card from the
// rules; 4 big tiles + More; the Simple / Full switch both ways; the last data shown with no internet; 200% zoom
// without sideways scrolling; axe in light and dark.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SIZES, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';
import { teluguHindi } from './helpers.mjs';

teluguHindi(test); // these tests are about Telugu / Hindi: shown for this file (item 41)

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const axe = async (page) => (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations
  .filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
const NO_SKILLS = { ...STRONG, skillGroups: [] };

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('language first, next step, tiles, switch, offline', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await studentWith(page, label, NO_SKILLS, 'simple');
      await page.goto('/me/simple');
      // the language first: each name in its own script
      for (const [c, name] of [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिंदी']]) await expect(page.getByTestId(`sx-pick-${c}`)).toHaveText(name);
      await expect(page.getByTestId('sx-hear-te')).toHaveAccessibleName('Hear తెలుగు');
      expect(await axe(page)).toEqual([]);
      await page.getByTestId('sx-pick-te').click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('నమస్తే Asha');
      const next = page.getByTestId('sx-next');
      await expect(next).toHaveAttribute('data-key', 'skills');
      await expect(next).toContainText('మీ నైపుణ్యాలు చేర్చండి');
      await expect(page.getByTestId('sx-tile-resume')).toHaveText(/నా రెజ్యూమ్/);
      for (const k of ['resume', 'jobs', 'apps', 'practice']) {
        const box = await page.getByTestId(`sx-tile-${k}`).boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(48);
      }
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sx-p')).fontSize))).toBeGreaterThanOrEqual(18);
      expect(await noSideScroll(page)).toBe(true);
      expect(await axe(page)).toEqual([]);
      // kept on the profile: a fresh browser storage still opens in Telugu
      await page.evaluate(() => { localStorage.removeItem('nm7-lang'); sessionStorage.removeItem('nm7-simple-cache'); });
      await page.reload();
      await expect(page.getByTestId('sx-next')).toContainText('మీ నైపుణ్యాలు చేర్చండి');
      // dark mode and 200% zoom
      await page.emulateMedia({ colorScheme: 'dark' });
      expect(await axe(page)).toEqual([]);
      await page.emulateMedia({ colorScheme: 'light' });
      const vp = page.viewportSize();
      await page.setViewportSize({ width: Math.round(vp.width / 2), height: Math.round(vp.height / 2) });
      expect(await noSideScroll(page)).toBe(true);
      await page.setViewportSize(vp);
      // change the language from the top
      await page.getByTestId('sx-lang').click();
      await page.getByTestId('sx-pick-en').click();
      await expect(page).toHaveURL(/\/me\/simple$/);
      await expect(page.getByTestId('sx-next')).toContainText('Add your skills');
      await expect(page.getByTestId('sx-next-go')).toHaveText(/Add my skills/);
      // More: everything else, in the full dashboard
      await page.getByTestId('sx-more').click();
      await expect(page.getByTestId('sx-more-certs')).toHaveAttribute('href', '/me/certificates');
      expect(await axe(page)).toEqual([]);
      // no internet: the last data stays, with a note
      await page.route('**/api/me/simple**', (r) => r.abort('internetdisconnected'));
      await page.evaluate(() => window.dispatchEvent(new Event('online'))); // the screen tries to refresh
      await expect(page.getByTestId('sx-offline')).toContainText('Will update when internet is back');
      await expect(page.getByTestId('sx-more-certs')).toBeVisible();
      await page.unroute('**/api/me/simple**');
      // Simple → Full → Simple, remembered
      await page.goto('/me/simple');
      await page.getByTestId('sx-to-full').click();
      await expect(page).toHaveURL(/\/me$/);
      await page.reload();
      await expect(page).toHaveURL(/\/me$/);
      await page.getByTestId('to-simple').click();
      await expect(page).toHaveURL(/\/me\/simple$/);
      await page.goto('/me');
      await expect(page).toHaveURL(/\/me\/simple$/); // Simple is their dashboard now
    });
  });
}
