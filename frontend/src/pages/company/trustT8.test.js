// Vetting Trust T8: what a company sees of the integrity rating: the label, "Reviewed by Nm7" once a person looked,
// "Under review by Nm7" (and nothing else) while a review is open; nothing at all while Trust is hidden from it.
import { describe, expect, it } from 'vitest';
import { integrityText } from './DocBadges';

describe('T8 integrity label', () => {
  it('shows the label, and Reviewed by Nm7 after a review', () => {
    expect(integrityText({ label: 'Low risk', level: 'low', underReview: false, reviewed: false })).toBe('Integrity: Low risk');
    expect(integrityText({ label: 'High risk', level: 'high', underReview: false, reviewed: true })).toBe('Integrity: High risk · Reviewed by Nm7');
    expect(integrityText({ label: 'Not enough data', level: 'not_enough_data', underReview: false, reviewed: false })).toBe('Integrity: Not enough data');
  });
  it('while a review is open: only "Under review by Nm7", never the level', () => {
    const t = integrityText({ label: 'Under review by Nm7', level: null, underReview: true, reviewed: false });
    expect(t).toBe('Under review by Nm7');
    expect(t.toLowerCase()).not.toContain('fraud');
    expect(t).not.toContain('High');
  });
  it('nothing while Trust is hidden from the company', () => {
    expect(integrityText(undefined)).toBe('');
    expect(integrityText(null)).toBe('');
  });
});
