// Vetting Trust T7: the order after an edit (must-haves met, then nice-to-haves met, then the score), the body the
// editor sends, and the strip's line.
import { describe, expect, it } from 'vitest';
import { blendScore, criteriaBody, criteriaSort, hireSort, stripLine } from './CriteriaBits';

const row = (key, mustMet, niceMet, score) => ({ key, criteria: { mustMet, niceMet, mustTotal: 2, niceTotal: 3 }, match: { score } });

describe('T7 criteria', () => {
  it('sorts by must-haves met, nice-to-haves met, then score; ties keep their order', () => {
    const rows = [row('a', 1, 3, 90), row('b', 2, 0, 40), row('c', 2, 1, 10), row('d', 2, 1, 10), row('e', 0, 0, 99)];
    expect(criteriaSort(rows, (x) => x.criteria, (x) => x.match.score).map((x) => x.key)).toEqual(['c', 'd', 'b', 'a', 'e']);
  });
  it('the shown score counts must-haves: missing must-haves never shows 100%', () => {
    expect(blendScore(100, { mustMet: 0, mustTotal: 7 })).toBe(50);
    expect(blendScore(100, { mustMet: 7, mustTotal: 7 })).toBe(100);
    expect(blendScore(80, { mustMet: 1, mustTotal: 2 })).toBe(65);
    expect(blendScore(90, null)).toBe(90);
    expect(blendScore(90, { mustMet: 0, mustTotal: 0 })).toBe(90);
  });
  it('Hire now ranks by the shown score, then must-haves met', () => {
    const rows = [row('a', 0, 0, 100), row('b', 2, 0, 20), row('c', 1, 0, 60), row('d', 2, 0, 0)];
    expect(hireSort(rows, (x) => x.criteria, (x) => x.match.score).map((x) => x.key)).toEqual(['b', 'c', 'd', 'a']);
  });
  it('people without criteria go last, by score', () => {
    const rows = [{ key: 'x', match: { score: 80 } }, row('y', 1, 0, 10), { key: 'z', match: { score: 90 } }];
    expect(criteriaSort(rows, (x) => x.criteria, (x) => x.match.score).map((x) => x.key)).toEqual(['y', 'z', 'x']);
  });
  it('sends only the filled-in requirements', () => {
    expect(criteriaBody([{ kind: 'skill', text: ' Tally ', must: 1, id: 'c1', by: 'ai' }, { kind: 'other', text: '  ', must: false }]))
      .toEqual({ items: [{ kind: 'skill', text: 'Tally', must: true }] });
  });
  it('says how many are met', () => {
    expect(stripLine({ mustMet: 1, mustTotal: 2, niceMet: 0, niceTotal: 3 })).toBe('1 of 2 must-haves · 0 of 3 nice-to-haves');
    expect(stripLine({ mustMet: 0, mustTotal: 0, niceMet: 1, niceTotal: 1 })).toBe('1 of 1 nice-to-haves');
  });
});
