// The summary writer, above the summary box on the builder's Summary step, in Job Profile → Summary and in the kiosk
// builder. Layer A (smart templates, no network) and Layer B ("Write with AI", lib/summary/ai.js) share the cards.
//   note:   "Tell us about yourself" — typed or spoken, saved as a draft with the resume, never printed on it
//   chips:  a starter sentence for the note
//   Make my summary → three cards (Role-first, Skills-first, Simple) from the templates; tap one to fill the box
//   Write with AI (signed in) → the same three cards written by Claude, "Writing… (about 5 seconds)" with Cancel;
//           a slot AI left empty is a template card, and any failure shows the template cards with a one-line notice
//   quick fixes: Shorter, Try again (templates); with AI also More professional and Simpler words
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/ui';
import dictionary from '../../lib/summary/dictionary.json';
import { BUSY_TEXT, FIX_LABEL, WRITING_TEXT, aiAvailable, fallbackNotice, fillSlots, writeWithAi } from '../../lib/summary/ai';
import { DEFAULT_SPEECH_LANG, SPEECH_LANGUAGES, useSpeech } from '../../lib/summary/speech';
import { shorter, writeSummaries } from '../../lib/summary/write';

export const NOTE_MAX = 1000;
const HINT = 'Write or speak in any language. e.g. I am Angelin, I completed BSc Computer Science, I like working with data';

