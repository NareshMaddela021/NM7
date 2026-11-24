// The blog build step with a made-up Hygraph answer: static pages, SEO tags, JSON-LD, sitemap, and the CSP.
import { mkdtempSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
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
    expect(html).toContain('href="/pricing#scan">Scan your resume free</a>');
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

describe('large blogs: post pages do not embed the whole list', async () => {
  const { postData, EMBED_LIST_MAX } = await import('./prerender-blog.mjs');
  const p = { slug: 'a' };
  it('small blog: list + post; large blog: post only (the app reads /blog/data.json)', () => {
    const small = { builtAt: 'b', posts: [p], categories: [] };
    expect(postData(small, p)).toEqual({ ...small, post: p });
    const big = { builtAt: 'b', posts: Array.from({ length: EMBED_LIST_MAX + 1 }, () => p), categories: [] };
    expect(postData(big, p)).toEqual({ builtAt: 'b', post: p });
  });
});

describe('the older articles (Team Nm7, through the API) merged in', async () => {
  const { OLDER_API, fakeOlderApi } = await import('../src/lib/blog/fixtures/hygraph.js');
  const d = dist();
  const info = [];
  const api = fakeOlderApi({ aliases: { 'what-is-asuraa': 'psu-interview-tips' } });
  const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph(), apiBase: 'https://api.test', apiFetch: api, log: { warn: (m) => info.push(m), info: (m) => info.push(m) } });
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(join(d, dir), { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
  walk('blog');

  it('3 own + 4 older = 5 articles: same slug and same title are kept once (the newer one)', () => {
    expect(res).toMatchObject({ ok: true, posts: 5, older: 4, olderError: null });
    expect(api.calls[0]).toBe('https://api.test/api/blog/legacy?content=1&per_page=200&page=1');
    const built = JSON.parse(read(d, 'blog/data.json'));
    expect(built.posts.map((p) => p.slug)).toEqual(['first-resume-fresher', 'ats-friendly-resume', 'ats-keywords', 'psu-interview-tips', 'govt-job-resume']);
    expect(built.posts.find((p) => p.slug === 'ats-keywords').title).toBe('Which keywords does an ATS look for?'); // the site's own, newer
    expect(built.aliases).toEqual({ 'what-is-asuraa': 'psu-interview-tips', 'ats-friendly-resume-guide': 'ats-friendly-resume' });
    expect(built.categories.map((c) => c.slug)).toEqual(['ats', 'freshers', 'interviews', 'govt-jobs']);
    expect(info.join('\n')).toContain('[blog] merged: 3 own + 4 older = 5 articles');
  });

  it('an older article page: Nm7 title, description, canonical nm7.si URL, BlogPosting + FAQ JSON-LD, the FAQ on the page', () => {
    const html = read(d, 'blog/govt-job-resume/index.html');
    expect(html).toContain('<title>Resume for government jobs by Team Nm7 · Nm7</title>');
    expect(html).toContain('<meta name="description" content="How Nm7 writes a resume for PSU and government jobs." />');
    expect(html).toContain('<link rel="canonical" href="https://nm7.si/blog/govt-job-resume" />');
    const ld = jsonLd(html);
    expect(ld[0]).toMatchObject({ '@type': 'BlogPosting', headline: 'Resume for government jobs by Team Nm7', author: { '@type': 'Organization', name: 'Nm7 Team' }, mainEntityOfPage: { '@id': 'https://nm7.si/blog/govt-job-resume' } });
    expect(ld.map((x) => x['@type'])).toEqual(['BlogPosting', 'BreadcrumbList', 'FAQPage']);
    expect(html).toContain('<h3>Is Nm7 free?</h3><p>Yes, everything on nm7.si is free.</p>');
    expect(html).toContain('<a href="https://nm7.si/blog/psu-interview-tips">our keyword guide</a>');
    expect(html).toContain('href="https://asuraa.ai"'); // the separate product: untouched
    expect(html).toContain('Left over: nm7.si/blog.');
  });

  it('no page, data file or sitemap entry contains "asuraa.in"', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(read(d, f), f).not.toMatch(/asuraa\.in/i);
    expect(read(d, 'sitemap.xml')).not.toMatch(/asuraa\.in/i);
  });

  it('the sitemap lists every article and the categories in use', () => {
    const xml = read(d, 'sitemap.xml');
    for (const s of ['first-resume-fresher', 'ats-friendly-resume', 'ats-keywords', 'psu-interview-tips', 'govt-job-resume']) expect(xml).toContain(`<loc>https://nm7.si/blog/${s}</loc>`);
    expect(xml).toContain('<loc>https://nm7.si/blog/category/govt-jobs</loc>');
    expect(xml).not.toContain('ats-friendly-resume-guide');
    expect(xml).not.toContain('what-is-asuraa');
  });

  it('an old slug that moved gets a small page sending readers on (not indexed)', () => {
    const html = read(d, 'blog/ats-friendly-resume-guide/index.html');
    expect(html).toContain('<link rel="canonical" href="https://nm7.si/blog/ats-friendly-resume" />');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/blog/ats-friendly-resume" />');
    expect(html).toContain('noindex');
  });

  it('API down or no token: the blog\'s own posts are still built, with a warning', async () => {
    const d2 = dist();
    const warns = [];
    const r = await prerenderBlog({ dist: d2, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph(), apiBase: 'https://api.test', apiFetch: fakeOlderApi({ fail: true }), log: { warn: (m) => warns.push(m), info: () => {} } });
    expect(r).toMatchObject({ ok: true, posts: 3, older: 0 });
    expect(warns.join('\n')).toMatch(/older articles could not be read from the API: network error/);
    const r2 = await prerenderBlog({ dist: dist(), endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph(), apiBase: 'https://api.test', apiFetch: fakeOlderApi({ configured: false }), log: quiet });
    expect(r2).toMatchObject({ ok: true, posts: 3, older: 0 });
    expect(OLDER_API).toHaveLength(4);
  });
});

