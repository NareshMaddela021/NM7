import { describe, expect, it } from 'vitest';
import { ALL_QUERY, POST_QUERY, normalizePost } from './hygraph';
import { POSTS } from './fixtures/hygraph';

// The Hygraph schema (project nm7-blog). RichText has raw / html / text / markdown — no `json`.
const SCHEMA = {
  Post: ['id', 'title', 'slug', 'excerpt', 'coverImage', 'content', 'category', 'author', 'seoTitle', 'seoDescription', 'publishedAt', 'updatedAt', 'createdAt'],
  RichText: ['raw', 'html', 'text', 'markdown'],
  Asset: ['url', 'width', 'height'],
  Category: ['name', 'slug'],
  Author: ['name', 'bio', 'photo'],
};
const KNOWN = new Set([...Object.values(SCHEMA).flat(), 'posts', 'post', 'categories', 'query', 'Blog', 'Post', 'orderBy', 'first', 'skip', 'where', 'Int', 'String', 'publishedAt_DESC']);

describe('the queries match Hygraph’s schema', () => {
  for (const [name, q] of [['list', ALL_QUERY], ['one post', POST_QUERY]]) {
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
