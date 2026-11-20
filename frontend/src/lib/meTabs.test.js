import { describe, expect, it } from 'vitest';
import { phoneTabs } from './meTabs';
import { ME_GROUPS } from '../pages/me/MeLayout';

const inMore = (tabs) => ME_GROUPS.flatMap(([, keys]) => keys).filter((k) => !tabs.includes(k));

describe('phone bottom bar', () => {
  it('shows Auto Apply in the second slot and moves My orders into More when Auto Apply is on', () => {
    const tabs = phoneTabs(true);
    expect(tabs).toEqual(['home', 'auto', 'resumes', 'jobs']);
    expect(inMore(tabs)).toContain('orders');
    expect(inMore(tabs)).not.toContain('auto');
  });
  it('keeps My orders in the bar (and not twice) when Auto Apply is off', () => {
    const tabs = phoneTabs(false);
    expect(tabs).toEqual(['home', 'orders', 'resumes', 'jobs']);
    expect(inMore(tabs)).not.toContain('orders');
    expect(inMore(tabs)).toContain('auto');
  });
});
