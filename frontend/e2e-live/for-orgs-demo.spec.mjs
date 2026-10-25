// The 2-minute demo on /for-orgs, on a desktop and a 390 px phone: the section sits near the top; nothing of the
// video downloads until play is pressed (only the small poster); pressing play puts in the player with controls,
// playsinline, preload="none", no autoplay attribute and not muted, the 16:9 file on a desktop and the 9:16 file on
// a phone; "Download for WhatsApp" saves the vertical file. The files are served, and the job-seeker home page has
// no video.
import { expect, test } from '@playwright/test';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('demo section: poster first, the right file on play, WhatsApp download, not on the home page', async ({ page, request }) => {
      const videoRequests = [];
      page.on('request', (r) => { if (/\/media\/.*\.mp4/.test(r.url())) videoRequests.push(r.url()); });
      await page.goto('/for-orgs');
      const section = page.getByTestId('demo-video');
      await expect(section.getByRole('heading', { name: 'Watch the 2-minute demo' })).toBeVisible();
      // near the top: right after the opening section
      const order = await page.evaluate(() => [...document.querySelectorAll('main > section')].map((s) => s.querySelector('h1, h2')?.textContent || s.id));
      expect(order.indexOf('Watch the 2-minute demo')).toBeLessThanOrEqual(2);
      expect(order.indexOf('Watch the 2-minute demo')).toBeLessThan(order.indexOf('Plans'));
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      expect(videoRequests).toEqual([]); // nothing of the video before play
      await expect(section.locator('video')).toHaveCount(0);

      await section.getByRole('button', { name: 'Play the 2-minute demo' }).click();
      const v = section.getByTestId('demo-player');
      await expect(v).toBeVisible();
      const want = label === 'phone' ? '/media/nm7-demo-vertical.mp4' : '/media/nm7-demo.mp4';
      expect(await v.evaluate((el) => ({ src: new URL(el.src).pathname, controls: el.controls, playsInline: el.playsInline, preload: el.getAttribute('preload'), autoplay: el.hasAttribute('autoplay'), muted: el.muted, poster: new URL(el.poster).pathname })))
        .toEqual({ src: want, controls: true, playsInline: true, preload: 'none', autoplay: false, muted: false, poster: label === 'phone' ? '/media/nm7-demo-poster-vertical.jpg' : '/media/nm7-demo-poster.jpg' });
      const box = await v.boundingBox();
      if (label === 'phone') expect(box.height).toBeGreaterThan(box.width); else expect(box.width).toBeGreaterThan(box.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      const wa = section.getByTestId('demo-whatsapp');
      await expect(wa).toHaveText('Download for WhatsApp');
      await expect(wa).toHaveAttribute('href', '/media/nm7-demo-vertical.mp4');
      await expect(wa).toHaveAttribute('download', 'Nm7_demo_WhatsApp.mp4');

      // the files are there
      for (const f of ['nm7-demo.mp4', 'nm7-demo-vertical.mp4', 'nm7-demo-poster.jpg', 'nm7-demo-poster-vertical.jpg']) {
        const r = await request.get(`/media/${f}`, { headers: { Range: 'bytes=0-1023' } });
        expect(r.status(), f).toBeLessThan(300);
      }

      await page.goto('/');
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByTestId('demo-video')).toHaveCount(0);
      await expect(page.locator('video')).toHaveCount(0);
    });
  });
}
