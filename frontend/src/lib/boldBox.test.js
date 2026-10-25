// The bold text box: plain text on screen, bold as a mask, the saved value in the same **marker** format.
import { describe, expect, it } from 'vitest';
import { editMask, fromMask, insertRich, settleTyped, toMask, toggleMask } from './bold';

const m = (raw) => toMask(raw);

describe('bold text box', () => {
  it('shows the words without markers and saves the same format back', () => {
    const r = 'Led **12 people** and cut **costs**';
    const { plain, mask } = m(r);
    expect(plain).toBe('Led 12 people and cut costs');
    expect(fromMask(plain, mask)).toBe(r);
    // every resume, old ones too: the box shows what prints, and saving it back prints the same
    for (const raw of ['', 'plain text', '**all bold**', 'a **b**\n**c** d', 'old ** stray', 'x **unpaired', 'two\n\nlines **here**', '**  spaced  ** out']) {
      const t = m(raw);
      expect(t.plain).not.toContain('**');
      const back = m(fromMask(t.plain, t.mask));
      const letters = (x) => x.mask.map((b, i) => (/\s/.test(x.plain[i]) ? '' : `${x.plain[i]}${b ? 1 : 0}`)).join('');
      expect(back.plain).toBe(t.plain);
      expect(letters(back)).toBe(letters(t)); // a space's weight never shows
      expect(t.mask).toHaveLength(t.plain.length);
    }
  });

  it('typing keeps the weight of the letters that stayed; new letters are bold only inside a bold run', () => {
    const { plain, mask } = m('Built **Power BI** dashboards');
    // typing inside the bold phrase
    const p1 = 'Built Power XBI dashboards';
    expect(fromMask(p1, editMask(plain, mask, p1))).toBe('Built **Power XBI** dashboards');
    // typing right after it: plain
    const p2 = 'Built Power BI weekly dashboards';
    expect(fromMask(p2, editMask(plain, mask, p2))).toBe('Built **Power BI** weekly dashboards');
    // deleting a bold letter, replacing a selection, clearing
    const p3 = 'Built Power B dashboards';
    expect(fromMask(p3, editMask(plain, mask, p3))).toBe('Built **Power B** dashboards');
    const p4 = 'Built Tableau dashboards';
    expect(fromMask(p4, editMask(plain, mask, p4))).toBe('Built Tableau dashboards');
    expect(fromMask('', editMask(plain, mask, ''))).toBe('');
  });

  it('B on / off toggles cleanly, the word at the cursor, spaces never bold', () => {
    const { plain, mask } = m('Built dashboards in Power BI for sales');
    const i = plain.indexOf('Power BI');
    const on = toggleMask(plain, mask, i, i + 8);
    expect(fromMask(plain, on.mask)).toBe('Built dashboards in **Power BI** for sales');
    expect([on.start, on.end]).toEqual([i, i + 8]);
    const off = toggleMask(plain, on.mask, on.start, on.end);
    expect(fromMask(plain, off.mask)).toBe('Built dashboards in Power BI for sales');
    // no selection: the word around the cursor; a selection with spaces at its edges
    expect(fromMask(plain, toggleMask(plain, mask, 2, 2).mask)).toBe('**Built** dashboards in Power BI for sales');
    expect(fromMask(plain, toggleMask(plain, mask, i - 1, i + 9).mask)).toBe('Built dashboards in **Power BI** for sales');
    // part bold → all bold, then all plain
    const part = toggleMask(plain, mask, i, i + 5).mask;
    const all = toggleMask(plain, part, i, i + 8).mask;
    expect(fromMask(plain, all)).toBe('Built dashboards in **Power BI** for sales');
  });

  it('pasting text with ** or from Word keeps the bold', () => {
    const { plain, mask } = m('Data analyst.');
    const r = insertRich(plain, mask, 13, 13, ' Cut costs by **40%**');
    expect(r.plain).toBe('Data analyst. Cut costs by 40%');
    expect(fromMask(r.plain, r.mask)).toBe('Data analyst. Cut costs by **40%**');
    expect(r.at).toBe(r.plain.length);
  });

  it('markers typed by hand become bold when they pair up', () => {
    expect(settleTyped('a **b', [false, false, false, false, false])).toBe(null); // a lone ** stays as typed
    const t = settleTyped('a **b**', new Array(7).fill(false));
    expect(t.plain).toBe('a b');
    expect(fromMask(t.plain, t.mask)).toBe('a **b**');
  });
});
