// "Speak" for the summary writer: the browser's own Web Speech API (free, nothing sent to our server). Chrome, Edge
// and Safari have it; Firefox and some iOS browsers don't, so the button is hidden there and a tip points to the
// phone keyboard's mic instead. The site's Permissions-Policy allows the microphone on our own pages only.
//
// What the session does for a good capture:
// - keeps listening until Stop (continuous), and restarts itself when the browser ends a run after a pause or at
//   about 60 s — until Stop is tapped or nothing has been heard for 20 s;
// - shows interim text live and commits only final results, APPENDED to what was already typed with spacing and
//   punctuation (appendSpeech);
// - asks for 3 alternatives and keeps the one with the highest confidence;
// - plain messages for the usual errors.
import dictionary from './dictionary.json';
import { DEFAULT_SPEECH_LANG } from '../speechCore';
import { langsShown } from '../i18n';

export * from '../speechCore';

const ALL_SPEECH = dictionary.speechLanguages; // [[code, label], …], en-IN first
const HIDDEN = /^(te|hi)-/;
/** The languages to speak in: without Telugu and Hindi while they are hidden (Admin → Settings). */
export const speechLanguages = () => (langsShown() ? ALL_SPEECH : ALL_SPEECH.filter(([c]) => !HIDDEN.test(c)));
export const SPEECH_LANGUAGES = ALL_SPEECH;
export const LANG_KEY = 'nm7.speechLang';

/** The code to start with: the last one picked here, else the browser's own Indian locale, else English (en-IN). */
export function defaultSpeechLang(win = typeof window !== 'undefined' ? window : undefined) {
  const codes = speechLanguages().map(([c]) => c);
  try {
    const saved = win?.localStorage?.getItem(LANG_KEY);
    if (saved && codes.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  const nav = (win?.navigator?.language || '').trim();
  if (nav) {
    const exact = codes.find((c) => c.toLowerCase() === nav.toLowerCase());
    if (exact) return exact;
    const [lang, region] = nav.split(/[-_]/);
    if ((region || '').toUpperCase() === 'IN' || !region) {
      const byLang = codes.find((c) => c.split('-')[0] === lang.toLowerCase());
      if (byLang && (region || byLang !== 'en-IN')) return byLang; // a bare "te" picks Telugu; a bare "en" stays the default
    }
  }
  return DEFAULT_SPEECH_LANG;
}
export function rememberSpeechLang(code, win = typeof window !== 'undefined' ? window : undefined) {
  try { win?.localStorage?.setItem(LANG_KEY, code); } catch { /* storage blocked */ }
}
