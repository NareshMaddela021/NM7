import { describe, expect, it } from 'vitest';
import { better, fetchOlder, mergePosts, normTitle, normalizeOlder, scrubOldDomain, withPostCategories } from './merge';
import { OLDER_API, fakeOlderApi } from './fixtures/hygraph';

const p = (slug, title, at, extra = {}) => ({ slug, title, publishedAt: at, updatedAt: at, content: { children: [] }, ...extra });

describe('merging the older articles into the blog (no duplicates)', () => {
  it('same slug: the newer one stays', () => {
    const { posts, aliases } = mergePosts([p('a', 'A', '2026-01-01')], [p('a', 'A old', '2025-01-01', { source: 'legacy' })]);
    expect(posts.map((x) => x.title)).toEqual(['A']);
    expect(aliases).toEqual({});
    expect(mergePosts([p('a', 'A', '2024-01-01')], [p('a', 'A new', '2025-01-01', { source: 'legacy' })]).posts[0].title).toBe('A new');
  });
  it('same title (any case or punctuation): the newer one stays and the other slug points to it', () => {
    const { posts, aliases } = mergePosts([p('ats', 'How to make an ATS-friendly resume', '2026-01-01')], [p('ats-guide', 'How to make an ats friendly resume!', '2024-01-01', { source: 'legacy' })]);
    expect(posts.map((x) => x.slug)).toEqual(['ats']);
    expect(aliases).toEqual({ 'ats-guide': 'ats' });
    const flipped = mergePosts([p('ats', 'Same title', '2024-01-01')], [p('ats-guide', 'Same Title', '2026-01-01', { source: 'legacy' })]);
    expect(flipped.posts.map((x) => x.slug)).toEqual(['ats-guide']);
    expect(flipped.aliases).toEqual({ ats: 'ats-guide' });
  });
  it('a tie goes to the site’s own post; titles in Telugu or Hindi compare too', () => {
    expect(better(p('a', 'x', '2025-01-01'), p('b', 'x', '2025-01-01', { source: 'legacy' }))).toBe(true);
    expect(normTitle('రెజ్యూమ్ గైడ్!')).toBe(normTitle('రెజ్యూమ్  గైడ్'));
    expect(normTitle('रिज़्यूमे गाइड')).not.toBe('');
  });
  it('newest first; aliases only to articles that are shown, chains end at one article', () => {
    const { posts, aliases } = mergePosts([p('b', 'B', '2026-02-01')], [p('a', 'A', '2025-01-01', { source: 'legacy' })], { old: 'a', older: 'old', gone: 'nowhere', b: 'a' });
    expect(posts.map((x) => x.slug)).toEqual(['b', 'a']);
    expect(aliases).toEqual({ old: 'a', older: 'a' });
  });
  it('836 articles: one per slug and per title', () => {
    const own = Array.from({ length: 36 }, (_, i) => p(`own-${i}`, `Own ${i}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`));
    const old = Array.from({ length: 800 }, (_, i) => p(`old-${i}`, i < 10 ? `Own ${i}` : `Old ${i}`, '2024-01-01', { source: 'legacy' }));
    const { posts, aliases } = mergePosts(own, old);
    expect(posts).toHaveLength(826);
    expect(new Set(posts.map((x) => x.slug)).size).toBe(826);
    expect(new Set(posts.map((x) => normTitle(x.title))).size).toBe(826);
    expect(Object.keys(aliases)).toHaveLength(10);
  });
});

describe('rebrand safety net and the API answer', () => {
  it('no "asuraa.in" survives; asuraa.ai is left alone', () => {
    const v = scrubOldDomain({ a: 'see www.asuraa.in/blog and ASURAA.IN', b: ['https://asuraa.ai/x'], c: 3 });
    expect(v).toEqual({ a: 'see nm7.si/blog and nm7.si', b: ['https://asuraa.ai/x'], c: 3 });
  });
  it('normalizes an API article (reading time, legacy source, no "asuraa.in")', () => {
    const n = normalizeOlder(OLDER_API[1]);
    expect(n).toMatchObject({ slug: 'govt-job-resume', source: 'legacy', author: null, cover: null, minutes: 1, category: { slug: 'govt-jobs' } });
    expect(JSON.stringify(n)).not.toMatch(/asuraa\.in/i);
    expect(JSON.stringify(n)).toContain('https://asuraa.ai');
  });
  it('reads every page from the API; nothing when the API has no token', async () => {
    const api = fakeOlderApi();
    const r = await fetchOlder('https://api.test/', { fetchImpl: api, perPage: 3 });
    expect(r.posts).toHaveLength(4);
    expect(api.calls).toEqual(['https://api.test/api/blog/legacy?content=1&per_page=3&page=1', 'https://api.test/api/blog/legacy?content=1&per_page=3&page=2']);
    expect(r.aliases).toEqual({ 'what-is-asuraa': 'what-is-nm7' });
    expect(await fetchOlder('https://api.test', { fetchImpl: fakeOlderApi({ configured: false }) })).toEqual({ configured: false, posts: [], aliases: {} });
    await expect(fetchOlder('https://api.test', { fetchImpl: fakeOlderApi({ fail: true }) })).rejects.toThrow(/network error/);
  });
  it('categories: the given ones first, then the ones the posts use', () => {
    expect(withPostCategories([{ slug: 'ats', name: 'ATS' }], [{ category: { slug: 'ats', name: 'Other' } }, { category: { slug: 'govt', name: 'Govt' } }, { category: null }]))
      .toEqual([{ slug: 'ats', name: 'ATS' }, { slug: 'govt', name: 'Govt' }]);
  });
});
