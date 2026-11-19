// The deep journeys (e2e-smoke/journeys-*.smoke.mjs) against a LOCAL copy instead of the live site: the production
// build served like Vercel (e2e-live/serve-dist.mjs) and the real API on a throwaway database (e2e-live/api.sh). A
// local owner admin with an authenticator key is made first, so the signed-in areas run too (the live site needs the
// SMOKE_ADMIN_* secrets for that). Uses the fixed e2e-live ports: run it inside the e2e-live lock.
//   flock /tmp/claude-0/e2e-live.lock npx playwright test -c playwright.journeys-local.config.mjs
import { defineConfig } from '@playwright/test';

process.env.SMOKE_URL = 'http://localhost:5182';
process.env.SMOKE_API = 'http://localhost:8001';
const SIZES = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } };
export default defineConfig({
  testDir: 'e2e-smoke',
  timeout: 90_000,
  retries: 0,
  workers: 2,
  globalSetup: './e2e-smoke/local-admin.mjs',
  reporter: [['list'], ['json', { outputFile: 'journeys-local-results.json' }]],
  outputDir: 'test-results-journeys-local',
  use: { baseURL: 'http://localhost:5182', reducedMotion: 'reduce', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  projects: [
    { name: 'setup', testMatch: /setup\.smoke\.mjs/ },
    ...Object.entries(SIZES).map(([name, use]) => ({ name: `j-${name}`, use, testMatch: /journeys-.*\.smoke\.mjs/, dependencies: ['setup'] })),
  ],
  webServer: [
    { command: 'sh e2e-live/api.sh', url: 'http://localhost:8001/health', reuseExistingServer: false, timeout: 120_000 },
    { command: 'node e2e-live/build-with-blog.mjs && node e2e-live/serve-dist.mjs dist', url: 'http://localhost:5182', reuseExistingServer: false, timeout: 240_000 },
  ],
});
