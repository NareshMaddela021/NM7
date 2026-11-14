// Languages for the main public pages: English, Telugu, Hindi. Strings live in src/i18n/home.json (top of the home
// page, phase 1) and src/i18n/pages.json (the rest of the home page, /for-orgs, the builder's Start step, sign-in); a
// missing string falls back to English. Telugu and Hindi are AI drafts until a native speaker reviews them
// (docs/translations-review.md). The choice is remembered in this browser; the first visit follows the phone's
// language (te-IN → Telugu, hi-IN → Hindi), else English. Noto Sans Telugu / Devanagari load only when that language
// is picked, with font-display: optional — the text never re-flows when the font arrives (it would shift the whole
// hero); until it is cached, the phone's own Telugu / Devanagari font is used (Android ships Noto itself).
// Telugu and Hindi (home.json's and pages.json's) are not in the main bundle: each loads (a few KB) the first time that
// language is on, and its strings show as soon as it arrives (English until then). Round L: home.json's moved out of
// the main bundle too, so React Router 7 fits the Easy dashboard's 150 KB budget.
import { Fragment, createElement, useSyncExternalStore } from 'react';
import { en as HOME_EN } from '../i18n/home.json';
import { en as PAGES_EN } from '../i18n/pages.json';

export const LANGS = [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी']];
export const STORE_KEY = 'nm7-lang';
// Telugu and Hindi are shown only when Admin → Settings → "Show Telugu and Hindi" is on (item 41; off by default
// until a native speaker has checked them). The flag comes from GET /api/public/site-flags (main.jsx) and is kept in
// this browser (not personal, so it doesn't start with nm7-) so the next visit draws in the right language at once.
// Off: no language switch anywhere and everything is English; saved Telugu / Hindi choices are kept for later.
export const FLAG_KEY = 'nm7site.langs';
const CODES = LANGS.map(([c]) => c);
const FONTS = {
  te: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=optional',
  hi: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=optional',
};

/** Both string files as one table per language (a key lives in only one of them). Telugu and Hindi are added by
 * loadLang(). */
export const STRINGS = { en: { ...HOME_EN, ...PAGES_EN }, te: {}, hi: {} };
const LOADERS = {
  // one named export per import, so the bundler keeps only that language of each file
  te: () => Promise.all([import('../i18n/home.json?te').then(({ te }) => te), import('../i18n/pages.json?te').then(({ te }) => te)])
    .then(([home, pages]) => ({ ...home, ...pages })),
  hi: () => Promise.all([import('../i18n/home.json?hi').then(({ hi }) => hi), import('../i18n/pages.json?hi').then(({ hi }) => hi)])
    .then(([home, pages]) => ({ ...home, ...pages })),
};
const loading = {};
let version = 0; // goes up when a language's strings arrive, so pages re-render with them

const read0 = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
let shown = typeof window !== 'undefined' && read0(FLAG_KEY) === '1';
/** Are Telugu and Hindi shown on this site right now? */
export const langsShown = () => shown;

/** The language to show: English while Telugu and Hindi are hidden; else a saved choice wins; else the browser's
 * (te / hi, with or without -IN); else English. */
export function pickLang(saved, navLangs = [], on = shown) {
  if (!on) return 'en';
  if (CODES.includes(saved)) return saved;
  for (const l of navLangs) {
    const base = String(l || '').toLowerCase().split('-')[0];
    if (base === 'te' || base === 'hi') return base;
    if (base === 'en') return 'en';
  }
  return 'en';
}

/** One string: the language's own, else English, else the key itself; {n}-style values filled in. */
export function translate(lang, key, vars, table = STRINGS) {
  // one thing: "Answer 1 question", not "Answer 1 questions" (re-test N5). `key.one` is used when n is 1 and the
  // language has it (or, for English, when only the English one exists).
  const one = vars && Number(vars.n) === 1 ? `${key}.one` : '';
  const s = (one ? table[lang]?.[one] ?? (table[lang]?.[key] == null ? table.en?.[one] : undefined) : undefined) ?? table[lang]?.[key] ?? table.en?.[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const nav = () => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
let current = typeof window === 'undefined' ? 'en' : pickLang(read(STORE_KEY), nav());
const subs = new Set();

export function loadFont(lang) {
  if (typeof document === 'undefined' || !FONTS[lang] || document.querySelector(`link[data-lang-font="${lang}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = FONTS[lang]; l.dataset.langFont = lang;
  document.head.appendChild(l);
}
const changed = () => { version += 1; subs.forEach((f) => f()); };

/** Telugu / Hindi strings for the pages beyond the home page's top (once; a failed load is tried again next time). */
export function loadLang(lang) {
  if (!LOADERS[lang]) return Promise.resolve();
  loading[lang] ||= LOADERS[lang]().then((t) => { Object.assign(STRINGS[lang], t); changed(); }, () => { delete loading[lang]; });
  return loading[lang];
}
if (current !== 'en') { loadFont(current); loadLang(current); }

export function setLang(lang) {
  if (!CODES.includes(lang) || lang === current || (!shown && lang !== 'en')) return;
  current = lang;
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* private mode: this visit only */ }
  loadFont(lang);
  loadLang(lang);
  changed();
}

/** The site's flag arrived: show or hide Telugu and Hindi (and go back to English when they are hidden). */
export function setLangsShown(on) {
  on = !!on;
  try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on === shown) return;
  shown = on;
  const next = pickLang(read(STORE_KEY), nav());
  if (next !== current) { current = next; if (next !== 'en') { loadFont(next); loadLang(next); } }
  changed();
}

/** A translated string with parts that are not plain text: {name} → parts.name (a link, a <strong> …) and *word* →
 * parts.em(word) (or the bare word). Returns an array for React to render. */
export function rich(s, parts = {}) {
  return String(s).split(/(\{\w+\}|\*[^*]+\*)/).filter(Boolean).map((p, i) => {
    const v = p.match(/^\{(\w+)\}$/);
    let node = p;
    if (v && v[1] in parts) node = parts[v[1]];
    else if (/^\*[^*]+\*$/.test(p)) node = parts.em ? parts.em(p.slice(1, -1)) : p.slice(1, -1);
    return createElement(Fragment, { key: i }, node);
  });
}

/** The header's public links in the current language (Header's `labels`). */
export const headerLabels = (t) => Object.fromEntries(['build', 'jobs', 'templates', 'pricing', 'orgs', 'blog', 'scan', 'buildFree', 'menu'].map((k) => [k, t(`nav.${k}`)]));

/** [t, lang]: t('hero.title'), t('seeker.chip.templates', { n: 18 }). Re-renders when the language changes. */
export function useLang() {
  const snap = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => `${current}:${version}`, () => 'en:0');
  const lang = snap.split(':')[0];
  return [(key, vars) => translate(lang, key, vars), lang];
}
