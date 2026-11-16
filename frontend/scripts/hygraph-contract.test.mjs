// Contract test against the REAL Hygraph APIs (needs internet). Runs in CI (frontend.yml) with HYGRAPH_CONTRACT=1;
// skipped otherwise, and skipped when the network can't reach Hygraph. It runs the exact queries and the exact build
// step Vercel runs, and checks the build sees every published post (counted independently on both endpoints).
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES_QUERY, DEFAULT_ENDPOINT, POSTS_QUERY, POST_QUERY, buildEndpoint, gql } from '../src/lib/blog/hygraph.js';
import { prerenderBlog } from './prerender-blog.mjs';

const BUILD = buildEndpoint();
const CDN = process.env.VITE_HYGRAPH_ENDPOINT || DEFAULT_ENDPOINT;
const COUNT = 'query Count { posts(first: 1000) { slug } }'; // simplest possible: what's published?

/** Runs the request; skips the test when Hygraph can't be reached at all. */
async function live(ctx, fn) {
  try { return await fn(); } catch (e) {
    if (/^network error/.test(e.message)) ctx.skip();
    throw e;
  }
}

describe.skipIf(!process.env.HYGRAPH_CONTRACT)('Hygraph contract (live endpoints)', () => {
  it('the build’s queries are valid against the live schema', async (ctx) => {
    const d = await live(ctx, () => gql(POSTS_QUERY, { first: 100, skip: 0 }, { endpoint: BUILD })); // throws on any GraphQL error
    for (const p of d.posts) expect(p.content.raw.children).toBeInstanceOf(Array);
    const c = await gql(CATEGORIES_QUERY, {}, { endpoint: BUILD });
    expect(c.categories.map((x) => x.slug)).toEqual(expect.arrayContaining(['resume-tips', 'ats', 'freshers', 'interviews', 'govt-psu-jobs', 'career-switch']));
    expect((await gql(POST_QUERY, { slug: 'no-such-post-contract-test' }, { endpoint: BUILD })).post).toBeNull();
    // the browser's endpoint (CDN) accepts the same queries
    await gql(POSTS_QUERY, { first: 1, skip: 0 }, { endpoint: CDN });
  });

  it('the build step pre-renders every published post (posts.length >= 1 whenever Hygraph has posts)', async (ctx) => {
    const published = (await live(ctx, () => gql(COUNT, {}, { endpoint: BUILD }))).posts.map((p) => p.slug).sort();
    const viaCdn = (await gql(COUNT, {}, { endpoint: CDN })).posts.map((p) => p.slug).sort();
    const dist = mkdtempSync(join(tmpdir(), 'nm7-contract-'));
    copyFileSync(new URL('../index.html', import.meta.url), join(dist, 'index.html'));
    const warnings = [];
    const res = await prerenderBlog({ dist, log: { warn: (m) => warnings.push(m), info: (m) => console.log(m) } }); // default = the build endpoint
    console.log(`[contract] published: ${published.length} (${published.join(', ') || 'none'}); CDN sees ${viaCdn.length}; build pre-rendered ${res.posts} posts, ${res.categories} categories`);
    expect(warnings).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.categories).toBeGreaterThanOrEqual(6);
    expect(res.posts).toBe(published.length);
    if (published.length > 0) expect(res.posts).toBeGreaterThanOrEqual(1);
    const data = JSON.parse(readFileSync(join(dist, 'blog/data.json'), 'utf8'));
    expect(data.posts.map((p) => p.slug).sort()).toEqual(published);
    const list = readFileSync(join(dist, 'blog/index.html'), 'utf8');
    if (published.length === 0) expect(list).toContain('First articles coming soon.');
    for (const slug of published) {
      expect(list).toContain(`href="/blog/${slug}"`);
      expect(readFileSync(join(dist, 'blog', slug, 'index.html'), 'utf8')).toContain(`<link rel="canonical" href="https://nm7.si/blog/${slug}" />`);
    }
  }, 60_000);
});
