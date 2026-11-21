// Batch D item 31: the city typed in "Write the description for me" fills Cities (the salary part is left out).
import { describe, expect, it } from 'vitest';
import { placeCities } from './CompanyJobs';

describe('placeCities', () => {
  it('keeps the city names only', () => {
    expect(placeCities('Pune, ₹2.4–3 LPA')).toBe('Pune');
    expect(placeCities('Hyderabad')).toBe('Hyderabad');
    expect(placeCities('Hyderabad and Pune, 20000 a month')).toBe('Hyderabad, Pune');
    expect(placeCities('Chennai Rs 15000 per month')).toBe('Chennai');
    expect(placeCities('')).toBe('');
    expect(placeCities('₹3 LPA')).toBe('');
  });
});
