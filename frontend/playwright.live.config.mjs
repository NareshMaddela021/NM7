// Browser tests against the real API and a real MongoDB (`npm run test:e2e:live`).
// Needs: a MongoDB replica set (TEST_MONGODB_URI, default 127.0.0.1:27017 rs0) and uv for the backend.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-live',
  timeout: 90_000,
  retries: 0,
  workers: 1, // one shared test database
  use: {
    baseURL: 'http://localhost:5182',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: [
    { command: 'sh e2e-live/api.sh', url: 'http://localhost:8001/health', reuseExistingServer: false, timeout: 120_000 },
    {
      command: 'npx vite --port 5182 --strictPort',
      env: { VITE_API_BASE: 'http://localhost:8001' },
      url: 'http://localhost:5182',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
