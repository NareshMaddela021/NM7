import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prerenderStatic, STATIC_ROUTES, staticMeta } from './prerender-static.mjs';

const TEMPLATE = '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="description" content="home" /><meta property="og:title" content="home" /><link rel="canonical" href="https://nm7.si/" /><title>Home | Nm7</title></head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>';

describe('static routes get their own head', () => {
  it('covers the builder, /templates, contact, /for-orgs, /partners and the legal pages, never the home page or the blog', () => {
    expect(STATIC_ROUTES).toEqual(['/builder', '/templates', '/contact', '/for-orgs', '/partners', '/terms', '/privacy', '/refund-policy', '/delivery-policy', '/expert-terms']);
  });
  it('writes one file per route with that route’s title, description, canonical and OpenGraph tags', () => {
    const dist = mkdtempSync(join(tmpdir(), 'nm7-static-'));
    writeFileSync(join(dist, 'index.html'), TEMPLATE);
    expect(prerenderStatic({ dist, log: {} })).toHaveLength(10);
    const html = readFileSync(join(dist, 'builder', 'index.html'), 'utf8');
    expect(html).toContain('<title>Resume builder · Nm7</title>');
    expect(html).toContain('<link rel="canonical" href="https://nm7.si/builder" />');
    expect(html).toContain('<meta property="og:title" content="Resume builder · Nm7" />');
    expect(html).toContain('<meta property="og:url" content="https://nm7.si/builder" />');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).not.toContain('content="home"');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('/assets/index-abc.js'); // the app shell is kept
    const gallery = readFileSync(join(dist, 'templates', 'index.html'), 'utf8'); // no personal data: the shell and its meta
    expect(gallery).toContain('<link rel="canonical" href="https://nm7.si/templates" />');
    expect(gallery).toContain('<meta property="og:image" content="https://nm7.si/og-image.png" />');
    const legal = readFileSync(join(dist, 'refund-policy', 'index.html'), 'utf8');
    expect(legal).toContain('<title>Refund &amp; cancellation policy · Nm7</title>');
  });
  it('uses the same text the app sets in the browser', () => {
    expect(staticMeta('/contact')).toMatchObject({ title: 'Contact us · Nm7', description: 'How to reach Nm7.', canonical: 'https://nm7.si/contact', noindex: false });
  });
});

describe('vercel.json serves the pre-rendered static routes', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  it('rewrites each static route to its own file, before the app’s catch-all rewrites', () => {
    const catchAll = v.rewrites.findIndex((r) => r.destination === '/index.html' && r.source !== '/');
    for (const route of STATIC_ROUTES) {
      const i = v.rewrites.findIndex((r) => r.source === route);
      expect(i, route).toBeGreaterThanOrEqual(0);
      expect(v.rewrites[i].destination).toBe(`${route}/index.html`);
      expect(i).toBeLessThan(catchAll);
    }
  });
});
