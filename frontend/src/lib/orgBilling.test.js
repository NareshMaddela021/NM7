import { describe, expect, it } from 'vitest';
import { gstinProblem, limitText, periodText, planBanners, refFromSearch, rupees, usagePct } from './orgBilling';

describe('money and limits', () => {
  it('formats paise as rupees, Indian grouping, paise only when there are any', () => {
    expect(rupees(4999_00)).toBe('₹4,999');
    expect(rupees(24999_00)).toBe('₹24,999');
    expect(rupees(4499_10)).toBe('₹4,499.10');
    expect(rupees(12345678_00)).toBe('₹1,23,45,678');
  });
  it('shows unlimited limits and plan periods in words', () => {
    expect(limitText(null)).toBe('Unlimited');
    expect(limitText(3000)).toBe('3,000');
    expect(periodText({ periodDays: 60 })).toBe('per 60 days');
    expect(periodText({ periodMonths: 12 })).toBe('per 12 months');
  });
  it('usage percentage', () => {
    expect(usagePct(40, 50)).toBe(80);
    expect(usagePct(60, 50)).toBe(100);
    expect(usagePct(5, null)).toBeNull();
    expect(usagePct(1, 0)).toBe(100);
  });
});

describe('banners', () => {
  const billing = { planName: 'Drive', warnings: [
    { kind: 'usage', key: 'members', used: 410, limit: 500, full: false },
    { kind: 'usage', key: 'groups', used: 5, limit: 5, full: true },
    { kind: 'ends_soon', endsOn: '2026-12-19', daysLeft: 3 },
  ] };
  it('tells the Owner where to upgrade and everyone else to ask the Owner', () => {
    const owner = planBanners(billing, true);
    expect(owner.map((b) => b.tone)).toEqual(['warning', 'danger', 'warning']);
    expect(owner[0].text).toBe('410 of 500 members used. Upgrade in Billing.');
    expect(owner[1].text).toContain('nothing is deleted');
    expect(owner[2].text).toContain('ends in 3 days');
    expect(planBanners(billing, false)[0].text).toContain('Ask your Owner to upgrade.');
  });
  it('grace and expired', () => {
    expect(planBanners({ planName: 'Drive', warnings: [{ kind: 'grace', endsOn: '2026-03-01', graceUntil: '2026-03-08' }] }, false)[0].text).toContain('Free limits apply. Ask your Owner to renew.');
    expect(planBanners({ planName: 'Free', lastPlan: 'Campus', warnings: [{ kind: 'expired' }] }, true)[0].text).toContain('Your Campus plan has ended');
    expect(planBanners(null, true)).toEqual([]);
  });
});

describe('GSTIN', () => {
  it('checks format, check digit and state like the server', () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBe('');
    expect(gstinProblem('27aapfu0939f1zv', '27')).toBe('');
    expect(gstinProblem('27AAPFU0939F1ZX')).toContain('last character');
    expect(gstinProblem('27AAPFU0939F1ZV', '29')).toContain('different state');
    expect(gstinProblem('ABC')).toContain('15 characters');
    expect(gstinProblem('')).toBe('');
  });
});

describe('referral code from the link', () => {
  it('upper-cases and keeps only code characters', () => {
    expect(refFromSearch('?ref=asx-ravi')).toBe('ASX-RAVI');
    expect(refFromSearch('?ref=<script>')).toBe('SCRIPT');
    expect(refFromSearch('')).toBe('');
  });
});
