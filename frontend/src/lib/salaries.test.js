// Round D1: the salary guide's indexing rule, the admin status line, and the build-time sitemap never listing it
// (the API's /sitemap-salaries.xml lists it only while it is shown).
import { describe, expect, it } from 'vitest';
import { indexable } from './salaries';
import { salariesLine } from '../pages/admin/live/SetupPages';
import { STATIC_PAGES } from '../../scripts/prerender-blog.mjs';

describe('salary guide visibility', () => {
  it('is indexable only while shown, and a role page only with enough data', () => {
    expect(indexable(false)).toBe(false);
    expect(indexable(undefined)).toBe(false); // still loading: noindex
    expect(indexable(true)).toBe(true);
    expect(indexable(true, false)).toBe(false);
    expect(indexable(true, true)).toBe(true);
  });
  it('says the status in Admin → Settings', () => {
    expect(salariesLine({ visible: false, ready: 0, needRoles: 15, mode: 'auto' })).toBe('Salaries page: hidden, 0 of 15 roles ready (Auto)');
    expect(salariesLine({ visible: true, ready: 3, needRoles: 15, mode: 'show' })).toBe('Salaries page: shown, 3 of 15 roles ready (Always show)');
  });
  it('is not in the build-time sitemap', () => {
    expect(STATIC_PAGES.some(([p]) => p.startsWith('/salaries'))).toBe(false);
  });
});
