import { describe, expect, it } from 'vitest';
import { inText, pledgeText, retakeLines } from './honestyLib';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 18, 6, 0);

describe('retake limits in plain words', () => {
  it('shows the rule, attempts used and when the next attempt opens', () => {
    const l = retakeLines({ attempts: 1, days: 30, used: 1, left: 0, canStart: false, nextAt: now + 20 * DAY, counts: 'latest passed attempt' }, 'test', now);
    expect(l.rule).toBe('Allowed: 1 attempt every 30 days for this role.');
    expect(l.used).toBe('Used: 1 of 1 in the last 30 days.');
    expect(l.next).toMatch(/^Next attempt opens on .*2026 \(in 20 days\)\.$/);
    expect(l.counts).toBe('latest passed attempt');
  });
  it('open now, a free retest, a running test, the refresher', () => {
    expect(retakeLines({ attempts: 2, days: 30, used: 1, left: 1, canStart: true }, 'test', now).next).toBe('You can start now (1 left in this period).');
    expect(retakeLines({ attempts: 1, days: 30, used: 1, left: 0, canStart: true, freeRetest: true }).next).toBe('Your free retest is open now.');
    expect(retakeLines({ attempts: 1, days: 30, used: 1, canStart: true, running: true }, 'interview').next).toBe('You have an interview in progress: carry on with it.');
    expect(retakeLines({ attempts: 3, days: 14, used: 5, left: 0, canStart: false, nextAt: now + DAY, refreshDays: 7 }, 'test', now)).toMatchObject({ used: 'Used: 3 of 3 in the last 14 days.', refresh: 'Badge refresher: once every 7 days if it doesn’t renew the badge.' });
    expect(retakeLines(null)).toBeNull();
  });
  it('counts down in days, then hours, then minutes', () => {
    expect(inText(now + 2.5 * DAY, now)).toBe('in 3 days');
    expect(inText(now + 5 * 3_600_000, now)).toBe('in 5 hours');
    expect(inText(now + 90_000, now)).toBe('in 2 minutes');
    expect(inText(now - 1, now)).toBe('now');
  });
});

describe('the pledge text', () => {
  const p = { version: 1, title: { en: 'Your honesty pledge', hi: 'ईमानदारी का वादा' }, text: { en: 'I will answer on my own', te: 'నా జవాబులు' }, tick: { en: 'I promise' } };
  it('picks the language, else English', () => {
    expect(pledgeText(p, 'hi')).toEqual({ title: 'ईमानदारी का वादा', text: 'I will answer on my own', tick: 'I promise' });
    expect(pledgeText(p, 'te').text).toBe('నా జవాబులు');
    expect(pledgeText(null, 'en').text).toBe('');
  });
});
