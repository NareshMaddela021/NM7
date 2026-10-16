// The blog build step with a made-up Hygraph answer: static pages, SEO tags, JSON-LD, sitemap, and the CSP.
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prerenderBlog } from './prerender-blog.mjs';
import { POSTS, fakeHygraph } from '../src/lib/blog/fixtures/hygraph.js';

const quiet = { warn: () => {}, info: () => {} };
function dist() {
  const d = mkdtempSync(join(tmpdir(), 'nm7-blog-'));
  copyFileSync(new URL('../index.html', import.meta.url), join(d, 'index.html')); // same head tags as the built page
  return d;
}
const read = (d, p) => readFileSync(join(d, p), 'utf8');
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('pre-rendering the blog at build time', async () => {
  const d = dist();
  const fetchImpl = fakeHygraph();
  const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl, log: quiet });

  it('asks Hygraph for published posts, newest first', () => {
    expect(res).toMatchObject({ ok: true, posts: 3, categories: 3, postsError: null, categoriesError: null });
    expect(fetchImpl.calls.every((c) => c.url === 'https://hygraph.test/content')).toBe(true);
    expect(fetchImpl.calls.find((c) => c.body.query.includes('posts(')).body.query).toContain('orderBy: publishedAt_DESC');
  });

  it('writes the article as real HTML with its own title, description, canonical and social tags', () => {
    const html = read(d, 'blog/ats-friendly-resume/index.html');
    expect(html).toContain('<title>How to make an ATS-friendly resume · Nm7</title>');
    expect(html.match(/<title>/g)).toHaveLength(1); // the home page's title is gone
    expect(html).toContain('<meta name="description" content="The five rules that get an ATS to read your resume — with examples for Indian job seekers." />');
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://nm7.si/blog/ats-friendly-resume" />');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta property="og:image" content="https://ap-south-1.graphassets.com/abc/ats-friendly-resume.jpg" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // the article itself is in the page (not only after JavaScript runs)
    expect(html).toContain('<h1 class="display h2">How to make an ATS-friendly resume</h1>');
    expect(html).toContain('ATS software reads your resume before a person does.');
    expect(html).toContain('<h2>Use standard headings</h2>');
    expect(html).toContain('Nm7 Team · 10 Oct 2026 · 2 min read');
    expect(html).toContain('href="/">Scan your resume free</a>');
    expect(html).not.toMatch(/<script>alert/);
    // related: the other ATS post, not the fresher one
    const related = html.slice(html.indexOf('Related articles'));
    expect(related).toContain('/blog/ats-keywords');
    expect(related).not.toContain('/blog/first-resume-fresher');
    // the app's own bundle still loads
    expect(html).toMatch(/<script type="module"[^>]*src="\/src\/main.jsx"/);
  });

  it('adds BlogPosting and BreadcrumbList JSON-LD', () => {
    const [post, crumbs] = jsonLd(read(d, 'blog/ats-friendly-resume/index.html'));
    expect(post).toMatchObject({
      '@type': 'BlogPosting', headline: 'How to make an ATS-friendly resume',
      description: 'The five rules that get an ATS to read your resume — with examples for Indian job seekers.',
      image: ['https://ap-south-1.graphassets.com/abc/ats-friendly-resume.jpg'],
      datePublished: '2026-10-10T05:00:00.000Z', dateModified: '2026-10-12T08:30:00.000Z',
      author: { name: 'Nm7 Team' }, publisher: { '@type': 'Organization', name: 'Nm7' },
      mainEntityOfPage: { '@id': 'https://nm7.si/blog/ats-friendly-resume' },
    });
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(['Home', 'Blog', 'ATS', 'How to make an ATS-friendly resume']);
  });

  it('falls back to the excerpt and the site image', () => {
    const html = read(d, 'blog/ats-keywords/index.html');
    expect(html).toContain('<meta name="description" content="Find the words recruiters search for." />');
    expect(html).toContain('<meta property="og:image" content="https://nm7.si/og-image.png" />');
  });

  it('writes the list and category pages, newest first', () => {
    const list = read(d, 'blog/index.html');
    expect(list).toContain('<link rel="canonical" href="https://nm7.si/blog" />');
    const order = ['first-resume-fresher', 'ats-friendly-resume', 'ats-keywords'].map((s) => list.indexOf(`href="/blog/${s}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const ats = read(d, 'blog/category/ats/index.html');
    expect(ats).toContain('<link rel="canonical" href="https://nm7.si/blog/category/ats" />');
    expect(ats).toContain('/blog/ats-keywords');
    expect(ats).not.toContain('href="/blog/first-resume-fresher"');
    expect(read(d, 'blog/category/interviews/index.html')).toContain('content="noindex, follow"'); // no posts yet
    const built = JSON.parse(read(d, 'blog/data.json'));
    expect(built.posts).toHaveLength(3);
    expect(Date.now() - Date.parse(built.builtAt)).toBeLessThan(60_000); // the browser goes live when it gets old
    expect(JSON.parse(read(d, 'blog/ats-keywords/post.json')).title).toBe('Which keywords does an ATS look for?');
  });

  it('builds the sitemap with every post (lastmod = updatedAt), used categories and the existing pages', () => {
    const xml = read(d, 'sitemap.xml');
    expect(xml).toContain('<loc>https://nm7.si/blog/ats-friendly-resume</loc><lastmod>2026-10-12T08:30:00.000Z</lastmod>');
    for (const p of POSTS) expect(xml).toContain(`<loc>https://nm7.si/blog/${p.slug}</loc>`);
    expect(xml).toContain('<loc>https://nm7.si/blog/category/ats</loc>');
    expect(xml).not.toContain('/blog/category/interviews'); // empty
    for (const p of ['/', '/builder', '/blog', '/contact', '/terms', '/privacy', '/refund-policy']) expect(xml).toContain(`<loc>https://nm7.si${p}</loc>`);
  });
});

