import { describe, expect, it } from 'vitest';
import { compare, sortRows } from './sort';

describe('admin table sorting', () => {
  const rows = [{ n: 'b', v: 10 }, { n: 'A', v: 2 }, { n: 'c', v: null }, { n: 'a2', v: 2 }];
  const by = { n: (r) => r.n, v: (r) => r.v };
  it('sorts text case-insensitively and numbers as numbers, blanks last both ways', () => {
    expect(sortRows(rows, by, { key: 'n', dir: 'asc' }).map((r) => r.n)).toEqual(['A', 'a2', 'b', 'c']);
    expect(sortRows(rows, by, { key: 'v', dir: 'asc' }).map((r) => r.n)).toEqual(['A', 'a2', 'b', 'c']);
    expect(sortRows(rows, by, { key: 'v', dir: 'desc' }).map((r) => r.n)).toEqual(['b', 'A', 'a2', 'c']);
  });
  it('keeps the server order with no sort or an unknown column', () => {
    expect(sortRows(rows, by, null)).toBe(rows);
    expect(sortRows(rows, by, { key: 'x', dir: 'asc' })).toBe(rows);
  });
  it('compares numbers inside text naturally', () => {
    expect(compare('RS-2', 'RS-10')).toBeLessThan(0);
  });
});
