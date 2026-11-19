// Vetting Trust T12: the order of the discriminatory-filter notes (refused first, then warnings).
import { describe, expect, it } from 'vitest';
import { fairSort } from './FairnessBits';

describe('T12 fairness notes', () => {
  it('puts what can’t be used first and keeps the rest in order', () => {
    const items = [{ level: 'warn', topic: 'college' }, { level: 'refuse', topic: 'age' }, { level: 'warn', topic: 'region' }];
    expect(fairSort(items).map((x) => x.topic)).toEqual(['age', 'college', 'region']);
    expect(fairSort(undefined)).toEqual([]);
  });
});
