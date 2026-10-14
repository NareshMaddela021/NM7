// The production build served with the vercel.json headers (CSP etc.) against the real API:
// `npm run test:e2e:csp`. Checks nothing is blocked by the Content-Security-Policy and unknown paths answer 404.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-live',
  testMatch: /zz-csp/,
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5182', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  webServer: [
    { command: 'sh e2e-live/api.sh', url: 'http://localhost:8001/health', reuseExistingServer: false, timeout: 120_000 },
    { command: 'VITE_API_BASE=http://localhost:8001 npx vite build --logLevel error && node e2e-live/serve-dist.mjs dist', url: 'http://localhost:5182', reuseExistingServer: false, timeout: 180_000 },
  ],
});
