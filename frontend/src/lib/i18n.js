// Home page languages (phase 1): English, Telugu, Hindi. Strings live in src/i18n/home.json; a missing string falls
// back to English. The choice is remembered in this browser; the first visit follows the phone's language
// (te-IN → Telugu, hi-IN → Hindi), else English. Noto Sans Telugu / Devanagari load only when that language is picked.
import { useSyncExternalStore } from 'react';
import STRINGS from '../i18n/home.json';

export const LANGS = [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी']];
export const STORE_KEY = 'nm7-lang';
const CODES = LANGS.map(([c]) => c);
const FONTS = {
  te: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=swap',
  hi: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap',
};

/** The language to show: a saved choice wins; else the browser's (te / hi, with or without -IN); else English. */
export function pickLang(saved, navLangs = []) {
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
  const s = table[lang]?.[key] ?? table.en?.[key] ?? key;
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
if (current !== 'en') loadFont(current);

export function setLang(lang) {
  if (!CODES.includes(lang) || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* private mode: this visit only */ }
  loadFont(lang);
  subs.forEach((f) => f());
}

/** [t, lang]: t('hero.title'), t('seeker.chip.templates', { n: 18 }). Re-renders when the language changes. */
export function useLang() {
  const lang = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => 'en');
  return [(key, vars) => translate(lang, key, vars), lang];
}
