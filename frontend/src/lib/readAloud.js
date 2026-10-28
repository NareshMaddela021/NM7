// Reading a question aloud with the browser's own speech synthesis (no paid service). English (India) by default;
// Telugu or Hindi voices when the device has them. When there is no voice at all, the screen shows the text only.

export const READ_LANGS = [['en-IN', 'English'], ['te-IN', 'Telugu'], ['hi-IN', 'Hindi']];

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : undefined);
export const canRead = () => !!synth() && typeof window.SpeechSynthesisUtterance === 'function';

/** The best voice for a language: exact (te-IN), then the same language (te), then for English any en voice. */
export function pickVoice(voices, lang) {
  const base = lang.split('-')[0];
  return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang?.replace('_', '-').startsWith(`${base}-`) || v.lang === base)
    || (base === 'en' ? voices.find((v) => v.lang?.startsWith('en')) : null) || null;
}

/** Voices load late on Chrome / Android: wait for them a moment. */
export function voices(timeout = 1200) {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { s.removeEventListener?.('voiceschanged', done); resolve(s.getVoices()); };
    s.addEventListener?.('voiceschanged', done);
    setTimeout(done, timeout);
  });
}

/** Reads `text` aloud. Resolves { ok, reason } — reason 'no_voice' when this device has no voice for the language. */
export async function readAloud(text, lang = 'en-IN', { rate = 0.95 } = {}) {
  if (!canRead()) return { ok: false, reason: 'unsupported' };
  const v = pickVoice(await voices(), lang);
  if (!v && lang !== 'en-IN') return { ok: false, reason: 'no_voice' };
  const s = synth();
  s.cancel();
  const u = new window.SpeechSynthesisUtterance(text);
  u.lang = v?.lang || lang;
  if (v) u.voice = v;
  u.rate = rate;
  return new Promise((resolve) => {
    u.onend = () => resolve({ ok: true });
    u.onerror = () => resolve({ ok: false, reason: 'error' });
    s.speak(u);
    setTimeout(() => resolve({ ok: true }), Math.min(20000, 1500 + text.length * 90)); // some devices never fire onend
  });
}

export const stopReading = () => { try { synth()?.cancel(); } catch { /* nothing to stop */ } };
