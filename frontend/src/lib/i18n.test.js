import { describe, expect, it } from 'vitest';
import STRINGS from '../i18n/home.json';
import { pickLang, translate } from './i18n';

describe('home languages', () => {
  it('a saved choice wins; else te-IN / hi-IN pick Telugu / Hindi; anything else is English', () => {
    expect(pickLang('hi', ['te-IN'])).toBe('hi');
    expect(pickLang(null, ['te-IN', 'en-US'])).toBe('te');
    expect(pickLang(null, ['hi-IN'])).toBe('hi');
    expect(pickLang(null, ['hi'])).toBe('hi');
    expect(pickLang(null, ['en-IN', 'te-IN'])).toBe('en'); // the first known language decides
    expect(pickLang(null, ['ta-IN'])).toBe('en');
    expect(pickLang('xx', [])).toBe('en'); // a broken saved value is ignored
    expect(pickLang(undefined, [undefined])).toBe('en');
  });

  it('a missing string falls back to English, then to the key; values are filled in', () => {
    const table = { en: { a: 'Hello', n: '{n} templates' }, te: { n: '{n} టెంప్లేట్లు' } };
    expect(translate('te', 'a', null, table)).toBe('Hello');
    expect(translate('te', 'n', { n: 18 }, table)).toBe('18 టెంప్లేట్లు');
    expect(translate('hi', 'n', { n: 18 }, table)).toBe('18 templates'); // no Hindi table at all
    expect(translate('en', 'missing', null, table)).toBe('missing');
    expect(translate('en', 'n', {}, table)).toBe('{n} templates'); // an unknown value stays visible, not "undefined"
  });

  it('Telugu and Hindi cover every English string, in their own script', () => {
    const keys = Object.keys(STRINGS.en);
    for (const lang of ['te', 'hi']) {
      expect(Object.keys(STRINGS[lang]).sort()).toEqual([...keys].sort());
      const script = lang === 'te' ? /[ఀ-౿]/ : /[ऀ-ॿ]/;
      for (const k of keys) expect(script.test(STRINGS[lang][k]), `${lang} ${k}`).toBe(true);
      for (const k of keys) if (STRINGS.en[k].includes('{n}')) expect(STRINGS[lang][k]).toContain('{n}');
    }
  });
});
