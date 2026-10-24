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
import { useEffect, useRef, useState } from 'react';
import dictionary from './dictionary.json';

export const SPEECH_LANGUAGES = dictionary.speechLanguages; // [[code, label], …], en-IN first
export const DEFAULT_SPEECH_LANG = 'en-IN';
export const LANG_KEY = 'nm7.speechLang';
export const SILENCE_MS = 20_000; // stop on our own after this long without a word
export const MIXED_HINT = 'Speaking Telugu or Hindi mixed with English? "English + mixed" usually hears it best.';
export const KEYBOARD_TIP = 'Tip: you can also use your phone keyboard’s mic 🎤';

export const MESSAGES = {
  'not-allowed': 'Allow microphone in your browser settings',
  'service-not-allowed': 'Speech isn’t available in this browser — use your keyboard’s mic instead',
  'no-speech': 'Didn’t hear anything, try again closer to the mic',
  network: 'Speech needs internet — check your connection and try again',
  'audio-capture': 'No microphone found — check it is plugged in and allowed',
  'language-not-supported': 'This language isn’t supported for speech here — try English + mixed',
  'start-failed': 'Speech didn’t start — try again or type instead',
};
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

export function recognitionCtor(win = typeof window !== 'undefined' ? window : undefined) {
  return win ? win.SpeechRecognition || win.webkitSpeechRecognition || null : null;
}
export const speechSupported = (win) => !!recognitionCtor(win);

/** The code to start with: the last one picked here, else the browser's own Indian locale, else English (en-IN). */
export function defaultSpeechLang(win = typeof window !== 'undefined' ? window : undefined) {
  const codes = SPEECH_LANGUAGES.map(([c]) => c);
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

const ENDS_SENTENCE = /[.!?।,;:…]$/;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Adds a committed piece of speech to the note: never overwrites, adds one space, and a full stop between chunks
 * when the note doesn't already end in punctuation. "I am Angelin" + "I completed BSc" → "I am Angelin. I completed BSc".
 */
export function appendSpeech(existing, chunk) {
  const base = (existing || '').replace(/\s+$/, '');
  const add = (chunk || '').trim().replace(/\s+/g, ' ');
  if (!add) return existing || '';
  if (!base) return cap(add);
  const sep = ENDS_SENTENCE.test(base) ? ' ' : '. ';
  return `${base}${sep}${cap(add)}`;
}

/** The alternative with the highest confidence (the browser's first one when none has a score). */
export function bestAlternative(result) {
  let best = null;
  for (let i = 0; i < (result?.length ?? 0); i += 1) {
    const alt = result[i];
    if (!alt?.transcript?.trim()) continue;
    if (!best || (alt.confidence || 0) > (best.confidence || 0)) best = alt;
  }
  return (best?.transcript || '').trim();
}

/**
 * One listening session on top of SpeechRecognition. Pure enough to unit-test with a fake constructor.
 *   new SpeechSession({ Ctor, lang, onFinal, onInterim, onChange, silenceMs, now })
 *   .start() / .stop()        onChange({ listening, error })
 * onFinal(text) per committed chunk; onInterim(text) with the words still being recognised ('' when settled).
 */
export class SpeechSession {
  constructor({ Ctor, lang, onFinal, onInterim, onChange, silenceMs = SILENCE_MS, now = () => Date.now() }) {
    Object.assign(this, { Ctor, lang, onFinal, onInterim, onChange, silenceMs, now });
    this.rec = null;
    this.listening = false;
    this.wantStop = false;
    this.heardAnything = false;
    this.lastHeardAt = 0;
    this.committed = 0; // how many results of the current run are already final
  }

  start() {
    if (this.listening || !this.Ctor) return;
    this.wantStop = false;
    this.heardAnything = false;
    this.lastHeardAt = this.now();
    this.listening = true;
    this.onChange?.({ listening: true, error: '' });
    this.run();
  }

  stop() {
    this.wantStop = true;
    this.onInterim?.('');
    try { this.rec?.stop(); } catch { /* already stopped */ }
    if (!this.rec) this.ended();
  }

  abort() {
    this.wantStop = true;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.ended();
  }

  /** One browser run; the browser ends it after a pause or ~60 s and we start the next one. */
  run() {
    const r = new this.Ctor();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    this.committed = 0;
    r.onresult = (e) => this.result(e);
    r.onerror = (e) => this.error(e?.error || 'unknown');
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      if (this.wantStop || this.now() - this.lastHeardAt >= this.silenceMs) this.ended();
      else this.run();
    };
    this.rec = r;
    try { r.start(); } catch { this.rec = null; this.fail('start-failed'); }
  }

  result(e) {
    const results = e?.results || [];
    const interim = [];
    for (let i = e?.resultIndex ?? 0; i < results.length; i += 1) {
      const res = results[i];
      const text = bestAlternative(res);
      if (!text) continue;
      if (res.isFinal) {
        if (i >= this.committed) { this.committed = i + 1; this.heardAnything = true; this.onFinal?.(text); }
      } else interim.push(text);
    }
    this.lastHeardAt = this.now();
    this.onInterim?.(interim.join(' '));
  }

  error(code) {
    if (code === 'aborted') return;
    if (code === 'no-speech') {
      // the browser gives up after ~8 s of quiet; the run's end restarts us unless the 20 s have passed
      if (!this.heardAnything && this.now() - this.lastHeardAt >= this.silenceMs) this.fail(code);
      return;
    }
    this.fail(FATAL.has(code) ? code : 'start-failed');
  }

  fail(code) {
    this.wantStop = true;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.ended(MESSAGES[code] || MESSAGES['start-failed']);
  }

  ended(error = '') {
    if (!this.listening && !error) return;
    this.listening = false;
    if (!error && !this.heardAnything && this.now() - this.lastHeardAt >= this.silenceMs) error = MESSAGES['no-speech'];
    this.onInterim?.('');
    this.onChange?.({ listening: false, error });
  }
}

/** Speaking is activity too: the kiosk's idle timer listens for this so a talking candidate isn't wiped. */
const activity = () => { try { window.dispatchEvent(new Event('nm7-activity')); } catch { /* no window */ } };

/**
 * useSpeech({ lang, onText }) → { supported, listening, interim, seconds, error, start, stop }
 * `onText(words)` gets each committed chunk; the caller appends it to the note with appendSpeech.
 */
export function useSpeech({ lang = DEFAULT_SPEECH_LANG, onText }) {
  const [state, setState] = useState({ listening: false, error: '' });
  const [interim, setInterim] = useState('');
  const [seconds, setSeconds] = useState(0);
  const session = useRef(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = speechSupported();

  useEffect(() => () => session.current?.abort(), []);
  useEffect(() => {
    if (!state.listening) return undefined;
    const t0 = Date.now();
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state.listening]);

  const start = () => {
    if (!supported || state.listening) return;
    session.current = new SpeechSession({
      Ctor: recognitionCtor(), lang,
      onFinal: (t) => { cb.current?.(t); activity(); },
      onInterim: (t) => { setInterim(t); if (t) activity(); },
      onChange: setState,
    });
    session.current.start();
  };
  const stop = () => session.current?.stop();
  return { supported, listening: state.listening, error: state.error, interim, seconds, start, stop };
}
