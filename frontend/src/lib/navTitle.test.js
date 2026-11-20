import { describe, expect, it } from 'vitest';
import { navMeta } from './navTitle';

const ME = [['home', '/me', 'Home'], ['messages', '/me/messages', 'Messages'], ['profile', '/me/profile', 'Job Profile'], ['learn', '/me/learn', 'Learning paths']];
const me = (p) => navMeta(p, ME, { home: '/me', generic: 'My dashboard' }).title;
const ADMIN = [['dashboard', '/admin', 'Dashboard'], ['jobs', '/admin/auto-apply', 'Auto Apply'], ['companies', '/admin/companies', 'Companies']];
const admin = (p) => navMeta(p, ADMIN, { home: '/admin', generic: 'Admin console', suffix: ' · Admin' }).title;

describe('tab title per page', () => {
  it('job seeker pages: the page name, not "My dashboard"', () => {
    expect(me('/me/messages')).toBe('Messages');
    expect(me('/me/profile')).toBe('Job Profile');
    expect(me('/me/learn')).toBe('Learning paths');
    expect(me('/me/learn/qa-basics')).toBe('Learning paths');
    expect(me('/me/offer-check')).toBe('Offer check'); // not in the menu: the path in words
    expect(me('/me')).toBe('My dashboard');
    expect(me('/me/')).toBe('My dashboard');
    expect(me('/me/simple')).toBe('Easy dashboard');
  });
  it('admin pages without their own entry get the menu label', () => {
    expect(admin('/admin/auto-apply')).toBe('Auto Apply · Admin');
    expect(admin('/admin/companies')).toBe('Companies · Admin');
    expect(admin('/admin/orders')).toBe('Orders · Admin'); // the route table's own title
    expect(admin('/admin')).toBe('Dashboard · Admin');
  });
});
