// "Speak" for the summary writer: the browser's own Web Speech API (free, nothing sent to our server). Chrome,
// Edge and Safari have it; Firefox doesn't, so the button is hidden there. The site's Permissions-Policy allows the
// microphone on our own pages only.
import { useEffect, useRef, useState } from 'react';
import dictionary from './dictionary.json';

export const SPEECH_LANGUAGES = dictionary.speechLanguages; // [[code, label], …], en-IN first
export const DEFAULT_SPEECH_LANG = 'en-IN';

export function speechSupported(win = typeof window !== 'undefined' ? window : undefined) {
  return !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition));
}

const MESSAGES = {
  'not-allowed': 'The microphone is blocked. Allow it in your browser’s address bar and try again.',
  'service-not-allowed': 'Speech recognition isn’t available in this browser right now. Please type instead.',
  'audio-capture': 'No microphone was found. Please type instead.',
  network: 'Speech recognition needs an internet connection. Please type instead.',
  'no-speech': 'Nothing was heard. Tap Speak and talk close to the phone.',
  aborted: '',
};

/**
 * useSpeech({ lang, onText }) → { supported, listening, start, stop, error }
 * `onText(words)` is called with each final piece of what was heard; the caller appends it to the note.
 */
export function useSpeech({ lang = DEFAULT_SPEECH_LANG, onText }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = speechSupported();

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* already stopped */ } }, []);

  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } };
  const start = () => {
    if (!supported || listening) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const words = Array.from(e.results).slice(e.resultIndex).filter((x) => x.isFinal).map((x) => x[0]?.transcript || '').join(' ').trim();
      if (words) cb.current?.(words);
    };
    r.onerror = (e) => { setError(MESSAGES[e.error] ?? 'Speech didn’t work this time. Please type instead.'); };
    r.onend = () => { setListening(false); rec.current = null; };
    rec.current = r;
    setError('');
    try { r.start(); setListening(true); } catch { setError('Speech didn’t start. Please type instead.'); }
  };
  return { supported, listening, start, stop, error };
}
