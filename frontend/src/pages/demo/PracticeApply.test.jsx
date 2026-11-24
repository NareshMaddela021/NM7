// The practice apply pages for the Chrome Web Store review (/demo/apply/:slug): a made-up company's form, labelled so
// the Nm7 Apply helper fills it, whose Submit sends nothing (no request of any kind) and only says so; never indexed,
// never in the sitemap, and lazy-loaded (never in the first download).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PracticeForm } from './PracticeApply';
import { FIELDS, JOBS, SENT_TEXT, practiceSubmit } from './practiceForm';
import { STATIC_PAGES } from '../../../scripts/prerender-blog.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const vercel = JSON.parse(src('../../../vercel.json'));

describe('practice apply pages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('show a plain form of a made-up company with every field labelled', () => {
    for (const slug of ['junior-data-analyst', 'customer-support-executive']) {
      const html = renderToStaticMarkup(<PracticeForm slug={slug} />);
      expect(html).toContain('Demo Tech Solutions');
      expect(html).toContain(`Apply for ${JOBS[slug].title}`);
      expect(html).toContain('Nothing you type here is sent or saved');
      for (const [name, label] of FIELDS) {
        expect(html).toContain(`for="pa-${name}"`);
        expect(html).toContain(`id="pa-${name}"`);
        expect(html).toContain(label);
      }
      expect(html).toContain('type="file"');
      expect(html).toContain('<textarea');
      expect(html).not.toMatch(/action=|method=/); // the form has nowhere to go
      expect(html).not.toContain(SENT_TEXT); // only after Submit
    }
    expect(renderToStaticMarkup(<PracticeForm slug="nope" />)).toContain('This practice page doesn’t exist');
  });

  it('Submit sends nothing: no fetch, no XHR, no beacon, no storage, only the message', () => {
    const fetch = vi.fn(); const xhr = vi.fn(); const beacon = vi.fn(); const setItem = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('localStorage', { setItem });
    const e = { preventDefault: vi.fn() };
    const done = vi.fn();
    practiceSubmit(e, done);
    expect(e.preventDefault).toHaveBeenCalledTimes(1); // the browser never sends the form either
    expect(done).toHaveBeenCalledWith(true);
    for (const f of [fetch, xhr, beacon, setItem]) expect(f).not.toHaveBeenCalled();
    expect(SENT_TEXT).toBe('Practice form: nothing was sent.');
    for (const file of ['./PracticeApply.jsx', './practiceForm.js']) {
      const code = src(file).replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|services\/http|localStorage|sessionStorage|WebSocket|<form[^>]*action/);
    }
  });

  it('is never indexed, never in the sitemap, and lazy-loaded', () => {
    expect(src('./PracticeApply.jsx')).toMatch(/usePageMeta\(\{[^\n]*noindex: true \}\)/);
    const rule = vercel.headers.find((h) => h.source === '/demo/(.*)');
    expect(rule.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    expect(vercel.rewrites).toContainEqual({ source: '/demo/apply/:slug', destination: '/index.html' });
    expect(STATIC_PAGES.map(([p]) => p).some((p) => p.startsWith('/demo'))).toBe(false);
    const app = src('../../App.jsx');
    expect(app).toContain("const PracticeApply = lazy(() => import('./pages/demo/PracticeApply'))");
    expect(app).not.toMatch(/^import .*pages\/demo\//m);
    expect(src('../../../public/robots.txt')).not.toMatch(/demo\/apply/); // crawlers may fetch it to read noindex
  });
});
