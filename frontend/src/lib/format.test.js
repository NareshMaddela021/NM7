// 13 Nov live test: offer dates read "23 Nov 2026" (not 2026-11-23) and counts agree with their number.
import { describe, expect, it } from 'vitest';
import { countOf, fmtDay, fmtRange } from './format';
import { fmtDates } from '../pages/builder/design';

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
  // round C (C4): an internship that started and ended in October reads "Oct 2026", on the card and on the resume
  it('shows one month when start and end are the same', () => {
    expect(fmtRange('2026-10', '2026-10')).toBe('Oct 2026');
    expect(fmtRange('2026-09', '2026-10')).toBe('Sep 2026 – Oct 2026');
    expect(fmtRange('2026-09', '', true)).toBe('Sep 2026 – Present');
    expect(fmtDates('2026-10', '2026-10', false)).toBe('Oct 2026');
    expect(fmtDates('2026-10', '2026-10', false, 'num')).toBe('10/2026');
    expect(fmtDates('2026-09', '2026-10', false)).toBe('Sep 2026 – Oct 2026');
    expect(fmtDates('2025-01', '2025-12', false, 'year')).toBe('2025');
  });
});
