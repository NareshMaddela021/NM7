import { describe, expect, it } from 'vitest';
import { experienceKpi } from './JobPages';

describe('Admin → Jobs "By experience"', () => {
  it('shows the total as the headline (not the Fresher count) and every band underneath', () => {
    const k = experienceKpi({ fresher: 41, '0_1': 12, '5_8': 3, not_stated: 4 });
    expect(k.value).toBe(60);
    expect(k.sub).toBe('Fresher 41 · 0–1 years 12 · 5–8 years 3 · Experience not stated 4');
  });
  it('is 0 with no jobs', () => {
    expect(experienceKpi({}).value).toBe(0);
    expect(experienceKpi(undefined).value).toBe(0);
  });
});
