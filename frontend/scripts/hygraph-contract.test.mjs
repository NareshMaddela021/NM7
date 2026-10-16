// Contract test against the REAL Hygraph Content API (needs internet). Runs in CI (frontend.yml) with
// HYGRAPH_CONTRACT=1; skipped otherwise. It runs the exact queries and the exact build step Vercel runs.
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_QUERY, DEFAULT_ENDPOINT, POST_QUERY, gql } from '../src/lib/blog/hygraph.js';
import { prerenderBlog } from './prerender-blog.mjs';

const endpoint = process.env.VITE_HYGRAPH_ENDPOINT || DEFAULT_ENDPOINT;

describe.skipIf(!process.env.HYGRAPH_CONTRACT)('Hygraph contract (live endpoint)', () => {
  it('the list query is valid against the live schema', async () => {
    const d = await gql(ALL_QUERY, { first: 100, skip: 0 }, { endpoint }); // throws on any GraphQL error
    expect(Array.isArray(d.posts)).toBe(true);
    expect(d.categories.map((c) => c.slug)).toEqual(expect.arrayContaining(['resume-tips', 'ats', 'freshers', 'interviews', 'govt-psu-jobs', 'career-switch']));
    for (const p of d.posts) expect(p.content.raw.children).toBeInstanceOf(Array);
  });

  it('the single-post query is valid (unknown slug → null)', async () => {
    const d = await gql(POST_QUERY, { slug: 'no-such-post-contract-test' }, { endpoint });
    expect(d.post).toBeNull();
  });

  it('the build step pre-renders /blog from the live data', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'nm7-contract-'));
    copyFileSync(new URL('../index.html', import.meta.url), join(dist, 'index.html'));
    const warnings = [];
    const res = await prerenderBlog({ dist, endpoint, log: { warn: (m) => warnings.push(m), info: (m) => console.log(m) } });
    expect(warnings).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.categories).toBeGreaterThanOrEqual(6);
    const list = readFileSync(join(dist, 'blog/index.html'), 'utf8');
    const data = JSON.parse(readFileSync(join(dist, 'blog/data.json'), 'utf8'));
    expect(data.categories.length).toBe(res.categories);
    if (res.posts === 0) expect(list).toContain('First articles coming soon.');
    else expect(list).toContain(`href="/blog/${data.posts[0].slug}"`);
    console.log(`[contract] live Hygraph: ${res.posts} posts, ${res.categories} categories`);
  }, 60_000);
});
