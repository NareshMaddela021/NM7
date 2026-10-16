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
    expect(metaFor('/admin').title).toBe('Dashboard · Admin');
    expect(metaFor('/admin/payments').title).toBe('Payments & invoices · Admin');
    expect(metaFor('/admin/team').title).toBe('Team & audit log · Admin');
    expect(metaFor('/me/launch').title).toBe('Career Launch');
    // organization pages are never "Page not found" (the portal's pages add the organization / group name)
    for (const [path, title] of [
      ['/org', 'My organization'], ['/org/abc', 'My organization'], ['/org/abc/resumes', 'My organization'],
      ['/org/abc/groups/g1', 'My organization'], ['/org/invite/tok', 'Organization invite'], ['/join/NTC26', 'Join a group'],
      ['/groups/stop', 'Reminders stopped'], ['/admin/orgs', 'Organizations · Admin'], ['/admin/shared-resumes', 'Shared resumes · Admin'],
    ]) expect(metaFor(path)).toMatchObject({ title, noindex: true });
    expect(metaFor('/me/upgrade').title).toBe('Upgrade & add-ons');
    expect(metaFor('/expert/orders')).toMatchObject({ title: 'Expert workspace', noindex: true });
  });
});
