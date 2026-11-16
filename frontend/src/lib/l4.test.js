import { describe, expect, it } from 'vitest';
import { HOURS, byDay, hourText, l4Status, noteLines, refereeProblems, settingsOf, stepIndex } from './l4';

describe('Vetting V4 helpers', () => {
  it('words for each status, and a fallback', () => {
    expect(l4Status('verified')).toEqual(['✓ Nm7 verified', 'ok']);
    expect(l4Status('requested')[0]).toBe('Requested');
    expect(l4Status('odd')).toEqual(['odd', 'neutral']);
    expect(stepIndex('booked')).toBe(1);
    expect(stepIndex('failed')).toBe(0);
  });

  it('hours 8 am to 8 pm', () => {
    expect(HOURS).toHaveLength(13);
    expect(hourText(8)).toBe('8 am');
    expect(hourText(12)).toBe('12 pm');
    expect(hourText(20)).toBe('8 pm');
  });

  it('groups slots by local day', () => {
    const a = new Date(2026, 10, 18, 10).getTime();
    const b = new Date(2026, 10, 18, 11).getTime();
    const c = new Date(2026, 10, 19, 9).getTime();
    const g = byDay([{ at: a }, { at: b }, { at: c }]);
    expect(g).toHaveLength(2);
    expect(g[0][1]).toHaveLength(2);
  });

  it('checks a referee row', () => {
    expect(refereeProblems({ name: 'Ravi Kumar', relation: 'past manager', email: 'ravi@example.com' })).toEqual([]);
    expect(refereeProblems({ name: 'R', relation: 'friend', email: '', phone: '' })).toEqual(['their name', 'how you know them', 'an email or a phone number']);
    expect(refereeProblems({ name: 'Ravi', relation: 'HR contact', email: 'nope', phone: '12345' })).toEqual(['a valid email', 'a 10-digit phone number']);
  });

  it('counts note lines and reads settings in either spelling', () => {
    expect(noteLines('a\n\nb\nc\n')).toBe(3);
    expect(settingsOf({ price_inr: 0, payout_inr: 0, payments_on: false })).toEqual({ priceInr: 0, payoutInr: 0, paymentsOn: false });
    expect(settingsOf({ priceInr: 499, payoutInr: 200, paymentsOn: true }).paymentsOn).toBe(true);
  });
});
