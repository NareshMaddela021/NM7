import { describe, expect, it } from 'vitest';
import { auditText } from './auditText';

describe('audit log details', () => {
  it('reads as text, not JSON', () => {
    expect(auditText({ via: 'totp', trust: false })).toBe('via: authenticator app · trusted device: no');
    expect(auditText({ via: 'trusted_device' })).toBe('via: trusted device');
    expect(auditText({ delivery_hours: { from: 72, to: 48 } })).toBe('delivery hours: 72 → 48');
    expect(auditText({ 'plans.expert': { from: { amount: 999, active: true }, to: { amount: 1099, active: true } } })).toBe('expert: ₹999 → ₹1099');
    expect(auditText({ order_id: 'RS-1', reason: 'Late' })).toBe('order: RS-1 · reason: Late');
    expect(auditText({})).toBe('');
    expect(auditText(null)).toBe('');
  });
});

import { settingsErrors } from './SetupPages';
describe('settings validation', () => {
  const form = (price, hours) => ({ plans: { expert: { text: price } }, addons: {}, hoursText: hours });
  it('explains each bad value', () => {
    expect(settingsErrors(form('999', '72'))).toEqual({});
    expect(settingsErrors(form('', '72'))['plans.expert']).toBe('Enter a whole number of rupees');
    expect(settingsErrors(form('99.5', '72'))['plans.expert']).toBe('Enter a whole number of rupees');
    expect(settingsErrors(form('0', '72'))['plans.expert']).toBe('Price must be ₹1–₹1,00,000');
    expect(settingsErrors(form('999', '200')).hours).toBe('Delivery must be 24–168 hours');
    expect(settingsErrors(form('999', 'abc')).hours).toBe('Enter a whole number of hours');
  });
});
