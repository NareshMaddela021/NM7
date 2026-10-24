import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// After the build:
// - Vercel serves dist/404.html with a real 404 status for paths that aren't app routes (see vercel.json); it's the
//   app itself, which then shows its "page doesn't exist" screen.
// - the blog is pre-rendered from Hygraph into static pages, and dist/sitemap.xml is written (scripts/prerender-blog.mjs);
//   the public static routes get their own head tags (scripts/prerender-static.mjs).
//   A Hygraph problem only logs a warning: the build still succeeds.
export const withoutHomePreload = (html) => html.replace(/[^\n]*<!-- The home page's first hero image[^\n]*\n/, '').replace(/[^\n]*data-home-only[^\n]*\n/, '');

const afterBuild = () => ({
  name: 'nm7-after-build',
  apply: 'build',
  async closeBundle() {
    if (single) return;
    // the hero image preload is for the home page only: every page made from index.html below is made without it
    const home = readFileSync(resolve('dist/index.html'), 'utf8');
    writeFileSync(resolve('dist/index.html'), withoutHomePreload(home));
    copyFileSync(resolve('dist/index.html'), resolve('dist/404.html'));
    const { prerenderBlog } = await import('./scripts/prerender-blog.mjs');
    await prerenderBlog({ dist: resolve('dist') });
    const { prerenderStatic } = await import('./scripts/prerender-static.mjs');
    prerenderStatic({ dist: resolve('dist') });
    writeFileSync(resolve('dist/index.html'), home);
  },
});

// `npm run build:preview` makes one self-contained HTML file (hash URLs + preview bar)
// that can be opened anywhere without a server.
const single = process.env.SINGLE === '1';

export default defineConfig({
  plugins: [react(), ...(single ? [viteSingleFile()] : [afterBuild()])],
  base: single ? './' : '/',
  build: { outDir: single ? 'dist-preview' : 'dist' },
  // Unit tests (vitest). The Playwright end-to-end tests live in e2e/ and run with `npm run test:e2e`.
  test: { include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs'], environment: 'node' },
});
