// End-to-end tests for the free ATS scan: `npm run test:e2e` (starts the dev server itself).
// Locally you can point at an installed Chromium with PW_CHROMIUM=/path/to/chrome.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5181',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npx vite --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
