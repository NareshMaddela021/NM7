// Small pieces shared by the two LinkedIn paths: Copy, the locked "Coming soon" cards (no checkout, ever), the
// "Tell us about yourself" box with Speak, the Save-to-PDF picture and the score ring.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon, useToast } from '../../components/ui';
import { COMING_SOON } from '../../lib/linkedin/guide';
import { KEYBOARD_TIP, MIXED_HINT, SPEECH_LANGUAGES, appendSpeech, defaultSpeechLang, rememberSpeechLang, useSpeech } from '../../lib/summary/speech';
import { charCount } from '../../lib/text';

export function CopyButton({ text, label = 'Copy', testid }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it'); }
  };
  return (
    <button type="button" className="btn btn-outline" data-testid={testid} onClick={copy} disabled={!text} style={{ minHeight: 44, gap: 6 }}>
      <Icon name="copy" size={16} />{label}
    </button>
  );
}

/** A paid Phase 2 item: visible, clearly locked, and its button does nothing but say "Coming soon". */
export function Locked({ items }) {
  return (
    <section className="card stack g12" aria-labelledby="li-locked-h" data-testid="li-locked">
      <h2 id="li-locked-h" className="h3" style={{ margin: 0 }}>Full rewrites</h2>
      <p className="small muted" style={{ margin: 0 }}>These are on the way. Nothing to pay now.</p>
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((it) => (
          <li key={it.id} className="well row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }} data-testid={`li-locked-${it.id}`}>
            <span className="row g8" style={{ alignItems: 'center' }}><Icon name="lock" size={16} /><span>{it.title}</span></span>
            <button type="button" className="btn btn-outline" aria-disabled="true" style={{ minHeight: 40, opacity: 0.7, cursor: 'not-allowed' }} onClick={(e) => e.preventDefault()}>{COMING_SOON}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const NOTE_MAX = 1000;
const HINT = 'Write or speak in any language. e.g. I finished B.Com in 2024 and want an accounts job in Hyderabad';

/** "Tell us about yourself", typed or spoken; what we write from it is always English. */
export function NoteBox({ note, onNote }) {
  const id = useId();
  const [lang, setLang] = useState(() => defaultSpeechLang());
  const now = useRef(note);
  now.current = note;
  const speech = useSpeech({ lang, onText: (w) => { const next = appendSpeech(now.current, w).slice(0, NOTE_MAX); now.current = next; onNote(next); } });
  return (
    <div className="stack g8">
      <div className="field">
        <label className="label" htmlFor={`${id}-note`}>Tell us about yourself <span className="xs muted" style={{ fontWeight: 400 }}>· optional</span></label>
        <textarea id={`${id}-note`} className="input" rows={3} maxLength={NOTE_MAX} value={note} placeholder={HINT} data-testid="li-note" onChange={(e) => onNote(e.target.value)} />
        <div className="row between g8" style={{ flexWrap: 'wrap' }}>
          <span className="xs muted" style={{ flex: '1 1 200px' }}>Any language is fine. Your LinkedIn text comes out in English.</span>
          <span className="xs faint">{charCount(note)}/{NOTE_MAX}</span>
        </div>
      </div>
      {speech.supported && (
        <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={`btn ${speech.listening ? 'btn-ink' : 'btn-outline'}`} aria-pressed={speech.listening} data-testid="li-speak"
            onClick={() => (speech.listening ? speech.stop() : speech.start())} style={{ minHeight: 48, gap: 8 }}>
            {speech.listening ? <span className="pulse-dot" aria-hidden="true" /> : <Icon name="mic" size={18} />}{speech.listening ? 'Stop' : 'Speak'}
          </button>
          <label className="row g8 small" style={{ minHeight: 44 }}>
            <span className="muted">Language</span>
            <select className="input" aria-label="Speaking language" value={lang} disabled={speech.listening} onChange={(e) => { setLang(e.target.value); rememberSpeechLang(e.target.value); }} style={{ height: 40, width: 'auto' }}>
              {SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          {speech.interim && <span className="muted small" style={{ fontStyle: 'italic' }}>{speech.interim}…</span>}
          {speech.error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{speech.error}</span>}
          <span className="xs muted" style={{ width: '100%' }}>{MIXED_HINT}</span>
        </div>
      )}
      <span className="xs muted">{KEYBOARD_TIP}</span>
    </div>
  );
}

/** A drawing (not a screenshot of LinkedIn) of where "Save to PDF" is: Profile > More > Save to PDF. */
export function SavePdfPicture() {
  return (
    <figure style={{ margin: 0 }} data-testid="li-pdf-picture">
      <svg viewBox="0 0 320 170" role="img" aria-label="Your profile, the More button under your name, and Save to PDF in its menu" style={{ width: '100%', maxWidth: 360, height: 'auto', display: 'block', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <rect x="0" y="0" width="320" height="44" fill="var(--sunken)" />
        <circle cx="44" cy="50" r="24" fill="var(--border)" stroke="var(--surface)" strokeWidth="4" />
        <rect x="20" y="84" width="120" height="10" rx="5" fill="var(--text3)" />
        <rect x="20" y="100" width="170" height="7" rx="3.5" fill="var(--border)" />
        <rect x="20" y="120" width="70" height="26" rx="13" fill="var(--ink)" />
        <text x="55" y="137" textAnchor="middle" fontSize="11" fill="var(--onink)" fontFamily="inherit">Open to</text>
        <rect x="98" y="120" width="70" height="26" rx="13" fill="none" stroke="var(--ink)" strokeWidth="2" />
        <text x="133" y="137" textAnchor="middle" fontSize="11" fill="var(--text)" fontFamily="inherit" fontWeight="700">More</text>
        <path d="M168 133 L196 120" stroke="var(--signal, #E8B400)" strokeWidth="3" />
        <rect x="196" y="78" width="112" height="78" rx="8" fill="var(--surface)" stroke="var(--border)" />
        <text x="208" y="98" fontSize="11" fill="var(--text3)" fontFamily="inherit">Send profile</text>
        <rect x="200" y="106" width="104" height="22" rx="5" fill="var(--signal, #FFE27A)" />
        <text x="208" y="121" fontSize="11" fill="#111" fontFamily="inherit" fontWeight="700">Save to PDF</text>
        <text x="208" y="146" fontSize="11" fill="var(--text3)" fontFamily="inherit">About this profile</text>
      </svg>
      <figcaption className="xs muted" style={{ marginTop: 6 }}>Drawing: Profile &gt; More &gt; Save to PDF (on the website; in the app, tap ⋯ on your profile).</figcaption>
    </figure>
  );
}

export function ScoreRing({ score, label }) {
  const r = 34; const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { setShown(score); }, [score]);
  return (
    <div className="row g12" style={{ alignItems: 'center' }}>
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--ink)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} transform="rotate(-90 44 44)" style={{ transition: 'stroke-dashoffset 600ms' }} />
      </svg>
      <div className="stack g4">
        <span data-testid="li-score" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{score}<span className="muted" style={{ fontSize: 18, fontWeight: 500 }}>/100</span></span>
        <span className="small muted">{label}</span>
      </div>
    </div>
  );
}
