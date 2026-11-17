// Round W: sortable admin tables. Click a column header to sort by it (again: the other way); the sorted header says
// so to screen readers (aria-sort). Sorting is of the rows on screen (the page the server sent).
import { useMemo, useState } from 'react';

const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Compares two values: numbers as numbers, text in the reader's order (case-insensitive, 2 before 10); blanks last. */
export function compare(a, b) {
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

/** Sorts rows by one of `by` ({ key: (row) => value }); returns { rows, sort, onSort }. A stable sort: ties keep the
 *  server's order. Blanks stay last in both directions. */
export function sortRows(rows, by, sort) {
  const get = sort?.key && by[sort.key];
  if (!get) return rows;
  const dir = sort.dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => [r, get(r), i]).sort(([, a, i], [, b, j]) => {
    if (blank(a) !== blank(b)) return blank(a) ? 1 : -1;
    return compare(a, b) * dir || i - j;
  }).map(([r]) => r);
}

export function useSort(rows, by, initial = null) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => sortRows(rows || [], by, sort), [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSort = (key) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { rows: sorted, sort, onSort };
}

/** A column header that sorts: <SortTh k="name" sort={sort} onSort={onSort}>Name</SortTh> */
export function SortTh({ k, sort, onSort, children, className }) {
  const on = sort?.key === k;
  return (
    <th scope="col" className={className} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="ad-sort" onClick={() => onSort(k)}>
        {children}<span aria-hidden="true" className="ad-sort-ic" data-on={on || undefined}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
