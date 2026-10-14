import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:preview` makes one self-contained HTML file (hash URLs + preview bar)
// that can be opened anywhere without a server.
const single = process.env.SINGLE === '1';

export default defineConfig({
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  base: single ? './' : '/',
  build: { outDir: single ? 'dist-preview' : 'dist' },
  // Unit tests (vitest). The Playwright end-to-end tests live in e2e/ and run with `npm run test:e2e`.
  test: { include: ['src/**/*.test.{js,jsx}'], environment: 'node' },
});
