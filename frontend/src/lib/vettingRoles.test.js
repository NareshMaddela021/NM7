import { describe, expect, it } from 'vitest';
import { BY_TEST, TEST_NAMES, VETTING_ROLES, badgeLine, bandText } from './vettingRoles';

describe('vetting roles', () => {
  it('has the 50 roles with unique slugs and test names', () => {
    expect(VETTING_ROLES).toHaveLength(50);
    expect(new Set(VETTING_ROLES.map((r) => r.slug)).size).toBe(50);
    expect(new Set(TEST_NAMES).size).toBe(50);
    expect(BY_TEST.Java.role).toBe('Java developer');
  });

  it('writes the band', () => {
    expect(bandText('3–5 years')).toBe('3–5 yrs band');
    expect(bandText('Fresher')).toBe('Fresher band');
    expect(bandText('8+ years')).toBe('8+ yrs band');
  });

  it('writes the badge line', () => {
    const at = Date.UTC(2026, 10, 10, 6);
    const sv = { test: 'Java', bandLabel: '3–5 years', score: 82, taskStars: 4.2, at, expired: false };
    expect(badgeLine(sv)).toBe('Skill verified · Java · 3–5 yrs band · 82/100 · task 4.2/5 · Nov 2026');
    expect(badgeLine({ ...sv, taskStars: 4 })).toContain('task 4.0/5');
    expect(badgeLine({ ...sv, expired: true })).toMatch(/^Skill verified \(expired\) · Java/);
    expect(badgeLine(null)).toBe('');
  });
});
