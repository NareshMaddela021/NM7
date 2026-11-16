import { describe, expect, it } from 'vitest';
import { answerAnnounce, avg, scoreWord, signalDelta } from './lib';

describe('screening interview helpers', () => {
  it('speaks the timer only at 60, 30 and 10 seconds', () => {
    expect(answerAnnounce(60)).toBe('60 seconds left for this answer');
    expect(answerAnnounce(10)).toMatch('10 seconds');
    expect(answerAnnounce(59)).toBe('');
    expect(answerAnnounce(0)).toBe('');
  });
  it('names a score', () => {
    expect(scoreWord(5)[0]).toBe('Strong');
    expect(scoreWord(3)[0]).toBe('Good');
    expect(scoreWord(2)[0]).toBe('Fair');
    expect(scoreWord(0)[0]).toBe('Needs work');
  });
  it('sends only what changed since the last answer', () => {
    expect(signalDelta({ blurs: 3, blurMs: 4200.4 }, { blurs: 1, blurMs: 1000 })).toEqual({ blurs: 2, blurMs: 3200 });
    expect(signalDelta({ blurs: 0, blurMs: 0 }, { blurs: 2, blurMs: 50 })).toEqual({ blurs: 0, blurMs: 0 });
  });
  it('formats an average', () => {
    expect(avg(4)).toBe('4.0');
    expect(avg(null)).toBe('—');
  });
});

describe('timeWords', () => {
  it('says answer times in words', async () => {
    const { timeWords } = await import('./lib');
    expect(timeWords(150)).toBe('2½ minutes');
    expect(timeWords(100)).toBe('1 minute 40 seconds');
    expect(timeWords(225)).toBe('3 minutes 45 seconds');
    expect(timeWords(30)).toBe('½ minute');
  });
});
