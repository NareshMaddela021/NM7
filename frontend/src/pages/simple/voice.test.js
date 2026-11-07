// Voice on the Easy dashboard (E3): the person's language when the phone has that voice, else English, else a note
// (never an error). The phone's voices are mocked.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadLang } from '../../lib/i18n';
import { compose, sayIt } from './voice';

beforeAll(async () => { await loadLang('te'); await loadLang('hi'); });

const items = [['simple.lang.title'], ['simple.next.fix_score.text', { score: 52, need: 60 }]];

describe('compose', () => {
  it('reads the words in one language as sentences', () => {
    expect(compose(items, 'en')).toBe('Choose your language. Your resume score is 52. It needs 60 to apply.');
    expect(compose(items, 'te')).toBe('మీ భాషను ఎంచుకోండి. మీ రెజ్యూమ్ స్కోరు 52. అప్లై చేయడానికి {need} కావాలి.'.replace('{need}', '60'));
    expect(compose(['  ', null, 'Hello'], 'en')).toBe('Hello.');
  });
});

describe('sayIt', () => {
  it('uses the person’s language when the phone has it', async () => {
    const read = vi.fn(async () => ({ ok: true }));
    expect(await sayIt(items, 'hi', read)).toBe('lang');
    expect(read).toHaveBeenCalledWith(compose(items, 'hi'), 'hi-IN');
  });
  it('falls back to the English words in an English voice', async () => {
    const read = vi.fn(async (_t, v) => (v === 'te-IN' ? { ok: false, reason: 'no_voice' } : { ok: true }));
    expect(await sayIt(items, 'te', read)).toBe('en');
    expect(read).toHaveBeenLastCalledWith(compose(items, 'en'), 'en-IN');
  });
  it('says there is no voice when the phone has none (no error)', async () => {
    expect(await sayIt(items, 'te', async () => ({ ok: false, reason: 'unsupported' }))).toBe(false);
    expect(await sayIt(items, 'te', async (_t, v) => ({ ok: false, reason: v === 'en-IN' ? 'error' : 'no_voice' }))).toBe(false);
    expect(await sayIt(items, 'en', async () => ({ ok: false, reason: 'unsupported' }))).toBe(false);
  });
});
