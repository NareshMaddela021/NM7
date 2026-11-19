import { describe, expect, it } from 'vitest';
import { IDLE_CAP_MS, createRecorder, delayFor, diffEdit, pasteMarks, pasteSpan, statsLine, textAt, timeline } from './codeLib';

describe('the code editor recorder', () => {
  it('finds the single edit between two texts', () => {
    expect(diffEdit('abc', 'abXc')).toEqual({ pos: 2, del: 0, ins: 'X' });
    expect(diffEdit('abcd', 'ad')).toEqual({ pos: 1, del: 2, ins: '' });
    expect(diffEdit('aaa', 'aaaa')).toEqual({ pos: 3, del: 0, ins: 'a' });
    expect(diffEdit('x', 'x')).toBeNull();
  });

  it('records typing, pastes, focus and a language switch, and replays to the same text', () => {
    let t = 0;
    const r = createRecorder('# start\n', 'python', { clock: () => t });
    let text = '# start\n';
    const type = (next, pasted = false) => { t += 100; r.edit(text, next, pasted); text = next; };
    type(`${text}p`); type(`${text}r`);
    t += 5000; r.mark('b'); t += 100; r.mark('f');
    type(`${text}int(sum(range(10)))\n`, true);
    type(text.replace('pr', 'pr'));
    const d = r.data();
    expect(d.v).toBe(1);
    expect(d.events.map((e) => e[1])).toEqual(['e', 'e', 'b', 'f', 'p']);
    expect(textAt(d, d.events.length)).toBe(text);
    expect(r.counters()).toEqual({ typed: 2, pasted: 20, largestPaste: 20 });
    r.set('console.log(1)', 'javascript');
    expect(textAt(r.data(), r.data().events.length)).toBe('console.log(1)');
  });

  it('keeps nothing without the consent but still counts', () => {
    const r = createRecorder('', 'python', { keep: false });
    r.edit('', 'abc');
    r.edit('abc', 'abc' + 'x'.repeat(300), true);
    expect(r.data()).toBeNull();
    expect(r.counters()).toEqual({ typed: 3, pasted: 300, largestPaste: 300 });
  });

  it('stops at the size cap and says so', () => {
    const r = createRecorder('', 'python', { maxEvents: 3 });
    let s = '';
    for (let i = 0; i < 10; i += 1) { r.edit(s, `${s}a`); s += 'a'; }
    expect(r.data().events).toHaveLength(3);
    expect(r.data().truncated).toBe(true);
    const r2 = createRecorder('', 'python', { maxBytes: 1000 });
    r2.edit('', 'x'.repeat(2000), true);
    expect(r2.data().truncated).toBe(true);
  });
});

describe('playing a replay', () => {
  const rep = { v: 1, start: 'ab', events: [[100, 'e', 2, 0, 'c'], [60_000, 'p', 0, 0, 'PASTED'], [200, 'e', 0, 1, '']] };
  it('caps long pauses and plays faster at 4x / 16x', () => {
    const { times, total } = timeline(rep);
    expect(times).toEqual([100, 100 + IDLE_CAP_MS, 300 + IDLE_CAP_MS]);
    expect(total).toBe(300 + IDLE_CAP_MS);
    expect(delayFor(rep, 1, 1)).toBe(IDLE_CAP_MS);
    expect(delayFor(rep, 1, 16)).toBe(IDLE_CAP_MS / 16);
  });
  it('marks the paste moments and highlights the pasted text', () => {
    const m = pasteMarks(rep, 5);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ i: 1, size: 6, big: true });
    expect(pasteSpan(rep, 2)).toEqual({ before: '', mark: 'PASTED', after: 'abc' });
    expect(pasteSpan(rep, 1).mark).toBe('');
    expect(textAt(rep, 3)).toBe('ASTEDabc');
  });
  it('says the numbers in plain words', () => {
    expect(statsLine({ typed: 10, pasted: 300, largestPaste: 300, blurs: 2, durationMs: 125_000 })).toBe('Typed 10 characters · pasted 300 (largest paste 300) · left the editor 2 times · 2 min 5 s in all');
  });
});
