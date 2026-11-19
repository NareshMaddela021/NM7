import { describe, expect, it } from 'vitest';
import { answered, clock, norm, pickSjt, recordLine, secondsLeft, typingTracker, wpm } from './workLib';

describe('Vetting Trust T15 work tests', () => {
  it('normalises like the server and counts Indic code points', () => {
    expect(norm('  a   b‌ c ')).toBe('a b c');
    expect([...norm('नमस्ते दुनिया')].length).toBe(13);
    expect(norm('మేనేజర్‌కి')).toBe(norm('మేనేజర్కి'));
    expect(wpm('x'.repeat(100), 60000)).toBe(20);
    expect(wpm('abc', 0)).toBe(0);
  });

  it('tracks big inserts, blocked pastes and the typing time', () => {
    let t = 1000;
    const tr = typingTracker(() => t);
    tr.change('T');
    t = 2000; tr.change('Th');
    t = 3000; tr.change('Th' + 'e van leaves at seven');
    tr.paste();
    expect(tr.st.inputs).toBe(3);
    expect(tr.st.insertedChars).toBe(21);
    expect(tr.body('x')).toEqual({ typed: 'x', ms: 2000, inputs: 3, insertedChars: 21, pasteAttempts: 1 });
  });

  it('SJT picks keep most and least different, and counts answered items', () => {
    let a = pickSjt({}, 'most', 1);
    a = pickSjt(a, 'least', 1);
    expect(a).toEqual({ least: 1 });
    a = pickSjt(a, 'most', 2);
    expect(answered('sjt', [{ id: 'x' }, { id: 'y' }], { x: a })).toBe(1);
    expect(answered('aptitude', [{ id: 'x' }, { id: 'y' }], { x: 0, y: 3 })).toBe(2);
  });

  it('clock and the record line', () => {
    expect(secondsLeft(10_000, 4_000)).toBe(6);
    expect(clock(75)).toBe('1:15');
    expect(recordLine({ empty: true, text: 'No history yet' })).toBe('No history yet');
    expect(recordLine({ empty: false, text: 'Showed up 1/1', source: 'confirmed by employers' })).toBe('Showed up 1/1 · confirmed by employers');
  });
});
