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

describe('side menu groups (Batch C items 23, 24)', async () => {
  const { ME_NAV, MORE_GROUP, meGroups } = await import('../pages/me/MeLayout');
  for (const student of [false, true]) {
    it(`${student ? 'students' : 'job seekers'}: every link exactly once, a few groups, More last`, () => {
      const g = meGroups(student);
      const keys = g.flatMap(([, k]) => k);
      expect(keys.slice().sort()).toEqual(ME_NAV.map(([k]) => k).sort());
      expect(g.length).toBeLessThanOrEqual(5);
      expect(g.at(-1)[0]).toBe(MORE_GROUP);
      expect(keys.length - g.at(-1)[1].length).toBeLessThanOrEqual(15); // shown before More
    });
  }
  it('students: learning, internships and skill checks first, then the resume, then jobs', () => {
    const keys = meGroups(true).flatMap(([, k]) => k);
    const at = (k) => keys.indexOf(k);
    expect(at('learn')).toBeLessThan(at('programs'));
    expect(at('programs')).toBeLessThan(at('skills'));
    expect(at('skills')).toBeLessThan(at('resumes'));
    expect(at('resumes')).toBeLessThan(at('jobs'));
  });
});
