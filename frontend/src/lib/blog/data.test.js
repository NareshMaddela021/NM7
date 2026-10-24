import { describe, expect, it } from 'vitest';
import { needsLive } from './data';

describe('a missed or old build never hides posts', () => {
  const now = Date.parse('2026-10-16T04:00:00Z');
  const post = { slug: 'a' };
  it('uses the built list when it has posts and is under 10 minutes old', () => {
    expect(needsLive({ builtAt: '2026-10-16T03:55:00Z', posts: [post] }, now)).toBe(false);
  });
  it('asks Hygraph when the built list is empty, old or undated', () => {
    expect(needsLive({ builtAt: '2026-10-16T03:59:00Z', posts: [] }, now)).toBe(true);
    expect(needsLive({ builtAt: '2026-10-16T03:49:00Z', posts: [post] }, now)).toBe(true);
    expect(needsLive({ posts: [post] }, now)).toBe(true);
  });
  it('not again once the list is the live one', () => {
    expect(needsLive({ live: true, posts: [] }, now)).toBe(false);
  });
});

describe('live answers only ever add posts (merge by slug)', async () => {
  const { mergeIndex } = await import('./data');
  const { cacheBustComment } = await import('./hygraph');
  const p = (slug, publishedAt) => ({ slug, title: slug, publishedAt });
  const built = { builtAt: '2026-10-16T05:47:00Z', posts: [p('b', '2026-10-15'), p('a', '2026-10-14')], categories: [{ slug: 'ats', name: 'ATS' }] };
  it('live returns [] but the build has posts → the built posts stay', () => {
    expect(mergeIndex(built, { live: true, posts: [], categories: [] }).posts.map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('a shorter live list never removes built posts', () => {
    expect(mergeIndex(built, { live: true, posts: [p('a', '2026-10-14')], categories: [] }).posts.map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('live adds newer posts and categories, newest first', () => {
    const m = mergeIndex(built, { live: true, posts: [p('c', '2026-10-16'), p('a', '2026-10-14')], categories: [{ slug: 'freshers', name: 'Freshers' }] });
    expect(m.posts.map((x) => x.slug)).toEqual(['c', 'b', 'a']);
    expect(m.categories.map((x) => x.slug)).toEqual(['ats', 'freshers']);
  });
  it('no built list (or an empty one) → the live list', () => {
    expect(mergeIndex(null, { live: true, posts: [p('c', '2026-10-16')], categories: [] }).posts).toHaveLength(1);
    expect(mergeIndex({ posts: [], categories: built.categories }, { live: true, posts: [p('c', '2026-10-16')], categories: [] }).categories).toEqual(built.categories);
  });
  it('the browser’s cache key changes every 5 minutes (a GraphQL comment the server ignores)', () => {
    const t = Date.parse('2026-10-16T06:00:00Z');
    expect(cacheBustComment(t)).toMatch(/^\n# nm7 cache key \d+$/);
    expect(cacheBustComment(t + 60_000)).toBe(cacheBustComment(t));
    expect(cacheBustComment(t + 5 * 60_000)).not.toBe(cacheBustComment(t));
  });
});
