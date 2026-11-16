// A read-only smoke check of the LIVE site (Actions → smoke-live → Run workflow): every page opens without a blank
// page, page errors, console errors, failed API calls or a "Page not found", desktop + 390 px. Signed-in areas use
// the demo accounts and only run when the live admin secrets are set (see .github/workflows/smoke-live.yml).
// Never creates orders or sends emails: it only opens pages (the demo "Reset and open" calls reset demo data only).
import { defineConfig } from '@playwright/test';

const SIZES = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } };
export default defineConfig({
  testDir: 'e2e-smoke',
  timeout: 90_000,
  retries: 1, // a page that fails once and passes on the retry is reported as flaky
  workers: 3,
  reporter: [['list'], ['json', { outputFile: 'smoke-results.json' }]],
  use: { baseURL: process.env.SMOKE_URL || 'https://nm7.si', reducedMotion: 'reduce', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  projects: [
    { name: 'setup', testMatch: /setup\.smoke\.mjs/ },
    ...Object.entries(SIZES).map(([name, use]) => ({ name, use, testMatch: /pages\.smoke\.mjs/, dependencies: ['setup'] })),
  ],
});
