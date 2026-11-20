// Batch E polish, desktop 1280 px and a 390 px phone:
//   45 the Easy dashboard home on a wide screen is balanced: the next step and the setup card side by side, the four
//      tiles in one row (a phone keeps one column);
//   46 the browser tab shows the page's own name (Messages, Learning paths), not "My dashboard";
//   47 on the company dashboard the top menu sits on a solid band and never covers the side menu or the content;
//   48 the company Activity list is in plain words, never codes such as "hire.invite" or "drive_create".
import { expect, test } from '@playwright/test';
import { adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

for (const [size, opts] of SIZES) {
  test.describe(size, () => {
    test.use(opts);

    test('Easy dashboard layout and tab titles', async ({ page }) => {
      await studentWith(page, `pe${size[0]}`, { ...STRONG, skills: [] }, 'simple');
      await page.goto('/me/simple');
      if (await page.getByTestId('sx-pick-en').isVisible().catch(() => false)) await page.getByTestId('sx-pick-en').click();
      const next = page.getByTestId('sx-next');
      await expect(next).toBeVisible();
      await expect(page).toHaveTitle('Easy dashboard · Nm7');
      if (size === 'desktop') await expect(page.getByTestId('sx-setup')).toBeVisible(); // this person has setup steps left
      const n = await next.boundingBox();
      const tiles = await Promise.all(['resume', 'jobs', 'apps', 'practice'].map((k) => page.getByTestId(`sx-tile-${k}`).boundingBox()));
      if (size === 'desktop') {
        const setup = page.getByTestId('sx-setup');
        if (await setup.count()) {
          const s = await setup.boundingBox();
          expect(Math.abs(s.y - n.y)).toBeLessThan(4); // side by side
          expect(s.x).toBeGreaterThan(n.x + n.width);
        }
        expect(new Set(tiles.map((b) => Math.round(b.y))).size).toBe(1); // one row
      } else {
        expect(tiles[0].width).toBeLessThan(390);
      }
      expect(await noSideScroll(page)).toBe(true);
      for (const [path, title] of [['/me/messages', 'Messages · Nm7'], ['/me/learn', 'Learning paths · Nm7'], ['/me/profile', 'Job Profile · Nm7']]) {
        await page.goto(path);
        await expect(page).toHaveTitle(title);
      }
    });

    test('company dashboard: the top menu never covers it; activity in plain words', async ({ browser }) => {
      const owner = `pe-${size}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', 'Strong-pass-123');
      const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      await adminLogin(admin, owner, secret);
      let r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {}));
      for (let i = 0; i < 5 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, '/api/admin/demo-company/hire/open', json('POST', {})); }
      expect(r.status).toBe(200);
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      await ctx.addInitScript((s) => { try { localStorage.setItem('nm7-recruiter-account', s); } catch { /* storage blocked */ } }, r.body.session);
      const page = await ctx.newPage();
      await page.goto('/company');
      await expect(page.locator('.co-side')).toBeVisible();
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(300);
      const bg = await page.locator('.site-header').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/); // a solid band, not see-through
      const head = await page.locator('.site-header').boundingBox();
      const side = await page.locator('.co-side').boundingBox();
      // the band is drawn over whatever scrolls under it (the side menu too), never the other way round
      expect(await page.evaluate(([x, y]) => { document.querySelector('.site-header').style.pointerEvents = 'auto'; return !!document.elementFromPoint(x, y)?.closest('.site-header'); }, [side.x + 8, head.y + head.height - 3])).toBe(true);
      if (size === 'phone') expect(await page.locator('.co-side').evaluate((el) => getComputedStyle(el).position)).toBe('static');
      await page.getByRole('tab', { name: 'Activity', exact: true }).click();
      const act = page.getByTestId('co-activity');
      await expect(act).toBeVisible();
      const words = await act.locator('strong').allTextContents();
      expect(words.length).toBeGreaterThan(0);
      for (const w of words) expect(w.split(':')[0]).not.toMatch(/[a-z]+[._][a-z]+/);
    });
  });
}
