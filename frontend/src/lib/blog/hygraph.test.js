import { describe, expect, it } from 'vitest';
import { CATEGORIES_QUERY, DEFAULT_BUILD_ENDPOINT, DEFAULT_ENDPOINT, POSTS_QUERY, POST_QUERY, buildEndpoint, gql, normalizePost } from './hygraph';
import { POSTS } from './fixtures/hygraph';

// The Hygraph schema (project nm7-blog). RichText has raw / html / text / markdown — no `json`.
const SCHEMA = {
  Post: ['id', 'title', 'slug', 'excerpt', 'coverImage', 'content', 'category', 'author', 'seoTitle', 'seoDescription', 'publishedAt', 'updatedAt', 'createdAt'],
  RichText: ['raw', 'html', 'text', 'markdown'],
  Asset: ['url', 'width', 'height'],
  Category: ['name', 'slug'],
  Author: ['name', 'bio', 'photo'],
};
const KNOWN = new Set([...Object.values(SCHEMA).flat(), 'posts', 'post', 'categories', 'query', 'BlogPosts', 'BlogCategories', 'Post', 'orderBy', 'first', 'skip', 'where', 'Int', 'String', 'publishedAt_DESC']);

describe('the queries match Hygraph’s schema', () => {
  for (const [name, q] of [['posts', POSTS_QUERY], ['one post', POST_QUERY]]) {
    it(`${name}: rich text as content { raw }, never json or html`, () => {
      expect(q).toMatch(/content\s*\{\s*raw\s*\}/);
      expect(q).not.toMatch(/\bjson\b/);
      expect(q).not.toMatch(/\bhtml\b/); // rendered from the AST only, never from Hygraph's HTML
    });
    it(`${name}: only asks for fields the schema has`, () => {
      const words = q.replace(/\$\w+/g, '').match(/[A-Za-z_]+/g);
      expect(words.filter((w) => !KNOWN.has(w))).toEqual([]);
    });
  }
  it('reads the rich text from content.raw', () => {
    const p = normalizePost(POSTS[0]);
    expect(p.content.children[0].type).toBe('paragraph');
    expect(p.minutes).toBe(2);
  });
});

describe('endpoints and errors', () => {
  it('the build reads the uncached Content API; the browser the CDN', () => {
    expect(DEFAULT_BUILD_ENDPOINT).toBe('https://api-ap-south-1.hygraph.com/v2/cmup9f6ob0ktu06w8zze56jn9/master');
    expect(buildEndpoint()).toBe(DEFAULT_BUILD_ENDPOINT);
    expect(DEFAULT_ENDPOINT).toBe('https://ap-south-1.cdn.hygraph.com/content/cmup9f6ob0ktu06w8zze56jn9/master');
  });
  it('the posts query has no filters (no where / stage / locales / date): every published post', () => {
    expect(POSTS_QUERY).not.toMatch(/where|stage|locales|_gt|_lt|coverImage_/);
    expect(CATEGORIES_QUERY).toContain('categories(first: 100)');
  });
  it('errors carry the HTTP status and the exact GraphQL messages', async () => {
    const answer = (status, body) => async () => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    await expect(gql('q', {}, { endpoint: 'x', fetchImpl: answer(400, { errors: [{ message: "field 'json' is not defined in 'RichText'" }] }) }))
      .rejects.toMatchObject({ status: 400, message: "HTTP 400 — field 'json' is not defined in 'RichText'", errors: ["field 'json' is not defined in 'RichText'"] });
    await expect(gql('q', {}, { endpoint: 'x', fetchImpl: async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' }) }))
      .rejects.toMatchObject({ status: 502, message: 'HTTP 502 — <html>Bad gateway</html>' });
    await expect(gql('q', {}, { endpoint: 'x', fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } }))
      .rejects.toMatchObject({ message: 'network error: ENOTFOUND' });
  });
});
