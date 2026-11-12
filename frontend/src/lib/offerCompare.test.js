import { describe, expect, it } from 'vitest';
import { best, inHandMonthly, yearly } from './offerCompare';

describe('compare offers (Phase 6 S5)', () => {
  it('reads CTC in LPA, a year or a month', () => {
    expect(yearly('3.5', 'lpa')).toBe(350000);
    expect(yearly('3,00,000', 'year')).toBe(300000);
    expect(yearly('25000', 'month')).toBe(300000);
    expect(yearly('', 'lpa')).toBeNull();
    expect(yearly('abc', 'lpa')).toBeNull();
  });
  it('shows in-hand only when deductions are typed in (never guessed)', () => {
    expect(inHandMonthly(300000, '')).toBeNull();
    expect(inHandMonthly(300000, undefined)).toBeNull();
    expect(inHandMonthly(300000, '2,500')).toBe(22500);
    expect(inHandMonthly(300000, '0')).toBe(25000);
    expect(inHandMonthly(null, '100')).toBeNull();
  });
  it('marks the best only when two or more can be compared', () => {
    expect(best([300000, null, 450000])).toBe(2);
    expect(best([300000, null])).toBeNull();
  });
});