describe('800 articles: pages of 12, a light list page', async () => {
  const { fakeOlderApi } = await import('../src/lib/blog/fixtures/hygraph.js');
  const many = Array.from({ length: 800 }, (_, i) => ({
    id: `o${i}`, slug: `older-article-${i}`, title: `Older article ${i}`, excerpt: 'x', cover: null, category: { name: i % 2 ? 'Govt Jobs' : 'Freshers', slug: i % 2 ? 'govt-jobs' : 'freshers' },
    author: null, publishedAt: new Date(Date.UTC(2025, 0, 1) - i * 3_600_000).toISOString(), content: { children: [{ type: 'paragraph', children: [{ text: 'Body.' }] }] }, faq: [],
  }));
  const d = dist();
  const res = await prerenderBlog({ dist: d, endpoint: 'https://hygraph.test/content', fetchImpl: fakeHygraph(), apiBase: 'https://api.test', apiFetch: fakeOlderApi({ posts: many, aliases: {} }), log: quiet });

  it('every article is pre-rendered and in the sitemap', () => {
    expect(res.posts).toBe(803);
    expect((read(d, 'sitemap.xml').match(/<loc>https:\/\/nm7\.si\/blog\/(?!category)[a-z0-9-]+<\/loc>/g) || []).length).toBe(803);
    expect(read(d, 'blog/older-article-799/index.html')).toContain('<link rel="canonical" href="https://nm7.si/blog/older-article-799" />');
  });

  it('lists in pages of 12 with links to the next and previous page; the list is not embedded in list pages', () => {
    const first = read(d, 'blog/index.html');
    expect(first.match(/class="blog-card"/g)).toHaveLength(12);
    expect(first).toContain('Page 1 of 67');
    expect(first).toContain('<a href="/blog/page/2" rel="next">Older articles</a>');
    expect(first).not.toContain('nm7-blog-data');
    const p2 = read(d, 'blog/page/2/index.html');
    expect(p2).toContain('<link rel="canonical" href="https://nm7.si/blog/page/2" />');
    expect(p2).toContain('<title>Resume &amp; job-search blog · Page 2 · Nm7</title>');
    expect(p2).toContain('<a href="/blog" rel="prev">Newer articles</a>');
    const last = read(d, 'blog/page/67/index.html');
    expect(last.match(/class="blog-card"/g)).toHaveLength(803 - 66 * 12);
    expect(last).not.toContain('rel="next"');
    expect(read(d, 'blog/category/govt-jobs/page/2/index.html')).toContain('<link rel="canonical" href="https://nm7.si/blog/category/govt-jobs/page/2" />');
    expect(first.length).toBeLessThan(60_000);
    expect(read(d, 'blog/older-article-5/index.html')).not.toContain('"posts":['); // a post page carries only itself
  });
});
