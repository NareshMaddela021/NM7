import { describe, expect, it } from 'vitest';
import { ROUTE_META, metaFor } from './meta';

describe('page titles', () => {
  it('every public page has its own title and description', () => {
    const titles = new Set(ROUTE_META.map(([, t]) => t));
    expect(titles.size).toBe(ROUTE_META.length);
    expect(metaFor('/privacy')).toMatchObject({ title: 'Privacy policy', noindex: false });
    expect(metaFor('/me/orders')).toMatchObject({ title: 'My orders', noindex: true });
    expect(metaFor('/nope')).toMatchObject({ title: 'Page not found', noindex: true });
    expect(metaFor('/expert-terms')).toMatchObject({ title: 'Expert terms', noindex: false });
    expect(metaFor('/me/messages').title).toBe('Messages');
    expect(metaFor('/me/launch').title).toBe('Career Launch');
    expect(metaFor('/me/upgrade').title).toBe('Upgrade & add-ons');
    expect(metaFor('/expert/orders')).toMatchObject({ title: 'Expert workspace', noindex: true });
  });
});
