import { describe, expect, it } from 'vitest';
import { audienceOf, hasOwnDetails, isUseKey, pickState, selectionText, startView, withTemplate } from './templatePick';
import { INITIAL } from './schema';
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

describe('Sample resume | My details', () => {
  const mine = { ...INITIAL, personal: { ...INITIAL.personal, name: 'Ravi Teja', email: 'ravi@example.com' }, design: { preset: 'fresher' }, hidden: { decl: false, pinfo: false, hobbies: true }, showPhoto: false };

  it('opens on My details when the resume has a name, else Sample; a saved choice wins', () => {
    expect(startView(null, mine)).toBe('mine');
    expect(startView(null, { ...mine, personal: { ...mine.personal, name: '  ' } })).toBe('sample');
    expect(startView(null, INITIAL)).toBe('sample'); // the built-in sample is not "my details"
    expect(startView(null, null)).toBe('sample');
    expect(startView('sample', mine)).toBe('sample');
    expect(startView('mine', null)).toBe('mine');
    expect(startView('junk', mine)).toBe('mine');
    expect(hasOwnDetails(mine)).toBe(true);
  });

  it('a look-only template keeps the person\'s hidden sections and print switches; a new layout brings its own, as the builder does', () => {
    const look = withTemplate(mine, 'modern'); // same standard layout as Fresher First
    expect(look.data).toBe(mine);
    expect(look.design).toMatchObject({ preset: 'modern', font: 'lato' });
    const kio = withTemplate(mine, 'kio'); // the Kio layout: its own order and switches
    expect(kio.data.order[0]).toBe('summary');
    expect(kio.data.hidden).toEqual({ proj: true, skills: true, certs: true, ach: true, langs: true });
    expect(kio.data.personal).toBe(mine.personal); // content is never touched
    expect(kio.data.exp).toBe(mine.exp);
    expect(withTemplate(mine, 'portrait').data.showPhoto).toBe(true);
    expect(withTemplate(mine, 'nope').design).toBeNull();
  });
});
