// Vetting Trust T7: the order after an edit (must-haves met, then nice-to-haves met, then the score), the body the
// editor sends, and the strip's line.
import { describe, expect, it } from 'vitest';
import { criteriaBody, criteriaSort, stripLine } from './CriteriaBits';

const row = (key, mustMet, niceMet, score) => ({ key, criteria: { mustMet, niceMet, mustTotal: 2, niceTotal: 3 }, match: { score } });

describe('T7 criteria', () => {
  it('sorts by must-haves met, nice-to-haves met, then score; ties keep their order', () => {
    const rows = [row('a', 1, 3, 90), row('b', 2, 0, 40), row('c', 2, 1, 10), row('d', 2, 1, 10), row('e', 0, 0, 99)];
    expect(criteriaSort(rows, (x) => x.criteria, (x) => x.match.score).map((x) => x.key)).toEqual(['c', 'd', 'b', 'a', 'e']);
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
