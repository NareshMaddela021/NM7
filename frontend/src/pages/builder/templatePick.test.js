import { describe, expect, it } from 'vitest';
import { audienceOf, isUseKey, pickState, selectionText } from './templatePick';
import { TEMPLATE_PRESETS } from './design';

describe('template picker selection', () => {
  it('starts on the current template without the bottom bar, and a pick shows it', () => {
    let s = { selected: 'fresher', touched: false };
    s = pickState(s, { type: 'sync', key: 'fresher' });
    expect(s).toEqual({ selected: 'fresher', touched: false });
    s = pickState(s, { type: 'pick', key: 'classic' });
    expect(s).toEqual({ selected: 'classic', touched: true });
    s = pickState(s, { type: 'sync', key: 'work' }); // applied elsewhere (e.g. a suggestion): follows it
    expect(s).toEqual({ selected: 'work', touched: true });
    expect(pickState(s, { type: 'nope' })).toBe(s);
  });

  it('labels always carry the selected template’s name', () => {
    const t = TEMPLATE_PRESETS.classic;
    expect(selectionText(t, { ats: 100, two: false })).toEqual({
      name: 'Classic',
      use: 'Use Classic',
      meta: 'ATS 100 · 1 column · Any level',
      announce: 'Classic selected. Use Classic to continue.',
    });
    expect(selectionText(TEMPLATE_PRESETS.fresher, { ats: 98 }).meta).toBe('ATS 98 · 1 column · Freshers');
    expect(selectionText(TEMPLATE_PRESETS.sidebar, { ats: 80, two: true }).meta).toBe('ATS 80 · 2 columns · Experienced');
    expect(selectionText(null).use).toBe('Use this');
    expect(audienceOf({ level: 'all' })).toBe('Any level');
  });

  it('Enter and Space use the focused card', () => {
    expect(isUseKey({ key: 'Enter' })).toBe(true);
    expect(isUseKey({ key: ' ' })).toBe(true);
    expect(isUseKey({ key: 'Tab' })).toBe(false);
    expect(isUseKey({ key: 'ArrowDown' })).toBe(false);
  });
});
