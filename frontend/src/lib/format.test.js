// 13 Nov live test: offer dates read "23 Nov 2026" (not 2026-11-23) and counts agree with their number.
import { describe, expect, it } from 'vitest';
import { countOf, fmtDay } from './format';

describe('fmtDay and countOf', () => {
  it('formats a day people read', () => {
    expect(fmtDay('2026-11-23')).toBe('23 Nov 2026');
    expect(fmtDay('')).toBe('');
    expect(fmtDay('soon')).toBe('soon');
  });
  it('uses the singular for one', () => {
    expect(countOf(1, 'answer')).toBe('1 answer');
    expect(countOf(0, 'answer')).toBe('0 answers');
    expect(countOf(12, 'answer')).toBe('12 answers');
  });
});
