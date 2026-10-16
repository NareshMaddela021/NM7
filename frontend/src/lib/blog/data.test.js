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
