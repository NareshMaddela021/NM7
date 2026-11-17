import { describe, expect, it } from 'vitest';
import { bandWord, change, inr, num, reasonList, shortCommit, sparkPoints, trendWords } from './dailyReportText';

describe('daily report helpers', () => {
  it('formats numbers and money', () => {
    expect(num(null)).toBe('—');
    expect(num(123456)).toBe('1,23,456');
    expect(inr(149700)).toBe('₹1,497');
    expect(inr(null)).toBe('—');
  });

  it('says the change vs yesterday, with the right tone', () => {
    expect(change(5, null)).toEqual({ dir: 'none', text: 'No yesterday to compare', tone: 'neutral' });
    expect(change(5, 5).dir).toBe('same');
    expect(change(9, 5)).toEqual({ dir: 'up', text: '▲ 4 vs yesterday', tone: 'good' });
    expect(change(2, 5)).toEqual({ dir: 'down', text: '▼ 3 vs yesterday', tone: 'bad' });
    expect(change(30, 10, { lowerIsBetter: true }).tone).toBe('bad'); // more jobs waiting for review is worse
    expect(change(20000, 10000, { fmt: inr }).text).toBe('▲ ₹100 vs yesterday');
  });

  it('draws sparkline points with gaps for days without data', () => {
    expect(sparkPoints([])).toEqual([]);
    expect(sparkPoints([null, null])).toEqual([]);
    const runs = sparkPoints([1, 2, null, 4], 100, 20, 0);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toBe('0.0,20.0 33.3,13.3');
    expect(runs[1]).toBe('100.0,0.0');
    expect(sparkPoints([3, 3], 100, 20)).toEqual(['2.0,10.0 98.0,10.0']); // flat: the middle line
  });

  it('puts the trend in words for screen readers', () => {
    expect(trendWords([null, null])).toBe('Last 30 days: no data yet');
    expect(trendWords([null, 4])).toBe('Last 30 days: one day of data, 4');
    expect(trendWords([2, null, 9, 5, 9])).toBe('Last 30 days: rising from 2 to 9 (4 days of data, highest 9)');
    expect(trendWords([9, 2])).toMatch(/^Last 30 days: falling from 9 to 2/);
    expect(trendWords([4, 6, 4])).toMatch(/^Last 30 days: flat at 4/);
  });

  it('names commits, reasons and experience bands', () => {
    expect(shortCommit('a3f9c1e5b2')).toBe('a3f9c1e');
    expect(shortCommit('unknown')).toBe('unknown');
    expect(reasonList({ city_not_stated: 1, no_page_text: 9, odd_reason: 2 })).toEqual([['No page text to summarise', 9], ['odd reason', 2], ['City not stated', 1]]);
    expect(bandWord('1_3')).toBe('1–3 years');
  });
});
