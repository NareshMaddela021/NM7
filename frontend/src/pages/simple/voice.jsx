// Voice on the Easy dashboard (Phase 4, E3), with the phone's own voices only (no paid voice service):
// - 🔊 reads a screen or a card aloud in the person's language when the phone has that voice; else it reads the
//   same words in English; else it says "Voice not available on this phone" (never an error);
// - 🎤 on every text answer: Speak in the person's language (lib/speechCore.js), then "We heard: …" with Edit / OK
//   before anything is saved; without speech (Firefox, some iPhones) a tip points to the keyboard's mic;
// - "Read screens aloud automatically" (off by default) reads each screen when it opens.
import { useEffect, useRef, useState } from 'react';
import { translate } from '../../lib/i18n';
import { readAloud, stopReading } from '../../lib/readAloud';
import { appendSpeech, useSpeech } from '../../lib/speechCore';

export const VOICES = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' };

/** The words to read: [[key, vars], …] or plain strings, in one language, as sentences. */
export function compose(items, lang) {
  return items.filter(Boolean).map((x) => (Array.isArray(x) ? translate(lang, x[0], x[1]) : String(x)))
    .map((s) => s.trim()).filter(Boolean).map((s) => (/[.!?।…:]$/.test(s) ? s : `${s}.`)).join(' ');
}

/** Reads the words aloud: 'lang' (in the person's language), 'en' (that voice is missing: read in English) or
 * false (no voice at all on this phone). */
export async function sayIt(items, lang, read = readAloud) {
  const r = await read(compose(items, lang), VOICES[lang] || 'en-IN');
  if (r.ok) return 'lang';
  if (r.reason === 'no_voice' && lang !== 'en') {
    const e = await read(compose(items, 'en'), 'en-IN');
    if (e.ok) return 'en';
  }
  return false;
}

/** The 🔊 button: reads `items` aloud. A short note says when English was used or there is no voice. */
export function SayButton({ items, t, lang, label, testid, big }) {
  const [note, setNote] = useState('');
  const go = async () => {
    setNote('');
    const how = await sayIt(items, lang);
    if (how === 'en') setNote(t('simple.voice.english'));
    else if (!how) setNote(t('simple.voice.none'));
  };
  useEffect(() => () => stopReading(), []);
  return (
    <span className="sx-saywrap">
      <button type="button" className={big ? 'sx-say' : 'sx-say sx-say-sm'} aria-label={label || t('simple.voice.read')} onClick={go} data-testid={testid}><span aria-hidden="true">🔊</span></button>
      {note && <span className="sx-note" role="status" data-testid={testid ? `${testid}-note` : undefined}>{note}</span>}
    </span>
  );
}

/** Reads the screen when it opens, if the person turned "Read screens aloud automatically" on. */
export function useAutoRead(on, items, lang) {
  const key = JSON.stringify([on, lang, items]);
  const last = useRef('');
  useEffect(() => {
    if (!on || !items.length || last.current === key) return undefined;
    last.current = key;
    sayIt(items, lang);
    return () => stopReading();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A text answer with 🎤: what was said is shown first ("We heard: …"); OK adds it to the answer, Edit puts it in the
 * box to correct by hand. `onChange(text)` gets every change (typed or confirmed); nothing is saved before OK.
 */
export function SpeakField({ id, label, value, onChange, t, lang, multiline, testid, inputMode, autoComplete }) {
  const [heard, setHeard] = useState('');
  const [editing, setEditing] = useState(false);
  const words = useRef('');
  const sp = useSpeech({ lang: VOICES[lang] || 'en-IN', onText: (w) => { words.current = appendSpeech(words.current, w); setHeard(words.current); } });
  const start = () => { words.current = ''; setHeard(''); setEditing(false); sp.start(); };
  const ok = () => { onChange(appendSpeech(value, heard)); setHeard(''); };
  const edit = () => { onChange(appendSpeech(value, heard)); setHeard(''); setEditing(true); document.getElementById(id)?.focus(); };
  const Box = multiline ? 'textarea' : 'input';
  return (
    <div className="sx-stack sx-field">
      <label htmlFor={id} className="sx-flabel">{label}</label>
      <div className="sx-frow">
        <Box id={id} className="sx-input" rows={multiline ? 4 : undefined} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} autoComplete={autoComplete} data-testid={testid} data-editing={editing || undefined} />
        {sp.supported && (sp.listening
          ? <button type="button" className="sx-say sx-mic-on" onClick={sp.stop} aria-label={t('simple.voice.stop')} data-testid={testid ? `${testid}-stop` : undefined}><span aria-hidden="true">⏹</span></button>
          : <button type="button" className="sx-say" onClick={start} aria-label={t('simple.voice.speak')} data-testid={testid ? `${testid}-mic` : undefined}><span aria-hidden="true">🎤</span></button>)}
      </div>
      {sp.listening && <span className="sx-note" role="status">{t('simple.voice.listening')}{sp.interim ? ` ${sp.interim}` : ''}</span>}
      {!sp.listening && heard && (
        <div className="sx-heard" role="group" aria-label={t('simple.voice.heard')} data-testid={testid ? `${testid}-heard` : undefined}>
          <span className="sx-flabel">{t('simple.voice.heard')}</span>
          <span className="sx-p">{heard}</span>
          <span className="sx-frow">
            <button type="button" className="sx-big" onClick={edit} data-testid={testid ? `${testid}-edit` : undefined}><span className="sx-ic" aria-hidden="true">✏️</span><span>{t('simple.voice.edit')}</span></button>
            <button type="button" className="sx-big sx-ink" onClick={ok} data-testid={testid ? `${testid}-ok` : undefined}><span className="sx-ic" aria-hidden="true">✔</span><span>{t('simple.voice.ok')}</span></button>
          </span>
        </div>
      )}
      {!sp.listening && sp.error && <span className="sx-note" role="status">{t('simple.voice.micError')}</span>}
      {!sp.supported && <span className="sx-hint">{t('simple.voice.keyboard')}</span>}
    </div>
  );
}
