import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import STRINGS from '../i18n/home.json';
import PAGES from '../i18n/pages.json';
import { CSV_PATH, STATUS, buildCsv } from '../../scripts/i18n-review.mjs';
import { STRINGS as ALL, loadLang, pickLang, rich, translate } from './i18n';
import { LIMITS, PLAN_FEATURES } from './orgBilling';
import { PROMISES } from './pricing';
import { WA_PAY_TEXT } from './waPay';

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

// Brand names, abbreviations and numbers may stay as they are in Telugu and Hindi; nothing else may.
const KEEP = /\b(Nm7|ATS|PDF|DOCX|Word|LinkedIn|WhatsApp|GST|GSTIN|UPI|PAN|PSU|NGO|Razorpay|HR|AI|QR|SMS|PO|URL|ID|MB|Free|Owner|Billing|Settings|Organization)\b/g;
const brandOnly = (s) => !s.replace(/\{\w+\}/g, '').replace(KEEP, '').replace(/[\s\d₹%.,·:;/&+\-–—→()*!?“”"'’]/g, '');
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort();
const SCRIPT = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/ };

describe('more pages in Telugu and Hindi (src/i18n/pages.json)', () => {
  const keys = Object.keys(PAGES.en);

  it('every English string has a Telugu and a Hindi draft, with the same {values} and *emphasis*', () => {
    expect(keys.length).toBeGreaterThan(200);
    for (const lang of ['te', 'hi']) {
      expect(Object.keys(PAGES[lang]).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        const v = PAGES[lang][k];
        expect(typeof v === 'string' && v.trim().length > 0, `${lang} ${k} is empty`).toBe(true);
        expect(holes(v), `${lang} ${k} keeps its {values}`).toEqual(holes(PAGES.en[k]));
        expect((v.match(/\*/g) || []).length, `${lang} ${k} keeps its *emphasis*`).toBe((PAGES.en[k].match(/\*/g) || []).length);
      }
    }
  });

  it('no Telugu or Hindi string is just the English one (unless it is only a brand name or a number), and each is in its own script', () => {
    for (const lang of ['te', 'hi']) {
      for (const k of keys) {
        const v = PAGES[lang][k];
        if (v === PAGES.en[k]) expect(brandOnly(v), `${lang} ${k} is still English: ${v}`).toBe(true);
        expect(SCRIPT[lang].test(v), `${lang} ${k} is in ${lang} script`).toBe(true);
      }
    }
    expect(brandOnly('LinkedIn · {price}')).toBe(true);
    expect(brandOnly('Start free')).toBe(false);
  });

  it('home.json and pages.json never use the same key; English is there at once, Telugu and Hindi once loaded', async () => {
    for (const k of Object.keys(STRINGS.en)) expect(PAGES.en[k], k).toBeUndefined();
    expect(translate('en', 'orgs.hero.title')).toBe(PAGES.en['orgs.hero.title']);
    expect(translate('hi', 'orgs.hero.title')).toBe(PAGES.en['orgs.hero.title']); // English until Hindi arrives
    await Promise.all([loadLang('te'), loadLang('hi'), loadLang('xx')]);
    expect(translate('te', 'hero.title')).toBe(STRINGS.te['hero.title']);
    expect(translate('hi', 'orgs.hero.title')).toBe(PAGES.hi['orgs.hero.title']);
    expect(translate('te', 'builder.start.profile.text', { n: 55 })).toContain('55%');
    for (const l of ['en', 'te', 'hi']) expect(Object.keys(ALL[l]).length).toBe(Object.keys(STRINGS.en).length + keys.length);
  });

  it('no phone numbers or email addresses in the strings (the code fills them in)', () => {
    for (const lang of ['en', 'te', 'hi']) {
      for (const k of keys) {
        expect(PAGES[lang][k], `${lang} ${k}`).not.toMatch(/@|\b\d{10}\b|\+91/);
      }
    }
  });

  it('the plans table has a string for every limit and feature, matching the English labels in lib/orgBilling', () => {
    for (const [k, label] of LIMITS) expect(PAGES.en[`orgs.table.l.${k}`], k).toBe(label);
    for (const [k, label] of PLAN_FEATURES.filter(([x]) => x !== 'kiosk')) expect(PAGES.en[`orgs.table.f.${k}`], k).toBe(label);
  });

  it('strings built around shared values still match them', () => {
    expect(PROMISES.delivery).toMatch(/^\S+ hours$/); // the strings say "{h} hours"
    expect(PAGES.en['pricing.waPay']).toBe(WA_PAY_TEXT);
  });

  it('rich(): {values} become the given parts and *word* is emphasised', () => {
    const out = rich('See {link} — *now*', { link: 'LINK', em: (w) => `[${w}]` });
    expect(out.map((x) => x.props.children)).toEqual(['See ', 'LINK', ' — ', '[now]']);
    expect(rich('a *b*').map((x) => x.props.children)).toEqual(['a ', 'b']);
    expect(rich('{x}').map((x) => x.props.children)).toEqual(['{x}']); // an unknown part stays visible
  });
});

describe('the review list (docs/translations-review.csv)', () => {
  const parse = (text) => text.replace(/^\uFEFF/, '').trim().split('\n').map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));

  it('is up to date with the JSON files (npm run i18n:review)', () => {
    expect(readFileSync(CSV_PATH, 'utf8')).toBe(buildCsv());
  });

  it('has one row per string, every Telugu and Hindi draft in it, and every row needs native review', async () => {
    await Promise.all([loadLang('te'), loadLang('hi')]);
    const [head, ...rows] = parse(readFileSync(CSV_PATH, 'utf8'));
    expect(head).toEqual(['key', 'page', 'English', 'Telugu', 'Hindi', 'status']);
    const all = [...Object.keys(STRINGS.en), ...Object.keys(PAGES.en)];
    expect(rows.map((r) => r[0])).toEqual(all);
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
    for (const r of rows) {
      expect(r, r[0]).toHaveLength(6);
      expect(r[5], r[0]).toBe(STATUS);
      expect(r[1], `${r[0]} has a page`).not.toBe('');
      expect(r[3], r[0]).toBe(ALL.te[r[0]]);
      expect(r[4], r[0]).toBe(ALL.hi[r[0]]);
    }
  });
});
