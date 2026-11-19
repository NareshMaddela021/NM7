// Screenshots of the Easy dashboard (/me/simple) for a job seeker and a student, desktop 1280 px and phone 390 px at
// 2x, for the no-emoji sweep's before / after pictures. Only runs when SHOTS_NOEMOJI is set to "before" or "after"
// (the file name prefix); pictures go to SHOTS_DIR (default ../docs/screens/no-emoji). Not a test of behaviour.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { STRONG, studentWith } from './autoapply.mjs';
import { call, json } from './college.mjs';

const WHEN = process.env.SHOTS_NOEMOJI;
const OUT = process.env.SHOTS_DIR || join('..', 'docs', 'screens', 'no-emoji');
const SIZES = [
  ['desktop', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }],
];
// a job seeker with a full resume, and a student who has not added skills yet (a different next step)
const PEOPLE = [['jobseeker', STRONG], ['student', { ...STRONG, skillGroups: [] }]];

test.skip(!WHEN, 'screenshots only when SHOTS_NOEMOJI is set');

for (const [size, opts] of SIZES) {
  for (const [who, data] of PEOPLE) {
    test(`Easy dashboard, ${who}, ${size}`, async ({ browser }) => {
      test.setTimeout(120_000);
      mkdirSync(OUT, { recursive: true });
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await studentWith(page, `${size}-${who}`, data, `shots-${who}`);
      expect((await call(page, '/api/auth/roles', json('POST', { add: [who], active: who }))).status).toBe(200);
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'en', mode: 'simple' }))).status).toBe(200);
      await page.goto('/me/simple');
      await expect(page.getByTestId('sx-next')).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `${WHEN}-${who}-${size}.png`), fullPage: true });
      await ctx.close();
    });
  }
}
