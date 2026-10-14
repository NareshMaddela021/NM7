import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vercel serves dist/404.html with a real 404 status for paths that aren't app routes (see vercel.json);
// it's the app itself, which then shows its "page doesn't exist" screen.
const notFoundPage = () => ({
  name: 'nm7-404',
  apply: 'build',
  closeBundle() { if (!single) copyFileSync(resolve('dist/index.html'), resolve('dist/404.html')); },
});

// `npm run build:preview` makes one self-contained HTML file (hash URLs + preview bar)
// that can be opened anywhere without a server.
const single = process.env.SINGLE === '1';

export default defineConfig({
  plugins: [react(), ...(single ? [viteSingleFile()] : [notFoundPage()])],
  base: single ? './' : '/',
  build: { outDir: single ? 'dist-preview' : 'dist' },
  // Unit tests (vitest). The Playwright end-to-end tests live in e2e/ and run with `npm run test:e2e`.
  test: { include: ['src/**/*.test.{js,jsx}'], environment: 'node' },
});
