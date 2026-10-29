import { describe, expect, it } from 'vitest';
import { inr } from './pricing';

describe('inr', () => {
  it('never shows “₹-0” (no refunds = ₹0)', () => {
    expect(inr(-0)).toBe('₹0');
    expect(inr(-0.2)).toBe('₹0');
    expect(inr(0)).toBe('₹0');
    expect(inr(1298)).toBe('₹1,298');
  });
});
