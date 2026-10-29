// Build step (after the blog): writes a real HTML file for each public static route (/builder, /contact, the legal
// pages) with that route's own <title>, description, canonical URL and OpenGraph tags, so search engines and link
// previews (WhatsApp, LinkedIn) see the right text instead of the home page's. The file is the app shell: the app
// takes over as usual once its script runs. vercel.json rewrites each route to its file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metaFor } from '../src/lib/meta.js';
import { page, STATIC_PAGES } from './prerender-blog.mjs';

const ORIGIN = 'https://nm7.si';
const IMAGE = `${ORIGIN}/og-image.png`;

/** The routes that get their own file: every static page except the home page (index.html itself) and the blog. */
export const STATIC_ROUTES = STATIC_PAGES.map(([p]) => p).filter((p) => p !== '/' && p !== '/blog');

/** The head meta for one route, in the shape `page()` takes. */
export function staticMeta(path) {
  const m = metaFor(path);
  return { title: `${m.title} · Nm7`, description: m.description, noindex: m.noindex, canonical: `${ORIGIN}${path}`, type: 'website', image: IMAGE };
}

/** Writes dist/<route>/index.html for each static route. Returns the routes written. */
export function prerenderStatic({ dist, log = console } = {}) {
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  for (const route of STATIC_ROUTES) {
    const file = join(dist, route, 'index.html');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, page(template, staticMeta(route), ''));
  }
  log.info?.(`[static] pre-rendered ${STATIC_ROUTES.length} pages with their own meta: ${STATIC_ROUTES.join(' ')}`);
  return STATIC_ROUTES;
}
