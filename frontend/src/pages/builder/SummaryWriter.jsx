// The summary writer, above the summary box on the builder's Summary step, in Job Profile → Summary and in the kiosk
// builder. Layer A (smart templates, no network) lives here; "Write with AI" (Layer B) plugs in next to it.
//   note:   "Tell us about yourself" — typed or spoken, saved as a draft with the resume, never printed on it
//   chips:  a starter sentence for the note
//   Make my summary → three cards (Role-first, Skills-first, Simple); tap one to fill the summary box
//   quick fixes: Shorter (one sentence fewer), Try again (the next template variant)
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/ui';
import dictionary from '../../lib/summary/dictionary.json';
import { DEFAULT_SPEECH_LANG, SPEECH_LANGUAGES, useSpeech } from '../../lib/summary/speech';
import { shorter, writeSummaries } from '../../lib/summary/write';

export const NOTE_MAX = 1000;
const HINT = 'Write or speak in any language. e.g. I am Angelin, I completed BSc Computer Science, I like working with data';

export default function SummaryWriter({ resume, note = '', onNote, value = '', onUse, big = false, extra = null }) {
  const id = useId();
  const [lang, setLang] = useState(DEFAULT_SPEECH_LANG);
  const [cards, setCards] = useState(null); // { options, persona, seed }
  const [status, setStatus] = useState('');
  const [chip, setChip] = useState('');
  const noteRef = useRef(null);
  const speech = useSpeech({ lang, onText: (words) => onNote?.(`${note ? `${note.trim()} ` : ''}${words}`.slice(0, NOTE_MAX)) });
  const fontSize = big ? 18 : 15;
  const btn = big ? 'btn btn-xl' : 'btn btn-lg';

  // the cards follow the note and the resume: a change hides stale suggestions
  useEffect(() => { setCards(null); }, [note]);

  const make = (seed = 0) => {
    const persona = dictionary.chips.find((c) => c.id === chip)?.id;
    const hint = persona === 'experienced' ? undefined : persona;
    const r = writeSummaries(resume, note, { seed, persona: hint });
    setCards({ options: r.options, seed });
    setStatus(`${r.options.length} suggestions ready. Tap one to use it.`);
  };
  const useChip = (c) => {
    setChip(c.id);
    if (!note.trim()) onNote?.(c.text);
    else if (!note.toLowerCase().includes(c.text.trim().toLowerCase().slice(0, 12))) onNote?.(`${c.text}${note}`.slice(0, NOTE_MAX));
    noteRef.current?.focus();
  };

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

      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={`${btn} btn-ink`} data-testid="sw-make" onClick={() => make(0)} style={{ flex: big ? '1 1 200px' : undefined }}>Make my summary</button>
        {extra}
      </div>
      <span className="sr-only" aria-live="polite" data-testid="sw-status">{status}</span>

      {cards && (
        <div className="stack g8" data-testid="sw-cards">
          <span className="label">Pick one, then edit it as you like</span>
          {cards.options.map((o) => (
            <button key={o.style} type="button" className="option stack g4" data-testid={`sw-card-${o.style}`} onClick={() => { onUse?.(o.text); setStatus(`${o.label} summary filled in. You can edit it below.`); }}
              style={{ fontSize, lineHeight: 1.5, minHeight: 44 }} aria-pressed={value === o.text}>
              <span>{o.text}</span><span className="xs faint">{o.label} · tap to use</span>
            </button>
          ))}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" data-testid="sw-shorter" disabled={!value.trim()} onClick={() => onUse?.(shorter(value))} style={{ minHeight: 44 }}>Shorter</button>
            <button type="button" className="btn btn-outline" data-testid="sw-again" onClick={() => make(cards.seed + 1)} style={{ minHeight: 44 }}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