describe('no posts yet (6 categories)', () => {
  it('/blog says "First articles coming soon" and data.json lists the categories', async () => {
    const d = dist();
    const six = ['resume-tips', 'ats', 'freshers', 'interviews', 'govt-psu-jobs', 'career-switch'].map((slug) => ({ name: slug, slug }));
    const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph({ posts: [], categories: six }), log: quiet });
    expect(res).toMatchObject({ ok: true, posts: 0, categories: 6 });
    expect(read(d, 'blog/index.html')).toContain('First articles coming soon.');
    expect(JSON.parse(read(d, 'blog/data.json'))).toMatchObject({ posts: [], categories: six });
    expect(read(d, 'blog/category/ats/index.html')).toContain('content="noindex, follow"');
  });
});

describe('when Hygraph fails', () => {
  it('the build still succeeds and logs exactly why; data.json says posts: null (the app reads Hygraph)', async () => {
    const d = dist();
    const warnings = [];
    const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph({ fail: true }), log: { warn: (m) => warnings.push(m), info: () => {} } });
    expect(res.ok).toBe(false);
    expect(warnings.join('\n')).toMatch(/the posts query failed: network error/);
    expect(warnings.join('\n')).toMatch(/the categories query failed: network error/);
    expect(read(d, 'blog/index.html')).toContain('<link rel="canonical" href="https://nm7.si/blog" />');
    expect(read(d, 'blog/index.html')).not.toContain('nm7-blog-data'); // the app fetches in the browser
    expect(JSON.parse(read(d, 'blog/data.json'))).toMatchObject({ posts: null, categories: null }); // no 404
    expect(read(d, 'sitemap.xml')).toContain('<loc>https://nm7.si/blog</loc>');
  });

  it('a failing posts query is never written as an empty list, even when categories work', async () => {
    const d = dist();
    const warnings = [];
    const fetchImpl = async (url, init) => {
      const q = JSON.parse(init.body).query;
      if (q.includes('posts(')) return { ok: false, status: 400, text: async () => JSON.stringify({ errors: [{ message: "field 'json' is not defined in 'RichText'" }] }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { categories: [{ name: 'ATS', slug: 'ats' }] } }) };
    };
    const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl, log: { warn: (m) => warnings.push(m), info: () => {} } });
    expect(res).toMatchObject({ ok: false, posts: 0, categories: 1, postsError: "HTTP 400 — field 'json' is not defined in 'RichText'", categoriesError: null });
    expect(warnings[0]).toContain("[blog] WARNING: the posts query failed: HTTP 400 — field 'json' is not defined in 'RichText'");
    expect(JSON.parse(read(d, 'blog/data.json')).posts).toBeNull(); // not []
  });

  it('logs the endpoint and the posts and categories it got', async () => {
    const d = dist();
    const info = [];
    await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph(), log: { warn: () => {}, info: (m) => info.push(m) } });
    expect(info).toEqual(expect.arrayContaining([
      '[blog] reading Hygraph at https://hygraph.test/content',
      '[blog] posts: 3 published (first-resume-fresher, ats-friendly-resume, ats-keywords)',
      '[blog] categories: 3 (ats, freshers, interviews)',
    ]));
  });
});

describe('vercel.json', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = v.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value;
  const dir = (name) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)).split(/\s+/);
  it('the CSP allows Hygraph images and the Content API', () => {
    expect(dir('img-src')).toEqual(expect.arrayContaining(['https://media.graphassets.com', 'https://*.graphassets.com']));
    expect(dir('connect-src')).toContain('https://ap-south-1.cdn.hygraph.com');
  });
  it('serves the pre-rendered blog files (before the app’s own rewrites)', () => {
    const blog = v.rewrites.findIndex((r) => r.source === '/blog/:slug');
    expect(v.rewrites[blog].destination).toBe('/blog/:slug/index.html');
    expect(v.rewrites.find((r) => r.source === '/blog').destination).toBe('/blog/index.html');
    expect(v.rewrites.find((r) => r.source === '/blog/category/:slug').destination).toBe('/blog/category/:slug/index.html');
    expect(v.rewrites.some((r) => r.destination === '/index.html' && /blog/.test(r.source))).toBe(false);
  });
});