export default function SummaryWriter({ resume, note = '', onNote, value = '', onUse, big = false, extra = null }) {
  const id = useId();
  const [lang, setLang] = useState(DEFAULT_SPEECH_LANG);
  const [cards, setCards] = useState(null); // { options: [{ style, label, text, ai }], seed, ai }
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState('');
  const noteRef = useRef(null);
  const abortRef = useRef(null);
  const speech = useSpeech({ lang, onText: (words) => onNote?.(`${note ? `${note.trim()} ` : ''}${words}`.slice(0, NOTE_MAX)) });
  const fontSize = big ? 18 : 15;
  const btn = big ? 'btn btn-xl' : 'btn btn-lg';
  const ai = aiAvailable();

  // the cards follow the note and the resume: a change hides stale suggestions
  useEffect(() => { setCards(null); setNotice(''); }, [note]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const persona = () => {
    const p = dictionary.chips.find((c) => c.id === chip)?.id;
    return p === 'experienced' ? undefined : p;
  };
  const make = (seed = 0, why = '') => {
    const r = writeSummaries(resume, note, { seed, persona: persona() });
    setCards({ options: r.options.map((o) => ({ ...o, ai: false })), seed, ai: false });
    setNotice(why);
    setStatus(`${why ? `${why}. ` : ''}${r.options.length} suggestions ready. Tap one to use it.`);
  };
  const cancel = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); setStatus('Cancelled.'); };

  /** Layer B. `mode` generate / retry → three cards; shorter / professional / simpler → the summary box. */
  const writeAi = async (mode) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const seed = (cards?.seed ?? -1) + 1;
    setBusy(true);
    setNotice('');
    setStatus(WRITING_TEXT);
    try {
      const r = await writeWithAi(resume, note, mode, value, { signal: ctl.signal, hints: persona() });
      if (ctl.signal.aborted) return;
      if (mode === 'generate' || mode === 'retry') {
        const options = fillSlots(r.options, resume, note, { seed, hints: persona() });
        setCards({ options, seed, ai: true });
        setNotice(r.options.length ? '' : BUSY_TEXT);
        setStatus(`${r.options.length ? `${r.options.length} AI suggestions` : BUSY_TEXT}. Tap one to use it.`);
      } else if (r.options[0]) {
        onUse?.(r.options[0].text);
        setStatus(`${FIX_LABEL[mode]} — done. You can edit it below.`);
      } else {
        quickFix(mode, BUSY_TEXT);
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      const why = fallbackNotice(e);
      if (why === null) return;
      if (mode === 'generate' || mode === 'retry') make(seed, why);
      else quickFix(mode, why);
    } finally {
      if (abortRef.current === ctl) { abortRef.current = null; setBusy(false); }
    }
  };
  /** The template version of a quick fix (also what an AI quick fix falls back to). */
  const quickFix = (mode, why = '') => {
    if (mode === 'shorter') onUse?.(shorter(value));
    else if (mode === 'retry') { make((cards?.seed ?? 0) + 1, why); return; }
    setNotice(why);
    setStatus(why ? `${why}.` : `${FIX_LABEL[mode]} — done.`);
  };
  const fix = (mode) => (ai && (cards?.ai || mode === 'professional' || mode === 'simpler') ? writeAi(mode) : quickFix(mode));

  const useChip = (c) => {
    setChip(c.id);
    if (!note.trim()) onNote?.(c.text);
    else if (!note.toLowerCase().includes(c.text.trim().toLowerCase().slice(0, 12))) onNote?.(`${c.text}${note}`.slice(0, NOTE_MAX));
    noteRef.current?.focus();
  };
  const fixBtn = (mode, { disabled = false } = {}) => (
    <button key={mode} type="button" className="btn btn-outline" data-testid={`sw-${mode === 'retry' ? 'again' : mode}`} disabled={busy || disabled}
      onClick={() => fix(mode)} style={{ minHeight: 44 }}>{FIX_LABEL[mode]}</button>
  );

  return (
    <div className="stack g12 summary-writer" data-testid="summary-writer">
      <div className="field">
        <label className="label" htmlFor={`${id}-note`}>Tell us about yourself <span className="xs muted" style={{ fontWeight: 400 }}>· optional, never printed on your resume</span></label>
        <textarea id={`${id}-note`} ref={noteRef} className="input" rows={big ? 4 : 3} maxLength={NOTE_MAX} value={note} placeholder={HINT} style={{ fontSize }}
          onChange={(e) => onNote?.(e.target.value)} aria-describedby={`${id}-hint`} />
        <div className="row between g8" style={{ flexWrap: 'wrap' }}>
          <span id={`${id}-hint`} className="xs muted" style={{ flex: '1 1 200px' }}>{HINT}</span>
          <span className="xs faint">{note.length}/{NOTE_MAX}</span>
        </div>
      </div>

      {speech.supported && (
        <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={`${btn} ${speech.listening ? 'btn-ink' : 'btn-outline'}`} aria-pressed={speech.listening} data-testid="sw-speak"
            onClick={() => (speech.listening ? speech.stop() : speech.start())} style={{ minHeight: big ? 60 : 48, fontSize: big ? 18 : 15 }}>
            <Icon name="mic" size={big ? 22 : 18} /> {speech.listening ? 'Listening… tap to stop' : 'Speak'}
          </button>
          <label className="row g8 small" style={{ minHeight: 44 }}>
            <span className="muted">Language</span>
            <select className="input" aria-label="Speaking language" value={lang} onChange={(e) => setLang(e.target.value)} style={{ height: big ? 48 : 40, width: 'auto', fontSize }}>
              {SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          {speech.error && <span className="xs" role="alert" style={{ color: 'var(--danger)' }}>{speech.error}</span>}
        </div>
      )}

      <div className="row g8" role="group" aria-label="Starter sentences" style={{ flexWrap: 'wrap' }}>
        {dictionary.chips.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={chip === c.id} onClick={() => useChip(c)} style={{ minHeight: 44, fontSize: big ? 16 : 14 }}>{c.label}</button>
        ))}
      </div>

      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={`${btn} btn-ink`} data-testid="sw-make" disabled={busy} onClick={() => make(0)} style={{ flex: big ? '1 1 200px' : undefined }}>Make my summary</button>
        {ai && !busy && (
          <button type="button" className={`${btn} btn-outline`} data-testid="sw-ai" onClick={() => writeAi('generate')} style={{ flex: big ? '1 1 200px' : undefined }}>
            <Icon name="spark" size={big ? 22 : 18} /> Write with AI
          </button>
        )}
        {busy && (
          <span className="row g8" style={{ alignItems: 'center', fontSize }} data-testid="sw-writing">
            <span className="muted" aria-hidden="true">{WRITING_TEXT}</span>
            <button type="button" className="btn btn-outline" data-testid="sw-cancel" onClick={cancel} style={{ minHeight: 44 }}>Cancel</button>
          </span>
        )}
        {extra}
      </div>
      <span className="sr-only" aria-live="polite" data-testid="sw-status">{status}</span>
      {notice && <span className="small muted" role="status" data-testid="sw-notice" style={{ fontSize }}>{notice}</span>}

      {cards && (
        <div className="stack g8" data-testid="sw-cards">
          <span className="label">Pick one, then edit it as you like</span>
          {cards.options.map((o) => (
            <button key={o.style} type="button" className="option stack g4" data-testid={`sw-card-${o.style}`} onClick={() => { onUse?.(o.text); setStatus(`${o.label} summary filled in. You can edit it below.`); }}
              style={{ fontSize, lineHeight: 1.5, minHeight: 44 }} aria-pressed={value === o.text}>
              <span>{o.text}</span><span className="xs faint">{o.label}{o.ai ? ' · AI' : cards.ai ? ' · quick suggestion' : ''} · tap to use</span>
            </button>
          ))}
          <div className="row g8" style={{ flexWrap: 'wrap' }} role="group" aria-label="Quick fixes">
            {fixBtn('shorter', { disabled: !value.trim() })}
            {ai && fixBtn('professional', { disabled: !value.trim() })}
            {ai && fixBtn('simpler', { disabled: !value.trim() })}
            {fixBtn('retry')}
          </div>
        </div>
      )}
    </div>
  );
}
